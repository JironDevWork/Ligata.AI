using System.Text;
using System.Text.Json;
using Ligata.AI.Data;
using Ligata.AI.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Ligata.AI.Services;

public sealed record ChatAttachment(string Type, string? Name, string? Data, string? Text);
/// <summary>A lookup the model made before an answer (search_website or read_pages with its arguments).</summary>
public sealed record ChatLookup(string Name, JsonElement Arguments);
/// <summary>
/// Lookups: the rounds of lookups before this answer. The browser keeps only the calls; their results are looked up
/// again on this server for every request, so the model sees the same results and the browser cannot change them.
/// Guide: what became of the place the answer showed (offered, shown, declined or missing; see Lookups.Outcomes).
/// </summary>
public sealed record ChatMessage(string Role, string Content, List<ChatAttachment>? Attachments, List<List<ChatLookup>>? Lookups = null, string? Guide = null);
/// <summary>
/// Consent is the id of the visitor's recorded consent (LigataAI:Privacy:RequireConsent). Summary replaces the earlier messages of a long
/// conversation; Compact asks for that summary instead of an answer (the widget sends it before the conversation would no longer fit).
/// History is the browser's random key for this conversation while the site keeps a history, Turn its id for the question (asking again
/// after an error replaces the earlier attempt) and Language the chat's interface language.
/// </summary>
public sealed record ChatRequest(List<ChatMessage> Messages, string? PageTitle, string? PagePath, string? Consent = null, string? Summary = null, bool Compact = false,
    string? History = null, string? Turn = null, string? Language = null);

public sealed class ChatValidationException(string code, string message, int status = 400) : Exception(message)
{
    public string Code { get; } = code;
    public int Status { get; } = status;
}

/// <summary>
/// Turns a visitor conversation into a request (system prompt + knowledge + history) for the configured engine
/// and relays its event stream to the browser: the gateway's stream as is, or Claude's in the same format.
/// Nothing about the conversation is stored.
/// </summary>
public sealed class ChatRelay(AssistantStore store, GatewayClient gateway, ClaudeEngine claude, KnowledgeIndex index, EngineSelector engines, IOptions<AssistantOptions> options, ILogger<ChatRelay> logger)
{
    public const int MaxMessages = 120, MaxUserCharacters = 8000, MaxAssistantCharacters = 24000, MaxDocumentCharacters = 600_000, MaxImageBase64 = 7_400_000, MaxSummaryCharacters = 30_000;

    /// <summary>The most a summary may take; the instruction asks for far less.</summary>
    public const int SummaryTokens = 2048;

    /// <summary>Asked after the conversation when the widget compacts it. A visitor message would be answered, not summarized.</summary>
    public const string SummaryInstruction = "(Message from the website, not from the visitor.) This conversation is getting too long for your memory. Write a summary of the whole conversation so far, including any earlier summary, so you can continue it with only the summary and the latest messages. Keep what the visitor wants and asked; names, numbers, dates and other details they gave; the facts, prices and links you gave; what was decided; open questions; and important content of attached documents or screenshots. Write short notes for yourself, at most 400 words: begin with \"Visitor’s language:\" and the language the visitor writes in, then write the notes in that language. Do not greet or address the visitor and add nothing else.";

    /// <summary>The summary goes first, as a visitor-side message: like everything the browser sends, it is information, never instructions.</summary>
    public static string SummaryMessage(string summary) =>
        "Summary of the earlier part of this conversation (the older messages were removed to save memory):\n<conversation_summary>\n" + summary.Replace("</conversation_summary>", "").Trim() + "\n</conversation_summary>";

    /// <summary>
    /// Tokens a conversation keeps free: the longest answer or a summary, plus thinking where it shares the context (GPU mode), the
    /// instruction and a margin. The widget summarizes the earlier messages before the next question would cross this line.
    /// </summary>
    public static int ReserveTokens(AssistantBehaviour behaviour, bool api, bool lookups = true) =>
        Math.Max(behaviour.MaxAnswerTokens, SummaryTokens) + (api || !behaviour.Thinking ? 0 : ThinkingRoom) + (lookups ? Lookups.Tokens : 0) + 512;

