using System.Text.Json;
using System.Text.Json.Serialization;

namespace Ligata.AI.Models;

public static class AssistantJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = JsonIgnoreCondition.Never };
    public static string Write<T>(T value) => JsonSerializer.Serialize(value, Options);
    public static T Read<T>(string value) => JsonSerializer.Deserialize<T>(value, Options)!;
}

/// <summary>Everything an editor configures in the AI Assistant section. Stored as one JSON document.</summary>
public sealed record AssistantSettings
{
    public bool Enabled { get; init; }
    public AssistantIdentity Identity { get; init; } = new();
    public AssistantBehaviour Behaviour { get; init; } = new();
    public AssistantAppearance Appearance { get; init; } = new();
    public AssistantDisplay Display { get; init; } = new();
    public string GatewayUrl { get; init; } = "http://127.0.0.1:1210";
    /// <summary>
    /// Which AI answers when both are set up: gpu (the Ligata AI gateway) or api (Claude through Anthropic). Empty uses
    /// LigataAI:Mode. When only one is set up, that one answers (see EngineSelector).
    /// </summary>
    public string Engine { get; init; } = "";
    /// <summary>Which licensed features the editor has switched on.</summary>
    public AssistantFeatures Features { get; init; } = new();
    public SupportSettings Support { get; init; } = new();
    public ContactSettings Contact { get; init; } = new();
    public NotificationSettings Notifications { get; init; } = new();
    public PrivacySettings Privacy { get; init; } = new();
    /// <summary>Which website pages the assistant may look up.</summary>
    public KnowledgeSettings Knowledge { get; init; } = new();
    /// <summary>The assistant shows visitors where something is: it opens the page, scrolls to the spot and highlights it (0.12).</summary>
    public GuideSettings Guide { get; init; } = new();

    /// <summary>Licensed (appsettings) and switched on (backoffice).</summary>
    public FeatureState Effective(FeatureOptions licensed) => new(licensed.Assistant && Features.Assistant, licensed.LiveChat && Features.LiveChat, licensed.Email && Features.Email);

    /// <summary>What a browser may see: no prompts, no knowledge, no gateway details, no recipients.</summary>
    public object Public(int contextLimit, object limits, int baseTokens, FeatureState features, RecaptchaSettings captcha, string engine = "gpu", object? consent = null) => new
    {
        Identity.Name,
        // Without the AI, the untouched AI defaults would promise answers that never come: the widget uses team wording instead.
        Greeting = features.Assistant || Identity.Greeting != AssistantIdentity.DefaultGreeting ? Identity.Greeting : "",
        Identity.Suggestions, Identity.AvatarUrl, Identity.Language, Identity.InputPlaceholder,
        // Empty while the editor keeps the default: the widget shows it in the visitor's language, naming Claude in API mode.
        PrivacyNotice = AssistantIdentity.IsDefaultNotice(Identity.PrivacyNotice) ? "" : Identity.PrivacyNotice,
        Identity.PrivacyUrl, Identity.FallbackMessage, Identity.FallbackEmail, Identity.FallbackUrl,
        Appearance, Behaviour.AllowImages, Behaviour.AllowPdfs, ContextLimit = contextLimit, Limits = limits, BaseTokens = baseTokens,
        // Kept free for the answer or a summary: the widget summarizes the earlier messages before a conversation would no longer fit.
        ReserveTokens = Services.ChatRelay.ReserveTokens(Behaviour, engine == "api"),
        Features = new { features.Assistant, features.LiveChat, features.Email },
        Engine = features.Assistant ? engine : null,
        Team = features.Team ? new
        {
            Support.TeamName, Suggest = Support.SuggestWhenUnsure && features.Assistant, Button = Support.ShowTeamButton, Support.NameField, Support.EmailField,
            EmailWhenOffline = Support.RequireEmailWhenOffline, Support.WaitingMessage, Support.OfflineMessage, Support.PrivacyNotice, Days = Support.InactivityDays,
        } : null,
        Contact = features.Email ? new { Contact.Title, Contact.Intro, Contact.NameField, Contact.SuccessMessage } : null,
        Captcha = features.Team && Support.UseRecaptcha && captcha.Ready ? new { captcha.SiteKey, captcha.ConsentMode, captcha.CookiebotCategory } : null,
        // Conversations with the AI may be kept for the team for this many days, with the visitor's separate consent (null: nothing is kept).
        History = features.Assistant && Privacy.History ? new { Days = Privacy.HistoryDays, Version = Services.VisitorConsent.HistoryVersion(this) } : null,
        // What the AI needs before it may read messages (null: no consent is asked, see LigataAI:Privacy).
        Consent = consent,
        // How the widget shows visitors where something is (null: the assistant only answers and links).
        Guide = features.Assistant && Guide.Enabled ? new { Guide.Reach, Guide.Ask, Guide.Style, Guide.Color, Guide.Seconds } : null,
    };
}

