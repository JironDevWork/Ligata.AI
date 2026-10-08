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
public sealed record ChatMessage(string Role, string Content, List<ChatAttachment>? Attachments);
/// <summary>Consent is the id of the visitor's recorded consent (LigataAI:Privacy:RequireConsent).</summary>
public sealed record ChatRequest(List<ChatMessage> Messages, string? PageTitle, string? PagePath, string? Consent = null);

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
public sealed class ChatRelay(AssistantStore store, GatewayClient gateway, ClaudeEngine claude, IOptions<AssistantOptions> options, ILogger<ChatRelay> logger)
{
    public const int MaxMessages = 120, MaxUserCharacters = 8000, MaxAssistantCharacters = 24000, MaxDocumentCharacters = 600_000, MaxImageBase64 = 7_400_000;

    public static List<object> Messages(ChatRequest request, AssistantSettings settings, string system)
    {
        var messages = request.Messages;
        if (messages is not { Count: > 0 } || messages.Count > MaxMessages) throw new ChatValidationException("invalid_messages", "This conversation is too long. Start a new chat.", 413);
        if (messages[^1].Role != "user") throw new ChatValidationException("invalid_messages", "The last message must be a question.");
        var images = 0;
        var result = new List<object> { new { role = "system", content = system } };
        foreach (var message in messages)
        {
            if (message.Role is not ("user" or "assistant")) throw new ChatValidationException("invalid_messages", "Invalid conversation.");
            var content = message.Content ?? "";
            var limit = message.Role == "user" ? MaxUserCharacters : MaxAssistantCharacters;
            if (content.Length > limit) throw new ChatValidationException("message_too_long", $"Messages can be at most {limit:N0} characters.", 413);
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
        return result;
    }

    /// <summary>
    /// Thinking shares the token limit with the answer, so "Think before answering" adds room on top (as in API mode).
    /// 4,096 tokens are at most about a minute of thinking on the Ligata GPU; usual thinking takes a few hundred.
    /// </summary>
    public const int ThinkingRoom = 4096;
    public static int MaxTokens(AssistantBehaviour behaviour) => behaviour.MaxAnswerTokens + (behaviour.Thinking ? ThinkingRoom : 0);

    public async Task RunAsync(HttpContext http, ChatRequest request, AssistantSettings settings, string visitor, bool countStats = true)
    {
        var token = http.RequestAborted;
        var features = settings.Effective(options.Value.Features);
        if (!features.Assistant) { await Json(http, 503, "disabled", "The AI assistant is switched off."); return; }
        List<object> messages;
        string stable, context;
        try
        {
            // Same for every visitor (cacheable) + this request's date and page.
            var team = PromptBuilder.Handoff(settings, features);
            stable = PromptBuilder.Guardrails(settings, team) + PromptBuilder.Knowledge(store.EnabledKnowledge());
            context = PromptBuilder.Context(settings, request.PageTitle, request.PagePath, DateTime.Now, team);
            messages = Messages(request, settings, stable + context);
        }
        catch (ChatValidationException e) { await Json(http, e.Status, e.Code, e.Message); return; }

        var api = options.Value.UsesApi;
        if (api && claude.QuotaReached())
        {
            if (countStats) store.Count(s => s.Busy++);
            await Json(http, 429, "daily_quota", "This website has reached its daily question limit. Please try again tomorrow.");
            return;
        }
        var last = request.Messages[^1];
        if (countStats) store.Count(s => { s.Questions++; if (request.Messages.Count(m => m.Role == "user") == 1) s.Conversations++; s.Attachments += last.Attachments?.Count ?? 0; });
        if (api) { await claude.ChatAsync(http, request, settings, stable, context.TrimStart(), visitor, countStats); return; }
        var body = new
        {
            messages, visitor, maxTokens = MaxTokens(settings.Behaviour), temperature = settings.Behaviour.Temperature,
            thinking = settings.Behaviour.Thinking, contextLimit = settings.Behaviour.ContextLimit,
        };
        HttpResponseMessage response;
        try { response = await gateway.ChatAsync(body, token); }
        catch (GatewayException e)
        {
            if (countStats) store.Count(s => { if (e.Code is "queue_full" or "site_busy" or "visitor_busy" or "queue_timeout" or "daily_quota") s.Busy++; else if (e.Code is "gateway_unavailable" or "model_unavailable" or "model_loading" or "not_configured" or "invalid_key") s.Offline++; else s.Failed++; });
            if (e.RetryAfter is { } retry) http.Response.Headers.RetryAfter = retry.ToString();
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
            try
            {
                await using var stream = await response.Content.ReadAsStreamAsync(token);
                using var reader = new StreamReader(stream, Encoding.UTF8);
                while (await reader.ReadLineAsync(token) is { } line)
                {
                    if (line.StartsWith("event: ")) currentEvent = line[7..];
                    else if (line.StartsWith("data: ") && currentEvent == "delta" && countStats && answer.Length < 200_000) answer.Append(Delta(line[6..]));
                    else if (line.StartsWith("data: ") && currentEvent is "done" or "error")
                    {
                        finished = true;
                        if (countStats) Record(currentEvent, line[6..]);
                        // Questions the AI could not answer: a useful signal for missing knowledge (only counted, never stored).
                        if (countStats && currentEvent == "done" && answer.ToString().Contains(PromptBuilder.TeamMarker)) store.Count(s => s.Suggested++);
                    }
                    await http.Response.WriteAsync(line + "\n", token);
                    if (line.Length == 0 || line.StartsWith(':')) await http.Response.Body.FlushAsync(token);
                }
                if (!finished)
                {
                    if (countStats) store.Count(s => s.Failed++);
                    await http.Response.WriteAsync("event: error\ndata: {\"code\":\"gateway_unavailable\",\"message\":\"The connection to the assistant was interrupted.\"}\n\n", token);
                }
                await http.Response.Body.FlushAsync(token);
            }
            catch (Exception e) when (e is OperationCanceledException || token.IsCancellationRequested) { }
            catch (Exception e) when (e is IOException or HttpRequestException)
            {
                logger.LogWarning("Ligata AI stream from the gateway was interrupted.");
                if (countStats && !finished) store.Count(s => s.Failed++);
                try { await http.Response.WriteAsync("event: error\ndata: {\"code\":\"gateway_unavailable\",\"message\":\"The connection to the assistant was interrupted.\"}\n\n", token); } catch { }
            }
        }
    }

    private static string Delta(string json)
    {
        try { using var document = JsonDocument.Parse(json); return document.RootElement.TryGetProperty("text", out var text) ? text.GetString() ?? "" : ""; }
        catch (JsonException) { return ""; }
    }

    private void Record(string kind, string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (kind == "done")
            {
                var usage = root.GetProperty("usage");
                var total = root.GetProperty("timings").TryGetProperty("totalMs", out var ms) && ms.ValueKind == JsonValueKind.Number ? ms.GetInt64() : 0;
                store.Count(s => { s.Answered++; s.PromptTokens += usage.GetProperty("promptTokens").GetInt64(); s.CompletionTokens += usage.GetProperty("completionTokens").GetInt64(); s.AnswerMs += total; });
            }
            else store.Count(s => s.Failed++);
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
