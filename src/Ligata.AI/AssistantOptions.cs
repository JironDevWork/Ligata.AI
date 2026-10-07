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
    /// <summary>User group aliases that may change the settings.</summary>
    public string[] EditorGroups { get; set; } = ["admin"];
    /// <summary>User group aliases that may answer visitors in the Inbox (in addition to EditorGroups).</summary>
    public string[] AgentGroups { get; set; } = ["admin", "editor"];
    /// <summary>Behind Cloudflare Tunnel the visitor IP arrives in CF-Connecting-IP on a loopback connection.</summary>
    public bool TrustCloudflareLoopbackHeader { get; set; }
    /// <summary>Questions one visitor IP may ask per ten minutes.</summary>
    public int MessagesPerTenMinutes { get; set; } = 20;
    /// <summary>Injects the chat bubble into every rendered page with a body tag. Disable to place it manually.</summary>
    public bool AutoInject { get; set; } = true;
    /// <summary>Address of this CMS for links in team emails, e.g. https://cms.example.ch. Falls back to an absolute PublicApiBase or WebRouting:UmbracoApplicationUrl.</summary>
    public string BackofficeUrl { get; set; } = "";
    /// <summary>What this installation is licensed for. Editors can switch enabled features off, never on.</summary>
    public FeatureOptions Features { get; set; } = new();
    /// <summary>Hard limits for team conversations and email requests.</summary>
    public SupportLimits Support { get; set; } = new();
}

public sealed class FeatureOptions
{
    /// <summary>AI answers through the Ligata AI gateway.</summary>
    public bool Assistant { get; set; } = true;
    /// <summary>Visitors can chat with the team; the team answers in the Inbox.</summary>
    public bool LiveChat { get; set; } = true;
    /// <summary>Email contact form and email notifications.</summary>
    public bool Email { get; set; } = true;
    public bool Any => Assistant || LiveChat || Email;
    public bool Inbox => LiveChat || Email;
}

public sealed class SupportLimits
{
    public int OpenConversationsPerVisitor { get; set; } = 3;
    public int ConversationsPerVisitorPerDay { get; set; } = 6;
    public int EmailsPerVisitorPerHour { get; set; } = 3;
    public int VisitorMessagesPerMinute { get; set; } = 12;
    public int MaxMessagesPerConversation { get; set; } = 400;
    public int MaxOpenConversations { get; set; } = 500;
    public int MaxStoredConversations { get; set; } = 20000;
    public int PollsPerAddress { get; set; } = 4;
}

/// <summary>Google reCAPTCHA v3. Read from LigataAI:Recaptcha, or else from LigataForms:Recaptcha so a site configures it once.</summary>
public sealed class RecaptchaSettings
{
    public string SiteKey { get; set; } = "";
    public string SecretKey { get; set; } = "";
    public string[] AllowedHostnames { get; set; } = [];
    public double MinimumScore { get; set; } = 0.5;
    /// <summary>explicit = a permission checkbox; cookiebot = require the configured Cookiebot category.</summary>
    public string ConsentMode { get; set; } = "explicit";
    public string CookiebotCategory { get; set; } = "marketing";
    /// <summary>Which section supplied the values: LigataAI, LigataForms or none.</summary>
    public string Source { get; set; } = "none";
    public bool Ready => SiteKey.Length > 0 && SecretKey.Length > 0 && AllowedHostnames.Length > 0;
}
