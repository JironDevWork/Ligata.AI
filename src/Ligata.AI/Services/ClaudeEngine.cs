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

/// <summary>Process-wide state for API mode: the SDK client, the concurrency gate and the latest health signals.</summary>
public sealed class ClaudeGate(IOptions<AssistantOptions> options) : IDisposable
{
    private readonly object sync = new();
    private (string Key, AnthropicClient Client)? current;
    private readonly SemaphoreSlim slots = new(Math.Clamp(options.Value.Claude.MaxConcurrent, 1, 200));
    private int active;
    private long rejectedUntil, busyUntil;
    private (DateTime At, GatewayException? Error)? verified;

    public ClaudeOptions Options => options.Value.Claude;

    /// <summary>One client per key. A key saved in the backoffice gets a new client and a fresh check; answers still running finish with the old one.</summary>
    public AnthropicClient Client(string key)
    {
        lock (sync)
        {
            if (current is { } known && known.Key == key) return known.Client;
            var replaced = current != null;
            current = (key, new AnthropicClient
            {
                // Explicit values only: an ANTHROPIC_* environment variable on the server must never redirect visitor messages.
                ApiKey = key,
                BaseUrl = string.IsNullOrWhiteSpace(Options.BaseUrl) ? "https://api.anthropic.com" : Options.BaseUrl.Trim().TrimEnd('/'),
                Timeout = TimeSpan.FromSeconds(Math.Clamp(Options.TimeoutSeconds, 15, 600)),
                MaxRetries = 1,
            });
            if (replaced) Forget();
            return current.Value.Client;
        }
    }
    public int Active => Volatile.Read(ref active);
    public bool Rejected => DateTime.UtcNow.Ticks < Interlocked.Read(ref rejectedUntil);
    public bool Busy => DateTime.UtcNow.Ticks < Interlocked.Read(ref busyUntil);
    public (DateTime At, GatewayException? Error)? Verified => verified;

    /// <summary>A rejected key or unknown model stays "offline" for a few minutes instead of failing every visitor's request.</summary>
    public void Reject() => Interlocked.Exchange(ref rejectedUntil, DateTime.UtcNow.AddMinutes(5).Ticks);
    public void Overloaded() => Interlocked.Exchange(ref busyUntil, DateTime.UtcNow.AddSeconds(30).Ticks);
    public void Healthy() { Interlocked.Exchange(ref rejectedUntil, 0); Interlocked.Exchange(ref busyUntil, 0); }
    public void Remember(GatewayException? error) => verified = (DateTime.UtcNow, error);
    /// <summary>A new or removed key: what was learned about the old one no longer applies.</summary>
    public void Forget() { Healthy(); verified = null; }

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

    public void Dispose() { slots.Dispose(); current?.Client.Dispose(); }
}

/// <summary>
/// API mode: answers come from Claude, called directly from this server. Produces the same event stream as the
/// gateway (started, thinking, delta, done, error), so the widget does not care which engine runs.
/// </summary>
public sealed class ClaudeEngine(ClaudeGate gate, AssistantStore store, EngineSelector engines, ILogger<ClaudeEngine> logger)
{
    public const string Engine = "api";

    private ClaudeOptions O => gate.Options;
    private AnthropicClient? client;
    /// <summary>The key from configuration or the backoffice (decrypted once per request).</summary>
    private AnthropicClient Client => client ??= gate.Client(RequireKey());

    /// <summary>"claude-haiku-5-5" → "Claude Haiku 5.5".</summary>
    public static string DisplayName(string model)
    {
        var parts = model.Split('-', StringSplitOptions.RemoveEmptyEntries);
        var words = parts.TakeWhile(p => !char.IsDigit(p[0])).Select(p => char.ToUpperInvariant(p[0]) + p[1..]);
        var version = string.Join('.', parts.SkipWhile(p => !char.IsDigit(p[0])).TakeWhile(p => p.Length <= 2));
        return (string.Join(' ', words) + (version.Length > 0 ? " " + version : "")).Trim();
    }

