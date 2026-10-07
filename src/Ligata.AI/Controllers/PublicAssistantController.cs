using System.Text.Json;
using Ligata.AI.Data;
using Ligata.AI.Models;
using Ligata.AI.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace Ligata.AI.Controllers;

public sealed record AttachmentRequest(string? Name, string? Data, string? Consent = null);
public sealed record ConsentRequest(string? Version, string? Source, string? Language);
public sealed record ConsentWithdrawal(string? Id);

/// <summary>Anonymous API for the chat bubble. Allowlisted origins only; no cookies or visitor storage.</summary>
[ApiController, AllowAnonymous, Route("api/ligata-ai")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class PublicAssistantController(AssistantStore store, AssistantEngine engine, RequestGuard guard, ChatRelay relay, IMemoryCache cache, SupportHub hub,
    ConsentStore consents, IOptions<AssistantOptions> options, IOptions<RecaptchaSettings> captcha) : ControllerBase
{
    private IActionResult? Check(string kind, bool requireOrigin)
    {
        if (!guard.Origin(HttpContext, requireOrigin) && !SameHost()) return StatusCode(403, Error("origin_denied", "This website is not allowed to use the assistant."));
        if (!guard.Allow(HttpContext, kind)) { Response.Headers.RetryAfter = "120"; return StatusCode(429, Error("rate_limited", "You are sending messages too quickly. Please wait a moment.")); }
        return null;
    }

    // A page served by this CMS posts to its own host; browsers still send an Origin header.
    private bool SameHost() => Uri.TryCreate(Request.Headers.Origin.ToString(), UriKind.Absolute, out var origin) && string.Equals(origin.Authority, Request.Host.Value, StringComparison.OrdinalIgnoreCase);

    private static object Error(string code, string message) => new { error = new { code, message } };

    [HttpOptions("{**path}")]
    public IActionResult Preflight() => guard.Origin(HttpContext, true) || SameHost() ? NoContent() : StatusCode(403);

    /// <summary>Public settings and live availability. The widget asks when it opens.</summary>
    [HttpGet("config")]
    public async Task<IActionResult> Config(CancellationToken token)
    {
        var denied = Check("read", false); if (denied != null) return denied;
        var (settings, version) = store.Settings();
        var features = settings.Effective(options.Value.Features);
        return Ok(Build(settings, version, settings.Enabled && features.Assistant ? await Status(token) : null, store, features, captcha.Value, hub.OnlineAgents(), ignoreEnabled: false, engine.Mode, VisitorConsent.Public(settings, options.Value, features)));
    }

    /// <summary>
    /// state describes the AI (ready, busy, starting, degraded, offline) or, without AI, the contact
    /// channels (ready). team.online is the number of team members in the Inbox right now.
    /// </summary>
    public static object Build(AssistantSettings settings, int version, GatewayStatus? status, AssistantStore store, FeatureState features, RecaptchaSettings captcha, int online, bool ignoreEnabled, string engine, object? consent = null)
    {
        var state = (!settings.Enabled && !ignoreEnabled) || !features.Any ? "disabled"
            : !features.Assistant ? "ready"
            : status == null ? "offline" : status.State == "busy" ? "busy" : status.State == "ready" ? status.GpuHealthy ? status.QueueWaiting > 3 ? "busy" : "ready" : "degraded" : status.State == "loading" ? "starting" : "offline";
        var contextLimit = Math.Min(settings.Behaviour.ContextLimit, status?.ContextTokens is > 0 ? status.ContextTokens : settings.Behaviour.ContextLimit);
        return new
        {
            version, state, queue = status == null ? null : new { waiting = status.QueueWaiting, running = status.QueueRunning, estimatedWaitSeconds = status.EstimatedWaitSeconds },
            vision = status?.Vision ?? false,
            team = features.Team ? new { online } : null,
            settings = settings.Public(contextLimit, Limits(status, engine), BaseTokens(settings, store, features), features, captcha, engine, consent),
        };
    }

    /// <summary>Approximate tokens used before the first question: instructions plus enabled knowledge.</summary>
    public static int BaseTokens(AssistantSettings settings, AssistantStore store, FeatureState features) =>
        (int)Math.Ceiling(PromptBuilder.Guardrails(settings, PromptBuilder.Handoff(settings, features)).Length / 3.6) + 120 + store.Knowledge().Where(k => k.Enabled).Sum(k => k.Tokens);

    public static object Limits(GatewayStatus? status, string engine = "gpu")
    {
        int Read(string name, int fallback) => status?.Limits.ValueKind == JsonValueKind.Object && status.Limits.TryGetProperty(name, out var value) && value.TryGetInt32(out var number) ? number : fallback;
        return new { maxImages = Read("maxImages", 8), maxImageBytes = Read("maxImageBytes", 5 * 1024 * 1024), maxPdfBytes = Read("maxPdfBytes", 10 * 1024 * 1024), maxPdfPages = Read("maxPdfPages", 80), maxAttachments = 4, maxMessageCharacters = ChatRelay.MaxUserCharacters, imageTokens = Read("imageTokens", engine == "api" ? 1600 : 280) };
    }

    // Many open pages poll availability; a short cache keeps that off the gateway.
    private Task<GatewayStatus?> Status(CancellationToken token) => CachedStatus(cache, engine, token);

    public static async Task<GatewayStatus?> CachedStatus(IMemoryCache cache, AssistantEngine engine, CancellationToken token) =>
        await cache.GetOrCreateAsync("Ligata.AI.Status", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(5);
            try { return await engine.StatusAsync(token); } catch (GatewayException) { return null; }
        });

    [HttpPost("chat"), RequestSizeLimit(40_000_000), Consumes("application/json")]
    public async Task Chat([FromBody] ChatRequest request)
    {
        var denied = Check("ask", true);
        if (denied != null) { await denied.ExecuteResultAsync(ControllerContext); return; }
        var row = store.Row();
        var settings = AssistantJson.Read<AssistantSettings>(row.Json);
        if (!settings.Enabled) { await ChatRelay.Json(HttpContext, 503, "disabled", "The assistant is switched off."); return; }
        if (ConsentDenied(settings, request.Consent) is { } refusal) { await ChatRelay.Json(HttpContext, 403, refusal.Code, refusal.Message); return; }
        var visitor = guard.Visitor(HttpContext, row.VisitorSecret);
        using var turn = guard.Begin(visitor);
        if (turn == null) { Response.Headers.RetryAfter = "10"; await ChatRelay.Json(HttpContext, 429, "visitor_busy", "Please wait for the current answer before asking the next question."); return; }
        await relay.RunAsync(HttpContext, request, settings, visitor);
    }

    /// <summary>Converts a visitor's PDF to text. The file is processed in memory and not stored.</summary>
    [HttpPost("attachments"), RequestSizeLimit(16_000_000), Consumes("application/json")]
    public async Task<IActionResult> Attachment([FromBody] AttachmentRequest request, CancellationToken token)
    {
        var denied = Check("file", true); if (denied != null) return denied;
        var (settings, _) = store.Settings();
        if (!settings.Enabled || !settings.Effective(options.Value.Features).Assistant || !settings.Behaviour.AllowPdfs) return StatusCode(415, Error("documents_disabled", "Documents are not accepted here."));
        if (ConsentDenied(settings, request.Consent) is { } refusal) return StatusCode(403, Error(refusal.Code, refusal.Message));
        byte[] bytes;
        try { bytes = Convert.FromBase64String(request.Data ?? ""); } catch (FormatException) { return BadRequest(Error("invalid_document", "The file could not be read.")); }
        try
        {
            var document = await engine.ExtractPdfAsync(bytes, token);
            return Ok(new { name = Path.GetFileName(request.Name ?? "document.pdf"), document.Text, document.Pages, document.PagesRead, document.Truncated, document.Tokens });
        }
        catch (GatewayException e)
        {
            if (e.RetryAfter is { } retry) Response.Headers.RetryAfter = retry.ToString();
            return StatusCode(e.Status is >= 400 and < 600 ? e.Status : 503, Error(e.Code, e.Code is "not_configured" or "invalid_key" ? "The assistant is not available right now." : e.Message));
        }
    }

    /// <summary>Null when the AI may read this visitor's messages (consent given, current and not withdrawn, or not required).</summary>
    private (string Code, string Message)? ConsentDenied(AssistantSettings settings, string? id)
    {
        if (!VisitorConsent.Required(options.Value, settings.Effective(options.Value.Features))) return null;
        return VisitorConsent.Verify(consents, id, settings, options.Value, DateTime.UtcNow) == ConsentCheck.Valid ? null
            : ("consent_required", "Please agree to the processing of your messages before using the assistant.");
    }

    /// <summary>
    /// Records a visitor's consent (the button in the chat, or the Cookiebot category) and returns its random id.
    /// Stored: id, consent version, engine, source, language and times. No IP address, no content.
    /// </summary>
    [HttpPost("consent"), RequestSizeLimit(4_000), Consumes("application/json")]
    public IActionResult GiveConsent([FromBody] ConsentRequest request)
    {
        var denied = Check("consent", true); if (denied != null) return denied;
        var (settings, _) = store.Settings();
        var features = settings.Effective(options.Value.Features);
        if (!settings.Enabled || !features.Assistant) return StatusCode(503, Error("disabled", "The assistant is switched off."));
        var current = VisitorConsent.Version(settings, options.Value);
        if (request.Version != current) return Conflict(new { error = new { code = "consent_outdated", message = "The consent text has changed. Please read it again." }, version = current });
        var now = DateTime.UtcNow;
        var row = consents.Create(current, VisitorConsent.Engine(options.Value), VisitorConsent.Source(request.Source), VisitorConsent.Language(request.Language), now,
            now.AddDays(Math.Clamp(options.Value.Privacy.ConsentDays, 1, 400)));
        return Ok(new { id = row.Id, version = row.Version, expires = row.ExpiresUtc });
    }

    /// <summary>Withdraws a consent. The widget forgets it at once; the record keeps the time of withdrawal as proof.</summary>
    [HttpPost("consent/withdraw"), RequestSizeLimit(1_000), Consumes("application/json")]
    public IActionResult WithdrawConsent([FromBody] ConsentWithdrawal request)
    {
        var denied = Check("consent", true); if (denied != null) return denied;
        if (Guid.TryParse(request.Id, out var id)) consents.Withdraw(id, DateTime.UtcNow);
        return NoContent();
    }
}
