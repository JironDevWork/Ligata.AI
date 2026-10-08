using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Anthropic;
using Anthropic.Exceptions;
using Anthropic.Models.Messages;
using Ligata.AI.Data;
using Ligata.AI.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Ligata.AI.Services;

/// <summary>Process-wide state for API mode: one SDK client, the concurrency gate and the latest health signals.</summary>
public sealed class ClaudeGate(IOptions<AssistantOptions> options) : IDisposable
{
    private readonly Lazy<AnthropicClient> client = new(() => new AnthropicClient
    {
        // Explicit values only: an ANTHROPIC_* environment variable on the server must never redirect visitor messages.
        ApiKey = options.Value.Claude.ApiKey.Trim(),
        BaseUrl = string.IsNullOrWhiteSpace(options.Value.Claude.BaseUrl) ? "https://api.anthropic.com" : options.Value.Claude.BaseUrl.Trim().TrimEnd('/'),
        Timeout = TimeSpan.FromSeconds(Math.Clamp(options.Value.Claude.TimeoutSeconds, 15, 600)),
        MaxRetries = 1,
    });
    private readonly SemaphoreSlim slots = new(Math.Clamp(options.Value.Claude.MaxConcurrent, 1, 200));
    private int active;
    private long rejectedUntil, busyUntil;
    private (DateTime At, GatewayException? Error)? verified;

    public ClaudeOptions Options => options.Value.Claude;
    public AnthropicClient Client => client.Value;
    public int Active => Volatile.Read(ref active);
    public bool Rejected => DateTime.UtcNow.Ticks < Interlocked.Read(ref rejectedUntil);
    public bool Busy => DateTime.UtcNow.Ticks < Interlocked.Read(ref busyUntil);
    public (DateTime At, GatewayException? Error)? Verified => verified;

    /// <summary>A rejected key or unknown model stays "offline" for a few minutes instead of failing every visitor's request.</summary>
    public void Reject() => Interlocked.Exchange(ref rejectedUntil, DateTime.UtcNow.AddMinutes(5).Ticks);
    public void Overloaded() => Interlocked.Exchange(ref busyUntil, DateTime.UtcNow.AddSeconds(30).Ticks);
    public void Healthy() { Interlocked.Exchange(ref rejectedUntil, 0); Interlocked.Exchange(ref busyUntil, 0); }
    public void Remember(GatewayException? error) => verified = (DateTime.UtcNow, error);

    public async Task<IDisposable?> EnterAsync(TimeSpan wait, CancellationToken token)
    {
        if (!await slots.WaitAsync(wait, token)) return null;
        Interlocked.Increment(ref active);
        return new Slot(this);
    }

    private sealed class Slot(ClaudeGate gate) : IDisposable
    {
        private int done;
        public void Dispose()
        {
            if (Interlocked.Exchange(ref done, 1) == 1) return;
            Interlocked.Decrement(ref gate.active);
            gate.slots.Release();
        }
    }

    public void Dispose() { slots.Dispose(); if (client.IsValueCreated) client.Value.Dispose(); }
}

/// <summary>
/// API mode: answers come from Claude, called directly from this server. Produces the same event stream as the
/// gateway (started, thinking, delta, done, error), so the widget does not care which engine runs.
/// </summary>
public sealed class ClaudeEngine(ClaudeGate gate, AssistantStore store, ILogger<ClaudeEngine> logger)
{
    public const string Engine = "api";

    private ClaudeOptions O => gate.Options;

    /// <summary>"claude-haiku-5-5" → "Claude Haiku 5.5".</summary>
    public static string DisplayName(string model)
    {
        var parts = model.Split('-', StringSplitOptions.RemoveEmptyEntries);
        var words = parts.TakeWhile(p => !char.IsDigit(p[0])).Select(p => char.ToUpperInvariant(p[0]) + p[1..]);
        var version = string.Join('.', parts.SkipWhile(p => !char.IsDigit(p[0])).TakeWhile(p => p.Length <= 2));
        return (string.Join(' ', words) + (version.Length > 0 ? " " + version : "")).Trim();
    }

    private void RequireKey()
    {
        if (!O.Configured) throw new GatewayException("not_configured", "No Anthropic API key is configured. Add LigataAI:Claude:ApiKey to the site's configuration.", 503);
    }