    /// <summary>The lookups kept with an answer, checked: the browser sends them back with every question.</summary>
    public static void CheckLookups(ChatMessage message)
    {
        if (message.Guide != null && (message.Role != "assistant" || !Lookups.Outcomes.Contains(message.Guide))) throw new ChatValidationException("invalid_messages", "Invalid conversation.");
        if (message.Lookups is not { Count: > 0 } rounds) return;
        if (message.Role != "assistant" || rounds.Count > Lookups.MaxRecordedRounds || rounds.Any(r => r is not { Count: > 0 and <= Lookups.MaxRecordedCalls } || !r.All(Lookups.Valid)))
            throw new ChatValidationException("invalid_messages", "Invalid conversation.");
    }

    /// <summary>
    /// Earlier lookups one request repeats at most. Later ones get a fixed note instead, the same with every question, so the
    /// prompt stays the same and the GPU cache holds. Long conversations are summarized long before this; it caps what one
    /// crafted request can cost the server.
    /// </summary>
    public const int MaxReplayedCalls = 60;
    public const string NotRepeated = "(This earlier lookup is not repeated: the conversation looked up a lot. Look it up again if you need it.)";
    public sealed class ReplayBudget { public int Left { get; set; } = MaxReplayedCalls; }

    /// <summary>The earlier answer's lookups, looked up again: the same calls on the same content give the same results.</summary>
    public static IEnumerable<(string Id, ChatLookup Call, string Result)[]> Replay(ChatMessage message, int index, Lookups? lookups, ReplayBudget? budget = null)
    {
        if (lookups == null || message.Lookups is not { Count: > 0 } rounds || (message.Content ?? "").Replace(PromptBuilder.TeamMarker, "").Trim().Length == 0) yield break;
        var answer = lookups.Again(message.Guide);
        for (var r = 0; r < rounds.Count; r++)
        {
            var round = rounds[r].Where(call => lookups.Declares(call.Name)).ToList();
            if (round.Count == 0) continue;
            List<string> results;
            if (budget is { Left: <= 0 }) results = round.Select(_ => NotRepeated).ToList();
            else
            {
                results = answer.Round(round);
                if (budget != null) budget.Left -= r < Lookups.MaxRounds ? Math.Min(round.Count, Lookups.MaxCalls) : 0;
            }
            yield return round.Select((call, i) => ($"l{index}r{r}c{i}", call, results[i])).ToArray();
        }
    }

