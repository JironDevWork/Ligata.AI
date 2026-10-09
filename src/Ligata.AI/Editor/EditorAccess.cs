using Umbraco.Cms.Core;
using Umbraco.Cms.Core.Actions;
using Umbraco.Cms.Core.Models;
using Umbraco.Cms.Core.Models.Entities;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Cms.Core.Services;
using Umbraco.Cms.Core.Services.AuthorizationStatus;

namespace Ligata.AI.Editor;

/// <summary>The person steering the assistant. Every tool runs with this user's own Umbraco permissions.</summary>
public sealed record EditorUser(IUser User)
{
    public Guid Key => User.Key;
    public int Id => User.Id;
    public string Name => User.Name ?? User.Username;
    public IEnumerable<string> Groups => User.Groups.Select(g => g.Alias);
}

/// <summary>
/// Who may use the assistant and in which modes (settings), and what it may touch for this user: the settings' scope (start
/// points, read-only types, protected fields, languages) and the user's own start nodes, permissions and languages in Umbraco.
/// </summary>
public sealed class EditorAccess(IContentPermissionService permissions, IEntityService entities)
{
    /// <summary>The modes this user may choose (empty: no access). Groups combine.</summary>
    public static string[] Modes(EditorSettings settings, EditorUser user) =>
        settings.Access.Where(a => user.Groups.Contains(a.Group, StringComparer.OrdinalIgnoreCase)).SelectMany(a => a.Modes).Distinct()
            .OrderBy(m => Array.IndexOf(EditorModes.All, m)).ToArray();

    /// <summary>The requested mode if allowed, else the setting's default if allowed, else the safest allowed mode.</summary>
    public static string Mode(EditorSettings settings, EditorUser user, string? wanted)
    {
        var modes = Modes(settings, user);
        if (wanted != null && modes.Contains(wanted)) return wanted;
        return modes.Contains(settings.DefaultMode) ? settings.DefaultMode : modes.FirstOrDefault() ?? EditorModes.Manual;
    }

    private HashSet<int>? roots;
    /// <summary>The ids of the configured start points (null: the whole site).</summary>
    private HashSet<int>? Roots(EditorSettings settings)
    {
        if (settings.Scope.Roots.Count == 0) return null;
        return roots ??= settings.Scope.Roots.Select(k => entities.GetId(k, UmbracoObjectTypes.Document)).Where(a => a.Success).Select(a => a.Result).ToHashSet();
    }

    /// <summary>Within the settings' start points (a start point itself counts, its parents do not).</summary>
    public bool InScope(EditorSettings settings, string path)
    {
        var allowed = Roots(settings);
        return allowed == null || path.Split(',').Select(p => int.TryParse(p, out var id) ? id : 0).Any(allowed.Contains);
    }

    /// <summary>Above a start point: shown while browsing towards it, never read or changed.</summary>
    public bool AboveScope(EditorSettings settings, IUmbracoEntity entity)
    {
        var allowed = Roots(settings);
        if (allowed == null) return false;
        var id = entity.Id.ToString();
        return settings.Scope.Roots.Select(k => entities.Get(k, UmbracoObjectTypes.Document)).Any(root => root != null && root.Path.Split(',').Contains(id) && root.Id != entity.Id);
    }

    public async Task<bool> AllowedAsync(EditorUser user, Guid key, string permission) =>
        await permissions.AuthorizeAccessAsync(user.User, [key], new HashSet<string> { permission }) == ContentAuthorizationStatus.Success;

    public async Task<bool> RootAllowedAsync(EditorUser user, string permission) =>
        await permissions.AuthorizeRootAccessAsync(user.User, new HashSet<string> { permission }) == ContentAuthorizationStatus.Success;

    public async Task<bool> CultureAllowedAsync(EditorSettings settings, EditorUser user, string? culture)
    {
        if (culture == null) return true;
        if (settings.Scope.Cultures.Count > 0 && !settings.Scope.Cultures.Contains(culture, StringComparer.OrdinalIgnoreCase)) return false;
        return await permissions.AuthorizeCultureAccessAsync(user.User, new HashSet<string> { culture }) == ContentAuthorizationStatus.Success;
    }

    /// <summary>Readable: in scope, not in the recycle bin, and the user may browse it.</summary>
    public async Task<bool> ReadableAsync(EditorSettings settings, EditorUser user, IContent content) =>
        !content.Trashed && InScope(settings, content.Path) && await AllowedAsync(user, content.Key, ActionBrowse.ActionLetter);

    /// <summary>Of the given keys, those the user may browse (for search results and lists).</summary>
    public async Task<HashSet<Guid>> ReadableAsync(EditorUser user, IEnumerable<Guid> keys) =>
        (await permissions.FilterAuthorizedAccessAsync(user.User, keys, new HashSet<string> { ActionBrowse.ActionLetter })).ToHashSet();

    /// <summary>The Umbraco permission each kind of change needs on the page (create: on the parent).</summary>
    public static string Permission(string action) => action switch
    {
        EditorActions.Create => ActionNew.ActionLetter,
        EditorActions.Publish => ActionPublish.ActionLetter,
        EditorActions.Unpublish => ActionUnpublish.ActionLetter,
        EditorActions.Move => ActionMove.ActionLetter,
        EditorActions.Delete => ActionDelete.ActionLetter,
        _ => ActionUpdate.ActionLetter,
    };

    /// <summary>Why this change may not be made, or null. Checks the settings and the user's permissions; the caller checks the action is allowed at all.</summary>
    public async Task<string?> RefuseAsync(EditorSettings settings, EditorUser user, IContent content, string action, string? culture)
    {
        if (content.Trashed) return "This page is in the recycle bin.";
        if (!InScope(settings, content.Path)) return "This page is outside the part of the site the assistant may work in (Content assistant → Settings → Where).";
        if (action != EditorActions.Create && settings.Scope.ReadOnlyTypes.Contains(content.ContentType.Alias, StringComparer.OrdinalIgnoreCase))
            return $"Pages of type {content.ContentType.Alias} are read-only for the assistant.";
        if (!await AllowedAsync(user, content.Key, Permission(action)))
            return $"{user.Name} may not {Verb(action)} this page in Umbraco.";
        if (!await CultureAllowedAsync(settings, user, culture)) return $"The assistant may not change the language {culture} for {user.Name}.";
        return null;
    }

    public static string Verb(string action) => action switch
    {
        EditorActions.Create => "create pages below",
        EditorActions.Publish => "publish",
        EditorActions.Unpublish => "unpublish",
        EditorActions.Move => "move",
        EditorActions.Delete => "delete",
        _ => "change",
    };
}
