using Ligata.AI.Data;
using Ligata.AI.Models;
using Microsoft.Extensions.Options;

namespace Ligata.AI.Services;

/// <summary>A key and where it comes from: configuration, backoffice (stored encrypted), unreadable (stored, but this server cannot decrypt it) or none.</summary>
public sealed record EngineKey(string? Key, string Source, string? Hint)
{
    public bool Ready => Key != null;
}

/// <summary>
/// Which AI answers. An engine is set up when its key is there: the gateway key (LigataAI:ApiKey or the backoffice) for the
/// Ligata GPU, the Anthropic key (LigataAI:Claude:ApiKey or the backoffice) for Claude. With both, the editor chooses
/// (settings.Engine, else LigataAI:Mode); with one, that one answers. The visitors' consent names the engine, so a switch asks them again.
/// </summary>
public sealed class EngineSelector(AssistantStore store, ApiKeyVault vault, IOptions<AssistantOptions> options)
{
    public const string Gpu = "gpu", Api = ClaudeEngine.Engine;

    public EngineKey GatewayKey()
    {
        if (options.Value.ApiKey is { Length: > 0 } key) return new(key, "configuration", ApiKeyVault.Hint(key));
        var row = store.Row();
        var stored = vault.Unprotect(row.ProtectedKey);
        return new(stored, stored != null ? "backoffice" : row.ProtectedKey != null ? "unreadable" : "none", row.KeyHint);
    }

    public EngineKey ClaudeKey()
    {
        if (options.Value.Claude.ApiKey.Trim() is { Length: > 0 } key) return new(key, "configuration", ApiKeyVault.ClaudeHint(key));
        var row = store.Row();
        var stored = vault.UnprotectClaude(row.ProtectedClaudeKey);
        return new(stored, stored != null ? "backoffice" : row.ProtectedClaudeKey != null ? "unreadable" : "none", row.ClaudeKeyHint);
    }

    public bool Ready(string engine) => (engine == Api ? ClaudeKey() : GatewayKey()).Ready;

    /// <summary>The engine LigataAI:Mode names (gpu unless api).</summary>
    public string Default => options.Value.UsesApi ? Api : Gpu;

    /// <summary>The editor's choice, else LigataAI:Mode; the other engine when only that one is set up.</summary>
    public string For(AssistantSettings settings)
    {
        var preferred = settings.Engine is Gpu or Api ? settings.Engine : Default;
        var other = preferred == Api ? Gpu : Api;
        return !Ready(preferred) && Ready(other) ? other : preferred;
    }

    /// <summary>The engine for the saved settings: what visitors use.</summary>
    public string Current => For(store.Settings().Settings);
}

/// <summary>
/// The AI behind the assistant: the self-hosted Ligata AI gateway ("gpu") or Claude through Anthropic's API ("api"),
/// chosen by <see cref="EngineSelector"/>. Everything else in the package talks to this.
/// </summary>
public sealed class AssistantEngine(GatewayClient gateway, ClaudeEngine claude, EngineSelector selector)
{
    public string Mode => selector.Current;
    public bool UsesApi => Mode == EngineSelector.Api;
    /// <summary>The engine for these (possibly unsaved) settings.</summary>
    public string For(AssistantSettings settings) => selector.For(settings);

    /// <summary>verify=true checks the connection for the backoffice; the widget's frequent checks stay local in API mode. engine: another than the current one (the backoffice tests both).</summary>
    public Task<GatewayStatus> StatusAsync(CancellationToken token, bool verify = false, string? engine = null) =>
        (engine ?? Mode) == EngineSelector.Api ? claude.StatusAsync(verify, token) : gateway.StatusAsync(token);

    public Task<int[]> CountAsync(IReadOnlyList<string> texts, CancellationToken token) =>
        UsesApi ? claude.CountAsync(texts, token) : gateway.CountAsync(texts, token);

    public Task<ExtractedDocument> ExtractPdfAsync(byte[] bytes, CancellationToken token) =>
        UsesApi ? claude.ExtractPdfAsync(bytes, token) : gateway.ExtractPdfAsync(bytes, token);
}
