using Ligata.AI.Data;
using Ligata.AI.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Ligata.AI.Controllers;

public sealed record VisitorTokenRequest(string? Token);
public sealed record VisitorMessageRequest(string? Token, string? Text, string? ClientId);
public sealed record VisitorPollRequest(string? Token, int After = 0, long Version = -1, bool Wait = true);
public sealed record VisitorTypingRequest(string? Token, bool Active);

/// <summary>
/// Visitor side of team conversations. A conversation is reached only with its random token (sent in the
/// body, never in URLs); the id alone grants nothing.
/// </summary>
[ApiController, AllowAnonymous, Route("api/ligata-ai")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class PublicSupportController(SupportService support, SupportStore store, SupportHub hub, AssistantStore settingsStore, RequestGuard guard,
    AgentDirectory directory, IOptions<AssistantOptions> options) : ControllerBase
{
    public static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(25);

    private IActionResult? Check(string kind)
    {
        var sameHost = Uri.TryCreate(Request.Headers.Origin.ToString(), UriKind.Absolute, out var origin) && string.Equals(origin.Authority, Request.Host.Value, StringComparison.OrdinalIgnoreCase);
        if (!guard.Origin(HttpContext, true) && !sameHost) return Problem("origin_denied", "This website is not allowed to use the chat.", 403);
        if (!options.Value.Features.Inbox) return Problem("channel_disabled", "Contacting the team is not available.", 404);
        if (!guard.Allow(HttpContext, kind)) { Response.Headers.RetryAfter = "60"; return Problem("rate_limited", "Too many requests. Please wait a moment.", 429); }
        return null;
    }

    private ObjectResult Problem(string code, string message, int status) => StatusCode(status, new { error = new { code, message } });
    private ObjectResult Problem(SupportException e) => Problem(e.Code, e.Message, e.Status);
    private string Visitor() => guard.Visitor(HttpContext, settingsStore.Row().VisitorSecret);

    [HttpPost("conversations"), RequestSizeLimit(400_000), Consumes("application/json")]
    public async Task<IActionResult> Create([FromBody] CreateConversationRequest request, CancellationToken token)
    {
        var denied = Check("contact"); if (denied != null) return denied;
        try
        {
            var (row, secret) = await support.CreateAsync(request, Visitor(), token);
            var (settings, _) = support.Current();
            return Ok(new { token = secret, version = hub.For(row.Id).Version, conversation = support.VisitorView(row, 0, settings) });
        }
        catch (SupportException e) { if (e.Status == 429) Response.Headers.RetryAfter = "600"; return Problem(e); }
    }

    [HttpPost("conversations/{id:guid}/messages"), RequestSizeLimit(64_000), Consumes("application/json")]
    public IActionResult Say(Guid id, [FromBody] VisitorMessageRequest request)
    {
        var denied = Check("say"); if (denied != null) return denied;
        try
        {
            var message = support.VisitorMessage(id, request.Token, request.Text, request.ClientId);
            return Ok(new { message.Seq, message.ClientId, at = DateTime.SpecifyKind(message.CreatedUtc, DateTimeKind.Utc) });
        }
        catch (SupportException e) { return Problem(e); }
    }

    /// <summary>
    /// Long poll: answers at once when there is something newer than <c>after</c>/<c>version</c>, otherwise
    /// waits up to 25 s for a message, a join/leave, a state change or typing.
    /// </summary>
    [HttpPost("conversations/{id:guid}/poll"), RequestSizeLimit(4_000), Consumes("application/json")]
    public async Task<IActionResult> Poll(Guid id, [FromBody] VisitorPollRequest request, CancellationToken token)
    {
        var denied = Check("poll"); if (denied != null) return denied;
        try
        {
            var pulse = hub.For(id);
            var version = pulse.Version;
            var row = support.Authorize(id, request.Token);
            hub.VisitorSeen(id);
            if (request.Wait && version == request.Version && row.LastSeq <= request.After && row.State != "closed")
            {
                using var slot = hub.BeginPoll(guard.Address(HttpContext)?.ToString() ?? "unknown", Math.Clamp(options.Value.Support.PollsPerAddress, 1, 50));
                if (slot == null) { Response.Headers.RetryAfter = "5"; return Problem("rate_limited", "Too many open connections.", 429); }
                try { version = await pulse.WaitAsync(version, PollTimeout, token); }
                catch (OperationCanceledException) { return new EmptyResult(); }
                row = store.Find(id) ?? throw new SupportException("not_found", "This conversation is no longer available.", 404);
                hub.VisitorSeen(id);
            }
            var (settings, _) = support.Current();
            return Ok(new { version, conversation = support.VisitorView(row, Math.Max(0, request.After), settings) });
        }
        catch (SupportException e) { return Problem(e); }
    }

    [HttpPost("conversations/{id:guid}/typing"), RequestSizeLimit(4_000), Consumes("application/json")]
    public IActionResult Typing(Guid id, [FromBody] VisitorTypingRequest request)
    {
        // Typing is cosmetic: past the limit it is ignored instead of failing.
        if (Check("typing") is { } denied) return denied is ObjectResult { StatusCode: 429 } ? NoContent() : denied;
        try { var row = support.Authorize(id, request.Token); if (row.State != "closed") hub.Typing(id, "visitor", request.Active); return NoContent(); }
        catch (SupportException e) { return Problem(e); }
    }

    [HttpPost("conversations/{id:guid}/close"), RequestSizeLimit(4_000), Consumes("application/json")]
    public IActionResult Close(Guid id, [FromBody] VisitorTokenRequest request)
    {
        var denied = Check("say"); if (denied != null) return denied;
        try { support.VisitorClose(id, request.Token); return NoContent(); }
        catch (SupportException e) { return Problem(e); }
    }

    /// <summary>A team member's profile photo, only while they choose to show it.</summary>
    [HttpGet("agents/{publicId:guid}/avatar")]
    public IActionResult Avatar(Guid publicId)
    {
        if (!options.Value.Features.LiveChat || !guard.Allow(HttpContext, "avatar")) return NotFound();
        var agent = store.AgentByPublicId(publicId);
        if (agent == null) return NotFound();
        var (settings, _) = support.Current();
        if (!directory.Card(agent.UserKey, settings).Photo || directory.Avatar(agent.UserKey) is not { } image) return NotFound();
        Response.Headers.CacheControl = "public, max-age=86400";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        return File(image.Bytes, image.ContentType);
    }
}
