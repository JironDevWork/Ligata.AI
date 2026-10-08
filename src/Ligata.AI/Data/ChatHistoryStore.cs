using Umbraco.Cms.Infrastructure.Scoping;

namespace Ligata.AI.Data;

/// <param name="Days">The history period in effect: the conversation is deleted this many days after this question at the latest.</param>
public sealed record NewChat(string KeyHash, Guid? ConsentId, string Engine, string Language, string PagePath, string PageTitle, int Days = 30);
public sealed record ChatTurn(string? ClientId, string Question, string? Files, string Answer, string? Lookups, string Outcome, bool OfferedTeam, string PagePath, long DurationMs, long PromptTokens, long CompletionTokens);
/// <summary>view: all | unanswered | team | kept</summary>
public sealed record HistoryQuery(string View = "all", string? Search = null, int Skip = 0, int Take = 50);
public sealed class HistoryCounts
{
    public int? Total { get; set; }
    public int? Unanswered { get; set; }
    public int? Team { get; set; }
    public int? Kept { get; set; }
}

/// <summary>The history of conversations with the AI (only while the site keeps one, see PrivacySettings.History).</summary>
public sealed class ChatHistoryStore(IScopeProvider scopes)
{
    public const int MaxTurnsPerChat = 400, MaxChats = 50_000;
    // Turn numbers are read-modify-write; one CMS instance serialises them here.
    private static readonly object Gate = new();
    // Conversations the visitor deleted: an answer still running when they did must not bring them back (kept longer than any answer).
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, DateTime> deleted = new();
    private static readonly TimeSpan Remember = TimeSpan.FromHours(2);

    /// <summary>
    /// Adds a question and its answer to the conversation with this key (created with the first question). The same question
    /// asked again (same ClientId, after an error) replaces the earlier attempt. Null when the conversation is full or the
    /// visitor deleted it while the answer was running.
    /// </summary>
    public ChatRow? Record(NewChat chat, ChatTurn turn, DateTime now)
    {
        lock (Gate)
        {
            if (deleted.ContainsKey(chat.KeyHash)) return null;
            using var scope = scopes.CreateScope();
            var db = scope.Database;
            var row = db.FirstOrDefault<ChatRow>("WHERE KeyHash=@0", chat.KeyHash);
            if (row == null)
            {
                row = new ChatRow
                {
                    Id = Guid.NewGuid(), KeyHash = chat.KeyHash, ConsentId = chat.ConsentId, Engine = chat.Engine, Language = chat.Language,
                    PagePath = chat.PagePath, PageTitle = chat.PageTitle, Topic = Topic(turn), CreatedUtc = now, UpdatedUtc = now,
                };
                db.Insert(row);
            }
            var existing = turn.ClientId == null ? null : db.FirstOrDefault<ChatTurnRow>("WHERE ChatId=@0 AND ClientId=@1", row.Id, turn.ClientId);
            if (existing == null && row.Turns >= MaxTurnsPerChat) { scope.Complete(); return null; }
            var stored = existing ?? new ChatTurnRow { ChatId = row.Id, ClientId = turn.ClientId, CreatedUtc = now, Attempts = 0 };
            stored.Question = turn.Question; stored.Files = turn.Files; stored.Answer = turn.Answer; stored.Lookups = turn.Lookups; stored.Outcome = turn.Outcome;
            stored.OfferedTeam = turn.OfferedTeam; stored.PagePath = turn.PagePath; stored.DurationMs = turn.DurationMs; stored.PromptTokens = turn.PromptTokens;
            stored.CompletionTokens = turn.CompletionTokens; stored.Attempts++;
            if (existing == null)
            {
                stored.Seq = db.ExecuteScalar<int>("SELECT COALESCE(MAX(Seq), 0) FROM LigataAIChatTurn WHERE ChatId=@0", row.Id) + 1;
                db.Insert(stored);
            }
            else db.Update(stored);
            row.Turns = db.ExecuteScalar<int>("SELECT COUNT(*) FROM LigataAIChatTurn WHERE ChatId=@0", row.Id);
            row.Unanswered = db.ExecuteScalar<int>("SELECT COUNT(*) FROM LigataAIChatTurn WHERE ChatId=@0 AND ((Outcome<>@1 AND Outcome<>@2) OR OfferedTeam=@3)", row.Id, "answered", "stopped", true);
            // Questions asked after the visitor agreed again belong to the newer consent: withdrawing that one deletes them.
            row.ConsentId = chat.ConsentId ?? row.ConsentId;
            row.UpdatedUtc = now;
            row.ExpiresUtc = now.AddDays(Math.Clamp(chat.Days, 1, 365));
            db.Update(row);
            scope.Complete();
            return row;
        }
    }

