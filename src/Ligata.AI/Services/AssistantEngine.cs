using Microsoft.Extensions.Options;

namespace Ligata.AI.Services;

/// <summary>
/// The AI behind the assistant, chosen in configuration (LigataAI:Mode): the self-hosted Ligata AI gateway
/// ("gpu") or Claude through Anthropic's API ("api"). Everything else in the package talks to this.
/// </summary>
public sealed class AssistantEngine(GatewayClient gateway, ClaudeEngine claude, IOptions<AssistantOptions> options)
{
    public bool UsesApi => options.Value.UsesApi;
    public string Mode => UsesApi ? ClaudeEngine.Engine : "gpu";

    /// <summary>verify=true checks the connection for the backoffice; the widget's frequent checks stay local in API mode.</summary>
    public Task<GatewayStatus> StatusAsync(CancellationToken token, bool verify = false) =>
        UsesApi ? claude.StatusAsync(verify, token) : gateway.StatusAsync(token);

    public Task<int[]> CountAsync(IReadOnlyList<string> texts, CancellationToken token) =>
        UsesApi ? claude.CountAsync(texts, token) : gateway.CountAsync(texts, token);

    public Task<ExtractedDocument> ExtractPdfAsync(byte[] bytes, CancellationToken token) =>
        UsesApi ? claude.ExtractPdfAsync(bytes, token) : gateway.ExtractPdfAsync(bytes, token);
}
