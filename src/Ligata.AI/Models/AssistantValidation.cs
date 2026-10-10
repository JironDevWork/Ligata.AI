using System.Text.RegularExpressions;

namespace Ligata.AI.Models;

public sealed class AssistantValidationException(Dictionary<string, string> errors) : Exception(string.Join(" ", errors.Values))
{
    public Dictionary<string, string> Errors { get; } = errors;
}
public sealed class AssistantConflictException(string message) : Exception(message);

public static partial class AssistantValidation
{
    [GeneratedRegex("^#[0-9a-fA-F]{6}$")] private static partial Regex Color();
    private static readonly string[] Themes = ["ligata", "midnight", "ocean", "forest", "sunset", "graphite", "custom"];
    private static readonly string[] Schemes = ["light", "dark", "auto"];
    private static readonly string[] Fonts = ["inherit", "system", "rounded", "serif", "mono"];
    private static readonly string[] Icons = ["chat", "sparkle", "help", "wave", "avatar"];
    private static readonly string[] Tones = ["friendly", "professional", "concise", "playful"];
    private static readonly string[] Lengths = ["short", "balanced", "detailed"];
    /// <summary>"" = the site's default (LigataAI:Mode).</summary>
    public static readonly string[] Engines = ["", "gpu", "api"];
    /// <summary>How much Claude thinks: off (no thinking) or an effort level of the API.</summary>
    public static readonly string[] Efforts = ["off", "low", "medium", "high", "xhigh", "max"];
    private static readonly string[] Languages = ["auto", "en", "de", "fr", "it"];
    private static readonly string[] Modes = ["all", "include", "exclude", "manual"];
    private static readonly string[] Fields = ["hidden", "optional", "required"];
    public static readonly string[] AgentDisplays = ["full", "name", "alias", "anonymous"];

    [GeneratedRegex(@"^[^@\s<>"",;:]+@[^@\s<>"",;:]+\.[^@\s<>"",;:]+$")] private static partial Regex EmailPattern();
    public static bool Email(string? value) => value is { Length: > 2 and <= 200 } && EmailPattern().IsMatch(value);
    private static bool SingleLine(string value) => !value.Contains('\n') && !value.Contains('\r');

    public static bool SafeUrl(string value, bool allowRelative = true) =>
        value == "" || (allowRelative && value.StartsWith('/') && !value.StartsWith("//") && !value.Contains('\\')) ||
        (Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme is "https" or "http");