    /// <summary>Availability without a network call, so open widgets can ask often. verify=true asks Anthropic (a success is trusted for a minute).</summary>
    public async Task<GatewayStatus> StatusAsync(bool verify, CancellationToken token)
    {
        RequireKey();
        if (verify && (gate.Rejected || gate.Verified is not { Error: null } last || DateTime.UtcNow - last.At > TimeSpan.FromMinutes(1))) await VerifyAsync(token);
        if (verify && gate.Verified?.Error is { } failed) throw failed;
        if (gate.Rejected) throw gate.Verified?.Error is { Code: "invalid_key" or "model_unavailable" } rejected ? rejected : new GatewayException("invalid_key", "Anthropic rejected the last request. Check the API key and model.", 401);
        var today = store.Stats(1).FirstOrDefault(s => s.Day == DateTime.UtcNow.ToString("yyyy-MM-dd"));
        var limits = JsonSerializer.SerializeToElement(new
        {
            maxImages = 8, maxImageBytes = 5 * 1024 * 1024, maxPdfBytes = PdfText.MaxBytes, maxPdfPages = PdfText.MaxPages,
            maxContextTokens = O.MaxContextTokens, maxConcurrent = O.MaxConcurrent, questionsPerDay = O.QuestionsPerDay, imageTokens = 1600,
        }, AssistantJson.Options);
        var usage = JsonSerializer.SerializeToElement(new { questionsToday = today?.Questions ?? 0, promptTokensToday = today?.PromptTokens ?? 0, completionTokensToday = today?.CompletionTokens ?? 0, active = gate.Active }, AssistantJson.Options);
        return new GatewayStatus(gate.Busy ? "busy" : "ready", DisplayName(O.Model), O.MaxContextTokens, true, 0, gate.Active > 0, 0, true, limits, usage, Engine, O.Model);
    }

    private async Task VerifyAsync(CancellationToken token)
    {
        try
        {
            await gate.Client.Models.Retrieve(O.Model, cancellationToken: token);
            gate.Healthy();
            gate.Remember(null);
        }
        catch (Exception e) when (!token.IsCancellationRequested)
        {
            gate.Remember(Map(e, gate));
        }
    }

    public bool QuotaReached() =>
        O.QuestionsPerDay > 0 && (store.Stats(1).FirstOrDefault(s => s.Day == DateTime.UtcNow.ToString("yyyy-MM-dd"))?.Questions ?? 0) >= O.QuestionsPerDay;

    /// <summary>Token counts from Anthropic's free counting endpoint (a few tokens of message overhead included).</summary>
    public async Task<int[]> CountAsync(IReadOnlyList<string> texts, CancellationToken token)
    {
        RequireKey();
        var counts = new int[texts.Count];
        try
        {
            await Parallel.ForEachAsync(Enumerable.Range(0, texts.Count), new ParallelOptions { MaxDegreeOfParallelism = 4, CancellationToken = token }, async (i, ct) =>
            {
                var result = await gate.Client.Messages.CountTokens(new MessageCountTokensParams { Model = O.Model, Messages = [new() { Role = Role.User, Content = texts[i].Length > 0 ? texts[i] : "." }] }, ct);
                counts[i] = (int)result.InputTokens;
            });
        }
        catch (Exception e) when (!token.IsCancellationRequested) { throw Map(e); }
        return counts;
    }

    public async Task<ExtractedDocument> ExtractPdfAsync(byte[] bytes, CancellationToken token)
    {
        var document = await PdfText.ExtractAsync(bytes, token);
        int? tokens = null;
        if (O.Configured && !gate.Rejected)
            try { tokens = (await CountAsync([document.Text], token))[0]; } catch (GatewayException) { }
        return document with { Tokens = tokens };
    }