/// <summary>
/// The assistant shows visitors where something is on the website. The model proposes a place (a page and words on it); the widget
/// scrolls there and highlights it, opening the page first when allowed. It never clicks, fills in or sends anything.
/// </summary>
public sealed record GuideSettings
{
    public bool Enabled { get; init; } = true;
    /// <summary>highlight (only what is on screen of the page the visitor is on) | scroll (anywhere on that page) | pages (also other pages)</summary>
    public string Reach { get; init; } = "pages";
    /// <summary>When the visitor is asked first: always (before scrolling or opening a page) | pages (only before opening another page) | never. Highlighting what is already on screen never asks.</summary>
    public string Ask { get; init; } = "always";
    /// <summary>ring | spotlight | marker</summary>
    public string Style { get; init; } = "ring";
    /// <summary>Empty uses the accent colour of the chat.</summary>
    public string Color { get; init; } = "";
    /// <summary>How long the highlight stays.</summary>
    public int Seconds { get; init; } = 5;

    public static readonly string[] Reaches = ["highlight", "scroll", "pages"];
    public static readonly string[] Asks = ["always", "pages", "never"];
    public static readonly string[] Styles = ["ring", "spotlight", "marker"];
    /// <summary>The assistant may open another page.</summary>
    public bool Pages => Enabled && Reach == "pages";
}

public sealed record FeatureState(bool Assistant, bool LiveChat, bool Email)
{
    /// <summary>A channel to the team exists (chat or email).</summary>
    public bool Team => LiveChat || Email;
    public bool Any => Assistant || Team;
}

public sealed record AssistantFeatures
{
    public bool Assistant { get; init; } = true;
    /// <summary>Off until a site decides to answer chats, so upgrading never promises a team that is not there.</summary>
    public bool LiveChat { get; init; }
    public bool Email { get; init; }
}

public sealed record SupportSettings
{
    /// <summary>Shown to visitors, e.g. "the Ligata team". Empty uses the interface language's "our team".</summary>
    public string TeamName { get; init; } = "";
    /// <summary>The AI offers the team when it cannot answer from the knowledge.</summary>
    public bool SuggestWhenUnsure { get; init; } = true;
    /// <summary>A permanent "Talk to a person" button in the chat header.</summary>
    public bool ShowTeamButton { get; init; } = true;
    /// <summary>hidden | optional | required</summary>
    public string NameField { get; init; } = "optional";
    public string EmailField { get; init; } = "optional";
    /// <summary>When nobody is online, an email address is needed to answer later.</summary>
    public bool RequireEmailWhenOffline { get; init; } = true;
    /// <summary>Empty texts use the widget's translated defaults.</summary>
    public string WaitingMessage { get; init; } = "";
    public string OfflineMessage { get; init; } = "";
    public string PrivacyNotice { get; init; } = "";
    /// <summary>full (name and photo) | name | alias (nickname) | anonymous (team name only)</summary>
    public string AgentDisplay { get; init; } = "full";
    /// <summary>Team members may choose their own display in the Inbox.</summary>
    public bool AgentsChoose { get; init; } = true;
    /// <summary>Conversations without activity close after this many days (and are forgotten on the visitor's device).</summary>
    public int InactivityDays { get; init; } = 3;
    /// <summary>Closed conversations are deleted after this many days.</summary>
    public int RetentionDays { get; init; } = 30;
    public bool UseRecaptcha { get; init; } = true;
}

public sealed record ContactSettings
{
    public string Title { get; init; } = "";
    public string Intro { get; init; } = "";
    public string NameField { get; init; } = "optional";
    public string SuccessMessage { get; init; } = "";
    /// <summary>Sends the visitor a copy of their message.</summary>
    public bool SendConfirmation { get; init; }
    public string ConfirmationSubject { get; init; } = "";
    public string ConfirmationText { get; init; } = "";
}