    public static List<object> Messages(ChatRequest request, AssistantSettings settings, string system, Lookups? lookups = null)
    {
        var messages = request.Messages;
        if (messages is not { Count: > 0 } || messages.Count > MaxMessages) throw new ChatValidationException("invalid_messages", "This conversation is too long. Start a new chat.", 413);
        if (!request.Compact && messages[^1].Role != "user") throw new ChatValidationException("invalid_messages", "The last message must be a question.");
        if (request.Summary is { Length: > MaxSummaryCharacters }) throw new ChatValidationException("message_too_long", "The summary of this conversation is too long. Start a new chat.", 413);
        var images = 0;
        var budget = new ReplayBudget();
        var result = new List<object> { new { role = "system", content = system } };
        if (!string.IsNullOrWhiteSpace(request.Summary)) result.Add(new { role = "user", content = SummaryMessage(request.Summary) });
        for (var index = 0; index < messages.Count; index++)
        {
            var message = messages[index];
            if (message.Role is not ("user" or "assistant")) throw new ChatValidationException("invalid_messages", "Invalid conversation.");
            var content = message.Content ?? "";
            var limit = message.Role == "user" ? MaxUserCharacters : MaxAssistantCharacters;
            if (content.Length > limit) throw new ChatValidationException("message_too_long", $"Messages can be at most {limit:N0} characters.", 413);
            CheckLookups(message);
            foreach (var round in Replay(message, index, lookups, budget))
            {
                result.Add(new { role = "assistant", content = "", toolCalls = round.Select(c => new { id = c.Id, name = c.Call.Name, arguments = c.Call.Arguments }) });
                foreach (var call in round) result.Add(new { role = "tool", toolCallId = call.Id, content = call.Result });
            }
            var attachments = message.Attachments ?? [];
            if (attachments.Count == 0) { result.Add(new { role = message.Role, content }); continue; }
            if (message.Role != "user" || attachments.Count > 4) throw new ChatValidationException("invalid_attachments", "A message can carry at most four attachments.");
            var parts = new List<object>();
            foreach (var attachment in attachments)
            {
                if (attachment.Type == "image")
                {
                    if (!settings.Behaviour.AllowImages) throw new ChatValidationException("images_disabled", "Images are not accepted here.", 415);
                    if (string.IsNullOrEmpty(attachment.Data) || attachment.Data.Length > MaxImageBase64) throw new ChatValidationException("image_too_large", "This image is too large.", 413);
                    if (++images > 8) throw new ChatValidationException("too_many_images", "A conversation can contain at most eight images. Start a new chat to send more.", 413);
                    parts.Add(new { type = "image", data = attachment.Data });
                }
                else if (attachment.Type == "document")
                {
                    if (!settings.Behaviour.AllowPdfs) throw new ChatValidationException("documents_disabled", "Documents are not accepted here.", 415);
                    if (string.IsNullOrEmpty(attachment.Text) || attachment.Text.Length > MaxDocumentCharacters) throw new ChatValidationException("document_too_large", "This document is too long.", 413);
                    parts.Add(new { type = "document", name = (attachment.Name ?? "document.pdf")[..Math.Min((attachment.Name ?? "document.pdf").Length, 120)], text = attachment.Text });
                }
                else throw new ChatValidationException("invalid_attachments", "Unsupported attachment.", 415);
            }
            if (content != "") parts.Add(new { type = "text", text = content });
            result.Add(new { role = message.Role, content = parts });
        }
        if (request.Compact) result.Add(new { role = "user", content = SummaryInstruction });
        return result;
    }

    /// <summary>
    /// Thinking shares the token limit with the answer, so "Think before answering" adds room on top (as in API mode).
    /// 4,096 tokens are at most about a minute of thinking on the Ligata GPU; usual thinking takes a few hundred.
    /// </summary>
    public const int ThinkingRoom = 4096;
    public static int MaxTokens(AssistantBehaviour behaviour) => behaviour.MaxAnswerTokens + (behaviour.Thinking ? ThinkingRoom : 0);

    /// <summary>
    /// The system prompt in two parts: what is the same for every visitor (cacheable: guardrails, the knowledge that is always
    /// known, the list of pages) and this request's situation (date, page). With an engine that can call tools the model looks
    /// the website up while answering; otherwise pages and documents go into the prompt as far as the knowledge budget allows.
    /// </summary>
    public async Task<(string Stable, string Context, Lookups? Lookups)> PromptAsync(AssistantSettings settings, FeatureState features, string? pageTitle, string? pagePath, CancellationToken token)
    {
        var team = PromptBuilder.Handoff(settings, features);
        var snapshot = await index.SnapshotAsync(settings.Knowledge, token);
        var lookups = engines.For(settings) == EngineSelector.Api || await gateway.SupportsToolsAsync(token) ? new Lookups(snapshot, team, snapshot.CultureOf(pagePath), settings.Guide, string.IsNullOrWhiteSpace(pagePath) ? null : pagePath) : null;
        var pinned = store.PinnedKnowledge();
        var stable = lookups != null
            ? PromptBuilder.Guardrails(settings, team, lookups: true) + PromptBuilder.Knowledge(pinned) + PromptBuilder.SiteMap(snapshot)
            : PromptBuilder.Guardrails(settings, team) + PromptBuilder.Knowledge(pinned) + PromptBuilder.Everything(snapshot, Math.Max(0, settings.Behaviour.KnowledgeBudget - pinned.Sum(k => k.Tokens)));
        return (stable, PromptBuilder.Context(settings, pageTitle, pagePath, DateTime.Now, team, lookups != null), lookups);
    }