    public static GatewayException Map(Exception e, ClaudeGate? gate = null)
    {
        switch (e)
        {
            case GatewayException g: return g;
            case AnthropicUnauthorizedException or AnthropicForbiddenException:
                gate?.Reject();
                return new GatewayException("invalid_key", "Anthropic rejected the API key (LigataAI:Claude:ApiKey).", 401);
            case AnthropicNotFoundException:
                gate?.Reject();
                return new GatewayException("model_unavailable", "The configured Claude model does not exist or is not available for this API key (LigataAI:Claude:Model).", 503);
            case AnthropicRateLimitException:
                gate?.Overloaded();
                return new GatewayException("site_busy", "Many visitors are asking at the same time. Please try again in a moment.", 429, 20);
            case AnthropicBadRequestException bad when bad.Message.Contains("prompt is too long", StringComparison.OrdinalIgnoreCase):
                return new GatewayException("context_full", "This conversation no longer fits into the assistant's memory. Start a new chat.", 413);
            case AnthropicBadRequestException:
                return new GatewayException("model_failed", "The assistant could not answer this message.", 502);
            case Anthropic5xxException overloaded when overloaded.Message.Contains("overloaded", StringComparison.OrdinalIgnoreCase):
                gate?.Overloaded();
                return new GatewayException("site_busy", "The AI service is very busy right now. Please try again in a moment.", 503, 20);
            case Anthropic5xxException:
                gate?.Overloaded();
                return new GatewayException("model_unavailable", "The AI service has a problem right now. Please try again in a moment.", 503, 20);
            default:
                return new GatewayException("gateway_unavailable", "The AI service is not reachable right now.", 503, 30);
        }
    }

    private static string ImageType(string data) => data.StartsWith("iVBOR") ? "image/png" : data.StartsWith("UklGR") ? "image/webp" : data.StartsWith("R0lGOD") ? "image/gif" : "image/jpeg";

    /// <summary>The visitor's conversation as Claude messages. The request was validated by ChatRelay.Messages first.</summary>
    public static List<MessageParam> Messages(ChatRequest request)
    {
        var messages = new List<MessageParam>();
        if (!string.IsNullOrWhiteSpace(request.Summary)) messages.Add(new() { Role = Role.User, Content = ChatRelay.SummaryMessage(request.Summary) });
        foreach (var message in request.Messages)
        {
            var text = message.Content ?? "";
            if (message.Role == "assistant")
            {
                // Answers that were stopped before any text arrived carry nothing the model can use.
                if (text.Replace(PromptBuilder.TeamMarker, "").Trim().Length > 0) messages.Add(new() { Role = Role.Assistant, Content = text.Replace(PromptBuilder.TeamMarker, "").TrimEnd() });
                continue;
            }
            var blocks = new List<ContentBlockParam>();
            foreach (var attachment in message.Attachments ?? [])
            {
                if (attachment.Type == "image" && !string.IsNullOrEmpty(attachment.Data))
                    blocks.Add(new ImageBlockParam { Source = new Base64ImageSource { Data = attachment.Data, MediaType = ImageType(attachment.Data) } });
                else if (attachment.Type == "document" && !string.IsNullOrEmpty(attachment.Text))
                    blocks.Add(new DocumentBlockParam { Source = new PlainTextSource { Data = attachment.Text }, Title = attachment.Name ?? "document.pdf" });
            }
            if (text.Trim().Length > 0) blocks.Add(new TextBlockParam { Text = text });
            if (blocks.Count > 0) messages.Add(new() { Role = Role.User, Content = blocks });
        }
        if (request.Compact) messages.Add(new() { Role = Role.User, Content = ChatRelay.SummaryInstruction });
        return messages;
    }

    private static Effort Level(string configured, bool raise)
    {
        var level = configured.Trim().ToLowerInvariant() switch { "medium" => 1, "high" => 2, _ => 0 };
        return Math.Min(2, level + (raise ? 1 : 0)) switch { 1 => Effort.Medium, 2 => Effort.High, _ => Effort.Low };
    }