/// <summary>
/// The assistant looks up what it needs while answering: every published page (with a template) is searchable, so pages
/// added later are included automatically. Editors leave out single pages or whole sections.
/// </summary>
public sealed record KnowledgeSettings
{
    public bool UsePages { get; init; } = true;
    /// <summary>Pages left out. Their subpages stay unless a path below covers them.</summary>
    public List<Guid> ExcludedPages { get; init; } = [];
    /// <summary>Sections left out with every page below them, also pages added later (path prefixes such as /shop/).</summary>
    public List<string> ExcludedPaths { get; init; } = [];

    public bool Includes(Guid key, string url) => UsePages && url != "" && !ExcludedPages.Contains(key) && !ExcludedPaths.Any(p => AssistantValidation.Below(url, p));
}

/// <summary>Editable parts of the consent visitors give before the AI reads their messages (the rest is in LigataAI:Privacy).</summary>
public sealed record PrivacySettings
{
    /// <summary>Replaces the first paragraph of the consent request. Empty uses the translated default that names the recipient.</summary>
    public string ConsentText { get; init; } = "";
    /// <summary>Raising it asks every visitor again (for example after the privacy policy changed).</summary>
    public int ConsentRevision { get; init; } = 1;
    /// <summary>
    /// Keeps a history of conversations with the AI for the team (questions, answers and what the AI looked up; no files, no IP
    /// address). Off by default. Visitors are told before they agree, and switching it on or changing the period asks them again.
    /// </summary>
    public bool History { get; init; }
    /// <summary>Conversations are deleted this many days after their last message, unless the team keeps them.</summary>
    public int HistoryDays { get; init; } = 30;
}

public sealed record NotificationSettings
{
    /// <summary>Team addresses that receive new requests and email messages.</summary>
    public List<string> Recipients { get; init; } = [];
    public bool NewChat { get; init; } = true;
    /// <summary>Visitor wrote while no team member is in the conversation (at most every 15 minutes per conversation).</summary>
    public bool VisitorMessages { get; init; } = true;
    /// <summary>Reply-to for emails the team sends from the Inbox. Empty uses the first recipient.</summary>
    public string ReplyTo { get; init; } = "";
    public string SubjectPrefix { get; init; } = "";
}

public sealed record AssistantIdentity
{
    public const string DefaultGreeting = "Hi! I can answer questions about this website. How can I help?";
    /// <summary>Kept as is, visitors read it translated (the widget has the text in every interface language).</summary>
    public const string DefaultPrivacyNotice = "Answers are generated by an AI and can be wrong. Your messages are not stored.";
    /// <summary>What visitors read in API mode (LigataAI:Mode = api) while the default notice is kept.</summary>
    public const string ApiPrivacyNotice = "Answers are generated by Claude, an AI by Anthropic, and can be wrong. This website does not store your messages.";
    /// <summary>Earlier defaults; sites that never changed the notice get the translated one.</summary>
    public static readonly string[] EarlierDefaultNotices = ["Answers are generated by an AI on our own server and can be wrong. Messages are not stored."];
    public static bool IsDefaultNotice(string? text) => text == DefaultPrivacyNotice || text == ApiPrivacyNotice || EarlierDefaultNotices.Contains(text);
    public string Name { get; init; } = "Assistant";
    public string Greeting { get; init; } = DefaultGreeting;
    public List<string> Suggestions { get; init; } = [];
    public string AvatarUrl { get; init; } = "";
    /// <summary>Interface language: auto (browser), en, de, fr, it.</summary>
    public string Language { get; init; } = "auto";
    public string InputPlaceholder { get; init; } = "";
    public string PrivacyNotice { get; init; } = DefaultPrivacyNotice;
    public string PrivacyUrl { get; init; } = "";
    public string FallbackMessage { get; init; } = "The assistant is not available right now.";
    public string FallbackEmail { get; init; } = "";
    public string FallbackUrl { get; init; } = "";
}

