using Asp.Versioning;
using Ligata.AI.Editor;
using Ligata.AI.Models;
using Ligata.AI.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Options;
using Umbraco.Cms.Api.Management.Controllers;
using Umbraco.Cms.Core.Models;
using Umbraco.Cms.Core.Security;
using Umbraco.Cms.Core.Services;
using Umbraco.Cms.Web.Common.Authorization;

namespace Ligata.AI.Controllers;

/// <summary>The content assistant's API exists only when it is licensed (LigataAI:Features:ContentAssistant).</summary>
public sealed class EditorUserFilter(IOptions<AssistantOptions> options) : IAuthorizationFilter
{
    public void OnAuthorization(AuthorizationFilterContext context)
    {
        if (!options.Value.Features.ContentAssistant) context.Result = new NotFoundResult();
    }
}

public sealed record EditorSettingsRequest(EditorSettings Settings, int Version);

/// <summary>
/// A streamed answer (server-sent events) written while the result executes: result filters (Umbraco sets no-cache headers) run
/// before the first byte, so they never meet a response that has already started.
/// </summary>
public sealed class StreamedResult(Func<HttpContext, Task> write) : IActionResult
{
    public Task ExecuteResultAsync(ActionContext context) => write(context.HttpContext);
}
public sealed record EditorUndoRequest(string? Note = null);

