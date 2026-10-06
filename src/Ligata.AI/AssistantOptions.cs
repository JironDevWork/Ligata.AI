namespace Ligata.AI;

/// <summary>Host configuration (section "LigataAI"). Everything editors can change lives in the backoffice instead.</summary>
public sealed class AssistantOptions
{
    /// <summary>Exact browser origins allowed to call the public chat API (static site and CMS), no trailing slash.</summary>
    public string[] AllowedOrigins { get; set; } = [];
    /// <summary>Absolute or root-relative base the widget calls, e.g. https://cms.example.ch/api/ligata-ai.</summary>
    public string PublicApiBase { get; set; } = "/api/ligata-ai";
    /// <summary>Overrides the gateway URL stored in the backoffice.</summary>
    public string GatewayUrl { get; set; } = "";
    /// <summary>Overrides the API key stored (encrypted) in the backoffice. Prefer an environment variable: LigataAI__ApiKey.</summary>
    public string ApiKey { get; set; } = "";
    /// <summary>User group aliases that may open the AI Assistant section.</summary>
    public string[] EditorGroups { get; set; } = ["admin"];
    /// <summary>Behind Cloudflare Tunnel the visitor IP arrives in CF-Connecting-IP on a loopback connection.</summary>
    public bool TrustCloudflareLoopbackHeader { get; set; }
    /// <summary>Questions one visitor IP may ask per ten minutes.</summary>
    public int MessagesPerTenMinutes { get; set; } = 20;
    /// <summary>Injects the chat bubble into every rendered page with a body tag. Disable to place it manually.</summary>
    public bool AutoInject { get; set; } = true;
}
