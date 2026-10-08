using Ligata.AI.Data;
using Ligata.AI.Models;
using Microsoft.Extensions.Options;

namespace Ligata.AI.Services;

public sealed class SupportException(string code, string message, int status = 400) : Exception(message)
{
    public string Code { get; } = code;
    public int Status { get; } = status;
}

public sealed record HistoryMessage(string Role, string Content);
/// <summary>HistoryKey: the key of the AI conversation the request starts from, so the team sees both linked in the history.</summary>
public sealed record CreateConversationRequest(string Kind, string? Name, string? Email, string Message, List<HistoryMessage>? History,
    string? PageTitle, string? PagePath, string? Language, string? RecaptchaToken, string? ClientId, string? HistoryKey = null);

/// <summary>Visitor and team actions on conversations: validation, limits, spam protection, notifications and counters.</summary>
public sealed class SupportService(SupportStore store, AssistantStore settingsStore, SupportHub hub, SupportMailer mailer, AgentDirectory directory,
    IContactCaptcha captcha, IOptions<AssistantOptions> options, ChatHistoryStore chats)
{
    public const int MaxVisitorCharacters = 4000, MaxAgentCharacters = 8000, MaxHistoryItems = 40, MaxHistoryCharacters = 30000;
    private static readonly string[] Languages = ["en", "de", "fr", "it"];
    private SupportLimits Limits => options.Value.Support;

    public (AssistantSettings Settings, FeatureState Features) Current()
    {
        var settings = settingsStore.Settings().Settings;
        return (settings, settings.Effective(options.Value.Features));
    }

    private static string Clip(string? value, int max) { var text = (value ?? "").Trim(); return text.Length > max ? text[..max] : text; }
    private static string Clean(string? value, int max) => Clip(new string((value ?? "").Where(c => !char.IsControl(c)).ToArray()), max);

    private static string? Field(string? value, string mode, int max, string code, string label)
    {
        var text = Clean(value, max + 1);
        if (mode == "hidden") return null;
        if (text.Length > max) throw new SupportException(code, $"{label} is too long.");
        if (text.Length == 0) { if (mode == "required") throw new SupportException(code, $"Please enter your {label.ToLowerInvariant()}."); return null; }
        return text;
    }

    // ---------- visitor ----------
    public async Task<(ConversationRow Row, string Token)> CreateAsync(CreateConversationRequest request, string visitor, CancellationToken token)
    {
        var (settings, features) = Current();
        var kind = request.Kind == "email" ? "email" : "chat";
        if (!settings.Enabled || (kind == "chat" ? !features.LiveChat : !features.Email)) throw new SupportException("channel_disabled", "This contact option is switched off.", 403);
        var online = hub.OnlineAgents() > 0;
        var name = Field(request.Name, kind == "chat" ? settings.Support.NameField : settings.Contact.NameField, 100, "invalid_name", "Name");
        var emailMode = kind == "email" || (!online && settings.Support.RequireEmailWhenOffline && settings.Support.EmailField != "hidden") ? "required" : settings.Support.EmailField;
        var email = Field(request.Email, emailMode, 200, "invalid_email", "Email address");
        if (email != null && !AssistantValidation.Email(email)) throw new SupportException("invalid_email", "Please enter a valid email address.");
        var message = Clip(request.Message, MaxVisitorCharacters + 1);
        if (message.Length == 0) throw new SupportException("invalid_message", "Please write a message.");
        if (message.Length > MaxVisitorCharacters) throw new SupportException("message_too_long", $"Messages can be at most {MaxVisitorCharacters:N0} characters.", 413);
        var history = new List<HistoryItem>();
        var budget = MaxHistoryCharacters;
        foreach (var item in (request.History ?? []).TakeLast(MaxHistoryItems).Reverse())
        {
            if (item.Role is not ("user" or "assistant")) throw new SupportException("invalid_history", "Invalid conversation.");
            var text = Clip(item.Content, Math.Min(4000, budget));
            if (text.Length == 0) continue;
            budget -= text.Length;
            history.Insert(0, new HistoryItem(item.Role, text));
            if (budget <= 0) break;
        }

        if (store.OpenForVisitor(visitor) >= Limits.OpenConversationsPerVisitor) throw new SupportException("too_many_open", "You already have open conversations with the team. Continue one of them or wait for an answer.", 429);
        if (store.CreatedSince(visitor, DateTime.UtcNow.AddDays(-1)) >= Limits.ConversationsPerVisitorPerDay) throw new SupportException("rate_limited", "You have contacted the team several times today. Please wait for an answer.", 429);
        if (kind == "email" && store.CreatedSince(visitor, DateTime.UtcNow.AddHours(-1), "email") >= Limits.EmailsPerVisitorPerHour) throw new SupportException("rate_limited", "You have sent several messages in the last hour. Please wait for an answer.", 429);
        if (store.OpenTotal() >= Limits.MaxOpenConversations) throw new SupportException("inbox_full", "The team is receiving too many requests right now. Please try again later.", 503);

        if (settings.Support.UseRecaptcha && captcha.Ready)
        {
            var result = await captcha.VerifyAsync(request.RecaptchaToken, token);
            if (result == CaptchaResult.Rejected) throw new SupportException("captcha_failed", "The spam check failed. Please try again.", 400);
            if (result == CaptchaResult.Unavailable) throw new SupportException("captcha_unavailable", "The spam check is not available right now. Please try again in a moment.", 503);
        }

        var language = Languages.Contains(request.Language) ? request.Language! : "";
        var row = store.Create(new NewConversation(kind, name, email, message, history, Clean(request.PagePath, 300), Clean(request.PageTitle, 150), language, visitor, Clean(request.ClientId, 40) is { Length: > 0 } id ? id : null), out var secret);
        settingsStore.Count(s => { if (kind == "chat") s.ChatRequests++; else s.EmailRequests++; });
        if (ChatHistory.Hash(request.HistoryKey) is { } historyKey) chats.Link(historyKey, row.Id);
        if (kind == "chat") mailer.TeamNewChat(settings, row, store.Messages(row.Id, 0, team: true), hub.OnlineAgents());
        else { mailer.TeamEmail(settings, row, message); mailer.VisitorConfirmation(settings, row, message); }
        store.Notified(row.Id);
        return (row, secret);
    }

    public ConversationRow Authorize(Guid id, string? token)
    {
        var row = store.Find(id);
        // The same answer for a missing conversation and a wrong token.
        if (row == null || !SupportStore.Verify(row, token)) throw new SupportException("not_found", "This conversation is no longer available.", 404);
        return row;
    }

    public MessageRow VisitorMessage(Guid id, string? token, string? text, string? clientId)
    {
        var row = Authorize(id, token);
        var (settings, features) = Current();
        if (row.Kind != "chat" || !features.LiveChat) throw new SupportException("channel_disabled", "Live chat is switched off.", 403);
        if (row.State == "closed") throw new SupportException("closed", "This conversation was closed. Start a new one.", 409);
        var message = Clip(text, MaxVisitorCharacters + 1);
        if (message.Length == 0) throw new SupportException("invalid_message", "Please write a message.");
        if (message.Length > MaxVisitorCharacters) throw new SupportException("message_too_long", $"Messages can be at most {MaxVisitorCharacters:N0} characters.", 413);
        if (store.MessageCount(id) >= Limits.MaxMessagesPerConversation) throw new SupportException("conversation_full", "This conversation is very long. Please start a new one.", 413);
        hub.Typing(id, "visitor", false);
        var (updated, stored) = store.Write(id, _ => new MessageRow { Author = "visitor", Kind = "message", Text = message, ClientId = Clean(clientId, 40) is { Length: > 0 } c ? c : null });
        // Nobody from the team is here: tell them by email, at most every 15 minutes per conversation.
        if (updated.AgentKeys.Count == 0 && (updated.NotifiedUtc == null || updated.NotifiedUtc < DateTime.UtcNow.AddMinutes(-15)) && mailer.CanNotify(settings))
        {
            mailer.TeamVisitorMessage(settings, updated, store.Messages(id, updated.LastAgentSeq, team: true).Where(m => m.Author == "visitor" && m.Kind == "message").ToList());
            store.Notified(id);
        }
        return stored!;
    }

    public void VisitorClose(Guid id, string? token)
    {
        var row = Authorize(id, token);
        if (row.State == "closed") return;
        store.Write(id, r => { r.State = "closed"; r.ClosedUtc = DateTime.UtcNow; r.ClosedReason = "visitor"; r.Agents = ""; return new MessageRow { Author = "visitor", Kind = "close" }; });
    }

    /// <summary>Everything the visitor's widget needs after <paramref name="after"/>.</summary>
    public object VisitorView(ConversationRow row, int after, AssistantSettings settings)
    {
        var events = store.Messages(row.Id, after, team: false, max: 300);
        object? Agent(Guid? key) => key is { } k ? directory.Card(k, settings).Public() : null;
        var typing = hub.TypingIn(row.Id).Where(w => w != "visitor").Select(w => Guid.TryParse(w, out var k) ? directory.Card(k, settings).Name ?? "" : "").ToList();
        return new
        {
            // Messages are read after the row: a message written in between is included, so report the highest sequence actually sent.
            id = row.Id, kind = row.Kind, state = row.State, seq = Math.Max(row.LastSeq, events.Count > 0 ? events[^1].Seq : 0),
            agents = row.AgentKeys.Select(k => directory.Card(k, settings).Public()).ToList(),
            typing, online = hub.OnlineAgents(),
            events = events.Select(m => new { m.Seq, m.Kind, m.Author, text = m.Kind is "message" or "email" ? m.Text : null, at = DateTime.SpecifyKind(m.CreatedUtc, DateTimeKind.Utc), agent = m.Author == "agent" ? Agent(m.AgentKey) : null, m.ClientId }),
        };
    }

    // ---------- team ----------
    public ConversationRow Join(Guid id, Guid agent)
    {
        var (_, features) = Current();
        if (!features.LiveChat) throw new SupportException("channel_disabled", "Live chat is switched off in the settings.", 403);
        return store.Write(id, r =>
        {
            if (r.Kind != "chat") throw new SupportException("not_chat", "Email requests are answered by email.", 409);
            if (r.State == "closed") throw new SupportException("closed", "Reopen the conversation first.", 409);
            if (r.AgentKeys.Contains(agent)) return null;
            r.Agents = string.Join(",", r.AgentKeys.Append(agent).Select(k => k.ToString("D")));
            r.State = "active";
            return new MessageRow { Author = "agent", AgentKey = agent, Kind = "join" };
        }).Row;
    }

    public ConversationRow Leave(Guid id, Guid agent, string reason = "") => store.Write(id, r =>
    {
        if (!r.AgentKeys.Contains(agent)) return null;
        r.Agents = string.Join(",", r.AgentKeys.Where(k => k != agent).Select(k => k.ToString("D")));
        if (r.Agents == "" && r.State == "active") r.State = "open";
        hub.Typing(id, agent.ToString("D"), false);
        return new MessageRow { Author = "agent", AgentKey = agent, Kind = "leave", Text = reason };
    }).Row;

    public MessageRow AgentMessage(Guid id, Guid agent, string? text, bool note)
    {
        var message = Clip(text, MaxAgentCharacters + 1);
        if (message.Length == 0) throw new SupportException("invalid_message", "Write a message first.");
        if (message.Length > MaxAgentCharacters) throw new SupportException("message_too_long", $"Messages can be at most {MaxAgentCharacters:N0} characters.", 413);
        DateTime? firstResponse = null; DateTime created = default;
        var (row, stored) = store.Write(id, r =>
        {
            if (!note)
            {
                if (r.Kind != "chat") throw new SupportException("not_chat", "Email requests are answered by email.", 409);
                if (r.State == "closed") throw new SupportException("closed", "This conversation is closed. Reopen it to write.", 409);
                if (!r.AgentKeys.Contains(agent)) throw new SupportException("not_joined", "Join the conversation before writing to the visitor.", 409);
            }
            firstResponse = r.FirstResponseUtc; created = r.CreatedUtc;
            return new MessageRow { Author = "agent", AgentKey = agent, Kind = note ? "note" : "message", Text = message };
        });
        if (!note) Replied(firstResponse, created);
        hub.Typing(id, agent.ToString("D"), false);
        return stored!;
    }

    public MessageRow EmailReply(Guid id, Guid agent, string? text)
    {
        var (settings, _) = Current();
        if (!mailer.Licensed) throw new SupportException("email_disabled", "Email is not included in this installation.", 403);
        var message = Clip(text, MaxAgentCharacters + 1);
        if (message.Length == 0) throw new SupportException("invalid_message", "Write a message first.");
        if (message.Length > MaxAgentCharacters) throw new SupportException("message_too_long", $"Messages can be at most {MaxAgentCharacters:N0} characters.", 413);
        var row = store.Find(id) ?? throw new SupportNotFoundException();
        if (!AssistantValidation.Email(row.Email)) throw new SupportException("no_email", "The visitor did not leave an email address.", 409);
        var card = directory.Card(agent, settings);
        var team = string.IsNullOrWhiteSpace(settings.Support.TeamName) ? (string.IsNullOrWhiteSpace(settings.Behaviour.SiteName) ? settings.Identity.Name : settings.Behaviour.SiteName) : settings.Support.TeamName;
        DateTime? firstResponse = null;
        var (updated, stored) = store.Write(id, r => { firstResponse = r.FirstResponseUtc; return new MessageRow { Author = "agent", AgentKey = agent, Kind = "email", Text = message }; });
        mailer.Reply(settings, updated, message, card.Name is { } name ? $"{name} · {team}" : team);
        Replied(firstResponse, updated.CreatedUtc);
        return stored!;
    }

    private void Replied(DateTime? firstResponseBefore, DateTime created) => settingsStore.Count(s =>
    {
        s.AgentReplies++;
        if (firstResponseBefore == null) { s.Responses++; s.FirstResponseMs += (long)(DateTime.UtcNow - created).TotalMilliseconds; }
    });

    public ConversationRow Close(Guid id, Guid? agent, string reason = "team") => store.Write(id, r =>
    {
        if (r.State == "closed") return null;
        r.State = "closed"; r.ClosedUtc = DateTime.UtcNow; r.ClosedReason = reason; r.Agents = "";
        return new MessageRow { Author = agent == null ? "system" : "agent", AgentKey = agent, Kind = "close", Text = reason };
    }).Row;

    public ConversationRow Reopen(Guid id, Guid agent) => store.Write(id, r =>
    {
        if (r.State != "closed") return null;
        r.State = "open"; r.ClosedUtc = null; r.ClosedReason = null;
        return new MessageRow { Author = "agent", AgentKey = agent, Kind = "reopen" };
    }).Row;

    // ---------- lifecycle (worker) ----------
    public int Maintain()
    {
        var (settings, _) = Current();
        var changes = 0;
        foreach (var id in store.Inactive(DateTime.UtcNow.AddDays(-settings.Support.InactivityDays)))
        {
            try { Close(id, null, "inactive"); changes++; } catch (SupportNotFoundException) { }
        }
        // Team members who closed the backoffice leave their conversations after 15 minutes, so nobody waits for a ghost.
        var cutoff = DateTime.UtcNow.AddMinutes(-15);
        foreach (var row in store.Active())
            foreach (var agent in row.AgentKeys)
                if ((hub.AgentLastSeen(agent) ?? hub.StartedUtc) < cutoff) { Leave(row.Id, agent, "away"); changes++; }
        changes += store.Purge(DateTime.UtcNow.AddDays(-settings.Support.RetentionDays), Math.Max(100, Limits.MaxStoredConversations));
        store.PurgeEmails();
        hub.Sweep();
        return changes;
    }
}
