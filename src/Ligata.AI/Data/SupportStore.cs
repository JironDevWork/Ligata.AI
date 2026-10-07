using System.Security.Cryptography;
using System.Text;
using Ligata.AI.Services;
using Umbraco.Cms.Infrastructure.Scoping;

namespace Ligata.AI.Data;

public sealed record HistoryItem(string Role, string Text);
public sealed record NewConversation(string Kind, string? Name, string? Email, string Message, IReadOnlyList<HistoryItem> History, string PagePath, string PageTitle, string Language, string Visitor, string? ClientId);
/// <summary>view: needs | active | open | closed | mine | all</summary>
public sealed record InboxQuery(string View = "needs", string? Kind = null, string? Search = null, int Skip = 0, int Take = 50);
public sealed class InboxCounts
{
    public int? NeedsReply { get; set; }
    public int? Active { get; set; }
    public int? OpenCount { get; set; }
    public int? Closed { get; set; }
    public int? Unread { get; set; }
    public int? Mine { get; set; }
}

public sealed class SupportNotFoundException() : Exception("This conversation does not exist (any more).");

/// <summary>Team conversations, their messages, team member profiles and the outgoing email queue.</summary>
public sealed class SupportStore(IScopeProvider scopes, SupportHub hub)
{
    // Sequence numbers are read-modify-write; one CMS instance serialises them here.
    private static readonly object Gate = new();

    public static (string Token, string Hash) NewToken()
    {
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return (token, Hash(token));
    }

    public static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();

