using System.Text;
using System.Text.Json;
using Ligata.AI.Data;
using Ligata.AI.Models;
using Microsoft.Extensions.Logging;

namespace Ligata.AI.Services;

/// <summary>
/// What became of one question, filled in by the engine while it answers: the answer as the visitor saw it, what the AI looked
/// up, the tokens, and how it ended. Only created while the site keeps a history.
/// </summary>
public sealed class ChatOutcome
{
    public StringBuilder Answer { get; } = new();
    public List<IReadOnlyList<ChatLookup>> Lookups { get; } = [];
    /// <summary>The request was valid and went to the engine (invalid requests are not kept).</summary>
    public bool Reached { get; set; }
    /// <summary>The answer was complete.</summary>
    public bool Done { get; set; }
    /// <summary>The error the visitor saw (busy, offline, context_full, …); null with Done false means the visitor stopped the answer.</summary>
    public string? Error { get; set; }
    public long PromptTokens { get; set; }
    public long CompletionTokens { get; set; }

    public void Append(string text) { if (Answer.Length < ChatRelay.MaxAssistantCharacters) Answer.Append(text); }
}

/// <summary>
/// Keeps conversations with the AI for the team while the site keeps a history (Privacy tab). The browser sends a random key
/// per conversation; only its hash is stored, so the key proves that a deletion comes from the visitor's own browser.
/// </summary>
public sealed class ChatHistory(ChatHistoryStore store, ILogger<ChatHistory> logger)
{
    public static bool Enabled(AssistantSettings settings, FeatureState features) => features.Assistant && settings.Privacy.History;

    /// <summary>The stored form of a browser's conversation key; null for anything that is not one.</summary>
    public static string? Hash(string? key) =>
        key is { Length: >= 20 and <= 100 } && key.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_') ? SupportStore.Hash(key) : null;

    private static string Clip(string? value, int max)
    {
        var text = (value ?? "").Trim();
        return text.Length > max ? text[..max] : text;
    }

    /// <summary>Stores the question and its outcome, kept for <paramref name="days"/> at most. Never throws: the visitor already has the answer.</summary>
    public void Record(ChatRequest request, ChatOutcome outcome, string engine, long durationMs, int days)
    {
        if (!outcome.Reached || Hash(request.History) is not { } hash || request.Messages is not { Count: > 0 }) return;
        try
        {
            if (request.Compact) { if (outcome.Done) store.Summarized(hash); return; }
            var question = request.Messages[^1];
            var files = question.Attachments is { Count: > 0 } attached
                ? JsonSerializer.Serialize(attached.Take(4).Select(a => new { type = a.Type == "image" ? "image" : "document", name = Clip(a.Name, 120) is { Length: > 0 } name ? name : a.Type == "image" ? "image" : "document.pdf" }), AssistantJson.Options)
                : null;
            var answer = outcome.Answer.ToString();
            var page = Clip(request.PagePath, 300);
            store.Record(
                new NewChat(hash, Guid.TryParse(request.Consent, out var consent) ? consent : null, engine, VisitorConsent.Language(request.Language), page, Clip(request.PageTitle, 150), days),
                new ChatTurn(Clip(request.Turn, 40) is { Length: > 0 } turn ? turn : null, Clip(question.Content, ChatRelay.MaxUserCharacters), files,
                    answer.Replace(PromptBuilder.TeamMarker, "").Trim(), Lookups(outcome), outcome.Done ? "answered" : Clip(outcome.Error, 30) is { Length: > 0 } error ? error : "stopped",
                    answer.Contains(PromptBuilder.TeamMarker), page, durationMs, outcome.PromptTokens, outcome.CompletionTokens),
                DateTime.UtcNow);
        }
        catch (Exception e)
        {
            logger.LogWarning("Ligata AI could not keep a conversation in the history ({Type}).", e.GetType().Name);
        }
    }

    /// <summary>The lookups as JSON, as many rounds as fit the column.</summary>
    private static string? Lookups(ChatOutcome outcome)
    {
        if (outcome.Lookups.Count == 0) return null;
        for (var rounds = outcome.Lookups.Count; rounds > 0; rounds--)
        {
            var json = JsonSerializer.Serialize(outcome.Lookups.Take(rounds).Select(r => r.Select(c => new { name = c.Name, arguments = c.Arguments })), AssistantJson.Options);
            if (json.Length <= 4000) return json;
        }
        return null;
    }
}