    private string RequireKey()
    {
        var key = engines.ClaudeKey();
        return key.Key ?? throw new GatewayException("not_configured", key.Source == "unreadable"
            ? "The stored Anthropic API key can no longer be decrypted on this server. Enter it again under Connection."
            : "No Anthropic API key is configured. Add it under Connection, or as LigataAI:Claude:ApiKey in the site's configuration.", 503);
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
            await Client.Models.Retrieve(O.Model, cancellationToken: token);
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
                var result = await Client.Messages.CountTokens(new MessageCountTokensParams { Model = O.Model, Messages = [new() { Role = Role.User, Content = texts[i].Length > 0 ? texts[i] : "." }] }, ct);
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
        if (engines.ClaudeKey().Ready && !gate.Rejected)
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
                return new GatewayException("invalid_key", "Anthropic rejected the API key.", 401);
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

    /// <summary>The lookup tools in Claude's format (the same names, descriptions and schemas as on the GPU).</summary>
    public static List<ToolUnion> Tools(IReadOnlyList<object>? definitions = null) => (definitions ?? Lookups.Tools).Select(definition =>
    {
        var json = JsonSerializer.SerializeToElement(definition);
        var parameters = json.GetProperty("parameters");
        return (ToolUnion)new Tool
        {
            Name = json.GetProperty("name").GetString()!,
            Description = json.GetProperty("description").GetString(),
            InputSchema = new() { Properties = parameters.GetProperty("properties").EnumerateObject().ToDictionary(p => p.Name, p => p.Value.Clone()), Required = parameters.GetProperty("required").EnumerateArray().Select(r => r.GetString()!).ToList() },
        };
    }).ToList();

    private static Dictionary<string, JsonElement> Input(JsonElement arguments) =>
        arguments.ValueKind == JsonValueKind.Object ? arguments.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.Clone()) : [];