    public static bool Verify(ConversationRow row, string? token) =>
        token is { Length: > 20 and < 100 } && CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Hash(token)), Encoding.ASCII.GetBytes(row.TokenHash));

    // ---------- conversations ----------
    public ConversationRow Create(NewConversation request, out string token)
    {
        var (secret, hash) = NewToken();
        token = secret;
        var now = DateTime.UtcNow;
        var row = new ConversationRow
        {
            Id = Guid.NewGuid(), TokenHash = hash, Kind = request.Kind, State = "open", Name = request.Name, Email = request.Email,
            Topic = Topic(request.Message), PagePath = request.PagePath, PageTitle = request.PageTitle, Language = request.Language,
            Visitor = request.Visitor, CreatedUtc = now, UpdatedUtc = now,
        };
        var messages = new List<MessageRow>();
        foreach (var item in request.History) messages.Add(new MessageRow { Author = item.Role == "assistant" ? "ai" : "visitor", Kind = "history", Text = item.Text });
        if (request.Kind == "chat") messages.Add(new MessageRow { Author = "system", Kind = "request", Text = "" });
        messages.Add(new MessageRow { Author = "visitor", Kind = "message", Text = request.Message, ClientId = request.ClientId });
        lock (Gate)
        {
            using var scope = scopes.CreateScope();
            foreach (var message in messages)
            {
                message.ConversationId = row.Id; message.Seq = ++row.LastSeq; message.CreatedUtc = now;
                if (message.Kind == "message") row.LastVisitorSeq = message.Seq;
            }
            scope.Database.Insert(row);
            foreach (var message in messages) scope.Database.Insert(message);
            scope.Complete();
        }
        hub.Changed(row.Id);
        return row;
    }

    private static string Topic(string message)
    {
        var line = message.ReplaceLineEndings(" ").Trim();
        return line.Length > 160 ? line[..157].TrimEnd() + "…" : line;
    }

    public ConversationRow? Find(Guid id)
    {
        using var scope = scopes.CreateScope(autoComplete: true);
        return scope.Database.SingleOrDefaultById<ConversationRow>(id);
    }

    public int OpenForVisitor(string visitor)
    {
        using var scope = scopes.CreateScope(autoComplete: true);
        return scope.Database.ExecuteScalar<int>("SELECT COUNT(*) FROM LigataAIConversation WHERE Visitor=@0 AND State<>@1", visitor, "closed");
    }

    public int CreatedSince(string visitor, DateTime since, string? kind = null)
    {
        using var scope = scopes.CreateScope(autoComplete: true);
        return kind == null
            ? scope.Database.ExecuteScalar<int>("SELECT COUNT(*) FROM LigataAIConversation WHERE Visitor=@0 AND CreatedUtc>@1", visitor, since)
            : scope.Database.ExecuteScalar<int>("SELECT COUNT(*) FROM LigataAIConversation WHERE Visitor=@0 AND CreatedUtc>@1 AND Kind=@2", visitor, since, kind);
    }

    public int OpenTotal()
    {
        using var scope = scopes.CreateScope(autoComplete: true);
        return scope.Database.ExecuteScalar<int>("SELECT COUNT(*) FROM LigataAIConversation WHERE State<>@0", "closed");
    }

    /// <summary>
    /// Changes a conversation under the sequence lock. <paramref name="change"/> mutates the row and
    /// returns the message to append (or null). Returns the updated row and the stored message.
    /// </summary>
    public (ConversationRow Row, MessageRow? Message) Write(Guid id, Func<ConversationRow, MessageRow?> change)
    {
        ConversationRow row; MessageRow? message;
        lock (Gate)
        {
            using var scope = scopes.CreateScope();
            row = scope.Database.SingleOrDefaultById<ConversationRow>(id) ?? throw new SupportNotFoundException();
            message = change(row);
            var now = DateTime.UtcNow;
            if (message != null)
            {
                if (message.ClientId != null && scope.Database.FirstOrDefault<MessageRow>("WHERE ConversationId=@0 AND ClientId=@1", id, message.ClientId) is { } duplicate)
                {
                    scope.Complete();
                    return (row, duplicate);
                }
                message.ConversationId = id; message.Seq = ++row.LastSeq; message.CreatedUtc = now;
                if (message.Author == "visitor" && message.Kind == "message") row.LastVisitorSeq = message.Seq;
                if (message.Author == "agent" && message.Kind is "message" or "email") { row.LastAgentSeq = message.Seq; row.FirstResponseUtc ??= now; }
                if (message.Kind != "note") row.UpdatedUtc = now;
                scope.Database.Insert(message);
            }
            scope.Database.Update(row);
            scope.Complete();
        }
        hub.Changed(id);
        return (row, message);
    }

    public List<MessageRow> Messages(Guid id, int after, bool team, int max = 1000)
    {
        using var scope = scopes.CreateScope(autoComplete: true);
        return team
            ? scope.Database.Fetch<MessageRow>("WHERE ConversationId=@0 AND Seq>@1 ORDER BY Seq", id, after).Take(max).ToList()
            : scope.Database.Fetch<MessageRow>("WHERE ConversationId=@0 AND Seq>@1 AND Kind<>@2 AND Kind<>@3 ORDER BY Seq", id, after, "note", "history").Take(max).ToList();
    }

    public int MessageCount(Guid id)
    {
        using var scope = scopes.CreateScope(autoComplete: true);
        return scope.Database.ExecuteScalar<int>("SELECT COUNT(*) FROM LigataAIMessage WHERE ConversationId=@0", id);
    }

    public (List<ConversationRow> Items, int Total) List(InboxQuery query, Guid me)
    {
        var where = new List<string>(); var args = new List<object>();
        string Arg(object value) { args.Add(value); return "@" + (args.Count - 1); }
        switch (query.View)
        {
            case "needs": where.Add($"State<>{Arg("closed")} AND LastVisitorSeq>LastAgentSeq"); break;
            case "active": where.Add($"State={Arg("active")}"); break;
            case "open": where.Add($"State<>{Arg("closed")}"); break;
            case "closed": where.Add($"State={Arg("closed")}"); break;
            case "mine": where.Add($"Agents LIKE {Arg("%" + me.ToString("D") + "%")}"); break;
        }
        if (query.Kind is "chat" or "email") where.Add($"Kind={Arg(query.Kind)}");
        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var term = "%" + query.Search.Trim().Replace("[", "").Replace("%", "").Replace("_", "")[..Math.Min(query.Search.Trim().Length, 80)] + "%";
            where.Add($"(Name LIKE {Arg(term)} OR Email LIKE {Arg(term)} OR Topic LIKE {Arg(term)})");
        }
        var filter = where.Count == 0 ? "" : "WHERE " + string.Join(" AND ", where);
        using var scope = scopes.CreateScope(autoComplete: true);
        var total = scope.Database.ExecuteScalar<int>("SELECT COUNT(*) FROM LigataAIConversation " + filter, args.ToArray());
        var items = scope.Database.SkipTake<ConversationRow>(Math.Max(0, query.Skip), Math.Clamp(query.Take, 1, 100), filter + " ORDER BY UpdatedUtc DESC", args.ToArray());
        return (items, total);
    }

    public InboxCounts Counts(Guid me)
    {
        using var scope = scopes.CreateScope(autoComplete: true);
        return scope.Database.Single<InboxCounts>(@"SELECT
            SUM(CASE WHEN State<>@0 AND LastVisitorSeq>LastAgentSeq THEN 1 ELSE 0 END) AS NeedsReply,
            SUM(CASE WHEN State=@1 THEN 1 ELSE 0 END) AS Active,
            SUM(CASE WHEN State<>@0 THEN 1 ELSE 0 END) AS OpenCount,
            SUM(CASE WHEN State=@0 THEN 1 ELSE 0 END) AS Closed,
            SUM(CASE WHEN State<>@0 AND LastVisitorSeq>TeamReadSeq THEN 1 ELSE 0 END) AS Unread,
            SUM(CASE WHEN State<>@0 AND Agents LIKE @2 THEN 1 ELSE 0 END) AS Mine
            FROM LigataAIConversation", "closed", "active", "%" + me.ToString("D") + "%");
    }

    public void MarkRead(Guid id, int seq)
    {
        int changed;
        using (var scope = scopes.CreateScope())
        {
            changed = scope.Database.Execute("UPDATE LigataAIConversation SET TeamReadSeq=@0 WHERE Id=@1 AND TeamReadSeq<@0", seq, id);
            scope.Complete();
        }
        if (changed > 0) hub.Inbox.Fire();
    }

    public void Notified(Guid id)
    {
        using var scope = scopes.CreateScope();
        scope.Database.Execute("UPDATE LigataAIConversation SET NotifiedUtc=@0 WHERE Id=@1", DateTime.UtcNow, id);
        scope.Complete();
    }

    public void Delete(Guid id)
    {
        lock (Gate)
        {
            using var scope = scopes.CreateScope();
            scope.Database.Execute("DELETE FROM LigataAIMessage WHERE ConversationId=@0", id);
            scope.Database.Execute("DELETE FROM LigataAIConversation WHERE Id=@0", id);
            scope.Complete();
        }
        hub.Changed(id);
    }

    // ---------- lifecycle ----------
    public List<Guid> Inactive(DateTime before)
    {
        using var scope = scopes.CreateScope(autoComplete: true);
        return scope.Database.Fetch<Guid>("SELECT Id FROM LigataAIConversation WHERE State<>@0 AND UpdatedUtc<@1", "closed", before);
    }

    public List<ConversationRow> Active()
    {
        using var scope = scopes.CreateScope(autoComplete: true);
        return scope.Database.Fetch<ConversationRow>("WHERE State=@0", "active");
    }

    /// <summary>Deletes closed conversations past retention and, above the storage cap, the oldest closed ones.</summary>
    public int Purge(DateTime closedBefore, int maxStored)
    {
        lock (Gate)
        {
            using var scope = scopes.CreateScope();
            var db = scope.Database;
            var ids = db.Fetch<Guid>("SELECT Id FROM LigataAIConversation WHERE State=@0 AND ClosedUtc<@1", "closed", closedBefore);
            var total = db.ExecuteScalar<int>("SELECT COUNT(*) FROM LigataAIConversation") - ids.Count;
            if (total > maxStored)
                ids.AddRange(db.SkipTake<ConversationRow>(0, total - maxStored, "WHERE State=@0 AND ClosedUtc>=@1 ORDER BY ClosedUtc", "closed", closedBefore).Select(r => r.Id));
            foreach (var chunk in ids.Chunk(200))
            {
                db.Execute("DELETE FROM LigataAIMessage WHERE ConversationId IN (@0)", chunk);
                db.Execute("DELETE FROM LigataAIConversation WHERE Id IN (@0)", chunk);
            }
            scope.Complete();
            if (ids.Count > 0) hub.Inbox.Fire();
            return ids.Count;
        }
    }

    // ---------- team members ----------
    public AgentRow Agent(Guid user)
    {
        lock (Gate)
        {
            using var scope = scopes.CreateScope();
            var row = scope.Database.SingleOrDefaultById<AgentRow>(user);
            if (row == null) { row = new AgentRow { UserKey = user, PublicId = Guid.NewGuid(), UpdatedUtc = DateTime.UtcNow }; scope.Database.Insert(row); }
            scope.Complete();
            return row;
        }
    }

    public AgentRow? AgentByPublicId(Guid publicId)
    {
        using var scope = scopes.CreateScope(autoComplete: true);
        return scope.Database.FirstOrDefault<AgentRow>("WHERE PublicId=@0", publicId);
    }

    public List<AgentRow> Agents()
    {
        using var scope = scopes.CreateScope(autoComplete: true);
        return scope.Database.Fetch<AgentRow>("");
    }

    public void SaveAgent(AgentRow row)
    {
        row.UpdatedUtc = DateTime.UtcNow;
        using var scope = scopes.CreateScope();
        scope.Database.Update(row);
        scope.Complete();
    }

    // ---------- email queue ----------
    public void Enqueue(EmailRow email)
    {
        email.State = "pending"; email.CreatedUtc = DateTime.UtcNow; email.NextAttemptUtc = DateTime.UtcNow;
        using var scope = scopes.CreateScope();
        scope.Database.Insert(email);
        scope.Complete();
    }

    public EmailRow? ClaimEmail()
    {
        lock (Gate)
        {
            using var scope = scopes.CreateScope();
            // A send interrupted by a restart may or may not have reached the mail server; never resend it blindly.
            scope.Database.Execute("UPDATE LigataAIEmail SET State=@0, LastError=@1 WHERE State=@2 AND NextAttemptUtc<@3", "failed", "Interrupted while sending; it may or may not have been delivered.", "sending", DateTime.UtcNow.AddMinutes(-10));
            var email = scope.Database.SkipTake<EmailRow>(0, 1, "WHERE State=@0 AND NextAttemptUtc<=@1 ORDER BY Id", "pending", DateTime.UtcNow).FirstOrDefault();
            if (email != null)
            {
                email.State = "sending"; email.Attempts++; email.NextAttemptUtc = DateTime.UtcNow;
                scope.Database.Update(email);
            }
            scope.Complete();
            return email;
        }
    }

    public void CompleteEmail(EmailRow email, string? error)
    {
        if (error == null) { email.State = "sent"; email.SentUtc = DateTime.UtcNow; email.LastError = null; }
        else if (email.Attempts >= 5) { email.State = "failed"; email.LastError = error; }
        else { email.State = "pending"; email.LastError = error; email.NextAttemptUtc = DateTime.UtcNow.AddMinutes(Math.Pow(2, email.Attempts)); }
        using var scope = scopes.CreateScope();
        scope.Database.Update(email);
        scope.Complete();
    }

    public void PurgeEmails()
    {
        using var scope = scopes.CreateScope();
        scope.Database.Execute("DELETE FROM LigataAIEmail WHERE (State=@0 AND CreatedUtc<@1) OR (State=@2 AND CreatedUtc<@3)", "sent", DateTime.UtcNow.AddDays(-7), "failed", DateTime.UtcNow.AddDays(-30));
        scope.Complete();
    }

    public List<EmailRow> RecentEmails(int take)
    {
        using var scope = scopes.CreateScope(autoComplete: true);
        return scope.Database.SkipTake<EmailRow>(0, take, "ORDER BY Id DESC");
    }
}