    /// <summary>
    /// Streams one answer to the browser. The cached prefix is everything that is the same for every visitor
    /// (guardrails, owner instructions, knowledge); the page context follows it uncached.
    /// </summary>
    public async Task ChatAsync(HttpContext http, ChatRequest request, AssistantSettings settings, string stable, string context, string visitor, bool countStats)
    {
        var token = http.RequestAborted;
        var b = settings.Behaviour;
        var limit = Math.Min(b.ContextLimit, O.MaxContextTokens);
        var effort = Level(O.Effort, b.Thinking);
        var room = effort == Effort.High ? 16_000 : effort == Effort.Medium ? 8_000 : 2_048;
        var messages = Messages(request);
        var system = new List<TextBlockParam>
        {
            new() { Text = stable, CacheControl = new CacheControlEphemeral() },
            new() { Text = context },
        };
        var parameters = new MessageCreateParams
        {
            Model = O.Model,
            // Thinking shares max_tokens with the answer, so the answer limit gets room on top.
            MaxTokens = (request.Compact ? ChatRelay.SummaryTokens : b.MaxAnswerTokens) + room,
            System = system,
            Messages = messages,
            OutputConfig = new OutputConfig { Effort = effort },
            Metadata = new Metadata { UserID = visitor.Length > 64 ? visitor[..64] : visitor },
        };

        // Reject conversations that cannot fit before paying for them. Exact counting only near the limit.
        var images = request.Messages.Sum(m => m.Attachments?.Count(a => a.Type == "image") ?? 0);
        var characters = stable.Length + context.Length + request.Messages.Sum(m => (m.Content?.Length ?? 0) + (m.Attachments?.Sum(a => a.Text?.Length ?? 0) ?? 0));
        var estimate = (int)(characters / 3.2) + images * 1600 + 64;
        if (estimate + Math.Min(b.MaxAnswerTokens, 256) > limit * 0.85)
        {
            try
            {
                var counted = await gate.Client.Messages.CountTokens(new MessageCountTokensParams { Model = O.Model, System = system, Messages = messages }, token);
                estimate = (int)counted.InputTokens;
            }
            catch (Exception e) when (!token.IsCancellationRequested) { logger.LogDebug(e, "Ligata AI could not count tokens; using the estimate."); }
        }
        if (estimate + Math.Min(b.MaxAnswerTokens, 256) > limit)
        {
            await Error(http, new GatewayException("context_full", "This conversation no longer fits into the assistant's memory. Start a new chat.", 413), countStats, estimate, limit);
            return;
        }

        var queued = Stopwatch.StartNew();
        using var slot = await gate.EnterAsync(TimeSpan.FromSeconds(15), token);
        if (slot == null)
        {
            await Error(http, new GatewayException("site_busy", "Many visitors are asking at the same time. Please try again in a moment.", 429, 10), countStats);
            return;
        }

        var clock = Stopwatch.StartNew();
        IAsyncEnumerator<RawMessageStreamEvent> stream;
        try
        {
            stream = gate.Client.Messages.CreateStreaming(parameters, token).GetAsyncEnumerator(token);
            // The request is sent on the first read: failures before the first event become a normal HTTP error.
            if (!await stream.MoveNextAsync()) throw new GatewayException("model_failed", "The assistant returned no answer.", 502);
        }
        catch (Exception) when (token.IsCancellationRequested) { return; }
        catch (Exception e)
        {
            var error = Map(e, gate);
            if (error.Code == "context_full") { await Error(http, error, countStats, limit, limit); return; }
            if (error.Code == "gateway_unavailable") logger.LogWarning(e, "Ligata AI could not reach the Claude API.");
            await Error(http, error, countStats);
            return;
        }

        await using var sse = new EventStream(http);
        long prompt = 0, output = 0, cached = 0, firstToken = 0;
        string? stopReason = null;
        bool thinking = false, finished = false;
        var answer = new StringBuilder();
        try
        {
            do
            {
                var item = stream.Current;
                if (item.TryPickStart(out var start))
                {
                    var u = start.Message.Usage;
                    cached = (u.CacheReadInputTokens ?? 0);
                    prompt = u.InputTokens + cached + (u.CacheCreationInputTokens ?? 0);
                    await sse.Send("started", new { promptTokens = prompt, contextTokens = limit, waitedMs = queued.ElapsedMilliseconds - clock.ElapsedMilliseconds });
                }
                else if (item.TryPickContentBlockStart(out var block))
                {
                    if (!thinking && (block.ContentBlock.TryPickThinking(out _) || block.ContentBlock.TryPickRedactedThinking(out _))) { thinking = true; await sse.Send("thinking", new { }); }
                }
                else if (item.TryPickContentBlockDelta(out var delta))
                {
                    if (delta.Delta.TryPickText(out var text) && text.Text.Length > 0)
                    {
                        if (firstToken == 0) firstToken = clock.ElapsedMilliseconds;
                        if (answer.Length < 200_000) answer.Append(text.Text);
                        await sse.Send("delta", new { text = text.Text });
                    }
                }
                else if (item.TryPickDelta(out var messageDelta))
                {
                    stopReason = messageDelta.Delta.StopReason?.Raw();
                    output = messageDelta.Usage.OutputTokens;
                }
            }
            while (await stream.MoveNextAsync());
            gate.Healthy();
            finished = true;

            if (stopReason == "max_tokens" && answer.Length == 0)
            {
                if (countStats) store.Count(s => s.Failed++);
                await sse.Send("error", new { code = "thinking_limit", message = "The assistant thought for too long and could not finish its answer. Please try again or ask more specifically." });
                return;
            }
            if (stopReason == "refusal" && answer.Length == 0)
            {
                if (countStats) store.Count(s => s.Failed++);
                await sse.Send("error", new { code = "refused", message = "I can't help with that. Please ask something else about this website." });
                return;
            }
            var total = clock.ElapsedMilliseconds;
            if (countStats)
                store.Count(s =>
                {
                    s.Answered++; s.PromptTokens += prompt; s.CompletionTokens += output; s.AnswerMs += total;
                    // Questions the AI could not answer: a signal for missing knowledge (only counted, never stored).
                    if (answer.ToString().Contains(PromptBuilder.TeamMarker)) s.Suggested++;
                });
            await sse.Send("done", new
            {
                finishReason = stopReason switch { "max_tokens" => "length", "refusal" => "refusal", _ => "stop" },
                usage = new { promptTokens = prompt, completionTokens = output, cachedTokens = cached },
                context = new { used = prompt + output, limit },
                timings = new { promptPerSecond = 0, tokensPerSecond = total - firstToken > 0 && firstToken > 0 ? Math.Round(output * 10000.0 / (total - firstToken)) / 10 : 0, firstTokenMs = firstToken > 0 ? firstToken + (queued.ElapsedMilliseconds - clock.ElapsedMilliseconds) : (long?)null, totalMs = total },
            });
        }
        catch (Exception) when (token.IsCancellationRequested) { }
        catch (Exception e)
        {
            var error = Map(e, gate);
            logger.LogWarning("Ligata AI: the Claude answer stream failed ({Code}).", error.Code);
            if (countStats && !finished) store.Count(s => s.Failed++);
            try { await sse.Send("error", new { code = error.Code, message = error.Message }); } catch (Exception) { }
        }
        finally { await stream.DisposeAsync(); }
    }

