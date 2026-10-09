using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Anthropic.Exceptions;
using Anthropic.Models.Messages;
using Ligata.AI.Services;
using Microsoft.Extensions.Logging;

namespace Ligata.AI.Editor;

/// <summary>A content block of the conversation as stored (Claude's shapes, so thinking and tool calls can be sent back as they were).</summary>
public sealed class StoredBlock
{
    /// <summary>text | image | thinking | redacted_thinking | tool_use | tool_result</summary>
    public string Type { get; set; } = "text";
    public string? Text { get; set; }
    public string? Thinking { get; set; }
    public string? Signature { get; set; }
    public string? Data { get; set; }
    public string? MediaType { get; set; }
    public string? Id { get; set; }
    public string? Name { get; set; }
    public JsonElement? Input { get; set; }
    public string? ToolUseId { get; set; }
    public string? Content { get; set; }
    public bool IsError { get; set; }

    public static StoredBlock Of(string text) => new() { Type = "text", Text = text };
    [JsonIgnore] public int Characters => (Text?.Length ?? 0) + (Thinking?.Length ?? 0) + (Content?.Length ?? 0) + (Input?.GetRawText().Length ?? 0) + (Type == "image" ? 0 : Data?.Length ?? 0);
}

public sealed class StoredMessage
{
    public string Role { get; set; } = "user";
    public List<StoredBlock> Blocks { get; set; } = [];
}

/// <summary>One answer of the model: its blocks (to send back), why it stopped and what it cost.</summary>
public sealed record ModelRound(List<StoredBlock> Blocks, string? StopReason, long Prompt, long Cached, long Output, string Text);

/// <summary>
/// Claude for the content assistant: one streamed request per round, with the content tools. The system prompt (with the tools
/// before it) and the conversation so far are cached, so every further round of tool calls costs only what is new.
/// </summary>
public sealed class EditorModel(ClaudeGate gate, EngineSelector engines, ILogger<EditorModel> logger)
{
    public const int AnswerTokens = 8192;

    public bool Ready => engines.ClaudeKey().Ready;
    public string Model => gate.Options.Model;
    public int ContextTokens => gate.Options.MaxContextTokens;

    private static List<ToolUnion> Tools(IEnumerable<EditorTool> tools) => tools.Select(t => (ToolUnion)new Tool
    {
        Name = t.Name,
        Description = t.Description,
        InputSchema = new()
        {
            Properties = t.Parameters.GetProperty("properties").EnumerateObject().ToDictionary(p => p.Name, p => p.Value.Clone()),
            Required = t.Parameters.TryGetProperty("required", out var required) ? required.EnumerateArray().Select(r => r.GetString()!).ToList() : [],
        },
    }).ToList();