    /// <summary>Answers one request. <paramref name="outcome"/> (while the site keeps a history) receives the answer and how it ended.</summary>
    public async Task RunAsync(HttpContext http, ChatRequest request, AssistantSettings settings, string visitor, bool countStats = true, ChatOutcome? outcome = null)
    {
        var token = http.RequestAborted;
        // A summary is housekeeping, not a visitor question: it is not counted.
        var compact = request.Compact;
        var counting = countStats && !compact;
        var features = settings.Effective(options.Value.Features);
        if (!features.Assistant) { await Json(http, 503, "disabled", "The AI assistant is switched off."); return; }
        List<object> messages;
        string stable, context;
        Lookups? lookups;
        try
        {
            // Same for every visitor (cacheable) + this request's date and page.
            (stable, context, lookups) = await PromptAsync(settings, features, request.PageTitle, request.PagePath, token);
            messages = Messages(request, settings, stable + context, lookups);
        }
        catch (ChatValidationException e) { await Json(http, e.Status, e.Code, e.Message); return; }
        catch (OperationCanceledException) { return; }
        if (outcome != null) outcome.Reached = true;

        var api = engines.For(settings) == EngineSelector.Api;
        if (api && claude.QuotaReached())
        {
            if (counting) store.Count(s => s.Busy++);
            if (outcome != null) outcome.Error = "daily_quota";
            await Json(http, 429, "daily_quota", "This website has reached its daily question limit. Please try again tomorrow.");
            return;
        }
        var last = request.Messages[^1];
        if (counting) store.Count(s => { s.Questions++; if (request.Messages.Count(m => m.Role == "user") == 1) s.Conversations++; s.Attachments += last.Attachments?.Count ?? 0; });
        if (api)
        {
            // Stopping while waiting for one of the site's Claude places (or while tokens are counted) ends like any other stop.
            try { await claude.ChatAsync(http, request, settings, stable, context.TrimStart(), visitor, counting, lookups, outcome); }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { }
            return;
        }
        var b = settings.Behaviour;
        var body = new
        {
            // A summary keeps the site's thinking setting and tools (declared, not callable): the prompt then matches the cached conversation exactly.
            messages, visitor, maxTokens = compact ? SummaryTokens + (b.Thinking ? ThinkingRoom : 0) : MaxTokens(b), temperature = compact ? Math.Min(b.Temperature, 0.3) : b.Temperature,
            thinking = b.Thinking, contextLimit = b.ContextLimit,
            tools = lookups?.Definitions, toolChoice = lookups == null ? null : compact ? "none" : lookups.Touches(request.Messages[^1].Content ?? "", request.Messages.SkipLast(1).Select(m => m.Content ?? "").Append(request.Summary ?? "")) ? "required" : null, lookupRounds = Lookups.MaxRounds,
        };
        HttpResponseMessage response;
        try { response = await gateway.ChatAsync(body, token); }
        catch (GatewayException e)
        {
            if (counting) store.Count(s => { if (e.Code is "queue_full" or "site_busy" or "visitor_busy" or "queue_timeout" or "daily_quota") s.Busy++; else if (e.Code is "gateway_unavailable" or "model_unavailable" or "model_loading" or "not_configured" or "invalid_key") s.Offline++; else s.Failed++; });
            if (e.RetryAfter is { } retry) http.Response.Headers.RetryAfter = retry.ToString();
            if (outcome != null) outcome.Error = e.Code;
            await Json(http, e.Status is >= 400 and < 600 ? e.Status : 503, e.Code, countStats ? Visible(e) : e.Message, e.Details);
            return;
        }
        catch (OperationCanceledException) { return; }

        using (response)
        {
            http.Features.Get<IHttpResponseBodyFeature>()?.DisableBuffering();
            http.Response.StatusCode = 200;
            http.Response.ContentType = "text/event-stream; charset=utf-8";
            http.Response.Headers.CacheControl = "no-store";
            http.Response.Headers["X-Accel-Buffering"] = "no";
            string? currentEvent = null; var finished = false;
            var answer = new StringBuilder();
            var looking = lookups?.Begin();
            try
            {
                await using var stream = await response.Content.ReadAsStreamAsync(token);
                using var reader = new StreamReader(stream, Encoding.UTF8);
                while (await reader.ReadLineAsync(token) is { } line)
                {
                    if (line.StartsWith("event: ")) currentEvent = line[7..];
                    if (currentEvent == "tool_calls")
                    {
                        // The model looks something up: answered here, never passed to the browser as is.
                        if (line.StartsWith("data: ")) await LookupAsync(http, line[6..], looking, outcome, token);
                        else if (line.Length == 0) currentEvent = null;
                        continue;
                    }
                    if (line.StartsWith("data: ") && currentEvent == "delta" && (counting || outcome != null))
                    {
                        var piece = Delta(line[6..]);
                        if (answer.Length < 200_000) answer.Append(piece);
                        outcome?.Append(piece);
                    }
                    else if (line.StartsWith("data: ") && currentEvent is "done" or "error")
                    {
                        finished = true;
                        Record(currentEvent, line[6..], counting, outcome);
                        // Questions the AI could not answer: a useful signal for missing knowledge (only counted, never stored).
                        if (counting && currentEvent == "done" && answer.ToString().Contains(PromptBuilder.TeamMarker)) store.Count(s => s.Suggested++);
                    }
                    await http.Response.WriteAsync(line + "\n", token);
                    if (line.Length == 0 || line.StartsWith(':')) await http.Response.Body.FlushAsync(token);
                }
                if (!finished)
                {
                    if (counting) store.Count(s => s.Failed++);
                    if (outcome != null) outcome.Error = "gateway_unavailable";
                    await http.Response.WriteAsync("event: error\ndata: {\"code\":\"gateway_unavailable\",\"message\":\"The connection to the assistant was interrupted.\"}\n\n", token);
                }
                await http.Response.Body.FlushAsync(token);
            }
            catch (Exception e) when (e is OperationCanceledException || token.IsCancellationRequested) { }
            catch (Exception e) when (e is IOException or HttpRequestException)
            {
                logger.LogWarning("Ligata AI stream from the gateway was interrupted.");
                if (counting && !finished) store.Count(s => s.Failed++);
                if (outcome != null && !finished) outcome.Error = "gateway_unavailable";
                try { await http.Response.WriteAsync("event: error\ndata: {\"code\":\"gateway_unavailable\",\"message\":\"The connection to the assistant was interrupted.\"}\n\n", token); } catch { }
            }
        }
    }