    /// <summary>The visitor's conversation as Claude messages, earlier lookups looked up again. The request was validated by ChatRelay.Messages first.</summary>
    public static List<MessageParam> Messages(ChatRequest request, Lookups? lookups = null)
    {
        var messages = new List<MessageParam>();
        var budget = new ChatRelay.ReplayBudget();
        if (!string.IsNullOrWhiteSpace(request.Summary)) messages.Add(new() { Role = Role.User, Content = ChatRelay.SummaryMessage(request.Summary) });
        for (var index = 0; index < request.Messages.Count; index++)
        {
            var message = request.Messages[index];
            var text = message.Content ?? "";
            if (message.Role == "assistant")
            {
                // Answers that were stopped before any text arrived carry nothing the model can use (nor do their lookups).
                if (text.Replace(PromptBuilder.TeamMarker, "").Trim().Length == 0) continue;
                foreach (var round in ChatRelay.Replay(message, index, lookups, budget))
                {
                    messages.Add(new() { Role = Role.Assistant, Content = round.Select(c => (ContentBlockParam)new ToolUseBlockParam { ID = c.Id, Name = c.Call.Name, Input = Input(c.Call.Arguments) }).ToList() });
                    messages.Add(new() { Role = Role.User, Content = round.Select(c => (ContentBlockParam)new ToolResultBlockParam { ToolUseID = c.Id, Content = c.Result }).ToList() });
                }
                messages.Add(new() { Role = Role.Assistant, Content = text.Replace(PromptBuilder.TeamMarker, "").TrimEnd() });
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

    /// <summary>
    /// The editor's thinking setting (Behaviour): the effort level, whether Claude thinks at all ("off": no thinking, at low effort)
    /// and the room thinking gets on top of the answer, since thinking shares max_tokens with it.
    /// </summary>
    public static (Effort Effort, bool Thinks, int Room) Level(string effort) => effort switch
    {
        "off" => (Effort.Low, false, 0),
        "medium" => (Effort.Medium, true, 8_000),
        "high" => (Effort.High, true, 16_000),
        "xhigh" => (Effort.Xhigh, true, 32_000),
        "max" => (Effort.Max, true, 64_000),
        _ => (Effort.Low, true, 2_048),
    };

    /// <summary>
    /// Streams one answer to the browser. The cached prefix is everything that is the same for every visitor (tools,
    /// guardrails, owner instructions, knowledge, the list of pages); the page context follows it uncached. When Claude looks
    /// something up, the lookups run here and the answer continues with the results, up to a few rounds.
    /// </summary>
    public async Task ChatAsync(HttpContext http, ChatRequest request, AssistantSettings settings, string stable, string context, string visitor, bool countStats, Lookups? lookups = null, ChatOutcome? outcome = null)
    {
        var token = http.RequestAborted;
        var b = settings.Behaviour;
        var limit = Math.Min(b.ContextLimit, O.MaxContextTokens);
        var level = Level(b.Effort);
        var conversation = Messages(request, lookups);
        var tools = lookups != null ? Tools(lookups.Definitions) : null;
        var system = new List<TextBlockParam>
        {
            new() { Text = stable, CacheControl = new CacheControlEphemeral() },
            new() { Text = context },
        };
        // Optional fields are left out, never sent as null: the API refuses "tool_choice": null ("Input should be an object").
        MessageCreateParams Parameters(int round)
        {
            var parameters = new MessageCreateParams
            {
                Model = O.Model,
                // Thinking shares max_tokens with the answer, so the answer limit gets room on top.
                MaxTokens = (request.Compact ? ChatRelay.SummaryTokens : b.MaxAnswerTokens) + level.Room,
                System = system,
                Messages = conversation,
                // A summary keeps the same thinking and effort: changing either between requests would lose the cached conversation.
                Thinking = level.Thinks ? new ThinkingConfigAdaptive() : new ThinkingConfigDisabled(),
                OutputConfig = new OutputConfig { Effort = level.Effort },
                Metadata = new Metadata { UserID = visitor.Length > 64 ? visitor[..64] : visitor },
            };
            if (tools == null) return parameters;
            // A summary keeps the tools declared (the cached prefix stays the same) but may not call them; neither may an answer after its last round of lookups.
            return request.Compact || round >= Lookups.MaxRounds ? parameters with { Tools = tools, ToolChoice = new ToolChoiceNone() } : parameters with { Tools = tools };
        }

        // Reject conversations that cannot fit before paying for them. Exact counting only near the limit.
        var images = request.Messages.Sum(m => m.Attachments?.Count(a => a.Type == "image") ?? 0);
        var budget = new ChatRelay.ReplayBudget();
        var replayed = request.Messages.Select((m, i) => ChatRelay.Replay(m, i, lookups, budget).Sum(round => round.Sum(c => c.Result.Length + 80))).Sum();
        var characters = stable.Length + context.Length + replayed + request.Messages.Sum(m => (m.Content?.Length ?? 0) + (m.Attachments?.Sum(a => a.Text?.Length ?? 0) ?? 0));
        var estimate = (int)(characters / 3.2) + images * 1600 + 64 + (tools != null ? 500 : 0);
        if (estimate + Math.Min(b.MaxAnswerTokens, 256) > limit * 0.85)
        {
            try
            {
                var counted = await Client.Messages.CountTokens(new MessageCountTokensParams { Model = O.Model, System = system, Messages = conversation }, token);
                estimate = (int)counted.InputTokens + (tools != null ? 500 : 0);
            }
            catch (Exception e) when (!token.IsCancellationRequested) { logger.LogDebug(e, "Ligata AI could not count tokens; using the estimate."); }
        }
        if (estimate + Math.Min(b.MaxAnswerTokens, 256) > limit)
        {
            await Error(http, new GatewayException("context_full", "This conversation no longer fits into the assistant's memory. Start a new chat.", 413), countStats, estimate, limit, outcome);
            return;
        }

        var queued = Stopwatch.StartNew();
        using var slot = await gate.EnterAsync(TimeSpan.FromSeconds(15), token);
        if (slot == null)
        {
            await Error(http, new GatewayException("site_busy", "Many visitors are asking at the same time. Please try again in a moment.", 429, 10), countStats, outcome: outcome);
            return;
        }

        var clock = Stopwatch.StartNew();
        EventStream? sse = null;
        long prompt = 0, output = 0, cached = 0, firstToken = 0;
        string? stopReason = null;
        bool thinking = false, finished = false, offered = false;
        var answer = new StringBuilder();
        var looking = lookups?.Begin();
        try
        {
            for (var round = 0; ; round++)
            {
                IAsyncEnumerator<RawMessageStreamEvent> stream;
                try
                {
                    stream = Client.Messages.CreateStreaming(Parameters(round), token).GetAsyncEnumerator(token);
                    // The request is sent on the first read: failures before the first event become a normal HTTP error.
                    if (!await stream.MoveNextAsync()) throw new GatewayException("model_failed", "The assistant returned no answer.", 502);
                }
                catch (Exception) when (token.IsCancellationRequested) { return; }
                catch (Exception e) when (sse == null)
                {
                    var error = Map(e, gate);
                    if (error.Code == "context_full") { await Error(http, error, countStats, limit, limit, outcome); return; }
                    if (error.Code == "gateway_unavailable") logger.LogWarning(e, "Ligata AI could not reach the Claude API.");
                    // A refused request is a fault of this package or its settings: Anthropic says why (never anything secret).
                    if (e is AnthropicBadRequestException && error.Code == "model_failed") logger.LogWarning("Ligata AI: Anthropic refused the request: {Message}", e.Message);
                    await Error(http, error, countStats, outcome: outcome);
                    return;
                }
                sse ??= new EventStream(http);

                // This round's content, kept to continue after a lookup (thinking with its signature, as the API requires).
                var blocks = new List<ContentBlockParam>();
                var calls = new List<(string Id, string Name, string Json)>();
                var kind = "";
                StringBuilder text = new(), reasoning = new();
                string signature = "", redacted = "", callId = "", callName = "";
                long written = 0;
                try
                {
                    do
                    {
                        var item = stream.Current;
                        if (item.TryPickStart(out var start))
                        {
                            var u = start.Message.Usage;
                            prompt = u.InputTokens + (u.CacheReadInputTokens ?? 0) + (u.CacheCreationInputTokens ?? 0);
                            if (round > 0) continue;
                            cached = u.CacheReadInputTokens ?? 0;
                            await sse.Send("started", new { promptTokens = prompt, contextTokens = limit, waitedMs = queued.ElapsedMilliseconds - clock.ElapsedMilliseconds });
                        }
                        else if (item.TryPickContentBlockStart(out var block))
                        {
                            text.Clear(); reasoning.Clear(); signature = ""; redacted = "";
                            if (block.ContentBlock.TryPickText(out _)) kind = "text";
                            else if (block.ContentBlock.TryPickThinking(out _)) kind = "thinking";
                            else if (block.ContentBlock.TryPickRedactedThinking(out var hidden)) { kind = "redacted"; redacted = hidden.Data; }
                            else if (block.ContentBlock.TryPickToolUse(out var use)) { kind = "tool"; callId = use.ID; callName = use.Name; }
                            else kind = "";
                            if (!thinking && kind is "thinking" or "redacted") { thinking = true; await sse.Send("thinking", new { }); }
                        }
                        else if (item.TryPickContentBlockDelta(out var delta))
                        {
                            if (delta.Delta.TryPickText(out var piece) && piece.Text.Length > 0)
                            {
                                if (firstToken == 0) firstToken = clock.ElapsedMilliseconds;
                                // Text written after a lookup starts a new paragraph instead of running on from the text before it.
                                var visible = text.Length == 0 && answer.Length > 0 && !char.IsWhiteSpace(answer[^1]) && !char.IsWhiteSpace(piece.Text[0]) ? "\n\n" + piece.Text : piece.Text;
                                if (answer.Length < 200_000) answer.Append(visible);
                                outcome?.Append(visible);
                                text.Append(piece.Text);
                                await sse.Send("delta", new { text = visible });
                            }
                            else if (delta.Delta.TryPickThinking(out var thought)) reasoning.Append(thought.Thinking);
                            else if (delta.Delta.TryPickSignature(out var signed)) signature += signed.Signature;
                            else if (delta.Delta.TryPickInputJson(out var input)) text.Append(input.PartialJson);
                        }
                        else if (item.TryPickContentBlockStop(out _))
                        {
                            if (kind == "text" && text.Length > 0) blocks.Add(new TextBlockParam { Text = text.ToString() });
                            else if (kind == "thinking") blocks.Add(new ThinkingBlockParam { Thinking = reasoning.ToString(), Signature = signature });
                            else if (kind == "redacted") blocks.Add(new RedactedThinkingBlockParam { Data = redacted });
                            else if (kind == "tool")
                            {
                                calls.Add((callId, callName, text.ToString()));
                                blocks.Add(new ToolUseBlockParam { ID = callId, Name = callName, Input = Input(Parse(text.ToString())) });
                            }
                            kind = "";
                        }
                        else if (item.TryPickDelta(out var messageDelta))
                        {
                            stopReason = messageDelta.Delta.StopReason?.Raw();
                            written = messageDelta.Usage.OutputTokens;
                        }
                    }
                    while (await stream.MoveNextAsync());
                }
                finally { await stream.DisposeAsync(); }
                output += written;

                if (stopReason == "tool_use" && calls.Count > 0 && looking != null && round + 1 < Lookups.MaxRecordedRounds)
                {
                    var asked = calls.Select(c => new ChatLookup(c.Name, Parse(c.Json))).ToList();
                    var results = looking.Round(asked, answered: answer.Length >= 20);
                    if (asked.Where(Lookups.Valid).Take(Lookups.MaxRecordedCalls).ToList() is { Count: > 0 } kept) outcome?.Lookups.Add(kept);
                    await sse.Send("lookup", new { calls = asked.Where(Lookups.Valid).Take(Lookups.MaxRecordedCalls).Select(c => new { name = c.Name, arguments = c.Arguments }) });
                    // A place to show the visitor, checked against this website's pages.
                    var places = looking.TakePlaces();
                    foreach (var place in places) { await sse.Send("guide", place); offered = true; }
                    // The answer was written before it showed the place. Told it was complete, Claude still wrote it a second time
                    // and mentioned the button: the website ends the answer here (the next question repeats this round, as usual).
                    if (looking.Complete && places.Count > 0) { stopReason = "end_turn"; break; }
                    conversation.Add(new() { Role = Role.Assistant, Content = blocks });
                    conversation.Add(new() { Role = Role.User, Content = calls.Select((c, i) => (ContentBlockParam)new ToolResultBlockParam { ToolUseID = c.Id, Content = results[i] }).ToList() });
                    continue;
                }
                break;
            }
            gate.Healthy();
            finished = true;

            if (stopReason == "max_tokens" && answer.Length == 0)
            {
                if (countStats) store.Count(s => s.Failed++);
                if (outcome != null) outcome.Error = "thinking_limit";
                await sse!.Send("error", new { code = "thinking_limit", message = "The assistant thought for too long and could not finish its answer. Please try again or ask more specifically." });
                return;
            }
            // At high effort Claude sometimes ends with everything in its thinking and nothing for the visitor.
            // An answer that only shows a place is complete: the widget says it for the assistant.
            if (answer.Length == 0 && stopReason is "end_turn" or "stop_sequence" && !offered)
            {
                if (countStats) store.Count(s => s.Failed++);
                if (outcome != null) outcome.Error = "empty_answer";
                await sse!.Send("error", new { code = "empty_answer", message = "The assistant did not write an answer. Please try again." });
                return;
            }
            if (stopReason == "refusal" && answer.Length == 0)
            {
                if (countStats) store.Count(s => s.Failed++);
                if (outcome != null) outcome.Error = "refused";
                await sse!.Send("error", new { code = "refused", message = "I can't help with that. Please ask something else about this website." });
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
            if (outcome != null) { outcome.Done = true; outcome.PromptTokens = prompt; outcome.CompletionTokens = output; }
            await sse!.Send("done", new
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
            if (outcome is { Done: false }) outcome.Error = error.Code;
            try { if (sse != null) await sse.Send("error", new { code = error.Code, message = error.Message }); } catch (Exception) { }
        }
        finally { if (sse != null) await sse.DisposeAsync(); }
    }

    /// <summary>Tool arguments as JSON (an empty object when the model wrote something else).</summary>
    private static JsonElement Parse(string json)
    {
        try { using var document = JsonDocument.Parse(json.Length > 0 ? json : "{}"); return document.RootElement.ValueKind == JsonValueKind.Object ? document.RootElement.Clone() : Empty; }
        catch (JsonException) { return Empty; }
    }
    private static readonly JsonElement Empty = JsonDocument.Parse("{}").RootElement.Clone();

    private async Task Error(HttpContext http, GatewayException error, bool countStats, int? promptTokens = null, int? contextTokens = null, ChatOutcome? outcome = null)
    {
        if (outcome != null) outcome.Error = error.Code;
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
