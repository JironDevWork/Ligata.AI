using Ligata.AI.Models;

namespace Ligata.AI.Editor;

/// <summary>
/// The content assistant in the backoffice (Ligata.AI 0.9): a chat for editors that finds, reads and changes content with tools.
/// Everything here is set under AI Assistant → Content assistant and stored as one JSON document, apart from the website assistant.
/// </summary>
public sealed record EditorSettings
{
    /// <summary>Switched on for the groups under Access. Licensed by LigataAI:Features:ContentAssistant.</summary>
    public bool Enabled { get; init; } = true;
    /// <summary>
    /// Who may use it (user group aliases) and which permission modes each group may choose. Administrators first. A group with
    /// any mode that changes content may also choose Read only; a group with only Read only uses the assistant to find and read.
    /// </summary>
    public List<EditorGroup> Access { get; init; } = [new("admin", [.. EditorModes.All])];
    /// <summary>The mode a new conversation starts in (falls back to the safest mode the user may use).</summary>
    public string DefaultMode { get; init; } = EditorModes.Manual;
    /// <summary>What the assistant may do at all (see <see cref="EditorActions"/>). Reading and opening pages are always allowed.</summary>
    public List<string> Actions { get; init; } = [EditorActions.Edit, EditorActions.Create, EditorActions.Media];
    /// <summary>In Auto mode these run without asking; everything else allowed asks first.</summary>
    public List<string> AutoApprove { get; init; } = [EditorActions.Edit, EditorActions.Create, EditorActions.Media];
    /// <summary>In Auto mode, after this many changes for one message the assistant asks again (0 = never).</summary>
    public int AskAfterChanges { get; init; } = 10;
    public EditorScope Scope { get; init; } = new();
    /// <summary>How much Claude thinks by default: off, low, medium, high or xhigh.</summary>
    public string Effort { get; init; } = "medium";
    /// <summary>Editors may choose the effort in the chat (Low, Medium, High).</summary>
    public bool EffortInChat { get; init; } = true;
    /// <summary>House rules for every conversation: tone, spelling, conventions ("Swiss spelling: ss instead of ß").</summary>
    public string Guidelines { get; init; } = "";
    /// <summary>Who is responsible for the processing, with a contact for privacy questions: shown in the privacy note for staff.</summary>
    public string Responsible { get; init; } = "";
    /// <summary>The privacy note promises that the activity log and usage figures are not used to monitor performance or behaviour. Only when that holds (a works agreement, for example).</summary>
    public bool NotForMonitoring { get; init; }
    public EditorLimits Limits { get; init; } = new();
}

/// <param name="Group">A user group alias.</param>
/// <param name="Modes">The permission modes members may choose.</param>
public sealed record EditorGroup(string Group, List<string> Modes);

/// <summary>Where the assistant may work.</summary>
public sealed record EditorScope
{
    /// <summary>Content nodes it may work in, with everything below them. Empty: the whole site (always within the user's own start nodes).</summary>
    public List<Guid> Roots { get; init; } = [];
    /// <summary>Document type aliases it may read but never change.</summary>
    public List<string> ReadOnlyTypes { get; init; } = [];
    /// <summary>Property aliases it never changes, on any page or block.</summary>
    public List<string> ProtectedFields { get; init; } = [];
    /// <summary>Languages (ISO codes) it may change. Empty: every language the user may edit.</summary>
    public List<string> Cultures { get; init; } = [];
}

public sealed record EditorLimits
{
    /// <summary>Messages one person may send per day (UTC). 0 = unlimited.</summary>
    public int MessagesPerUser { get; init; } = 100;
    /// <summary>Messages for the whole site per day (UTC), a ceiling on cost apart from the website assistant's. 0 = unlimited.</summary>
    public int MessagesPerDay { get; init; } = 500;
    /// <summary>Tool steps the assistant may take for one message before it has to answer.</summary>
    public int MaxSteps { get; init; } = 24;
    /// <summary>Conversations are deleted this many days after their last message.</summary>
    public int KeepChatsDays { get; init; } = 30;
    /// <summary>The activity log keeps what the assistant did for this many days.</summary>
    public int KeepActivityDays { get; init; } = 365;
}

public static class EditorModes
{
    /// <summary>Finds, reads and opens pages, and changes nothing: the model is given no tool that changes content (0.10).</summary>
    public const string ReadOnly = "readonly";
    /// <summary>Every change waits for the user's approval.</summary>
    public const string Manual = "manual";
    /// <summary>Changes listed under AutoApprove run at once; the others ask.</summary>
    public const string Auto = "auto";
    /// <summary>Every allowed change runs without asking.</summary>
    public const string Bypass = "bypass";
    /// <summary>From the safest to the least safe.</summary>
    public static readonly string[] All = [ReadOnly, Manual, Auto, Bypass];
    /// <summary>The modes that may change content.</summary>
    public static readonly string[] Changing = [Manual, Auto, Bypass];
}