    private static string Topic(ChatTurn turn)
    {
        var line = turn.Question.ReplaceLineEndings(" ").Trim();
        if (line.Length == 0) line = turn.Files ?? "";
        return line.Length > 160 ? line[..157].TrimEnd() + "…" : line;
    }

    /// <summary>The AI's memory was full and the conversation was summarized.</summary>
    public void Summarized(string keyHash)
    {
        using var scope = scopes.CreateScope();
        scope.Database.Execute("UPDATE LigataAIChat SET Summaries=Summaries+1 WHERE KeyHash=@0", keyHash);
        scope.Complete();
    }

    /// <summary>The visitor asked the team from this conversation.</summary>
    public void Link(string keyHash, Guid conversationId)
    {
        using var scope = scopes.CreateScope();
        scope.Database.Execute("UPDATE LigataAIChat SET ConversationId=@0 WHERE KeyHash=@1", conversationId, keyHash);
        scope.Complete();
    }

    public ChatRow? Find(Guid id)
    {
        using var scope = scopes.CreateScope(autoComplete: true);
        return scope.Database.SingleOrDefaultById<ChatRow>(id);
    }

    public List<ChatTurnRow> Turns(Guid id)
    {
        using var scope = scopes.CreateScope(autoComplete: true);
        return scope.Database.Fetch<ChatTurnRow>("WHERE ChatId=@0 ORDER BY Seq", id);
    }

