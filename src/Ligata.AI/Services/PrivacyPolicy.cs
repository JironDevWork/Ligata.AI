using System.Text;
using System.Text.RegularExpressions;
using Ligata.AI.Models;

namespace Ligata.AI.Services;

/// <summary>
/// Fills the privacy policy templates (docs/privacy/*.md, embedded in the package) with this site's setup:
/// &lt;!-- if flag --&gt; … &lt;!-- endif --&gt; keeps a block when the flag is set ("!flag" when it is not,
/// "a|b" when either is); {{value}} is replaced. Blocks marked "docs" are notes for readers of the template.
/// </summary>
public static partial class PrivacyPolicy
{
    public static readonly string[] Languages = ["de", "en"];

    // A marker alone on its line takes the line with it.
    [GeneratedRegex(@"(?<own>^[ \t]*)?<!--\s*(?:if\s+(?<flag>!?[\w|]+)|(?<end>endif))\s*-->(?(own)[ \t]*\n?)", RegexOptions.Multiline)]
    private static partial Regex Marker();
    [GeneratedRegex(@"\{\{(\w+)\}\}")]
    private static partial Regex Value();
    [GeneratedRegex(@"\n{3,}")]
    private static partial Regex BlankLines();

    public static string Template(string language) => Resource($"Ligata.AI.Privacy.{(Languages.Contains(language) ? language : "en")}.md");

    /// <summary>A template embedded in the package (docs/privacy), with Unix line ends.</summary>
    public static string Resource(string name)
    {
        using var stream = typeof(PrivacyPolicy).Assembly.GetManifestResourceStream(name) ?? throw new InvalidOperationException($"Missing resource {name}.");
        using var reader = new StreamReader(stream, Encoding.UTF8);
        return reader.ReadToEnd().Replace("\r\n", "\n");
    }

    public static string Render(string template, IReadOnlySet<string> flags, IReadOnlyDictionary<string, string> values)
    {
        var output = new StringBuilder();
        var keep = new Stack<bool>();
        var position = 0;
        bool Showing() => keep.All(x => x);
        foreach (Match marker in Marker().Matches(template))
        {
            if (Showing()) output.Append(template, position, marker.Index - position);
            position = marker.Index + marker.Length;
            if (marker.Groups["end"].Success) { if (keep.Count > 0) keep.Pop(); continue; }
            var flag = marker.Groups["flag"].Value;
            var negate = flag.StartsWith('!');
            var any = flag.TrimStart('!').Split('|').Any(flags.Contains);
            keep.Push(negate ? !any : any);
        }
        if (Showing()) output.Append(template, position, template.Length - position);
        var text = Value().Replace(output.ToString(), m => values.TryGetValue(m.Groups[1].Value, out var value) ? value : m.Value);
        // A removed block leaves its line breaks behind.
        return BlankLines().Replace(string.Join('\n', text.Split('\n').Select(line => line.TrimEnd())), "\n\n").Trim() + "\n";
    }

