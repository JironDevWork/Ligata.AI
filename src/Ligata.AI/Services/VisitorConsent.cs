using System.Security.Cryptography;
using System.Text;
using Ligata.AI.Data;
using Ligata.AI.Models;

namespace Ligata.AI.Services;

public enum ConsentCheck { Valid, Missing, Unknown, Withdrawn, Expired, Outdated }

/// <summary>
/// What visitors agree to before the AI receives their messages: who answers (Anthropic or the GPU operator),
/// which version of the consent text, and for how long. Any change of recipient asks everyone again.
/// </summary>
public static class VisitorConsent
{
    public const string AnthropicName = "Anthropic";
    public const string AnthropicCountry = "US";

    public static string Engine(AssistantOptions options) => options.UsesApi ? "api" : "gpu";

    public static bool Required(AssistantOptions options, FeatureState features) => options.Privacy.RequireConsent && features.Assistant;

    /// <summary>
    /// Changes when the recipient changes (engine, GPU operator or its country), editors ask everyone again, or the site starts
    /// keeping conversations or keeps them for another period: the consent request states the period ("…h30"), so every visitor
    /// agrees again to the period that applies now.
    /// </summary>
    public static string Version(AssistantSettings settings, AssistantOptions options)
    {
        var engine = Engine(options);
        var recipient = engine == "api" ? AnthropicName : $"{options.Privacy.GpuOperator.Trim()}|{options.Privacy.GpuOperatorCountry.Trim().ToUpperInvariant()}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(recipient)))[..6].ToLowerInvariant();
        var history = settings.Privacy.History ? $".h{Math.Clamp(settings.Privacy.HistoryDays, 1, 365)}" : "";
        return $"{engine}.{Math.Max(1, settings.Privacy.ConsentRevision)}.{hash}{history}";
    }

    /// <summary>
    /// A consent covers the current version when it is that version, or when it was given while conversations were kept and the site
    /// has stopped keeping them since (it agreed to more than is done now, so nobody is asked again for less).
    /// </summary>
    public static bool Covers(string? given, string current) =>
        given == current || (given != null && !current.Contains(".h", StringComparison.Ordinal) && given.StartsWith(current + ".h", StringComparison.Ordinal));

    /// <summary>What the widget needs to ask (null when no consent is needed).</summary>
    public static object? Public(AssistantSettings settings, AssistantOptions options, FeatureState features)
    {
        if (!Required(options, features)) return null;
        var privacy = options.Privacy;
        var api = options.UsesApi;
        return new
        {
            Version = Version(settings, options),
            Mode = privacy.UsesCookiebot ? "cookiebot" : "explicit",
            privacy.Category,
            Days = Math.Clamp(privacy.ConsentDays, 1, 400),
            Provider = new { Kind = api ? "anthropic" : "gpu", Name = api ? AnthropicName : privacy.GpuOperator.Trim(), Country = api ? AnthropicCountry : privacy.GpuOperatorCountry.Trim() },
            Text = settings.Privacy.ConsentText,
        };
    }

    /// <summary>
    /// The period and the revision the visitor was told about when the site kept their conversations (recorded with the consent as
    /// proof; null there after an objection). Empty while no history is kept.
    /// </summary>
    public static string HistoryVersion(AssistantSettings settings) =>
        settings.Privacy.History ? $"{Math.Clamp(settings.Privacy.HistoryDays, 1, 365)}.{Math.Max(1, settings.Privacy.ConsentRevision)}" : "";

    /// <summary>
    /// The site may keep this visitor's conversation (legitimate interest, Art. 6(1)(f) GDPR): with consent required, on a valid
    /// consent given to the current period and not objected to since ("Stop keeping"); without consent, unless the visitor objected
    /// (the browser then sends no key).
    /// </summary>
    public static bool KeepsHistory(ConsentStore store, string? id, AssistantSettings settings, AssistantOptions options, FeatureState features, DateTime now)
    {
        if (!features.Assistant || !settings.Privacy.History) return false;
        if (!Required(options, features)) return true;
        var row = Guid.TryParse(id, out var key) ? store.Find(key) : null;
        return Check(row, Version(settings, options), now) == ConsentCheck.Valid && row!.HistoryVersion == HistoryVersion(settings);
    }

    public static ConsentCheck Check(ConsentRow? row, string version, DateTime now) =>
        row == null ? ConsentCheck.Unknown
        : row.WithdrawnUtc != null ? ConsentCheck.Withdrawn
        : row.ExpiresUtc <= now ? ConsentCheck.Expired
        : !Covers(row.Version, version) ? ConsentCheck.Outdated
        : ConsentCheck.Valid;

    /// <summary>Checks the consent id a question or file carries; the first use is recorded.</summary>
    public static ConsentCheck Verify(ConsentStore store, string? id, AssistantSettings settings, AssistantOptions options, DateTime now)
    {
        if (string.IsNullOrWhiteSpace(id)) return ConsentCheck.Missing;
        if (!Guid.TryParse(id, out var key)) return ConsentCheck.Unknown;
        var row = store.Find(key);
        var result = Check(row, Version(settings, options), now);
        if (result == ConsentCheck.Valid) store.MarkUsed(row!, now);
        return result;
    }

    public static string Source(string? value) => value == "cookiebot" ? "cookiebot" : "chat";

    public static string Language(string? value)
    {
        var text = (value ?? "").Trim().ToLowerInvariant();
        return text.Length is >= 2 and <= 10 && text.All(c => char.IsAsciiLetter(c) || c == '-') ? text : "";
    }
}
