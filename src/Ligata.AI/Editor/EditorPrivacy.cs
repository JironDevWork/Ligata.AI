using Ligata.AI.Services;

namespace Ligata.AI.Editor;

/// <summary>
/// The privacy note for staff who use the content assistant (Art. 13 GDPR, Art. 19 DSG), filled in from its settings: the
/// templates docs/privacy/staff-*.md, rendered like the website's privacy policy text. Editors read it in the chat; the
/// editor groups copy it for their staff privacy notes.
/// </summary>
public static class EditorPrivacy
{
    public static string Template(string language) => PrivacyPolicy.Resource($"Ligata.AI.Privacy.staff.{Language(language)}.md");

    /// <summary>de for German backoffice languages (de-CH, de-DE, …), else en.</summary>
    public static string Language(string? language) => language?.StartsWith("de", StringComparison.OrdinalIgnoreCase) == true ? "de" : "en";

    /// <param name="users">Names of the user groups that may use the assistant.</param>
    /// <param name="viewers">Names of the user groups that see the activity log and usage (LigataAI:EditorGroups).</param>
    public static string Generate(string language, EditorSettings settings, string model, IEnumerable<string> users, IEnumerable<string> viewers)
    {
        language = Language(language);
        var flags = new HashSet<string>();
        if (!string.IsNullOrWhiteSpace(settings.Responsible)) flags.Add("responsible");
        if (settings.Actions.Contains(EditorActions.Media)) flags.Add("media");
        if (settings.NotForMonitoring) flags.Add("nomonitoring");
        var values = new Dictionary<string, string>
        {
            ["responsible"] = (settings.Responsible ?? "").Trim(),
            ["model"] = model,
            ["chatDays"] = settings.Limits.KeepChatsDays.ToString(),
            ["activityDays"] = settings.Limits.KeepActivityDays.ToString(),
            ["usageDays"] = EditorStore.KeepUsageDays.ToString(),
            ["users"] = Names(users, language),
            ["viewers"] = Names(viewers, language),
        };
        return PrivacyPolicy.Render(Template(language), flags, values);
    }

    /// <summary>„Administratoren“ und „Redaktion“ / “Administrators” and “Editors”.</summary>
    private static string Names(IEnumerable<string> names, string language)
    {
        var quoted = names.Where(n => !string.IsNullOrWhiteSpace(n)).Distinct().Select(n => language == "de" ? $"„{n.Trim()}“" : $"“{n.Trim()}”").ToList();
        if (quoted.Count == 0) return language == "de" ? "[Benutzergruppen]" : "[user groups]";
        var and = language == "de" ? " und " : " and ";
        return quoted.Count == 1 ? quoted[0] : string.Join(", ", quoted[..^1]) + and + quoted[^1];
    }
}
