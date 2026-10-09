using System.Text.Json;
using Asp.Versioning;
using Ligata.AI.Data;
using Ligata.AI.Models;
using Ligata.AI.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Options;
using Umbraco.Cms.Api.Management.Controllers;
using Umbraco.Cms.Core.Security;
using Umbraco.Cms.Web.Common.Authorization;

namespace Ligata.AI.Controllers;

public sealed class AssistantEditorFilter(IBackOfficeSecurityAccessor security, IOptions<AssistantOptions> options) : IAuthorizationFilter
{
    public void OnAuthorization(AuthorizationFilterContext context)
    {
        if (security.BackOfficeSecurity?.CurrentUser?.Groups.Any(g => options.Value.EditorGroups.Contains(g.Alias)) != true)
            context.Result = new ForbidResult();
    }
}

public sealed record SaveSettingsRequest(AssistantSettings Settings, int Version);
public sealed record ConnectionRequest(string? GatewayUrl, string? ApiKey, int Version);
public sealed record KnowledgeRequest(Guid? Id, string Title, string Text);
public sealed record EnabledRequest(bool Enabled);
public sealed record OrderRequest(List<Guid> Ids);
public sealed record BudgetRequest(AssistantSettings Settings);

[ApiVersion("1.0"), Route("umbraco/management/api/v{version:apiVersion}/ligata-ai")]
[Authorize(Policy = AuthorizationPolicies.BackOfficeAccess), ServiceFilter(typeof(AssistantEditorFilter))]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class AssistantManagementController(AssistantStore store, GatewayClient gateway, AssistantEngine engine, ApiKeyVault vault, ContentKnowledge content, KnowledgeIndex index, ChatRelay relay, IOptions<AssistantOptions> options,
    IBackOfficeSecurityAccessor security, Microsoft.Extensions.Caching.Memory.IMemoryCache cache, IOptions<RecaptchaSettings> captcha, SupportHub hub, SupportMailer mailer, SupportStore supportStore, ConsentStore consents, ChatHistoryStore chats) : ManagementApiControllerBase
{
    private static object Problem(string message, Dictionary<string, string>? errors = null) => new { message, errors };

    private object Connection()
    {
        var row = store.Row();
        var (url, key, source) = gateway.Target();
        var claude = options.Value.Claude;
        return new
        {
            // gpu = Ligata AI gateway; api = Claude via Anthropic (configured only in appsettings, the key is never sent here).
            mode = engine.Mode,
            // What visitors see while the notice under the input is left at its default.
            defaultPrivacyNotice = engine.UsesApi ? AssistantIdentity.ApiPrivacyNotice : AssistantIdentity.DefaultPrivacyNotice,
            claude = engine.UsesApi ? new
            {
                model = claude.Model, modelName = ClaudeEngine.DisplayName(claude.Model), configured = claude.Configured, effort = claude.Effort,
                claude.MaxContextTokens, claude.MaxConcurrent, claude.QuestionsPerDay, customEndpoint = claude.BaseUrl.Trim() != "",
            } : null,
            gatewayUrl = url, gatewayUrlFromConfig = options.Value.GatewayUrl != "", keySource = source,
            keyHint = source == "configuration" ? ApiKeyVault.Hint(key!) : row.KeyHint, publicApiBase = options.Value.PublicApiBase,
            allowedOrigins = options.Value.AllowedOrigins, autoInject = options.Value.AutoInject,
        };
    }

    /// <summary>What the host allows and what is set up: shown in the backoffice so editors understand locked options.</summary>
    private object Platform()
    {
        var c = captcha.Value;
        return new
        {
            licensed = new { options.Value.Features.Assistant, options.Value.Features.LiveChat, options.Value.Features.Email },
            captcha = new { ready = c.Ready, source = c.Source, siteKey = c.SiteKey.Length > 10 ? c.SiteKey[..6] + "…" + c.SiteKey[^4..] : c.SiteKey, consentMode = c.ConsentMode, cookiebotCategory = c.CookiebotCategory, hostnames = c.AllowedHostnames, minimumScore = c.MinimumScore },
            email = new { ready = mailer.Ready, licensed = mailer.Licensed, backofficeUrl = mailer.Backoffice() },
            agentGroups = options.Value.AgentGroups, editorGroups = options.Value.EditorGroups, online = hub.OnlineAgents(), limits = options.Value.Support,
        };
    }

    [HttpGet]
    public IActionResult Overview()
    {
        var (settings, version) = store.Settings();
        return Ok(new { settings, version, connection = Connection(), knowledge = store.Knowledge(), defaults = new AssistantSettings(), platform = Platform(), privacy = Privacy(settings) });
    }

    /// <summary>Consent configuration (appsettings), the current consent version and how many visitors agreed recently.</summary>
    private object Privacy(AssistantSettings settings)
    {
        var o = options.Value; var p = o.Privacy; var now = DateTime.UtcNow;
        var features = settings.Effective(o.Features);
        ConsentSummary? summary = null;
        try { summary = consents.Summary(now.AddDays(-30), now); } catch (Exception e) when (e is not OutOfMemoryException) { } // table missing until the migration ran
        HistoryCounts? kept = null;
        try { kept = chats.Counts(); } catch (Exception e) when (e is not OutOfMemoryException) { }
        return new
        {
            required = p.RequireConsent, mode = p.UsesCookiebot ? "cookiebot" : "explicit", category = p.Category,
            consentDays = Math.Clamp(p.ConsentDays, 1, 400), keepDays = Math.Clamp(p.KeepConsentRecordsDays, Math.Clamp(p.ConsentDays, 1, 400), 3650),
            gpuOperator = p.GpuOperator.Trim(), gpuOperatorCountry = p.GpuOperatorCountry.Trim(), cookiebotIgnore = p.CookiebotIgnore,
            engine = VisitorConsent.Engine(o), version = VisitorConsent.Version(settings, o),
            // What the preview widget needs to show the consent request (null when none is asked).
            consent = VisitorConsent.Public(settings, o, features),
            summary,
            // Conversations in the history now (also after it was switched off, until their period ends).
            history = new { stored = kept?.Total ?? 0, kept = kept?.Kept ?? 0 },
            captcha = captcha.Value.Ready ? new { mode = captcha.Value.ConsentMode, category = captcha.Value.CookiebotCategory } : null,
            languages = PrivacyPolicy.Languages,
        };
    }

    private int Kept() { try { return chats.Counts().Total ?? 0; } catch (Exception e) when (e is not OutOfMemoryException) { return 0; } }

    [HttpGet("privacy")]
    public IActionResult PrivacyInfo() => Ok(Privacy(store.Settings().Settings));

    /// <summary>The privacy policy sections for this site's setup (uses the editor's unsaved settings when posted).</summary>
    [HttpPost("privacy/policy"), RequestSizeLimit(400_000)]
    public IActionResult PrivacyPolicyText([FromQuery] string language, [FromBody] AssistantSettings? settings)
    {
        settings ??= store.Settings().Settings;
        try { AssistantValidation.Settings(settings); } catch (AssistantValidationException) { settings = store.Settings().Settings; }
        return Ok(new { language = PrivacyPolicy.Languages.Contains(language) ? language : "en", text = PrivacyPolicy.Generate(language, settings, options.Value, captcha.Value, Kept()) });
    }

    /// <summary>Queues a test email to the given (or saved) team addresses and tries to send it at once.</summary>
    [HttpPost("test-email")]
    public async Task<IActionResult> TestEmail([FromBody] TestEmailRequest request, CancellationToken token)
    {
        if (!mailer.Licensed) return BadRequest(Problem("Email is not included in this installation (LigataAI:Features:Email)."));
        var (settings, _) = store.Settings();
        var to = (request.Recipients?.Count > 0 ? request.Recipients : settings.Notifications.Recipients).Where(AssistantValidation.Email).Take(10).ToList();
        if (to.Count == 0) return BadRequest(Problem("Add at least one valid team email address first."));
        if (!mailer.Ready) return BadRequest(Problem("SMTP is not configured on this server (Umbraco:CMS:Global:Smtp). Ask your developer to add it; emails wait in the queue until then."));
        mailer.Test(request.Settings ?? settings, to);
        await SupportWorker.SendAsync(HttpContext.RequestServices, token);
        var last = supportStore.RecentEmails(1).FirstOrDefault();
        return Ok(new { state = last?.State, error = last?.LastError, to });
    }

    [HttpPost("settings")]
    public IActionResult Save([FromBody] SaveSettingsRequest request)
    {
        try
        {
            var pinned = store.Knowledge().Where(k => k.Enabled && k.Pinned).Sum(k => k.Tokens);
            if (pinned > request.Settings.Behaviour.KnowledgeBudget)
                throw new AssistantValidationException(new() { ["behaviour.knowledgeBudget"] = $"Your always-known knowledge uses {pinned:N0} tokens. Raise the budget or let the assistant look some of it up instead." });
            return Ok(new { version = store.Save(request.Settings, request.Version) });
        }
        catch (AssistantValidationException e) { return BadRequest(Problem("Check the highlighted settings.", e.Errors)); }
        catch (AssistantConflictException e) { return Conflict(Problem(e.Message)); }
    }

    [HttpGet("status")]
    public async Task<IActionResult> Status(CancellationToken token)
    {
        try { return Ok(new { ok = true, status = await engine.StatusAsync(token, verify: true), connection = Connection() }); }
        catch (GatewayException e) { return Ok(new { ok = false, code = e.Code, message = e.Message, connection = Connection() }); }
    }

    [HttpPost("connection")]
    public async Task<IActionResult> SaveConnection([FromBody] ConnectionRequest request, CancellationToken token)
    {
        if (engine.UsesApi) return BadRequest(Problem("This site uses the Claude API (LigataAI:Mode = api). Its key and model are set in the site's configuration."));
        var (settings, version) = store.Settings();
        if (request.GatewayUrl != null && request.GatewayUrl.TrimEnd('/') != settings.GatewayUrl)
        {
            try { version = store.Save(settings with { GatewayUrl = request.GatewayUrl.Trim().TrimEnd('/') }, request.Version); }
            catch (AssistantValidationException e) { return BadRequest(Problem("Check the gateway address.", e.Errors)); }
            catch (AssistantConflictException e) { return Conflict(Problem(e.Message)); }
        }
        if (!string.IsNullOrWhiteSpace(request.ApiKey))
        {
            var key = request.ApiKey.Trim();
            if (!ApiKeyVault.LooksValid(key)) return BadRequest(Problem("That does not look like a Ligata AI key (lai_…).", new() { ["apiKey"] = "Paste the complete key from the gateway, starting with lai_." }));
            store.SetKey(vault.Protect(key), ApiKeyVault.Hint(key));
        }
        return await StatusWithVersion(version, token);
    }

    private async Task<IActionResult> StatusWithVersion(int version, CancellationToken token)
    {
        try { return Ok(new { version, ok = true, status = await engine.StatusAsync(token, verify: true), connection = Connection() }); }
        catch (GatewayException e) { return Ok(new { version, ok = false, code = e.Code, message = e.Message, connection = Connection() }); }
    }

    [HttpDelete("connection/key")]
    public IActionResult ClearKey() { store.SetKey(null, null); return Ok(new { connection = Connection() }); }

    /// <summary>
    /// Token cost of the instructions with the given (possibly unsaved) settings: guardrails, the list of pages and the
    /// lookup tools. lookupTokens is what lookups may add to one answer.
    /// </summary>
    [HttpPost("budget")]
    public async Task<IActionResult> Budget([FromBody] BudgetRequest request, CancellationToken token)
    {
        var settings = request.Settings;
        try { AssistantValidation.Settings(settings); } catch (AssistantValidationException) { settings = store.Settings().Settings; }
        var (stable, context, lookups) = await relay.PromptAsync(settings, settings.Effective(options.Value.Features), "A page title of typical length here", "/a/typical/page/path/", token);
        // The knowledge that is always known is shown on its own; tools are declared next to the instructions.
        var pinned = PromptBuilder.Knowledge(store.PinnedKnowledge());
        var instructions = stable.Replace(pinned, "") + context + (lookups != null ? JsonSerializer.Serialize(Lookups.Tools) : "");
        var (tokens, estimated) = await Count(instructions, token);
        return Ok(new { instructionTokens = tokens + 16, estimated, lookupTokens = lookups != null ? Lookups.Tokens : 0, lookups = lookups != null });
    }

    /// <summary>What the assistant can look up right now (saved settings), and a test search for editors.</summary>
    [HttpGet("knowledge/index")]
    public async Task<IActionResult> Index([FromQuery] string? q, CancellationToken token)
    {
        var snapshot = await index.SnapshotAsync(store.Settings().Settings.Knowledge, token);
        var hits = string.IsNullOrWhiteSpace(q) ? [] : snapshot.Search(q.Length > 200 ? q[..200] : q, 8).Select(h => new { h.Document.Title, h.Document.Url, h.Document.Kind, text = h.Text.Length > 400 ? h.Text[..400] + "…" : h.Text, score = Math.Round(h.Score, 2) });
        return Ok(new { truncated = snapshot.Truncated, maxPages = ContentKnowledge.MaxPages, pages = snapshot.Pages, documents = snapshot.Documents.Count - snapshot.Pages, passages = snapshot.Passages, languages = snapshot.Cultures, siteMap = PromptBuilder.SiteMap(snapshot).Trim(), textTokens = (int)(snapshot.Documents.Sum(d => (long)d.Text.Length) / 3.6), hits });
    }

    private async Task<(int Tokens, bool Estimated)> Count(string text, CancellationToken token)
    {
        try { return ((await engine.CountAsync([text], token))[0], false); }
        catch (GatewayException) { return ((int)Math.Ceiling(text.Length / 3.6), true); }
    }

    [HttpGet("knowledge/{id:guid}")]
    public IActionResult Item(Guid id) => store.Find(id) is { } row ? Ok(row) : NotFound();

    private async Task<IActionResult> SaveItem(KnowledgeRow row, CancellationToken token)
    {
        var (settings, _) = store.Settings();
        var source = PromptBuilder.Knowledge([row]);
        (row.Tokens, row.Estimated) = await Count(source, token);
        // Only knowledge that is always known counts against the budget; everything else is looked up when needed.
        var others = store.Knowledge().Where(k => k.Enabled && k.Pinned && k.Id != row.Id).Sum(k => k.Tokens);
        string? warning = null;
        if (row.Enabled && row.Pinned && others + row.Tokens > settings.Behaviour.KnowledgeBudget)
        {
            row.Pinned = false;
            warning = $"Saved, but looked up when needed instead of always known: it needs {row.Tokens:N0} tokens and only {Math.Max(0, settings.Behaviour.KnowledgeBudget - others):N0} of your knowledge budget are free.";
        }
        try { return Ok(new { item = Summary(store.Upsert(row)), warning }); }
        catch (AssistantValidationException e) { return BadRequest(Problem(e.Message, e.Errors)); }
    }

    private static KnowledgeSummary Summary(KnowledgeRow r) => new(r.Id, r.Title, r.Kind, r.Source, r.ContentKey, r.Tokens, r.Estimated, r.Enabled, r.SortOrder, r.UpdatedUtc, r.Characters, r.Text.Length > 300 ? r.Text[..300] : r.Text, r.Pinned);

    [HttpPost("knowledge"), RequestSizeLimit(8_000_000)]
    public Task<IActionResult> SaveText([FromBody] KnowledgeRequest request, CancellationToken token)
    {
        var existing = request.Id is { } id ? store.Find(id) : null;
        var row = existing ?? new KnowledgeRow { Id = Guid.NewGuid(), Kind = "text", Enabled = true };
        row.Title = (request.Title ?? "").Trim();
        row.Text = DocumentText.Normalize(request.Text ?? "");
        return SaveItem(row, token);
    }

    [HttpPost("knowledge/upload"), RequestSizeLimit(DocumentText.MaxUploadBytes + 100_000)]
    public async Task<IActionResult> Upload(IFormFile file, CancellationToken token)
    {
        if (file == null || file.Length == 0) return BadRequest(Problem("Choose a file to upload."));
        if (file.Length > DocumentText.MaxUploadBytes) return BadRequest(Problem("Files can be at most 15 MB."));
        var name = Path.GetFileName(file.FileName);
        var extension = Path.GetExtension(name).ToLowerInvariant();
        if (!DocumentText.Extensions.Contains(extension)) return BadRequest(Problem("Upload PDF, Word (.docx), text, Markdown, CSV, JSON or HTML files."));
        using var memory = new MemoryStream();
        await file.CopyToAsync(memory, token);
        string text;
        try { text = extension == ".pdf" ? (await engine.ExtractPdfAsync(memory.ToArray(), token)).Text : DocumentText.Extract(name, memory.ToArray()); }
        catch (GatewayException e) { return BadRequest(Problem(e.Code == "gateway_unavailable" || e.Code == "not_configured" ? "PDFs are converted by the AI gateway, which is not reachable right now. Try again later or upload the text instead." : e.Message)); }
        catch (Exception e) when (e is InvalidDataException or System.Xml.XmlException) { return BadRequest(Problem(e.Message)); }
        if (string.IsNullOrWhiteSpace(text)) return BadRequest(Problem("This file contains no readable text."));
        return await SaveItem(new KnowledgeRow { Id = Guid.NewGuid(), Kind = "file", Source = name, Title = Path.GetFileNameWithoutExtension(name), Text = text, Enabled = true }, token);
    }

    [HttpPost("knowledge/{id:guid}/enabled")]
    public IActionResult Enable(Guid id, [FromBody] EnabledRequest request)
    {
        var row = store.Find(id); if (row == null) return NotFound();
        if (request.Enabled && row.Pinned && OverBudget(row) is { } problem) return BadRequest(Problem(problem));
        store.SetEnabled(id, request.Enabled);
        return NoContent();
    }

    /// <summary>Always known (read with every question, counts against the knowledge budget) or looked up when needed.</summary>
    [HttpPost("knowledge/{id:guid}/pinned")]
    public IActionResult Pin(Guid id, [FromBody] EnabledRequest request)
    {
        var row = store.Find(id); if (row == null) return NotFound();
        if (request.Enabled && row.Enabled && OverBudget(row) is { } problem) return BadRequest(Problem(problem));
        store.SetPinned(id, request.Enabled);
        return NoContent();
    }

    private string? OverBudget(KnowledgeRow row)
    {
        var (settings, _) = store.Settings();
        var others = store.Knowledge().Where(k => k.Enabled && k.Pinned && k.Id != row.Id).Sum(k => k.Tokens);
        return others + row.Tokens > settings.Behaviour.KnowledgeBudget
            ? $"Not enough knowledge budget: this item needs {row.Tokens:N0} tokens, {Math.Max(0, settings.Behaviour.KnowledgeBudget - others):N0} are free. Let the assistant look something else up instead, or raise the budget under Behaviour."
            : null;
    }

    [HttpPost("knowledge/order")]
    public IActionResult Order([FromBody] OrderRequest request) { store.Reorder(request.Ids.Take(AssistantStore.MaxKnowledgeItems).ToList()); return NoContent(); }

    [HttpDelete("knowledge/{id:guid}")]
    public IActionResult Delete(Guid id) { store.Delete(id); return NoContent(); }

    [HttpPost("knowledge/recount")]
    public async Task<IActionResult> Recount(CancellationToken token)
    {
        var items = store.EnabledKnowledge().Concat(store.Knowledge().Where(k => !k.Enabled).Select(k => store.Find(k.Id)!)).ToList();
        try
        {
            var counts = await engine.CountAsync(items.Select(i => PromptBuilder.Knowledge([i])).ToList(), token);
            for (var i = 0; i < items.Count; i++) store.SetTokens(items[i].Id, counts[i], false);
            return Ok(new { knowledge = store.Knowledge() });
        }
        catch (GatewayException e) { return BadRequest(Problem("Counting needs the AI gateway: " + e.Message)); }
    }

    /// <summary>Published pages in tree order; the backoffice marks the ones the assistant may read (settings.knowledge).</summary>
    [HttpGet("pages")]
    public async Task<IActionResult> Pages() => Ok(await content.PagesAsync());

    /// <summary>Same as the public config, for the live preview (works while the assistant is switched off).</summary>
    [HttpGet("config")]
    public async Task<IActionResult> PreviewConfig(CancellationToken token)
    {
        var (settings, version) = store.Settings();
        var features = settings.Effective(options.Value.Features);
        return Ok(PublicAssistantController.Build(settings, version, features.Assistant ? await PublicAssistantController.CachedStatus(cache, engine, token) : null, store, features, captcha.Value, hub.OnlineAgents(), ignoreEnabled: true, engine.Mode, VisitorConsent.Public(settings, options.Value, features)));
    }

    [HttpPost("attachments"), RequestSizeLimit(16_000_000)]
    public async Task<IActionResult> PreviewAttachment([FromBody] AttachmentRequest request, CancellationToken token)
    {
        try
        {
            var document = await engine.ExtractPdfAsync(Convert.FromBase64String(request.Data ?? ""), token);
            return Ok(new { name = Path.GetFileName(request.Name ?? "document.pdf"), document.Text, document.Pages, document.PagesRead, document.Truncated, document.Tokens });
        }
        catch (FormatException) { return BadRequest(new { error = new { code = "invalid_document", message = "The file could not be read." } }); }
        catch (GatewayException e) { return StatusCode(e.Status is >= 400 and < 600 ? e.Status : 503, new { error = new { code = e.Code, message = e.Message } }); }
    }

    [HttpGet("stats")]
    public IActionResult Stats([FromQuery] int days = 30) => Ok(store.Stats(days));

    /// <summary>Test chat in the backoffice. Uses the saved knowledge with the editor's current (unsaved) settings.</summary>
    [HttpPost("preview"), RequestSizeLimit(40_000_000)]
    public async Task Preview([FromBody] PreviewRequest request)
    {
        var settings = request.Settings ?? store.Settings().Settings;
        try { AssistantValidation.Settings(settings); }
        catch (AssistantValidationException e) { await ChatRelay.Json(HttpContext, 400, "invalid_settings", e.Message); return; }
        var user = security.BackOfficeSecurity?.CurrentUser?.Key.ToString("N") ?? "editor";
        await relay.RunAsync(HttpContext, request.Chat, settings with { Enabled = true }, "backoffice-" + user, countStats: false);
    }
}

public sealed record PreviewRequest(ChatRequest Chat, AssistantSettings? Settings);
public sealed record TestEmailRequest(List<string>? Recipients, AssistantSettings? Settings);
