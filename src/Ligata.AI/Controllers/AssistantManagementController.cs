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
public sealed record PagesRequest(List<Guid> Keys);
public sealed record BudgetRequest(AssistantSettings Settings);

[ApiVersion("1.0"), Route("umbraco/management/api/v{version:apiVersion}/ligata-ai")]
[Authorize(Policy = AuthorizationPolicies.BackOfficeAccess), ServiceFilter(typeof(AssistantEditorFilter))]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class AssistantManagementController(AssistantStore store, GatewayClient gateway, ApiKeyVault vault, ContentKnowledge content, ChatRelay relay, IOptions<AssistantOptions> options, IBackOfficeSecurityAccessor security, Microsoft.Extensions.Caching.Memory.IMemoryCache cache) : ManagementApiControllerBase
{
    private static object Problem(string message, Dictionary<string, string>? errors = null) => new { message, errors };

    private object Connection()
    {
        var row = store.Row();
        var (url, key, source) = gateway.Target();
        return new
        {
            gatewayUrl = url, gatewayUrlFromConfig = options.Value.GatewayUrl != "", keySource = source,
            keyHint = source == "configuration" ? ApiKeyVault.Hint(key!) : row.KeyHint, publicApiBase = options.Value.PublicApiBase,
            allowedOrigins = options.Value.AllowedOrigins, autoInject = options.Value.AutoInject,
        };
    }

    [HttpGet]
    public IActionResult Overview()
    {
        var (settings, version) = store.Settings();
        return Ok(new { settings, version, connection = Connection(), knowledge = store.Knowledge(), defaults = new AssistantSettings() });
    }

    [HttpPost("settings")]
    public IActionResult Save([FromBody] SaveSettingsRequest request)
    {
        try
        {
            var enabled = store.Knowledge().Where(k => k.Enabled).Sum(k => k.Tokens);
            if (enabled > request.Settings.Behaviour.KnowledgeBudget)
                throw new AssistantValidationException(new() { ["behaviour.knowledgeBudget"] = $"Your enabled knowledge uses {enabled:N0} tokens. Raise the budget or switch knowledge off first." });
            return Ok(new { version = store.Save(request.Settings, request.Version) });
        }
        catch (AssistantValidationException e) { return BadRequest(Problem("Check the highlighted settings.", e.Errors)); }
        catch (AssistantConflictException e) { return Conflict(Problem(e.Message)); }
    }

    [HttpGet("status")]
    public async Task<IActionResult> Status(CancellationToken token)
    {
        try { return Ok(new { ok = true, status = await gateway.StatusAsync(token), connection = Connection() }); }
        catch (GatewayException e) { return Ok(new { ok = false, code = e.Code, message = e.Message, connection = Connection() }); }
    }

    [HttpPost("connection")]
    public async Task<IActionResult> SaveConnection([FromBody] ConnectionRequest request, CancellationToken token)
    {
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
        try { return Ok(new { version, ok = true, status = await gateway.StatusAsync(token), connection = Connection() }); }
        catch (GatewayException e) { return Ok(new { version, ok = false, code = e.Code, message = e.Message, connection = Connection() }); }
    }

    [HttpDelete("connection/key")]
    public IActionResult ClearKey() { store.SetKey(null, null); return Ok(new { connection = Connection() }); }

    /// <summary>Token cost of the instructions with the given (possibly unsaved) settings.</summary>
    [HttpPost("budget")]
    public async Task<IActionResult> Budget([FromBody] BudgetRequest request, CancellationToken token)
    {
        var instructions = PromptBuilder.Guardrails(request.Settings) + PromptBuilder.Context(request.Settings, "A page title of typical length here", "/a/typical/page/path/", DateTime.Now);
        var (tokens, estimated) = await Count(instructions, token);
        return Ok(new { instructionTokens = tokens + 16, estimated });
    }

    private async Task<(int Tokens, bool Estimated)> Count(string text, CancellationToken token)
    {
        try { return ((await gateway.CountAsync([text], token))[0], false); }
        catch (GatewayException) { return ((int)Math.Ceiling(text.Length / 3.6), true); }
    }

    [HttpGet("knowledge/{id:guid}")]
    public IActionResult Item(Guid id) => store.Find(id) is { } row ? Ok(row) : NotFound();

    private async Task<IActionResult> SaveItem(KnowledgeRow row, CancellationToken token)
    {
        var (settings, _) = store.Settings();
        var source = PromptBuilder.Knowledge([row]);
        (row.Tokens, row.Estimated) = await Count(source, token);
        var others = store.Knowledge().Where(k => k.Enabled && k.Id != row.Id).Sum(k => k.Tokens);
        string? warning = null;
        if (row.Enabled && others + row.Tokens > settings.Behaviour.KnowledgeBudget)
        {
            row.Enabled = false;
            warning = $"Saved but switched off: it needs {row.Tokens:N0} tokens and only {Math.Max(0, settings.Behaviour.KnowledgeBudget - others):N0} of your knowledge budget are free.";
        }
        try { return Ok(new { item = Summary(store.Upsert(row)), warning }); }
        catch (AssistantValidationException e) { return BadRequest(Problem(e.Message, e.Errors)); }
    }

    private static KnowledgeSummary Summary(KnowledgeRow r) => new(r.Id, r.Title, r.Kind, r.Source, r.ContentKey, r.Tokens, r.Estimated, r.Enabled, r.SortOrder, r.UpdatedUtc, r.Characters, r.Text.Length > 300 ? r.Text[..300] : r.Text);

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
        try { text = extension == ".pdf" ? (await gateway.ExtractPdfAsync(memory.ToArray(), token)).Text : DocumentText.Extract(name, memory.ToArray()); }
        catch (GatewayException e) { return BadRequest(Problem(e.Code == "gateway_unavailable" || e.Code == "not_configured" ? "PDFs are converted by the AI gateway, which is not reachable right now. Try again later or upload the text instead." : e.Message)); }
        catch (Exception e) when (e is InvalidDataException or System.Xml.XmlException) { return BadRequest(Problem(e.Message)); }
        if (string.IsNullOrWhiteSpace(text)) return BadRequest(Problem("This file contains no readable text."));
        return await SaveItem(new KnowledgeRow { Id = Guid.NewGuid(), Kind = "file", Source = name, Title = Path.GetFileNameWithoutExtension(name), Text = text, Enabled = true }, token);
    }

    [HttpPost("knowledge/{id:guid}/enabled")]
    public IActionResult Enable(Guid id, [FromBody] EnabledRequest request)
    {
        var row = store.Find(id); if (row == null) return NotFound();
        if (request.Enabled)
        {
            var (settings, _) = store.Settings();
            var others = store.Knowledge().Where(k => k.Enabled && k.Id != id).Sum(k => k.Tokens);
            if (others + row.Tokens > settings.Behaviour.KnowledgeBudget)
                return BadRequest(Problem($"Not enough knowledge budget: this item needs {row.Tokens:N0} tokens, {Math.Max(0, settings.Behaviour.KnowledgeBudget - others):N0} are free. Switch something else off or raise the budget under Behaviour."));
        }
        store.SetEnabled(id, request.Enabled);
        return NoContent();
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
            var counts = await gateway.CountAsync(items.Select(i => PromptBuilder.Knowledge([i])).ToList(), token);
            for (var i = 0; i < items.Count; i++) store.SetTokens(items[i].Id, counts[i], false);
            return Ok(new { knowledge = store.Knowledge() });
        }
        catch (GatewayException e) { return BadRequest(Problem("Counting needs the AI gateway: " + e.Message)); }
    }

    [HttpGet("pages")]
    public async Task<IActionResult> Pages() => Ok(await content.PagesAsync());

    [HttpPost("knowledge/pages")]
    public async Task<IActionResult> ImportPages([FromBody] PagesRequest request, CancellationToken token)
    {
        var results = new List<object>();
        foreach (var key in request.Keys.Distinct().Take(200))
        {
            var page = await content.PageTextAsync(key);
            if (page == null || string.IsNullOrWhiteSpace(page.Value.Text)) { results.Add(new { key, skipped = "No published text on this page." }); continue; }
            var row = store.FindByContent(key) ?? new KnowledgeRow { Id = Guid.NewGuid(), Kind = "page", ContentKey = key, Enabled = true };
            row.Title = page.Value.Title; row.Source = page.Value.Url; row.Text = page.Value.Text;
            var saved = await SaveItem(row, token);
            results.Add(saved is OkObjectResult ok ? ok.Value! : new { key, skipped = "Could not be saved." });
        }
        return Ok(new { results, knowledge = store.Knowledge() });
    }

    /// <summary>Same as the public config, for the live preview (works while the assistant is switched off).</summary>
    [HttpGet("config")]
    public async Task<IActionResult> PreviewConfig(CancellationToken token)
    {
        var (settings, version) = store.Settings();
        return Ok(PublicAssistantController.Build(settings, version, await PublicAssistantController.CachedStatus(cache, gateway, token), store, ignoreEnabled: true));
    }

    [HttpPost("attachments"), RequestSizeLimit(16_000_000)]
    public async Task<IActionResult> PreviewAttachment([FromBody] AttachmentRequest request, CancellationToken token)
    {
        try
        {
            var document = await gateway.ExtractPdfAsync(Convert.FromBase64String(request.Data ?? ""), token);
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
