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
    /// <summary>Which licensed features the editor has switched on.</summary>
    public AssistantFeatures Features { get; init; } = new();
    public SupportSettings Support { get; init; } = new();
    public ContactSettings Contact { get; init; } = new();
    public NotificationSettings Notifications { get; init; } = new();

    /// <summary>Licensed (appsettings) and switched on (backoffice).</summary>
    public FeatureState Effective(FeatureOptions licensed) => new(licensed.Assistant && Features.Assistant, licensed.LiveChat && Features.LiveChat, licensed.Email && Features.Email);

    /// <summary>What a browser may see: no prompts, no knowledge, no gateway details, no recipients.</summary>
    public object Public(int contextLimit, object limits, int baseTokens, FeatureState features, RecaptchaSettings captcha) => new
    {
        Identity.Name, Identity.Greeting, Identity.Suggestions, Identity.AvatarUrl, Identity.Language, Identity.InputPlaceholder,
        Identity.PrivacyNotice, Identity.PrivacyUrl, Identity.FallbackMessage, Identity.FallbackEmail, Identity.FallbackUrl,
        Appearance, Behaviour.AllowImages, Behaviour.AllowPdfs, ContextLimit = contextLimit, Limits = limits, BaseTokens = baseTokens,
        Features = new { features.Assistant, features.LiveChat, features.Email },
        Team = features.Team ? new
        {
            Support.TeamName, Suggest = Support.SuggestWhenUnsure && features.Assistant, Button = Support.ShowTeamButton, Support.NameField, Support.EmailField,
            EmailWhenOffline = Support.RequireEmailWhenOffline, Support.WaitingMessage, Support.OfflineMessage, Support.PrivacyNotice, Days = Support.InactivityDays,
        } : null,
        Contact = features.Email ? new { Contact.Title, Contact.Intro, Contact.NameField, Contact.SuccessMessage } : null,
        Captcha = features.Team && Support.UseRecaptcha && captcha.Ready ? new { captcha.SiteKey, captcha.ConsentMode, captcha.CookiebotCategory } : null,
    };
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
    public string Name { get; init; } = "Assistant";
    public string Greeting { get; init; } = "Hi! I can answer questions about this website. How can I help?";
    public List<string> Suggestions { get; init; } = [];
    public string AvatarUrl { get; init; } = "";
    /// <summary>Interface language: auto (browser), en, de, fr, it.</summary>
    public string Language { get; init; } = "auto";
    public string InputPlaceholder { get; init; } = "";
    public string PrivacyNotice { get; init; } = "Answers are generated by an AI on our own server and can be wrong. Messages are not stored.";
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
    public bool Thinking { get; init; }
    public double Temperature { get; init; } = 0.7;
    public int MaxAnswerTokens { get; init; } = 1024;
    /// <summary>Maximum tokens of one conversation, including instructions and knowledge.</summary>
    public int ContextLimit { get; init; } = 65536;
    /// <summary>Maximum tokens of enabled knowledge.</summary>
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
    public string Position { get; init; } = "left";
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
    public bool ShowContextMeter { get; init; } = true;
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