/// <summary>
/// The content assistant: the chat for every backoffice user its settings allow (Access), and its settings, activity log and usage
/// for the editor groups (LigataAI:EditorGroups). Every tool runs with the signed-in user's permissions.
/// </summary>
[ApiVersion("1.0"), Route("umbraco/management/api/v{version:apiVersion}/ligata-ai/editor")]
[Authorize(Policy = AuthorizationPolicies.BackOfficeAccess), ServiceFilter(typeof(EditorUserFilter))]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class EditorController(EditorStore store, EditorAgent agent, EditorModel model, ContentTools content, EditorMedia media, IBackOfficeSecurityAccessor security,
    IOptions<AssistantOptions> options, IUserGroupService groups, IContentTypeService types, IEntityService entities) : ManagementApiControllerBase
{
    private EditorUser? User => security.BackOfficeSecurity?.CurrentUser is { } user ? new EditorUser(user) : null;
    private bool Admin(EditorUser user) => user.Groups.Any(g => options.Value.EditorGroups.Contains(g, StringComparer.OrdinalIgnoreCase));
    private static object Problem(string code, string message, Dictionary<string, string>? errors = null) => new { code, message, errors };

    private static DateTime Utc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);

    /// <summary>Whether this user may use the assistant, in which modes, and their recent conversations. Never an error: the panel hides itself.</summary>
    [HttpGet("session")]
    public IActionResult Session()
    {
        var user = User;
        if (user == null) return Unauthorized();
        var settings = store.Settings().Settings;
        var modes = EditorAccess.Modes(settings, user);
        string? reason = !settings.Enabled ? "disabled" : modes.Length == 0 ? "forbidden" : !model.Ready ? "not_configured" : null;
        var (mine, _) = reason == null ? store.MessagesToday(user.Key) : (0, 0);
        return Ok(new
        {
            available = reason == null, reason, admin = Admin(user), user = new { name = user.Name },
            modes, mode = EditorAccess.Mode(settings, user, null), actions = settings.Actions, autoApprove = settings.AutoApprove, askAfterChanges = settings.AskAfterChanges,
            effort = settings.Effort, efforts = settings.EffortInChat ? EditorValidation.ChatEfforts : [], model = ClaudeEngine.DisplayName(model.Model),
            keepDays = settings.Limits.KeepChatsDays,
            messagesLeft = settings.Limits.MessagesPerUser > 0 ? Math.Max(0, settings.Limits.MessagesPerUser - mine) : (int?)null,
            chats = reason == null ? store.Chats(user.Key, 30).Select(c => new { c.Id, c.Title, c.Mode, updated = Utc(c.UpdatedUtc) }) : null,
        });
    }

    /// <summary>The name of the page open in the backoffice (for the panel's context chip), if the user may see it.</summary>
    [HttpGet("page")]
    public async Task<IActionResult> Page([FromQuery] Guid key, [FromQuery] string? culture)
    {
        var user = User!;
        var settings = store.Settings().Settings;
        var context = new ToolContext(settings, user) { OpenCulture = culture };
        var page = content.Find(key.ToString());
        if (page == null || !await content.ReadableForUserAsync(context, page)) return NotFound();
        var (c, _) = await content.CultureAsync(context, page.ContentType, culture);
        return Ok(new { name = content.Name(page, c), culture = c, type = page.ContentType.Alias });
    }

    [HttpGet("chats/{id:guid}")]
    public IActionResult Chat(Guid id)
    {
        var user = User!;
        var chat = store.Chat(id, user.Key);
        if (chat == null) return NotFound(Problem("not_found", "This conversation no longer exists."));
        var state = AssistantJson.Read<EditorState>(chat.State is { Length: > 2 } s ? s : "{}");
        return Ok(new
        {
            chat.Id, chat.Title, chat.Mode, effort = state.Effort, updated = Utc(chat.UpdatedUtc), items = AssistantJson.Read<List<EditorItem>>(chat.Transcript),
            waiting = state.Pending != null, context = new { used = EditorAgent.Estimate(state), limit = agent.CompactAt() },
        });
    }

    [HttpDelete("chats/{id:guid}")]
    public IActionResult DeleteChat(Guid id) => store.DeleteChat(id, User!.Key) ? NoContent() : NotFound(Problem("not_found", "This conversation no longer exists."));

    /// <summary>Sends a message; the answer streams as server-sent events (chat, item, delta, thinking, navigate, refresh, waiting, done, error).</summary>
    [HttpPost("message"), RequestSizeLimit(40_000_000)]
    public IActionResult Message([FromBody] EditorMessageRequest request)
    {
        var user = User!;
        return new StreamedResult(http => Streamed(http, () => agent.MessageAsync(http, user, request)));
    }

    private static async Task Streamed(HttpContext http, Func<Task> run)
    {
        try { await run(); }
        catch (EditorException e) when (!http.Response.HasStarted) { await ChatRelay.Json(http, e.Status, e.Code, e.Message); }
        catch (OperationCanceledException) { }
    }

    /// <summary>Approves or declines the changes that wait; the assistant continues (streamed like a message).</summary>
    [HttpPost("decide")]
    public IActionResult Decide([FromBody] EditorDecideRequest request)
    {
        var user = User!;
        return new StreamedResult(http => Streamed(http, () => agent.DecideAsync(http, user, request)));
    }

    // ---------- for the editor groups ----------
    private IActionResult? Forbidden() => User is { } user && Admin(user) ? null : StatusCode(403, Problem("forbidden", "Only the editor groups (LigataAI:EditorGroups) manage the content assistant."));

    [HttpGet("settings")]
    public async Task<IActionResult> Settings()
    {
        if (Forbidden() is { } no) return no;
        var (settings, version) = store.Settings();
        var allGroups = (await groups.GetAllAsync(0, 500)).Items.Select(g => new { g.Alias, g.Name, sections = g.AllowedSections.Contains(Ligata.AI.Data.AssistantInstaller.SectionAlias) }).OrderBy(g => g.Name).ToList();
        var documentTypes = types.GetAll().Select(t => new { t.Alias, t.Name, element = t.IsElement, icon = t.Icon }).OrderBy(t => t.element).ThenBy(t => t.Name).ToList();
        var languages = (await content.LanguagesAsync()).Select(l => new { l.IsoCode, l.CultureName, l.IsDefault });
        var roots = settings.Scope.Roots.Select(k => entities.Get(k, UmbracoObjectTypes.Document)).Where(e => e != null).Select(e => new { e!.Key, e.Name, path = content.Breadcrumb(e.Path) });
        var top = entities.GetChildren(Umbraco.Cms.Core.Constants.System.Root, UmbracoObjectTypes.Document).Where(e => !e.Trashed).OrderBy(e => e.SortOrder).Select(e => new { e.Key, e.Name, e.HasChildren });
        return Ok(new
        {
            settings, version, defaults = new EditorSettings(), groups = allGroups, types = documentTypes, languages, roots, top,
            claude = new { ready = model.Ready, model = model.Model, modelName = ClaudeEngine.DisplayName(model.Model) }, licensed = true,
            editorGroups = options.Value.EditorGroups, compactAt = agent.CompactAt(),
        });
    }

    /// <summary>The pages below a page (or the top), for choosing where the assistant may work.</summary>
    [HttpGet("tree")]
    public IActionResult Tree([FromQuery] Guid? parent)
    {
        if (Forbidden() is { } no) return no;
        var id = parent is { } key ? entities.GetId(key, UmbracoObjectTypes.Document) is { Success: true } found ? found.Result : -2 : Umbraco.Cms.Core.Constants.System.Root;
        if (id == -2) return NotFound();
        return Ok(entities.GetChildren(id, UmbracoObjectTypes.Document).Where(e => !e.Trashed).OrderBy(e => e.SortOrder).Select(e => new { e.Key, e.Name, e.HasChildren }));
    }

    [HttpPost("settings")]
    public IActionResult SaveSettings([FromBody] EditorSettingsRequest request)
    {
        if (Forbidden() is { } no) return no;
        try
        {
            var settings = request.Settings with
            {
                Access = request.Settings.Access?.Where(a => !string.IsNullOrWhiteSpace(a.Group)).Select(a => a with { Group = a.Group.Trim() }).ToList() ?? [],
                Scope = request.Settings.Scope ?? new(), Limits = request.Settings.Limits ?? new(), Guidelines = request.Settings.Guidelines ?? "",
                Actions = request.Settings.Actions?.Distinct().ToList() ?? [], AutoApprove = request.Settings.AutoApprove?.Distinct().ToList() ?? [],
            };
            var version = store.Save(settings, request.Version);
            return Ok(new { version, settings });
        }
        catch (AssistantValidationException e) { return BadRequest(Problem("invalid", "Please check the highlighted settings.", e.Errors)); }
        catch (AssistantConflictException e) { return Conflict(Problem("conflict", e.Message)); }
    }

    private static object Row(EditorActionRow r) => new
    {
        r.Id, r.ChatId, r.UserKey, r.UserName, created = Utc(r.CreatedUtc), r.Kind, r.Tool, r.DocumentKey, r.DocumentName, r.Culture, r.Summary, r.Approval, r.Outcome, r.Error, r.Request,
        undone = r.UndoneUtc is { } u ? Utc(u) : (DateTime?)null, r.UndoneBy,
        undoable = r.Outcome == "done" && r.Approval != "undo" && r.Kind is EditorActions.Edit or EditorActions.Create or EditorActions.Delete or EditorActions.Move or EditorActions.Media,
    };

    [HttpGet("activity")]
    public IActionResult Activity([FromQuery] string? kind, [FromQuery] Guid? user, [FromQuery] Guid? document, [FromQuery] string? q, [FromQuery] int skip = 0, [FromQuery] int take = 50)
    {
        if (Forbidden() is { } no) return no;
        var (items, total) = store.Activity(new ActivityQuery(kind, user, document, q, skip, take));
        return Ok(new { items = items.Select(Row), total, users = store.ActivityUsers().Select(u => new { key = u.Key, name = u.Name }) });
    }

    /// <summary>One action with its changes (before and after). Admins see every action, other users their own.</summary>
    [HttpGet("activity/{id:guid}")]
    public IActionResult Action(Guid id)
    {
        var user = User!;
        var row = store.Action(id);
        if (row == null || (!Admin(user) && row.UserKey != user.Key)) return NotFound(Problem("not_found", "No such action."));
        var changes = AssistantJson.Read<List<EditorChange>>(row.Changes).Select(c => c with { Before = null, After = null });
        return Ok(new { action = Row(row), changes });
    }

    /// <summary>Puts back what an action changed (if nothing changed it since), with the undoing user's permissions. Logged as an action of its own.</summary>
    [HttpPost("activity/{id:guid}/undo")]
    public async Task<IActionResult> Undo(Guid id)
    {
        var user = User!;
        var row = store.Action(id);
        if (row == null || (!Admin(user) && row.UserKey != user.Key)) return NotFound(Problem("not_found", "No such action."));
        if (row.Outcome != "done" || row.Approval == "undo") return BadRequest(Problem("not_undoable", row.Outcome == "undone" ? "This was already undone." : "Only changes that were made can be undone."));
        var settings = store.Settings().Settings;
        var context = new ToolContext(settings, user);
        string? problem;
        try { problem = row.Kind == EditorActions.Media ? (row.DocumentKey is { } key ? media.Undo(user, key) : "Nothing to undo.") : await content.UndoAsync(context, row); }
        catch (Exception e) when (e is not OperationCanceledException) { problem = "Undo failed: " + e.Message; }
        if (problem != null) return Conflict(Problem("conflict", problem));
        row.Outcome = "undone"; row.UndoneUtc = DateTime.UtcNow; row.UndoneBy = user.Name;
        store.Log(row);
        var undo = new EditorActionRow
        {
            Id = Guid.NewGuid(), ChatId = row.ChatId, UserKey = user.Key, UserName = user.Name, CreatedUtc = DateTime.UtcNow, Kind = row.Kind, Tool = "undo",
            DocumentKey = row.DocumentKey, DocumentName = row.DocumentName, Culture = row.Culture, Summary = ("Undo: " + row.Summary)[..Math.Min(500, row.Summary.Length + 6)],
            Changes = "[]", Approval = "undo", Outcome = "done", Request = "",
        };
        store.Log(undo);
        return Ok(new { action = Row(row), undo = Row(undo) });
    }

    [HttpGet("usage")]
    public IActionResult Usage([FromQuery] int days = 30)
    {
        if (Forbidden() is { } no) return no;
        var rows = store.Usage(days);
        var settings = store.Settings().Settings;
        return Ok(new
        {
            days = rows.GroupBy(r => r.Day).Select(g => new { day = g.Key, messages = g.Sum(r => r.Messages), steps = g.Sum(r => r.Steps), changes = g.Sum(r => r.Changes), promptTokens = g.Sum(r => r.PromptTokens), cachedTokens = g.Sum(r => r.CachedTokens), completionTokens = g.Sum(r => r.CompletionTokens) }),
            users = rows.GroupBy(r => r.UserKey).Select(g => new { key = g.Key, name = g.OrderByDescending(r => r.Day).First().UserName, messages = g.Sum(r => r.Messages), changes = g.Sum(r => r.Changes), promptTokens = g.Sum(r => r.PromptTokens), cachedTokens = g.Sum(r => r.CachedTokens), completionTokens = g.Sum(r => r.CompletionTokens), today = g.Where(r => r.Day == EditorStore.Today).Sum(r => r.Messages) }).OrderByDescending(u => u.messages),
            limits = settings.Limits, model = model.Model,
        });
    }
}