    private async Task Error(HttpContext http, GatewayException error, bool countStats, int? promptTokens = null, int? contextTokens = null)
    {
        if (countStats) store.Count(s => { if (error.Code is "site_busy" or "daily_quota") s.Busy++; else if (error.Code is "invalid_key" or "model_unavailable" or "gateway_unavailable" or "not_configured") s.Offline++; else if (error.Code != "context_full") s.Failed++; });
        if (error.RetryAfter is { } retry) http.Response.Headers.RetryAfter = retry.ToString();
        var details = promptTokens != null ? JsonSerializer.SerializeToElement(new { promptTokens, contextTokens }) : (JsonElement?)null;
        var visible = error.Code is "invalid_key" or "not_configured" or "model_unavailable" && countStats ? "The assistant is not available right now." : error.Message;
        await ChatRelay.Json(http, error.Status, error.Code, visible, details);
    }

    /// <summary>Server-sent events with a heartbeat, so proxies and tunnels keep the connection open while the model thinks.</summary>
    private sealed class EventStream : IAsyncDisposable
    {
        private readonly HttpContext http;
        private readonly SemaphoreSlim write = new(1, 1);
        private readonly CancellationTokenSource stop = new();
        private readonly Task heartbeat;

        public EventStream(HttpContext http)
        {
            this.http = http;
            http.Features.Get<IHttpResponseBodyFeature>()?.DisableBuffering();
            http.Response.StatusCode = 200;
            http.Response.ContentType = "text/event-stream; charset=utf-8";
            http.Response.Headers.CacheControl = "no-store";
            http.Response.Headers["X-Accel-Buffering"] = "no";
            heartbeat = Beat();
        }

        private async Task Beat()
        {
            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(15));
            try { while (await timer.WaitForNextTickAsync(stop.Token)) await Write(": ping\n\n"); }
            catch (Exception) { }
        }

        public Task Send(string name, object data) => Write($"event: {name}\ndata: {JsonSerializer.Serialize(data, AssistantJson.Options)}\n\n");

        private async Task Write(string text)
        {
            await write.WaitAsync(http.RequestAborted);
            try
            {
                await http.Response.WriteAsync(text, http.RequestAborted);
                await http.Response.Body.FlushAsync(http.RequestAborted);
            }
            finally { write.Release(); }
        }

        public async ValueTask DisposeAsync()
        {
            stop.Cancel();
            await heartbeat;
            stop.Dispose();
            write.Dispose();
        }
    }
}