/// <summary>What a write does. Each is allowed or not (Actions) and asks or not in Auto mode (AutoApprove).</summary>
public static class EditorActions
{
    /// <summary>Change text and fields, add, remove and reorder blocks, rename. Always saved as a draft.</summary>
    public const string Edit = "edit";
    /// <summary>Create pages (as drafts).</summary>
    public const string Create = "create";
    /// <summary>Make changes live.</summary>
    public const string Publish = "publish";
    /// <summary>Take pages off the website.</summary>
    public const string Unpublish = "unpublish";
    /// <summary>Move pages to another place in the tree or change their order.</summary>
    public const string Move = "move";
    /// <summary>Move pages to the recycle bin (never deleted for good).</summary>
    public const string Delete = "delete";
    /// <summary>Upload images from the chat to the media library.</summary>
    public const string Media = "media";
    public static readonly string[] All = [Edit, Create, Publish, Unpublish, Move, Delete, Media];
}

public static class EditorValidation
{
    public static readonly string[] Efforts = ["off", "low", "medium", "high", "xhigh"];
    /// <summary>The efforts an editor may pick in the chat.</summary>
    public static readonly string[] ChatEfforts = ["low", "medium", "high"];

    public static void Settings(EditorSettings s)
    {
        var errors = new Dictionary<string, string>();
        void Check(bool ok, string key, string message) { if (!ok) errors.TryAdd(key, message); }
        Check(s.Access is { Count: <= 50 } && s.Access.All(a => a != null && System.Text.RegularExpressions.Regex.IsMatch(a.Group ?? "", "^[A-Za-z0-9_.-]{1,100}$") && a.Modes is { Count: > 0 } && a.Modes.All(EditorModes.All.Contains)),
            "access", "Choose at least one mode for every user group.");
        Check(s.Access == null || s.Access.Select(a => a.Group.ToLowerInvariant()).Distinct().Count() == s.Access.Count, "access", "Each user group can be listed once.");
        Check(EditorModes.All.Contains(s.DefaultMode), "defaultMode", "Choose Read only, Manual, Auto or Bypass as the starting mode.");
        Check(s.Actions is { Count: <= 10 } && s.Actions.All(EditorActions.All.Contains), "actions", "Unknown action.");
        Check(s.AutoApprove is { Count: <= 10 } && s.AutoApprove.All(EditorActions.All.Contains), "autoApprove", "Unknown action.");
        Check(s.AskAfterChanges is >= 0 and <= 200, "askAfterChanges", "Ask again after 0 to 200 changes.");
        Check(Efforts.Contains(s.Effort), "effort", "Choose a supported effort level.");
        Check((s.Guidelines ?? "").Length <= 4000, "guidelines", "The guidelines can be at most 4,000 characters.");
        Check((s.Responsible ?? "").Length <= 1000, "responsible", "Who is responsible can be at most 1,000 characters.");
        var scope = s.Scope ?? new();
        Check(scope.Roots is { Count: <= 50 }, "scope.roots", "Choose at most 50 starting points.");
        Check(scope.ReadOnlyTypes is { Count: <= 200 } && scope.ReadOnlyTypes.All(t => t is { Length: > 0 and <= 255 }), "scope.readOnlyTypes", "Invalid document type.");
        Check(scope.ProtectedFields is { Count: <= 200 } && scope.ProtectedFields.All(t => t is { Length: > 0 and <= 255 }), "scope.protectedFields", "Invalid property alias.");
        Check(scope.Cultures is { Count: <= 50 } && scope.Cultures.All(t => t is { Length: > 0 and <= 20 }), "scope.cultures", "Invalid language.");
        var l = s.Limits ?? new();
        Check(l.MessagesPerUser is >= 0 and <= 100_000, "limits.messagesPerUser", "Messages per person: 0 (unlimited) to 100,000.");
        Check(l.MessagesPerDay is >= 0 and <= 1_000_000, "limits.messagesPerDay", "Messages per day: 0 (unlimited) to 1,000,000.");
        Check(l.MaxSteps is >= 2 and <= 60, "limits.maxSteps", "Steps per message: 2 to 60.");
        Check(l.KeepChatsDays is >= 1 and <= 365, "limits.keepChatsDays", "Conversations are kept for 1 to 365 days.");
        Check(l.KeepActivityDays is >= 7 and <= 3650, "limits.keepActivityDays", "The activity log is kept for 7 to 3,650 days.");
        if (errors.Count > 0) throw new AssistantValidationException(errors);
    }
}