    public static void Settings(AssistantSettings s)
    {
        var errors = new Dictionary<string, string>();
        void Check(bool ok, string key, string message) { if (!ok) errors.TryAdd(key, message); }
        void Length(string? value, int max, string key, string label) => Check((value ?? "").Length <= max, key, $"{label} can be at most {max} characters.");

        var i = s.Identity; var b = s.Behaviour; var a = s.Appearance; var d = s.Display;
        Check(!string.IsNullOrWhiteSpace(i.Name), "identity.name", "Give the assistant a name.");
        Length(i.Name, 40, "identity.name", "The name");
        Length(i.Greeting, 600, "identity.greeting", "The greeting");
        Length(i.InputPlaceholder, 80, "identity.inputPlaceholder", "The placeholder");
        Length(i.PrivacyNotice, 600, "identity.privacyNotice", "The privacy notice");
        Length(i.FallbackMessage, 400, "identity.fallbackMessage", "The offline message");
        Check(i.Suggestions.Count <= 6 && i.Suggestions.All(x => !string.IsNullOrWhiteSpace(x) && x.Length <= 120), "identity.suggestions", "Use up to six suggested questions of at most 120 characters.");
        Check(Languages.Contains(i.Language), "identity.language", "Choose a supported interface language.");
        Check(SafeUrl(i.AvatarUrl) && i.AvatarUrl.Length <= 500, "identity.avatarUrl", "The avatar must be an http(s) or site-relative URL.");
        Check(SafeUrl(i.PrivacyUrl) && i.PrivacyUrl.Length <= 500, "identity.privacyUrl", "The privacy link must be an http(s) or site-relative URL.");
        Check(s.Privacy != null, "privacy", "Privacy settings are missing.");
        Check((s.Privacy?.ConsentText ?? "").Length <= 1500, "privacy.consentText", "The consent text can have at most 1500 characters.");
        Check(s.Privacy?.ConsentRevision is >= 1 and <= 100000, "privacy.consentRevision", "The consent revision must be between 1 and 100000.");
        Check(s.Privacy?.HistoryDays is >= 1 and <= 365, "privacy.historyDays", "Conversations are kept for 1 to 365 days.");
        Check(SafeUrl(i.FallbackUrl) && i.FallbackUrl.Length <= 500, "identity.fallbackUrl", "The contact link must be an http(s) or site-relative URL.");
        Check(i.FallbackEmail == "" || Email(i.FallbackEmail), "identity.fallbackEmail", "Enter a valid contact email address.");

        Length(b.Instructions, 20000, "behaviour.instructions", "The instructions");
        Length(b.SiteName, 120, "behaviour.siteName", "The website name");
        Check(Tones.Contains(b.Tone), "behaviour.tone", "Choose a tone.");
        Check(Lengths.Contains(b.AnswerLength), "behaviour.answerLength", "Choose an answer length.");
        Check(Efforts.Contains(b.Effort), "behaviour.effort", "Choose how much Claude thinks.");
        Check(Engines.Contains(s.Engine ?? ""), "engine", "Choose the Ligata GPU or the Claude API.");
        Check(b.Temperature is >= 0 and <= 1.5, "behaviour.temperature", "Creativity must be between 0 and 1.5.");
        Check(b.MaxAnswerTokens is >= 128 and <= 4096, "behaviour.maxAnswerTokens", "Answer length limit must be between 128 and 4096 tokens.");
        Check(b.ContextLimit is >= 4096 and <= 262144, "behaviour.contextLimit", "The conversation limit must be between 4,096 and 262,144 tokens.");
        Check(b.KnowledgeBudget is >= 0 and <= 200000, "behaviour.knowledgeBudget", "The knowledge budget must be between 0 and 200,000 tokens.");
        Check(b.KnowledgeBudget + b.MaxAnswerTokens + 2048 <= b.ContextLimit, "behaviour.knowledgeBudget", "Knowledge budget plus answer length must leave at least 2,048 tokens of the conversation limit for the chat itself.");

        Check(Themes.Contains(a.Theme), "appearance.theme", "Choose a theme.");
        Check(Schemes.Contains(a.ColorScheme), "appearance.colorScheme", "Choose light, dark or automatic.");
        Check(a.Position is "left" or "right", "appearance.position", "The bubble sits bottom left or bottom right.");
        foreach (var (key, value) in new[] { ("accent", a.Accent), ("accentText", a.AccentText), ("background", a.Background), ("surface", a.Surface), ("text", a.Text), ("mutedText", a.MutedText), ("userBubble", a.UserBubble), ("userText", a.UserText), ("assistantBubble", a.AssistantBubble), ("assistantText", a.AssistantText) })
            Check(Color().IsMatch(value ?? ""), "appearance." + key, "Colours must be hex values like #2f5bff.");
        Check(Fonts.Contains(a.Font), "appearance.font", "Choose a font style.");
        Check(Icons.Contains(a.LauncherIcon), "appearance.launcherIcon", "Choose a bubble icon.");
        Check(a.LauncherIcon != "avatar" || i.AvatarUrl != "", "appearance.launcherIcon", "The avatar icon needs an avatar image.");
        Length(a.LauncherLabel, 30, "appearance.launcherLabel", "The bubble label");
        Length(a.Teaser, 160, "appearance.teaser", "The teaser");
        Check(a.Radius is >= 0 and <= 32, "appearance.radius", "Corner radius must be between 0 and 32 px.");
        Check(a.LauncherSize is >= 44 and <= 88, "appearance.launcherSize", "Bubble size must be between 44 and 88 px.");
        Check(a.PanelWidth is >= 320 and <= 560, "appearance.panelWidth", "Panel width must be between 320 and 560 px.");
        Check(a.PanelHeight is >= 420 and <= 900, "appearance.panelHeight", "Panel height must be between 420 and 900 px.");
        Check(a.OffsetX is >= 0 and <= 200 && a.OffsetY is >= 0 and <= 200, "appearance.offset", "Distance from the edge must be between 0 and 200 px.");
        Check(a.TeaserDelaySeconds is >= 0 and <= 120, "appearance.teaserDelaySeconds", "Teaser delay must be between 0 and 120 seconds.");
        Check(a.ZIndex is >= 1 and <= 2147483647, "appearance.zIndex", "Invalid stacking order.");

        var g = s.Guide;
        Check(g != null, "guide", "The settings for showing the way are missing.");
        if (g != null)
        {
            Check(GuideSettings.Reaches.Contains(g.Reach), "guide.reach", "Choose what the assistant may do: highlight, scroll or open pages.");
            Check(GuideSettings.Asks.Contains(g.Ask), "guide.ask", "Choose when visitors are asked first.");
            Check(GuideSettings.Styles.Contains(g.Style), "guide.style", "Choose a highlight style.");
            Check(g.Color == "" || Color().IsMatch(g.Color), "guide.color", "The highlight colour must be a hex value like #2f5bff, or empty for the accent colour.");
            Check(g.Seconds is >= 2 and <= 15, "guide.seconds", "The highlight stays for 2 to 15 seconds.");
        }

        Check(Modes.Contains(d.Mode), "display.mode", "Choose where the assistant appears.");
        Check(d.Paths.Count <= 50 && d.Paths.All(p => p.StartsWith('/') && p.Length <= 300 && !p.Contains("//")), "display.paths", "Paths must start with / (for example /contact/).");
        Check(SafeUrl(s.GatewayUrl, allowRelative: false) && s.GatewayUrl.Length <= 300, "gatewayUrl", "The gateway URL must be an http(s) address.");
        var k = s.Knowledge;
        Check(k != null && k.ExcludedPages.Count <= 5000, "knowledge.excludedPages", "At most 5,000 pages can be left out.");
        Check(k == null || (k.ExcludedPaths.Count <= 50 && k.ExcludedPaths.All(p => p.StartsWith('/') && p.Length <= 300 && !p.Contains("//"))), "knowledge.excludedPaths", "Paths must start with / (for example /shop/).");

        var t = s.Support; var c = s.Contact; var n = s.Notifications;
        Length(t.TeamName, 60, "support.teamName", "The team name");
        Check(Fields.Contains(t.NameField), "support.nameField", "Choose whether the name is hidden, optional or required.");
        Check(Fields.Contains(t.EmailField), "support.emailField", "Choose whether the email is hidden, optional or required.");
        Length(t.WaitingMessage, 400, "support.waitingMessage", "The waiting message");
        Length(t.OfflineMessage, 400, "support.offlineMessage", "The offline message");
        Length(t.PrivacyNotice, 400, "support.privacyNotice", "The storage notice");
        Check(AgentDisplays.Contains(t.AgentDisplay), "support.agentDisplay", "Choose how team members appear.");
        Check(t.InactivityDays is >= 1 and <= 30, "support.inactivityDays", "Conversations close after 1 to 30 days without activity.");
        Check(t.RetentionDays is >= 1 and <= 365, "support.retentionDays", "Closed conversations are kept for 1 to 365 days.");
        Length(c.Title, 80, "contact.title", "The form title");
        Length(c.Intro, 400, "contact.intro", "The introduction");
        Check(Fields.Contains(c.NameField), "contact.nameField", "Choose whether the name is hidden, optional or required.");
        Length(c.SuccessMessage, 400, "contact.successMessage", "The success message");
        Length(c.ConfirmationSubject, 150, "contact.confirmationSubject", "The confirmation subject");
        Length(c.ConfirmationText, 4000, "contact.confirmationText", "The confirmation text");
        Check(SingleLine(c.ConfirmationSubject), "contact.confirmationSubject", "The subject must be a single line.");
        Check(n.Recipients.Count <= 10 && n.Recipients.All(Email), "notifications.recipients", "Use up to ten valid email addresses.");
        Check(n.ReplyTo == "" || Email(n.ReplyTo), "notifications.replyTo", "Enter a valid reply-to address.");
        Length(n.SubjectPrefix, 40, "notifications.subjectPrefix", "The subject prefix");
        Check(SingleLine(n.SubjectPrefix), "notifications.subjectPrefix", "The subject prefix must be a single line.");
        if (errors.Count > 0) throw new AssistantValidationException(errors);
    }

    /// <summary>The path is the prefix or below it, by whole segments (/kontakt/ covers /kontakt/team/, not /kontaktformular/).</summary>
    public static bool Below(string path, string prefix)
    {
        path = path.EndsWith('/') ? path : path + "/";
        return path.StartsWith(prefix.EndsWith('/') ? prefix : prefix + "/", StringComparison.OrdinalIgnoreCase) || (prefix == "/" && path == "/");
    }

    public static bool ShowsOn(AssistantDisplay display, string path) => display.Mode switch
    {
        "all" => true,
        "include" => display.Paths.Any(p => Below(path, p)),
        "exclude" => !display.Paths.Any(p => Below(path, p)),
        _ => false,
    };
}
