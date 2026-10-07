using Asp.Versioning;
using Ligata.AI.Data;
using Ligata.AI.Models;
using Ligata.AI.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Options;
using Umbraco.Cms.Api.Management.Controllers;
using Umbraco.Cms.Core.Security;
using Umbraco.Cms.Web.Common.Authorization;

namespace Ligata.AI.Controllers;

/// <summary>Inbox access: agent groups plus editor groups, and only when live chat or email is licensed.</summary>
public sealed class SupportAgentFilter(IBackOfficeSecurityAccessor security, IOptions<AssistantOptions> options) : IAuthorizationFilter
{
    public void OnAuthorization(AuthorizationFilterContext context)
    {
        var groups = options.Value.AgentGroups.Concat(options.Value.EditorGroups).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (!options.Value.Features.Inbox) context.Result = new NotFoundResult();
        else if (security.BackOfficeSecurity?.CurrentUser?.Groups.Any(g => groups.Contains(g.Alias)) != true) context.Result = new ForbidResult();
    }
}

public sealed record AgentTextRequest(string? Text, bool Note = false);
public sealed record AgentTypingRequest(bool Active);
public sealed record ReadRequest(int Seq);
public sealed record ProfileRequest(string? Display, string? Alias, bool? Away);

[ApiVersion("1.0"), Route("umbraco/management/api/v{version:apiVersion}/ligata-ai/inbox")]
[Authorize(Policy = AuthorizationPolicies.BackOfficeAccess), ServiceFilter(typeof(SupportAgentFilter))]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class InboxController(SupportService support, SupportStore store, SupportHub hub, AgentDirectory directory, SupportMailer mailer,
    IBackOfficeSecurityAccessor security, IOptions<AssistantOptions> options) : ManagementApiControllerBase
{
    public static TimeSpan UpdateTimeout { get; set; } = TimeSpan.FromSeconds(25);
    private Guid Me => security.BackOfficeSecurity?.CurrentUser?.Key ?? throw new UnauthorizedAccessException();
    private static object Problem(string code, string message) => new { code, message };
    private ObjectResult Fail(SupportException e) => StatusCode(e.Status, Problem(e.Code, e.Message));
    private static DateTime Utc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);

    private void Heartbeat() => hub.AgentSeen(Me, store.Agent(Me).Away);

    private object Agent(Guid key, AssistantSettings settings)
    {
        var card = directory.Card(key, settings);
        return new { key, name = card.RealName, shownAs = card.Name, mode = card.Mode, initials = AgentDirectory.Initials(card.RealName), online = hub.OnlineAgentKeys().Contains(key) };
    }

    private object Summary(ConversationRow r, AssistantSettings settings)
    {
        var seen = hub.VisitorLastSeen(r.Id);
        return new
        {
            r.Id, r.Kind, r.State, r.Name, r.Email, r.Topic, r.PagePath, r.PageTitle, r.Language,
            created = Utc(r.CreatedUtc), updated = Utc(r.UpdatedUtc), closed = r.ClosedUtc is { } c ? Utc(c) : (DateTime?)null, r.ClosedReason,
            needsReply = r.NeedsReply, unread = r.State != "closed" && r.LastVisitorSeq > r.TeamReadSeq, r.LastSeq,
            agents = r.AgentKeys.Select(k => Agent(k, settings)).ToList(), joined = r.AgentKeys.Contains(Me),
            visitorOnline = seen > DateTime.UtcNow - SupportHub.PresenceWindow, visitorSeen = seen,
            typing = hub.TypingIn(r.Id).Contains("visitor"),
        };
    }

    private object Counts()
    {
        var c = store.Counts(Me);
        return new { needsReply = c.NeedsReply ?? 0, active = c.Active ?? 0, open = c.OpenCount ?? 0, closed = c.Closed ?? 0, unread = c.Unread ?? 0, mine = c.Mine ?? 0 };
    }

    private object Features(FeatureState f) => new { liveChat = f.LiveChat, email = f.Email, licensed = new { options.Value.Features.LiveChat, options.Value.Features.Email }, emailReady = mailer.Ready };

    [HttpGet]
    public IActionResult List([FromQuery] string view = "needs", [FromQuery] string? kind = null, [FromQuery] string? q = null, [FromQuery] int skip = 0, [FromQuery] int take = 50)
    {
        Heartbeat();
        var (settings, features) = support.Current();
        var (items, total) = store.List(new InboxQuery(view, kind, q, skip, take), Me);
        return Ok(new { items = items.Select(r => Summary(r, settings)), total, counts = Counts(), online = hub.OnlineAgents(), version = hub.Inbox.Version, features = Features(features) });
    }

    [HttpGet("summary")]
    public IActionResult Badge() { Heartbeat(); return Ok(new { counts = Counts(), online = hub.OnlineAgents(), version = hub.Inbox.Version }); }

    /// <summary>Long poll for the whole inbox (any conversation changed, presence, typing). Also the presence heartbeat.</summary>
    [HttpGet("updates")]
    public async Task<IActionResult> Updates([FromQuery] long version = -1, CancellationToken token = default)
    {
        Heartbeat();
        var current = hub.Inbox.Version;
        if (current == version)
        {
            try { current = await hub.Inbox.WaitAsync(version, UpdateTimeout, token); }
            catch (OperationCanceledException) { return new EmptyResult(); }
            Heartbeat();
        }
        return Ok(new { version = current, counts = Counts(), online = hub.OnlineAgents() });
    }

    [HttpGet("{id:guid}")]
    public IActionResult Thread(Guid id, [FromQuery] int after = 0)
    {
        Heartbeat();
        var row = store.Find(id);
        if (row == null) return NotFound(Problem("not_found", "This conversation was deleted."));
        var (settings, _) = support.Current();
        var messages = store.Messages(id, after, team: true);
        var agents = messages.Where(m => m.AgentKey != null).Select(m => m.AgentKey!.Value).Concat(row.AgentKeys).Distinct().ToDictionary(k => k, k => Agent(k, settings));
        return Ok(new
        {
            conversation = Summary(row, settings),
            messages = messages.Select(m => new { m.Seq, m.Kind, m.Author, m.Text, at = Utc(m.CreatedUtc), agent = m.AgentKey }),
            agents, me = Me,
            typing = hub.TypingIn(id).Where(w => w != "visitor" && w != Me.ToString("D")).Select(w => Guid.TryParse(w, out var k) ? directory.Card(k, settings).RealName : "").ToList(),
        });
    }

    private IActionResult Act(Func<object?> action)
    {
        try { Heartbeat(); var result = action(); return result == null ? NoContent() : Ok(result); }
        catch (SupportException e) { return Fail(e); }
        catch (SupportNotFoundException e) { return NotFound(Problem("not_found", e.Message)); }
    }

    [HttpPost("{id:guid}/join")] public IActionResult Join(Guid id) => Act(() => new { conversation = Summary(support.Join(id, Me), support.Current().Settings) });
    [HttpPost("{id:guid}/leave")] public IActionResult Leave(Guid id) => Act(() => new { conversation = Summary(support.Leave(id, Me), support.Current().Settings) });
    [HttpPost("{id:guid}/close")] public IActionResult Close(Guid id) => Act(() => new { conversation = Summary(support.Close(id, Me), support.Current().Settings) });
    [HttpPost("{id:guid}/reopen")] public IActionResult Reopen(Guid id) => Act(() => new { conversation = Summary(support.Reopen(id, Me), support.Current().Settings) });
    [HttpDelete("{id:guid}")] public IActionResult Delete(Guid id) => Act(() => { store.Delete(id); return null; });

    [HttpPost("{id:guid}/messages"), RequestSizeLimit(64_000)]
    public IActionResult Write(Guid id, [FromBody] AgentTextRequest request) => Act(() => { var m = support.AgentMessage(id, Me, request.Text, request.Note); return new { m.Seq }; });

    [HttpPost("{id:guid}/email"), RequestSizeLimit(64_000)]
    public IActionResult Email(Guid id, [FromBody] AgentTextRequest request) => Act(() => { var m = support.EmailReply(id, Me, request.Text); return new { m.Seq, queued = true, ready = mailer.Ready }; });

    [HttpPost("{id:guid}/typing")]
    public IActionResult Typing(Guid id, [FromBody] AgentTypingRequest request) => Act(() => { hub.Typing(id, Me.ToString("D"), request.Active); return null; });

    [HttpPost("{id:guid}/read")]
    public IActionResult Read(Guid id, [FromBody] ReadRequest request) => Act(() => { store.MarkRead(id, request.Seq); return null; });

    /// <summary>Profile photos for the team itself (regardless of what visitors see).</summary>
    [HttpGet("agents/{key:guid}/avatar")]
    public IActionResult AgentAvatar(Guid key)
    {
        if (directory.Avatar(key) is not { } image) return NotFound();
        Response.Headers.CacheControl = "private, max-age=600";
        return File(image.Bytes, image.ContentType);
    }

    [HttpGet("me")]
    public IActionResult Profile()
    {
        Heartbeat();
        var (settings, features) = support.Current();
        var row = store.Agent(Me);
        var cards = AssistantValidation.AgentDisplays.ToDictionary(mode => mode, mode => directory.Card(Me, settings with { Support = settings.Support with { AgentDisplay = mode, AgentsChoose = false } }).Public());
        var mine = directory.Card(Me, settings);
        return Ok(new
        {
            key = Me, name = mine.RealName, display = row.Display, row.Alias, row.Away, effective = mine.Mode, preview = cards,
            hasPhoto = directory.Avatar(Me) != null, allowChoose = settings.Support.AgentsChoose, defaultDisplay = settings.Support.AgentDisplay,
            teamName = settings.Support.TeamName, features = Features(features), online = hub.OnlineAgents(),
        });
    }

    [HttpPost("me")]
    public IActionResult SaveProfile([FromBody] ProfileRequest request)
    {
        var (settings, _) = support.Current();
        var row = store.Agent(Me);
        if (request.Display != null)
        {
            if (request.Display != "default" && !AssistantValidation.AgentDisplays.Contains(request.Display)) return BadRequest(Problem("invalid_display", "Choose how you appear."));
            if (!settings.Support.AgentsChoose && request.Display != row.Display) return BadRequest(Problem("locked", "Your administrator sets how team members appear."));
            row.Display = request.Display;
        }
        if (request.Alias != null)
        {
            var alias = request.Alias.Trim();
            if (alias.Length > 40 || alias.Any(char.IsControl)) return BadRequest(Problem("invalid_alias", "Use a nickname of up to 40 characters."));
            row.Alias = alias;
        }
        if (request.Away is { } away) row.Away = away;
        store.SaveAgent(row);
        directory.Forget(Me, settings);
        hub.AgentSeen(Me, row.Away);
        hub.Inbox.Fire();
        return Profile();
    }

    /// <summary>The latest outgoing emails, so delivery problems are visible.</summary>
    [HttpGet("outbox")]
    public IActionResult Outbox() => Ok(new
    {
        ready = mailer.Ready, licensed = mailer.Licensed,
        emails = store.RecentEmails(25).Select(e => new { e.Id, e.Kind, to = e.ToAddress, e.Subject, e.State, e.Attempts, e.LastError, created = Utc(e.CreatedUtc), sent = e.SentUtc is { } s ? Utc(s) : (DateTime?)null }),
    });
}