public sealed record AssistantBehaviour
{
    /// <summary>The site owner's own instructions, appended to Ligata's guardrails.</summary>
    public string Instructions { get; init; } = "";
    public string SiteName { get; init; } = "";
    /// <summary>friendly | professional | concise | playful</summary>
    public string Tone { get; init; } = "friendly";
    /// <summary>short | balanced | detailed</summary>
    public string AnswerLength { get; init; } = "balanced";
    public bool StayOnTopic { get; init; } = true;
    public bool UseMarkdown { get; init; } = true;
    /// <summary>Ligata GPU: think before answering (Gemma thinks or does not).</summary>
    public bool Thinking { get; init; }
    /// <summary>Claude: off (no thinking), low, medium, high, xhigh or max. Higher levels think longer: slower, more careful and more expensive.</summary>
    public string Effort { get; init; } = "low";
    public double Temperature { get; init; } = 0.7;
    public int MaxAnswerTokens { get; init; } = 1024;
    /// <summary>
    /// Maximum tokens of one conversation, including instructions and knowledge. The AI server's own limit per conversation
    /// (Ligata GPU: about 107k with three conversations at once) or LigataAI:Claude:MaxContextTokens caps it.
    /// </summary>
    public int ContextLimit { get; init; } = DefaultContextLimit;
    public const int DefaultContextLimit = 131072;
    /// <summary>The default before 0.5.1, when one GPU conversation could fill the whole 256k pool; untouched, it reads as today's default.</summary>
    public const int EarlierDefaultContextLimit = 65536;
    /// <summary>Maximum tokens of knowledge read with every question ("always known"); everything else is looked up when needed.</summary>
    public int KnowledgeBudget { get; init; } = 24576;
    public bool AllowImages { get; init; } = true;
    public bool AllowPdfs { get; init; } = true;
    public bool IncludePageContext { get; init; } = true;
}

public sealed record AssistantAppearance
{
    /// <summary>ligata | midnight | ocean | forest | sunset | graphite | custom</summary>
    public string Theme { get; init; } = "ligata";
    /// <summary>light | dark | auto</summary>
    public string ColorScheme { get; init; } = "light";
    /// <summary>left | right</summary>
    /// <summary>Bottom right by default: consent banners such as Cookiebot keep their button bottom left.</summary>
    public string Position { get; init; } = "right";
    public string Accent { get; init; } = "#2f5bff";
    public string AccentText { get; init; } = "#ffffff";
    public string Background { get; init; } = "#ffffff";
    public string Surface { get; init; } = "#f3f4f8";
    public string Text { get; init; } = "#15171f";
    public string MutedText { get; init; } = "#5d6272";
    public string UserBubble { get; init; } = "#2f5bff";
    public string UserText { get; init; } = "#ffffff";
    public string AssistantBubble { get; init; } = "#f3f4f8";
    public string AssistantText { get; init; } = "#15171f";
    /// <summary>inherit (the website's font) | system | rounded | serif | mono</summary>
    public string Font { get; init; } = "inherit";
    public int Radius { get; init; } = 20;
    public int LauncherSize { get; init; } = 60;
    /// <summary>chat | sparkle | help | wave | avatar</summary>
    public string LauncherIcon { get; init; } = "chat";
    public string LauncherLabel { get; init; } = "";
    public int PanelWidth { get; init; } = 400;
    public int PanelHeight { get; init; } = 640;
    public int OffsetX { get; init; } = 24;
    public int OffsetY { get; init; } = 24;
    /// <summary>The memory bar under the input (0.7.3: off by default). Counting and summarizing long conversations happen either way.</summary>
    public bool ShowContextMeter { get; init; }
    public bool ShowQueuePosition { get; init; } = true;
    public bool ShowBranding { get; init; } = true;
    public bool Animations { get; init; } = true;
    /// <summary>A soft chime when the team replies while the chat is closed or the tab is in the background.</summary>
    public bool Sound { get; init; } = true;
    public string Teaser { get; init; } = "";
    public int TeaserDelaySeconds { get; init; } = 6;
    public int ZIndex { get; init; } = 2147483000;
}

public sealed record AssistantDisplay
{
    /// <summary>all | include | exclude | manual</summary>
    public string Mode { get; init; } = "all";
    /// <summary>Path prefixes for include/exclude, e.g. /kontakt/ or /shop/</summary>
    public List<string> Paths { get; init; } = [];
    public bool HideOnMobile { get; init; }
}
