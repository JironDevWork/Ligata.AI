using System.Text.Json;
using Asp.Versioning;
using Ligata.AI.Data;
using Ligata.AI.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Options;
using Umbraco.Cms.Api.Management.Controllers;
using Umbraco.Cms.Core.Security;
using Umbraco.Cms.Web.Common.Authorization;

namespace Ligata.AI.Controllers;

/// <summary>The history of AI conversations: the same people as the Inbox (agent and editor groups), and only with the AI licensed.</summary>
public sealed class HistoryFilter(IBackOfficeSecurityAccessor security, IOptions<AssistantOptions> options) : IAuthorizationFilter
{
    public void OnAuthorization(AuthorizationFilterContext context)
    {
        var groups = options.Value.AgentGroups.Concat(options.Value.EditorGroups).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (!options.Value.Features.Assistant) context.Result = new NotFoundResult();
        else if (security.BackOfficeSecurity?.CurrentUser?.Groups.Any(g => groups.Contains(g.Alias)) != true) context.Result = new ForbidResult();
    }
}

/// <summary>Keep a conversation for Days (1 to 365, default 90) for a Reason, or stop keeping it (Keep false).</summary>
public sealed record KeepRequest(bool Keep, string? Reason = null, int Days = 90);

[ApiVersion("1.0"), Route("umbraco/management/api/v{version:apiVersion}/ligata-ai/history")]
[Authorize(Policy = AuthorizationPolicies.BackOfficeAccess), ServiceFilter(typeof(HistoryFilter))]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class HistoryController(ChatHistoryStore chats, AssistantStore store, IBackOfficeSecurityAccessor security, IOptions<AssistantOptions> options) : ManagementApiControllerBase
{
    private static DateTime Utc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);

    private static object Summary(ChatRow r) => new
    {
        r.Id, r.Topic, r.PagePath, r.PageTitle, r.Language, r.Engine, r.Turns, r.Unanswered, r.Summaries, r.Kept, r.KeptReason,
        keptUntil = r.KeptUntil is { } until ? Utc(until) : (DateTime?)null, expires = r.ExpiresUtc is { } end ? Utc(end) : (DateTime?)null,
        conversationId = r.ConversationId, created = Utc(r.CreatedUtc), updated = Utc(r.UpdatedUtc),
    };

    private object Setup()
    {
        var (settings, _) = store.Settings();
        return new { enabled = settings.Privacy.History, days = settings.Privacy.HistoryDays, inbox = options.Value.Features.Inbox, editor = Editor() };
    }

    private object Counts()
    {
        var c = chats.Counts();
        return new { all = c.Total ?? 0, unanswered = c.Unanswered ?? 0, team = c.Team ?? 0, kept = c.Kept ?? 0 };
    }

    [HttpGet]
    public IActionResult List([FromQuery] string view = "all", [FromQuery] string? q = null, [FromQuery] int skip = 0, [FromQuery] int take = 50)
    {
        var (items, total) = chats.List(new HistoryQuery(view, q, skip, take));
        return Ok(new { items = items.Select(Summary), total, counts = Counts(), history = Setup() });
    }

    [HttpGet("{id:guid}")]
    public IActionResult Conversation(Guid id)
    {
        if (chats.Find(id) is not { } row) return NotFound(new { code = "not_found", message = "This conversation was deleted." });
        return Ok(new
        {
            conversation = Summary(row),
            turns = chats.Turns(id).Select(t => new
            {
                t.Seq, t.Question, files = Json(t.Files), t.Answer, lookups = Json(t.Lookups), t.Outcome, t.OfferedTeam, t.PagePath, t.Attempts,
                t.DurationMs, t.PromptTokens, t.CompletionTokens, at = Utc(t.CreatedUtc),
            }),
        });
    }

    private static JsonElement? Json(string? value)
    {
        if (string.IsNullOrEmpty(value)) return null;
        try { using var document = JsonDocument.Parse(value); return document.RootElement.Clone(); } catch (JsonException) { return null; }
    }

    /// <summary>
    /// Keeps a conversation beyond the history period, for a stated reason (a complaint, a legal claim) and a limited time. The
    /// visitor can still delete it, and it is deleted when the keeping ends.
    /// </summary>
    [HttpPost("{id:guid}/keep")]
    public IActionResult Keep(Guid id, [FromBody] KeepRequest request)
    {
        if (chats.Find(id) == null) return NotFound(new { code = "not_found", message = "This conversation was deleted." });
        var reason = (request.Reason ?? "").Trim();
        if (request.Keep && (reason.Length is 0 or > 200 || reason.Any(char.IsControl))) return BadRequest(new { code = "invalid_reason", message = "Say in up to 200 characters why the conversation is kept." });
        if (request.Keep && request.Days is < 1 or > 365) return BadRequest(new { code = "invalid_days", message = "Keep a conversation for 1 to 365 days." });
        chats.Keep(id, request.Keep ? DateTime.UtcNow.AddDays(request.Days) : null, request.Keep ? reason : null, security.BackOfficeSecurity?.CurrentUser?.Key);
        return Ok(new { conversation = Summary(chats.Find(id)!) });
    }

    [HttpDelete("{id:guid}")]
    public IActionResult Delete(Guid id) { chats.Delete(id); return NoContent(); }

    private bool Editor() => security.BackOfficeSecurity?.CurrentUser?.Groups.Any(g => options.Value.EditorGroups.Contains(g.Alias, StringComparer.OrdinalIgnoreCase)) == true;

    /// <summary>Deletes every conversation the team has not kept (editors only).</summary>
    [HttpPost("delete-all")]
    public IActionResult DeleteAll() => Editor() ? Ok(new { deleted = chats.DeleteAll() }) : Forbid();
}