    private static readonly string[] SafeCountries = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "CH", "GB"];
    private static readonly Dictionary<string, string> GermanCountries = new(StringComparer.OrdinalIgnoreCase)
    {
        ["CH"] = "der Schweiz", ["DE"] = "Deutschland", ["AT"] = "Österreich", ["LI"] = "Liechtenstein", ["FR"] = "Frankreich", ["IT"] = "Italien", ["NL"] = "den Niederlanden",
        ["BE"] = "Belgien", ["LU"] = "Luxemburg", ["IE"] = "Irland", ["FI"] = "Finnland", ["SE"] = "Schweden", ["DK"] = "Dänemark", ["NO"] = "Norwegen", ["PL"] = "Polen",
        ["ES"] = "Spanien", ["PT"] = "Portugal", ["GB"] = "dem Vereinigten Königreich", ["US"] = "den USA",
    };

    /// <summary>"in Switzerland" / "in der Schweiz"; codes are ISO 3166 (CH), names are used as written.</summary>
    public static string Country(string code, string language)
    {
        code = code.Trim();
        if (code == "") return language == "de" ? "[Land]" : "[country]";
        if (code.Length != 2) return code;
        if (language == "de") return GermanCountries.TryGetValue(code, out var german) ? german : code.ToUpperInvariant();
        try { var name = new System.Globalization.RegionInfo(code).EnglishName; return code.ToUpperInvariant() is "US" or "GB" or "NL" ? "the " + name : name; }
        catch (ArgumentException) { return code.ToUpperInvariant(); }
    }

    private static string Category(string category, string language) => (category, language) switch
    {
        ("statistics", "de") => "Statistiken", ("marketing", _) => "Marketing", ("preferences", "de") => "Präferenzen",
        ("statistics", _) => "Statistics", _ => "Preferences",
    };

    /// <param name="keptConversations">Conversations still in the history: after it was switched off they stay until their period ends,
    /// and the text must say so instead of "not stored".</param>
    public static string Generate(string language, AssistantSettings settings, AssistantOptions options, RecaptchaSettings captcha, int keptConversations = 0, string? engine = null)
    {
        var api = (engine ?? VisitorConsent.Engine(options)) == "api";
        language = Languages.Contains(language) ? language : "en";
        var features = settings.Effective(options.Features);
        var privacy = options.Privacy;
        var flags = new HashSet<string>();
        void Flag(string name, bool on) { if (on) flags.Add(name); }
        var gpuCountry = privacy.GpuOperatorCountry.Trim();
        Flag("ai", features.Assistant);
        Flag("gpu", features.Assistant && !api);
        Flag("api", features.Assistant && api);
        Flag("consent", VisitorConsent.Required(options, features));
        Flag("noconsent", features.Assistant && !privacy.RequireConsent);
        Flag("cookiebot", VisitorConsent.Required(options, features) && privacy.UsesCookiebot);
        Flag("gpuabroad", gpuCountry.Length == 2 && !SafeCountries.Contains(gpuCountry.ToUpperInvariant()));
        Flag("chat", features.LiveChat);
        Flag("email", features.Email);
        Flag("team", features.Team);
        Flag("confirmation", features.Email && settings.Contact.SendConfirmation);
        var usesCaptcha = features.Team && settings.Support.UseRecaptcha && captcha.Ready;
        Flag("captcha", usesCaptcha);
        Flag("captchacookiebot", usesCaptcha && string.Equals(captcha.ConsentMode, "cookiebot", StringComparison.OrdinalIgnoreCase));
        Flag("captchaexplicit", usesCaptcha && !string.Equals(captcha.ConsentMode, "cookiebot", StringComparison.OrdinalIgnoreCase));
        Flag("images", features.Assistant && settings.Behaviour.AllowImages);
        Flag("pdfs", features.Assistant && settings.Behaviour.AllowPdfs);
        Flag("files", features.Assistant && (settings.Behaviour.AllowImages || settings.Behaviour.AllowPdfs));
        Flag("pagecontext", features.Assistant && settings.Behaviour.IncludePageContext);
        Flag("history", features.Assistant && settings.Privacy.History);
        Flag("nohistory", features.Assistant && !settings.Privacy.History && keptConversations == 0);
        Flag("historyending", features.Assistant && !settings.Privacy.History && keptConversations > 0);
        Flag("historyany", features.Assistant && (settings.Privacy.History || keptConversations > 0));

        var values = new Dictionary<string, string>
        {
            ["gpuOperator"] = privacy.GpuOperator.Trim() is { Length: > 0 } op ? op : language == "de" ? "[Betreiber]" : "[operator]",
            ["gpuCountry"] = Country(gpuCountry, language),
            ["model"] = ClaudeEngine.DisplayName(options.Claude.Model),
            ["consentDays"] = Math.Clamp(privacy.ConsentDays, 1, 400).ToString(),
            ["keepDays"] = Math.Clamp(privacy.KeepConsentRecordsDays, Math.Clamp(privacy.ConsentDays, 1, 400), 3650).ToString(),
            ["inactivityDays"] = settings.Support.InactivityDays.ToString(),
            ["retentionDays"] = settings.Support.RetentionDays.ToString(),
            ["historyDays"] = Math.Clamp(settings.Privacy.HistoryDays, 1, 365).ToString(),
            // The widget forgets conversations after the team's inactivity period, or after 3 days without team features.
            ["storageDays"] = (features.Team ? Math.Clamp(settings.Support.InactivityDays, 1, 30) : 3).ToString(),
            ["cookiebotCategory"] = Category(privacy.Category, language),
            ["captchaCategory"] = Category((captcha.CookiebotCategory ?? "").Trim().ToLowerInvariant(), language),
        };
        return Render(Template(language), flags, values);
    }
}
