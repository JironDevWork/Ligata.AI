namespace Ligata.AI;

/// <summary>Host configuration (section "LigataAI"). Everything editors can change lives in the backoffice instead.</summary>
public sealed class AssistantOptions
{
    /// <summary>Exact browser origins allowed to call the public chat API (static site and CMS), no trailing slash.</summary>
    public string[] AllowedOrigins { get; set; } = [];
    /// <summary>Absolute or root-relative base the widget calls, e.g. https://cms.example.ch/api/ligata-ai.</summary>
    public string PublicApiBase { get; set; } = "/api/ligata-ai";
    /// <summary>
    /// Where answers come from by default. gpu = the self-hosted Ligata AI gateway (GatewayUrl/ApiKey);
    /// api = Claude through Anthropic's API, called directly from this server (Claude:ApiKey). No gateway is needed.
    /// When both keys are set up, editors choose under Connection; when only one is, that one answers.
    /// </summary>
    public string Mode { get; set; } = "gpu";
    /// <summary>Settings for Claude (api).</summary>
    public ClaudeOptions Claude { get; set; } = new();
    public bool UsesApi => string.Equals(Mode?.Trim(), "api", StringComparison.OrdinalIgnoreCase);
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
    /// <summary>Status checks per IP per ten minutes (open chats check every 30 s; offices share one IP).</summary>
    public int ReadsPerTenMinutes { get; set; } = 600;
    /// <summary>Injects the chat bubble into every rendered page with a body tag. Disable to place it manually.</summary>
    public bool AutoInject { get; set; } = true;
    /// <summary>
    /// Reads every page as visitors get it (in memory, through the site's own request pipeline, no network request) for what its
    /// text properties do not hold: forms such as Ligata.Forms renders, embedded maps and videos, and parts marked with
    /// data-ligata-ai-part. The assistant then knows where the form is and can point at it.
    /// </summary>
    public bool ReadRenderedPages { get; set; } = true;
    /// <summary>Address of this CMS for links in team emails, e.g. https://cms.example.ch. Falls back to an absolute PublicApiBase or WebRouting:UmbracoApplicationUrl.</summary>
    public string BackofficeUrl { get; set; } = "";
    /// <summary>What this installation is licensed for. Editors can switch enabled features off, never on.</summary>
    public FeatureOptions Features { get; set; } = new();
    /// <summary>Hard limits for team conversations and email requests.</summary>
    public SupportLimits Support { get; set; } = new();
    /// <summary>Consent before the AI sees a visitor's messages, and the details visitors are told.</summary>
    public PrivacyOptions Privacy { get; set; } = new();
    /// <summary>The content assistant in the backoffice (everything else about it is set in the backoffice).</summary>
    public ContentAssistantOptions ContentAssistant { get; set; } = new();
}

/// <summary>The content assistant: an AI chat for editors in the backoffice (Claude through the Anthropic API key under Connection).</summary>
public sealed class ContentAssistantOptions
{
    /// <summary>A conversation is summarized before it would take more than this many tokens (capped at 80% of LigataAI:Claude:MaxContextTokens).</summary>
    public int CompactAtTokens { get; set; } = 60_000;
    /// <summary>
    /// The default thinking effort (off, low, medium, high, xhigh). Set here, it wins over the backoffice setting, which then shows
    /// it locked; editors may still pick Low, Medium or High in the chat when that is allowed. Empty: the backoffice decides.
    /// </summary>
    public string Effort { get; set; } = "";
}

/// <summary>
/// The AI receives a visitor's messages only after the visitor agreed (GDPR Art. 6(1)(a)). The consent is
/// recorded (random id, no IP, no content) and checked by the server on every question and file.
/// </summary>
public sealed class PrivacyOptions
{
    /// <summary>Visitors must agree before their first question. Switch off only with your data protection adviser's approval.</summary>
    public bool RequireConsent { get; set; } = true;
    /// <summary>explicit = the chat asks itself; cookiebot = the chat unlocks with a Cookiebot category (falls back to explicit without Cookiebot).</summary>
    public string ConsentMode { get; set; } = "explicit";
    /// <summary>For ConsentMode = cookiebot: preferences, statistics or marketing.</summary>
    public string CookiebotCategory { get; set; } = "preferences";
    /// <summary>Visitors are asked again after this many days.</summary>
    public int ConsentDays { get; set; } = 365;
    /// <summary>Consent records (proof of consent) are deleted after this many days. Records never used for a question go after one day.</summary>
    public int KeepConsentRecordsDays { get; set; } = 1095;
    /// <summary>Who runs the AI server in GPU mode. Visitors are told this name before they agree.</summary>
    public string GpuOperator { get; set; } = "Ligata";
    /// <summary>Country of the AI server in GPU mode as an ISO code (the Ligata GPU runs in Switzerland). Shown to visitors and in the privacy policy text.</summary>
    public string GpuOperatorCountry { get; set; } = "CH";
    /// <summary>Adds data-cookieconsent="ignore" to the script tag so Cookiebot's automatic blocking leaves the chat alone (it handles consent itself and sets no cookies).</summary>
    public bool CookiebotIgnore { get; set; } = true;

    public bool UsesCookiebot => string.Equals(ConsentMode?.Trim(), "cookiebot", StringComparison.OrdinalIgnoreCase);
    public string Category => CookiebotCategory?.Trim().ToLowerInvariant() is "preferences" or "statistics" or "marketing" ? CookiebotCategory.Trim().ToLowerInvariant() : "preferences";
}

/// <summary>Claude through Anthropic's API. The key is only ever sent to Anthropic. How much Claude thinks is chosen under Behaviour.</summary>
public sealed class ClaudeOptions
{
    /// <summary>
    /// Anthropic API key (sk-ant-…). Prefer an environment variable or secret store: LigataAI__Claude__ApiKey. Without it, editors can
    /// store a key under Connection (encrypted with the server's Data Protection keys); a key set here wins.
    /// </summary>
    public string ApiKey { get; set; } = "";
    public string Model { get; set; } = "claude-haiku-5-5";
    /// <summary>Largest prompt per question. Claude Haiku 5.5 costs five times more per token above 100,000 prompt tokens.</summary>
    public int MaxContextTokens { get; set; } = 100_000;
    /// <summary>Answers written at the same time on this site. Further visitors wait up to 15 seconds, then see "busy".</summary>
    public int MaxConcurrent { get; set; } = 8;
    /// <summary>Questions per day (UTC) for the whole site, a hard ceiling on cost. 0 = unlimited.</summary>
    public int QuestionsPerDay { get; set; } = 1500;
    public int TimeoutSeconds { get; set; } = 90;
    /// <summary>Only for tests or an approved proxy. Empty = https://api.anthropic.com (environment variables are ignored).</summary>
    public string BaseUrl { get; set; } = "";
}

public sealed class FeatureOptions
{
    /// <summary>AI answers (through the Ligata AI gateway or the Claude API, see Mode).</summary>
    public bool Assistant { get; set; } = true;
    /// <summary>Visitors can chat with the team; the team answers in the Inbox.</summary>
    public bool LiveChat { get; set; } = true;
    /// <summary>Email contact form and email notifications.</summary>
    public bool Email { get; set; } = true;
    /// <summary>The content assistant in the backoffice: editors find, read and change content by chatting (0.9).</summary>
    public bool ContentAssistant { get; set; } = true;
    public bool Any => Assistant || LiveChat || Email || ContentAssistant;
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
    /// <summary>Burst limit per IP for new team requests and emails (on top of the per-visitor limits above).</summary>
    public int ContactRequestsPerTenMinutes { get; set; } = 10;
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