    /// <summary>
    /// One round of lookups from the gateway: { round, calls: [{ id, name, arguments }] }. The results go back to the gateway,
    /// which continues the answer; the browser learns what was looked up ("lookup" event), keeps the calls and sends them back
    /// with the next question.
    /// </summary>
    private async Task LookupAsync(HttpContext http, string json, Lookups.Answer? looking, ChatOutcome? outcome, CancellationToken token)
    {
        string round;
        List<(string Id, ChatLookup Call)> calls;
        try
        {
            using var document = JsonDocument.Parse(json);
            round = document.RootElement.GetProperty("round").GetString() ?? "";
            calls = document.RootElement.GetProperty("calls").EnumerateArray().Take(Lookups.MaxRecordedCalls)
                .Select(c => (c.GetProperty("id").GetString() ?? "", new ChatLookup(c.GetProperty("name").GetString() ?? "", c.GetProperty("arguments").Clone()))).ToList();
        }
        catch (Exception e) when (e is JsonException or KeyNotFoundException or InvalidOperationException) { logger.LogWarning("Ligata AI received a malformed lookup from the gateway."); return; }
        var results = looking?.Round(calls.Select(c => c.Call).ToList()) ?? calls.Select(_ => "Lookups are not available.").ToList();
        var valid = calls.Select(c => c.Call).Where(Lookups.Valid).ToList();
        if (valid.Count > 0) outcome?.Lookups.Add(valid);
        var kept = valid.Select(c => new { name = c.Name, arguments = c.Arguments });
        await http.Response.WriteAsync($"event: lookup\ndata: {JsonSerializer.Serialize(new { calls = kept }, AssistantJson.Options)}\n\n", token);
        // A place to show the visitor, checked here: the browser shows only pages of this website.
        foreach (var place in looking?.TakePlaces() ?? []) await http.Response.WriteAsync($"event: guide\ndata: {JsonSerializer.Serialize(place, AssistantJson.Options)}\n\n", token);
        await http.Response.Body.FlushAsync(token);
        try { await gateway.ToolResultsAsync(round, calls.Select((c, i) => new { id = c.Id, content = results[i] }).ToList(), token); }
        catch (GatewayException e) { logger.LogWarning("Ligata AI could not return lookup results to the gateway ({Code}).", e.Code); }
    }

