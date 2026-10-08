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
    /// Changes when the recipient changes (engine, GPU operator or its country), when the site starts keeping a history of
    /// conversations or keeps it for another period, or when editors ask everyone again. Without a history it is the same as
    /// before histories existed, so updating the package asks nobody again.
    /// </summary>
    public static string Version(AssistantSettings settings, AssistantOptions options)
    {
        var engine = Engine(options);
        var recipient = engine == "api" ? AnthropicName : $"{options.Privacy.GpuOperator.Trim()}|{options.Privacy.GpuOperatorCountry.Trim().ToUpperInvariant()}";
        if (settings.Privacy.History) recipient += $"|history:{settings.Privacy.HistoryDays}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(recipient)))[..6].ToLowerInvariant();
        return $"{engine}.{Math.Max(1, settings.Privacy.ConsentRevision)}.{hash}";
    }

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

    public static ConsentCheck Check(ConsentRow? row, string version, DateTime now) =>
        row == null ? ConsentCheck.Unknown
        : row.WithdrawnUtc != null ? ConsentCheck.Withdrawn
        : row.ExpiresUtc <= now ? ConsentCheck.Expired
        : row.Version != version ? ConsentCheck.Outdated
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