    private static Dictionary<string, JsonElement> Input(JsonElement? input) =>
        input is { ValueKind: JsonValueKind.Object } o ? o.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.Clone()) : [];

    private static ContentBlockParam Block(StoredBlock b, bool cache) => b.Type switch
    {
        // Optional fields are left out rather than sent as null.
        "image" => cache
            ? new ImageBlockParam { Source = new Base64ImageSource { Data = b.Data ?? "", MediaType = b.MediaType ?? "image/png" }, CacheControl = new CacheControlEphemeral() }
            : new ImageBlockParam { Source = new Base64ImageSource { Data = b.Data ?? "", MediaType = b.MediaType ?? "image/png" } },
        "thinking" => new ThinkingBlockParam { Thinking = b.Thinking ?? "", Signature = b.Signature ?? "" },
        "redacted_thinking" => new RedactedThinkingBlockParam { Data = b.Data ?? "" },
        "tool_use" => new ToolUseBlockParam { ID = b.Id ?? "", Name = b.Name ?? "", Input = Input(b.Input) },
        "tool_result" => cache
            ? new ToolResultBlockParam { ToolUseID = b.ToolUseId ?? "", Content = b.Content ?? "", IsError = b.IsError, CacheControl = new CacheControlEphemeral() }
            : new ToolResultBlockParam { ToolUseID = b.ToolUseId ?? "", Content = b.Content ?? "", IsError = b.IsError },
        _ => cache ? new TextBlockParam { Text = b.Text ?? "", CacheControl = new CacheControlEphemeral() } : new TextBlockParam { Text = b.Text ?? "" },
    };

    /// <summary>The conversation for the API. The last block carries the cache breakpoint: the next round reads all of this from the cache.</summary>
    public static List<MessageParam> Messages(IReadOnlyList<StoredMessage> messages)
    {
        var result = new List<MessageParam>();
        for (var i = 0; i < messages.Count; i++)
        {
            var m = messages[i];
            var last = i == messages.Count - 1;
            var blocks = m.Blocks.Where(b => b.Type != "text" || !string.IsNullOrWhiteSpace(b.Text)).ToList();
            if (blocks.Count == 0) continue;
            result.Add(new MessageParam { Role = m.Role == "assistant" ? Role.Assistant : Role.User, Content = blocks.Select((b, j) => Block(b, last && j == blocks.Count - 1 && b.Type is not ("thinking" or "redacted_thinking"))).ToList() });
        }
        return result;
    }

    /// <summary>One round: streams the text through onText and returns the blocks (thinking with its signature, text, tool calls).</summary>
    public async Task<ModelRound> RoundAsync(string system, IReadOnlyList<EditorTool> tools, IReadOnlyList<StoredMessage> messages, string effort, bool forceAnswer, string user,
        Func<string, Task> onText, Func<Task> onThinking, CancellationToken token)
    {
        var key = engines.ClaudeKey();
        if (!key.Ready) throw new GatewayException("not_configured", "No Anthropic API key is set up. Add it under AI Assistant → Settings → Connection.", 503);
        var client = gate.Client(key.Key!);
        var level = ClaudeEngine.Level(effort);
        var parameters = new MessageCreateParams
        {
            Model = gate.Options.Model,
            MaxTokens = AnswerTokens + level.Room,
            System = new List<TextBlockParam> { new() { Text = system, CacheControl = new CacheControlEphemeral() } },
            Messages = Messages(messages),
            Thinking = level.Thinks ? new ThinkingConfigAdaptive() : new ThinkingConfigDisabled(),
            OutputConfig = new OutputConfig { Effort = level.Effort },
            Metadata = new Metadata { UserID = user.Length > 64 ? user[..64] : user },
            Tools = Tools(tools),
        };
        // Optional fields are left out, never sent as null (the API refuses "tool_choice": null).
        if (forceAnswer) parameters = parameters with { ToolChoice = new ToolChoiceNone() };

        IAsyncEnumerator<RawMessageStreamEvent> stream;
        try
        {
            stream = client.Messages.CreateStreaming(parameters, token).GetAsyncEnumerator(token);
            if (!await stream.MoveNextAsync()) throw new GatewayException("model_failed", "The assistant returned no answer.", 502);
        }
        catch (Exception e) when (!token.IsCancellationRequested && e is not GatewayException)
        {
            if (e is AnthropicBadRequestException) logger.LogWarning("Ligata AI content assistant: Anthropic refused the request: {Message}", e.Message);
            throw ClaudeEngine.Map(e, gate);
        }

        var blocks = new List<StoredBlock>();
        var all = new StringBuilder();
        StringBuilder text = new(), reasoning = new(), json = new();
        string kind = "", signature = "", redacted = "", callId = "", callName = "";
        string? stop = null;
        long prompt = 0, cached = 0, output = 0;
        try
        {
            do
            {
                var item = stream.Current;
                if (item.TryPickStart(out var start))
                {
                    var u = start.Message.Usage;
                    prompt = u.InputTokens + (u.CacheReadInputTokens ?? 0) + (u.CacheCreationInputTokens ?? 0);
                    cached = u.CacheReadInputTokens ?? 0;
                }
                else if (item.TryPickContentBlockStart(out var block))
                {
                    text.Clear(); reasoning.Clear(); json.Clear(); signature = ""; redacted = "";
                    if (block.ContentBlock.TryPickText(out _)) kind = "text";
                    else if (block.ContentBlock.TryPickThinking(out _)) { kind = "thinking"; await onThinking(); }
                    else if (block.ContentBlock.TryPickRedactedThinking(out var hidden)) { kind = "redacted"; redacted = hidden.Data; await onThinking(); }
                    else if (block.ContentBlock.TryPickToolUse(out var use)) { kind = "tool"; callId = use.ID; callName = use.Name; }
                    else kind = "";
                }
                else if (item.TryPickContentBlockDelta(out var delta))
                {
                    if (delta.Delta.TryPickText(out var piece) && piece.Text.Length > 0) { text.Append(piece.Text); all.Append(piece.Text); await onText(piece.Text); }
                    else if (delta.Delta.TryPickThinking(out var thought)) reasoning.Append(thought.Thinking);
                    else if (delta.Delta.TryPickSignature(out var signed)) signature += signed.Signature;
                    else if (delta.Delta.TryPickInputJson(out var input)) json.Append(input.PartialJson);
                }
                else if (item.TryPickContentBlockStop(out _))
                {
                    if (kind == "text" && text.Length > 0) blocks.Add(StoredBlock.Of(text.ToString()));
                    else if (kind == "thinking") blocks.Add(new StoredBlock { Type = "thinking", Thinking = reasoning.ToString(), Signature = signature });
                    else if (kind == "redacted") blocks.Add(new StoredBlock { Type = "redacted_thinking", Data = redacted });
                    else if (kind == "tool") blocks.Add(new StoredBlock { Type = "tool_use", Id = callId, Name = callName, Input = Parse(json.ToString()) });
                    kind = "";
                }
                else if (item.TryPickDelta(out var messageDelta))
                {
                    stop = messageDelta.Delta.StopReason?.Raw();
                    output = messageDelta.Usage.OutputTokens;
                }
            }
            while (await stream.MoveNextAsync());
        }
        catch (Exception e) when (!token.IsCancellationRequested && e is not GatewayException) { throw ClaudeEngine.Map(e, gate); }
        finally { await stream.DisposeAsync(); }
        gate.Healthy();
        return new ModelRound(blocks, stop, prompt, cached, output, all.ToString());
    }

    private static JsonElement Parse(string json)
    {
        try { using var document = JsonDocument.Parse(json.Length > 0 ? json : "{}"); return document.RootElement.ValueKind == JsonValueKind.Object ? document.RootElement.Clone() : Empty; }
        catch (JsonException) { return Empty; }
    }
    private static readonly JsonElement Empty = JsonDocument.Parse("{}").RootElement.Clone();
}