    public (List<ChatRow> Items, int Total) List(HistoryQuery query)
    {
        var where = new List<string>(); var args = new List<object>();
        string Arg(object value) { args.Add(value); return "@" + (args.Count - 1); }
        switch (query.View)
        {
            case "unanswered": where.Add("Unanswered>0"); break;
            case "team": where.Add("ConversationId IS NOT NULL"); break;
            case "kept": where.Add($"Kept={Arg(true)}"); break;
        }
        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var text = query.Search.Trim().Replace("[", "").Replace("%", "").Replace("_", "");
            var term = Arg("%" + text[..Math.Min(text.Length, 80)] + "%");
            // Also by the name or email of a team request the visitor started from the conversation (requests for access by email).
            where.Add($"(Topic LIKE {term} OR PagePath LIKE {term} OR Id IN (SELECT ChatId FROM LigataAIChatTurn WHERE Question LIKE {term} OR Answer LIKE {term})" +
                $" OR ConversationId IN (SELECT Id FROM LigataAIConversation WHERE Name LIKE {term} OR Email LIKE {term}))");
        }
        var filter = where.Count == 0 ? "" : "WHERE " + string.Join(" AND ", where);
        using var scope = scopes.CreateScope(autoComplete: true);
        var total = scope.Database.ExecuteScalar<int>("SELECT COUNT(*) FROM LigataAIChat " + filter, args.ToArray());
        var items = scope.Database.SkipTake<ChatRow>(Math.Max(0, query.Skip), Math.Clamp(query.Take, 1, 100), filter + " ORDER BY UpdatedUtc DESC", args.ToArray());
        return (items, total);
    }

    public HistoryCounts Counts()
    {
        using var scope = scopes.CreateScope(autoComplete: true);
        return scope.Database.Single<HistoryCounts>(@"SELECT COUNT(*) AS Total,
            SUM(CASE WHEN Unanswered>0 THEN 1 ELSE 0 END) AS Unanswered,
            SUM(CASE WHEN ConversationId IS NOT NULL THEN 1 ELSE 0 END) AS Team,
            SUM(CASE WHEN Kept=@0 THEN 1 ELSE 0 END) AS Kept
            FROM LigataAIChat", true);
    }

    /// <summary>Keeps a conversation beyond the history period until <paramref name="until"/>, for a reason (null: stop keeping it).</summary>
    public void Keep(Guid id, DateTime? until, string? reason, Guid? by)
    {
        using var scope = scopes.CreateScope();
        scope.Database.Execute("UPDATE LigataAIChat SET Kept=@0, KeptUntil=@1, KeptReason=@2, KeptBy=@3 WHERE Id=@4",
            until != null, (object?)until ?? DBNull.Value, (object?)reason ?? DBNull.Value, (object?)(until == null ? null : by) ?? DBNull.Value, id);
        scope.Complete();
    }

    public int Delete(Guid id) => Remove("WHERE Id=@0", id);

    /// <summary>The visitor deleted these conversations in the chat (keys hashed). An answer still running cannot bring them back.</summary>
    public int DeleteByKeys(IReadOnlyCollection<string> keyHashes)
    {
        if (keyHashes.Count == 0) return 0;
        Forget(keyHashes);
        return Remove("WHERE KeyHash IN (@0)", keyHashes);
    }

    /// <summary>The visitor withdrew this consent, or stopped the history: everything kept with it goes.</summary>
    public int DeleteByConsent(Guid consentId)
    {
        using (var scope = scopes.CreateScope(autoComplete: true)) Forget(scope.Database.Fetch<string>("SELECT KeyHash FROM LigataAIChat WHERE ConsentId=@0", consentId));
        return Remove("WHERE ConsentId=@0", consentId);
    }

    private static void Forget(IEnumerable<string> keyHashes)
    {
        var now = DateTime.UtcNow;
        foreach (var hash in keyHashes) deleted[hash] = now;
        if (deleted.Count > 1000) foreach (var old in deleted.Where(d => now - d.Value > Remember).Select(d => d.Key).ToList()) deleted.TryRemove(old, out _);
    }

    /// <summary>Every conversation the team has not kept.</summary>
    public int DeleteAll() => Remove("WHERE Kept=@0", false);

    /// <summary>
    /// Deletes conversations past their period: the one they were collected under (ExpiresUtc), or the current one when it is
    /// shorter (<paramref name="days"/>). Kept ones go when their keeping ends. Above the cap the oldest go first.
    /// </summary>
    public int Purge(DateTime now, int days, int maxStored = MaxChats)
    {
        var before = now.AddDays(-Math.Clamp(days, 1, 365));
        lock (Gate)
        {
            using var scope = scopes.CreateScope();
            var db = scope.Database;
            var ids = db.Fetch<Guid>("SELECT Id FROM LigataAIChat WHERE (Kept=@0 AND (ExpiresUtc<@1 OR UpdatedUtc<@2)) OR (Kept=@3 AND (KeptUntil IS NULL OR KeptUntil<@1))", false, now, before, true);
            var total = db.ExecuteScalar<int>("SELECT COUNT(*) FROM LigataAIChat") - ids.Count;
            if (total > maxStored)
                ids.AddRange(db.SkipTake<ChatRow>(0, total - maxStored, "WHERE Kept=@0 AND UpdatedUtc>=@1 ORDER BY UpdatedUtc", false, before).Where(r => !ids.Contains(r.Id)).Select(r => r.Id));
            foreach (var chunk in ids.Chunk(200))
            {
                db.Execute("DELETE FROM LigataAIChatTurn WHERE ChatId IN (@0)", chunk);
                db.Execute("DELETE FROM LigataAIChat WHERE Id IN (@0)", chunk);
            }
            scope.Complete();
            return ids.Count;
        }
    }

    private int Remove(string where, object argument)
    {
        lock (Gate)
        {
            using var scope = scopes.CreateScope();
            var db = scope.Database;
            var ids = db.Fetch<Guid>("SELECT Id FROM LigataAIChat " + where, argument);
            foreach (var chunk in ids.Chunk(200))
            {
                db.Execute("DELETE FROM LigataAIChatTurn WHERE ChatId IN (@0)", chunk);
                db.Execute("DELETE FROM LigataAIChat WHERE Id IN (@0)", chunk);
            }
            scope.Complete();
            return ids.Count;
        }
    }
}