    private static string Delta(string json)
    {
        try { using var document = JsonDocument.Parse(json); return document.RootElement.TryGetProperty("text", out var text) ? text.GetString() ?? "" : ""; }
        catch (JsonException) { return ""; }
    }

    /// <summary>The end of an answer (done or error): the daily counters and, while a history is kept, the outcome.</summary>
    private void Record(string kind, string json, bool counting, ChatOutcome? outcome)
    {
        if (outcome != null) { outcome.Done = kind == "done"; if (kind != "done") outcome.Error = "model_failed"; }
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (kind == "done")
            {
                var usage = root.GetProperty("usage");
                var prompt = usage.GetProperty("promptTokens").GetInt64();
                var completion = usage.GetProperty("completionTokens").GetInt64();
                if (outcome != null) { outcome.PromptTokens = prompt; outcome.CompletionTokens = completion; }
                var total = root.GetProperty("timings").TryGetProperty("totalMs", out var ms) && ms.ValueKind == JsonValueKind.Number ? ms.GetInt64() : 0;
                if (counting) store.Count(s => { s.Answered++; s.PromptTokens += prompt; s.CompletionTokens += completion; s.AnswerMs += total; });
            }
            else
            {
                var code = root.TryGetProperty("code", out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
                if (outcome != null && code != null) outcome.Error = code;
                // A line that waited too long is busy, not a failure (the stream was already open for the queue position).
                if (counting) store.Count(s => { if (code is "queue_timeout" or "queue_full" or "site_busy") s.Busy++; else if (code is "model_unavailable" or "model_loading" or "gateway_unavailable") s.Offline++; else s.Failed++; });
            }
        }
        catch (Exception e) when (e is JsonException or KeyNotFoundException or InvalidOperationException) { }
    }

    private static string Visible(GatewayException e) => e.Code switch
    {
        "not_configured" or "invalid_key" => "The assistant is not available right now.",
        _ => e.Message,
    };

    public static Task Json(HttpContext http, int status, string code, string message, JsonElement? details = null)
    {
        http.Response.StatusCode = status;
        http.Response.ContentType = "application/json; charset=utf-8";
        var payload = new Dictionary<string, object?> { ["code"] = code, ["message"] = message };
        if (details is { ValueKind: JsonValueKind.Object } d)
            foreach (var property in d.EnumerateObject().Where(p => p.Name is "promptTokens" or "contextTokens"))
                payload[property.Name] = property.Value.Clone();
        return http.Response.WriteAsync(JsonSerializer.Serialize(new { error = payload }, AssistantJson.Options));
    }
}
