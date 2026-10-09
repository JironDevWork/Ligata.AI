using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Ligata.AI.Models;
using Microsoft.Extensions.Logging;
using Umbraco.Cms.Core;
using Umbraco.Cms.Core.Models;
using Umbraco.Cms.Core.Models.Entities;
using Umbraco.Cms.Core.Services;
using Umbraco.Cms.Core.Web;
using Umbraco.Extensions;

namespace Ligata.AI.Editor;

/// <summary>One conversation step's setting: whose permissions, which settings. Collects what the backoffice should refresh or open.</summary>
public sealed class ToolContext(EditorSettings settings, EditorUser user)
{
    public EditorSettings Settings { get; } = settings;
    public EditorUser User { get; } = user;
    /// <summary>The language of the page open in the editor (the default for pages that vary by language).</summary>
    public string? OpenCulture { get; set; }
    /// <summary>Images the editor attached in this conversation (base64), for upload_media.</summary>
    public List<(string Name, string MediaType, string Data)> Attachments { get; } = [];
}

/// <summary>A change the assistant wants to make: what the user approves, and what the activity log keeps.</summary>
public sealed class Proposal
{
    public string Kind { get; set; } = EditorActions.Edit;
    public string Title { get; set; } = "";
    public Guid? DocumentKey { get; set; }
    public string DocumentName { get; set; } = "";
    public string? Culture { get; set; }
    /// <summary>The parent in the tree (refreshed after creating, moving or deleting).</summary>
    public Guid? ParentKey { get; set; }
    public List<EditorChange> Changes { get; set; } = [];
    public List<string> Notes { get; set; } = [];
    /// <summary>Why it cannot be made: returned to the model at once, never shown for approval.</summary>
    public string? Error { get; set; }
    /// <summary>Makes the change, checks it and returns what the model is told.</summary>
    [JsonIgnore] public Func<Task<string>>? Commit { get; set; }

    public static Proposal Refused(string error) => new() { Error = error };
}

/// <summary>
/// The content tools: everything runs on this server with the editor's own permissions, inside the configured scope. Reading
/// returns text for the model; changes are planned first (shown for approval with before and after) and then committed.
/// </summary>
public sealed partial class ContentTools(IContentService contents, IMediaService media, IEntityService entities, ILanguageService languages, IUserService users,
    ContentSchema schema, EditorAccess access, IUmbracoContextFactory contexts, ILogger<ContentTools> logger)
{
    public const int MaxResults = 25, ListPage = 60;

    private List<ILanguage>? cultures;
    public async Task<List<ILanguage>> LanguagesAsync() => cultures ??= (await languages.GetAllAsync()).OrderByDescending(l => l.IsDefault).ThenBy(l => l.IsoCode).ToList();
    public async Task<string?> DefaultCultureAsync() => (await LanguagesAsync()).FirstOrDefault(l => l.IsDefault)?.IsoCode;

    public Task<bool> ReadableForUserAsync(ToolContext context, IContent page) => access.ReadableAsync(context.Settings, context.User, page);

    /// <summary>A page by its key (or numeric id).</summary>
    public IContent? Find(string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return null;
        id = id.Trim();
        if (ContentFields.Udi(id) is { } key) return contents.GetById(key);
        return int.TryParse(id, out var number) ? contents.GetById(number) : null;
    }

    /// <summary>The language to work in: the requested one for pages that vary by language (else the open page's, else the default), none otherwise.</summary>
    public Task<(string? Culture, string? Error)> CultureAsync(ToolContext context, ISimpleContentType type, string? requested) => CultureAsync(context, type.VariesByCulture(), requested);
    public Task<(string? Culture, string? Error)> CultureAsync(ToolContext context, IContentTypeComposition type, string? requested) => CultureAsync(context, type.VariesByCulture(), requested);

    public async Task<(string? Culture, string? Error)> CultureAsync(ToolContext context, bool varies, string? requested)
    {
        if (!varies) return (null, null);
        var all = await LanguagesAsync();
        var wanted = string.IsNullOrWhiteSpace(requested) ? context.OpenCulture ?? await DefaultCultureAsync() : requested.Trim();
        var match = all.FirstOrDefault(l => string.Equals(l.IsoCode, wanted, StringComparison.OrdinalIgnoreCase));
        return match != null ? (match.IsoCode, null) : (null, $"Unknown language {wanted}. This site has: {string.Join(", ", all.Select(l => l.IsoCode))}.");
    }

    private readonly Dictionary<Guid, string> names = [];
    private string NameOf(Guid key)
    {
        if (names.TryGetValue(key, out var known)) return known;
        return names[key] = entities.Get(key)?.Name ?? "(not found)";
    }

    /// <summary>"Startseite › Leistungen › Massmöbel" (the page's ancestors and the page).</summary>
    public string Breadcrumb(string path, string? culture = null)
    {
        var ids = path.Split(',').Select(p => int.TryParse(p, out var id) ? id : 0).Where(id => id > 0).ToArray();
        if (ids.Length == 0) return "";
        var byId = entities.GetAll(UmbracoObjectTypes.Document, ids).ToDictionary(e => e.Id);
        return string.Join(" › ", ids.Where(byId.ContainsKey).Select(id => Name(byId[id], culture)));
    }

    private static string Name(IEntitySlim entity, string? culture) =>
        culture != null && entity is IDocumentEntitySlim d && d.CultureNames.TryGetValue(culture, out var name) && !string.IsNullOrEmpty(name) ? name : entity.Name ?? "";

    public string Name(IContent content, string? culture) => (culture != null ? content.GetCultureName(culture) : null) ?? content.Name ?? "";

    /// <summary>The page's address on the website in this language, if published.</summary>
    public string? Url(Guid key, string? culture)
    {
        try
        {
            using var reference = contexts.EnsureUmbracoContext();
            var page = reference.UmbracoContext.Content?.GetById(key);
            var url = page?.Url(culture, Umbraco.Cms.Core.Models.PublishedContent.UrlMode.Relative);
            return url is null or "" or "#" ? null : url;
        }
        catch (Exception e) { logger.LogDebug(e, "Ligata AI could not resolve the url of {Key}.", key); return null; }
    }

    public static string Status(IContent content, string? culture)
    {
        if (content.Trashed) return "in the recycle bin";
        if (culture != null && !content.IsCultureAvailable(culture)) return "not created in this language yet";
        var published = culture != null ? content.IsCulturePublished(culture) : content.Published;
        var edited = culture != null ? content.IsCultureEdited(culture) : content.Edited;
        return !published ? "draft, not published" : edited ? "published; the draft has unpublished changes" : "published";
    }

    private static string Status(IEntitySlim entity, string? culture)
    {
        if (entity is not IDocumentEntitySlim d) return "";
        if (culture != null && d.Variations.VariesByCulture())
        {
            if (!d.CultureNames.ContainsKey(culture)) return "not in this language";
            var published = d.PublishedCultures.Contains(culture);
            return !published ? "draft" : d.EditedCultures.Contains(culture) ? "published, draft changed" : "published";
        }
        return !d.Published ? "draft" : d.Edited ? "published, draft changed" : "published";
    }

    // ---------- search_content ----------
    /// <summary>
    /// The searchable draft text of every page, per language ("" for pages that do not vary): the name, then "Label: text" lines,
    /// also from the fields inside blocks (so "Telefon" finds the block field labelled Telefon). Kept in memory and rebuilt for a
    /// page when its update date changes, so a search reads only what changed since the last one.
    /// </summary>
    private static readonly ConcurrentDictionary<int, (DateTime Updated, Dictionary<string, (string Text, string Folded)> Cultures)> drafts = new();
    public const int MaxScanned = 5000;

    private async Task<Dictionary<string, (string Text, string Folded)>> TextOfAsync(IContent page)
    {
        var type = schema.Type(page.ContentType.Key);
        var cultures = page.ContentType.VariesByCulture() ? page.AvailableCultures.ToList() : [""];
        var result = new Dictionary<string, (string, string)>();
        foreach (var culture in cultures)
        {
            var c = culture == "" ? null : culture;
            var text = new StringBuilder(Name(page, c)).Append('\n');
            if (type != null)
                foreach (var p in ContentSchema.Properties(type))
                    await LinesAsync(text, p.Name ?? p.Alias, p.PropertyEditorAlias, p.DataTypeKey, page.GetValue(p.Alias, p.VariesByCulture() ? c : null), c, 0);
            var all = text.ToString();
            result[culture] = (all, Fold(all));
        }
        return result;
    }

    private async Task LinesAsync(StringBuilder text, string label, string editor, Guid dataType, object? raw, string? culture, int depth)
    {
        if (raw == null || depth > 6) return;
        var (dataEditor, _) = await schema.DataTypeAsync(dataType);
        editor = dataEditor.Length > 0 ? dataEditor : editor;
        if (FieldKinds.Of(editor) == FieldKinds.Blocks)
        {
            var blocks = BlockValue.Parse(raw, editor);
            if (blocks == null) return;
            foreach (var data in blocks.Content.OfType<JsonObject>())
            {
                if (culture != null && !blocks.Exposed(BlockValue.Key(data), culture)) continue;
                var element = Guid.TryParse(data["contentTypeKey"]?.ToString(), out var key) ? schema.Type(key) : null;
                if (element == null) continue;
                foreach (var p in ContentSchema.Properties(element))
                    await LinesAsync(text, p.Name ?? p.Alias, p.PropertyEditorAlias, p.DataTypeKey, BlockValue.Entry(data, p.Alias, p.VariesByCulture() ? culture : null)?["value"], culture, depth + 1);
            }
            return;
        }
        var words = Words(raw).Trim();
        if (words.Length > 0) text.Append(label).Append(": ").Append(words.Length > 4000 ? words[..4000] : words).Append('\n');
    }

    private static string Fold(string text) => Ligata.AI.Services.KnowledgeSnapshot.Fold(text);

    private static int Count(string text, string term)
    {
        var n = 0;
        for (var at = text.IndexOf(term, StringComparison.Ordinal); at >= 0 && n < 5; at = text.IndexOf(term, at + term.Length, StringComparison.Ordinal)) n++;
        return n;
    }

    public async Task<string> SearchAsync(ToolContext context, string query, string? culture, string? type, int limit)
    {
        query = (query ?? "").Trim();
        if (query.Length == 0) return "Error: give a few words to search for.";
        limit = Math.Clamp(limit <= 0 ? 10 : limit, 1, MaxResults);
        var terms = Ligata.AI.Services.KnowledgeSnapshot.Terms(query).Distinct().ToList();
        if (terms.Count == 0) terms = [Fold(query)];
        var phrase = Fold(query);
        var pages = entities.GetAll(UmbracoObjectTypes.Document).OfType<IDocumentEntitySlim>().Where(e => !e.Trashed && access.InScope(context.Settings, e.Path)).Take(MaxScanned).ToList();
        if (!string.IsNullOrWhiteSpace(type)) pages = pages.Where(e => string.Equals(e.ContentTypeAlias, type.Trim(), StringComparison.OrdinalIgnoreCase)).ToList();
        var stale = pages.Where(e => !drafts.TryGetValue(e.Id, out var known) || known.Updated != e.UpdateDate).Select(e => e.Id).ToList();
        foreach (var batch in stale.Chunk(100))
            foreach (var page in contents.GetByIds(batch)) drafts[page.Id] = (page.UpdateDate, await TextOfAsync(page));
        // Ties go to the language asked for, else the open page's, else the site's default language.
        var preferred = string.IsNullOrWhiteSpace(culture) ? context.OpenCulture ?? await DefaultCultureAsync() : culture.Trim();
        var scores = new List<(IDocumentEntitySlim Page, double Score, string Culture)>();
        foreach (var page in pages)
        {
            if (!drafts.TryGetValue(page.Id, out var known)) continue;
            var (bestScore, bestCulture) = (0.0, "");
            foreach (var (c, (_, folded)) in known.Cultures)
            {
                var name = folded[..Math.Max(0, folded.IndexOf('\n'))];
                var score = (name == phrase ? 12 : 0) + terms.Count(name.Contains) * 4.0 + (folded.Contains(phrase) ? 6 : 0)
                    + terms.Sum(t => Count(folded, t)) + (terms.All(folded.Contains) ? 3 : 0);
                if (score > 0 && string.Equals(c, preferred, StringComparison.OrdinalIgnoreCase)) score += 0.5;
                if (score > bestScore) (bestScore, bestCulture) = (score, c);
            }
            if (bestScore > 0) scores.Add((page, bestScore, bestCulture));
        }
        if (scores.Count == 0) return $"No pages found for “{query}”. Try other words (a name, a phrase from the text, a number), or browse with list_children.";
        var ranked = scores.OrderByDescending(s => s.Score).Take(100).ToList();
        var readable = await access.ReadableAsync(context.User, ranked.Select(s => s.Page.Key));
        var shown = ranked.Where(s => readable.Contains(s.Page.Key)).Take(limit).ToList();
        if (shown.Count == 0) return $"No pages you may see were found for “{query}”.";
        var text = new StringBuilder($"{shown.Count} page{(shown.Count == 1 ? "" : "s")} found for “{query}” (best first):\n");
        var n = 0;
        foreach (var (page, _, c) in shown)
        {
            // Named in the language asked for (else the preferred one) when the page has it; the snippet comes from where the words matched.
            var language = preferred != null && page.CultureNames.ContainsKey(preferred) ? preferred : c.Length > 0 ? c : null;
            text.Append($"{++n}. “{Name(page, language)}” — key {page.Key}, type {page.ContentTypeAlias}, {Breadcrumb(page.Path, language)}, {Status(page, language)}{(language != null ? $" ({language})" : "")}");
            if (drafts.TryGetValue(page.Id, out var known) && known.Cultures.TryGetValue(c, out var body) && Snippet(body.Text, body.Folded, terms, phrase) is { } snippet) text.Append($"\n   “…{snippet}…”");
            text.Append('\n');
        }
        return text.ToString().TrimEnd();
    }

    /// <summary>The line around the first match (the phrase first, else any term), without the page name line.</summary>
    private static string? Snippet(string text, string folded, List<string> terms, string phrase)
    {
        var body = folded.IndexOf('\n') + 1;
        var at = folded.IndexOf(phrase, body, StringComparison.Ordinal);
        if (at < 0) at = terms.Select(t => folded.IndexOf(t, body, StringComparison.Ordinal)).Where(i => i >= 0).DefaultIfEmpty(-1).Min();
        if (at < 0 || at >= text.Length) return null;
        var start = Math.Max(body, at - 70);
        return text.Substring(start, Math.Min(170, text.Length - start)).Replace('\n', ' ').Trim();
    }

    /// <summary>The words of a stored value: rich text without tags, the texts inside block and picker JSON.</summary>
    private static string Words(object? raw)
    {
        var node = ContentFields.Node(raw);
        if (node == null) return ContentFields.Plain(ContentFields.String(raw) ?? "");
        var words = new StringBuilder();
        void Walk(JsonNode? n, string? key)
        {
            switch (n)
            {
                case JsonObject o: foreach (var p in o) Walk(p.Value, p.Key); break;
                case JsonArray a: foreach (var i in a) Walk(i, key); break;
                case JsonValue v when v.TryGetValue<string>(out var s) && key is not ("editorAlias" or "alias" or "culture" or "segment" or "key" or "contentKey" or "settingsKey" or "contentTypeKey" or "udi" or "mediaKey" or "target" or "queryString"):
                    var inner = ContentFields.Node(s);
                    if (inner != null) Walk(inner, key);
                    else if (!Guid.TryParse(s, out _) && !s.StartsWith("umb://")) words.Append(ContentFields.Plain(s)).Append(' ');
                    break;
            }
        }
        Walk(node, null);
        return words.ToString();
    }

    // ---------- list_children ----------
    public async Task<string> ChildrenAsync(ToolContext context, string? parent, string? culture, int skip)
    {
        IEnumerable<IEntitySlim> children;
        string where;
        var settings = context.Settings;
        string? c = null;
        if (string.IsNullOrWhiteSpace(parent) || parent.Trim().Equals("root", StringComparison.OrdinalIgnoreCase))
        {
            // With start points, the top of the tree is the start points.
            children = settings.Scope.Roots.Count > 0 ? settings.Scope.Roots.Select(k => entities.Get(k, UmbracoObjectTypes.Document)).Where(e => e != null).Cast<IEntitySlim>() : entities.GetChildren(Constants.System.Root, UmbracoObjectTypes.Document);
            where = settings.Scope.Roots.Count > 0 ? "The assistant works in these parts of the site" : "Top-level pages";
            c = string.IsNullOrWhiteSpace(culture) ? context.OpenCulture ?? await DefaultCultureAsync() : culture.Trim();
        }
        else
        {
            var page = Find(parent);
            if (page == null) return $"Error: no page with key {parent}.";
            if (!await access.ReadableAsync(settings, context.User, page) && !access.AboveScope(settings, page)) return "Error: you may not see this page.";
            (c, _) = await CultureAsync(context, page.ContentType, culture);
            c ??= string.IsNullOrWhiteSpace(culture) ? context.OpenCulture ?? await DefaultCultureAsync() : culture.Trim();
            children = entities.GetChildren(page.Id, UmbracoObjectTypes.Document);
            where = $"Below “{Name(page, c)}” ({page.Key})";
        }
        var list = children.Where(e => !e.Trashed).OrderBy(e => e.SortOrder).ToList();
        var readable = await access.ReadableAsync(context.User, list.Select(e => e.Key));
        list = list.Where(e => readable.Contains(e.Key) && (access.InScope(settings, e.Path) || access.AboveScope(settings, e))).ToList();
        if (list.Count == 0) return where + ": no pages.";
        skip = Math.Max(0, skip);
        var shown = list.Skip(skip).Take(ListPage).ToList();
        var text = new StringBuilder($"{where}: {list.Count} page{(list.Count == 1 ? "" : "s")}{(c != null ? $" (names in {c})" : "")}\n");
        foreach (var e in shown)
        {
            var type = e is IContentEntitySlim typed ? typed.ContentTypeAlias : "";
            text.Append($"- “{Name(e, c)}” — key {e.Key}, type {type}, {Status(e, c)}{(e.HasChildren ? ", has subpages" : "")}{(access.AboveScope(settings, e) ? " (the assistant only works further down)" : "")}\n");
        }
        if (skip + shown.Count < list.Count) text.Append($"… {list.Count - skip - shown.Count} more: list_children with skip={skip + shown.Count}.\n");
        return text.ToString().TrimEnd();
    }

    // ---------- read_content ----------
    public async Task<string> ReadAsync(ToolContext context, string? id, string? requestedCulture, IReadOnlyList<string>? only)
    {
        var page = Find(id);
        if (page == null) return $"Error: no page with key {id}. Find pages with search_content or list_children.";
        if (!await access.ReadableAsync(context.Settings, context.User, page)) return "Error: you may not see this page (permissions or the assistant's scope).";
        var (culture, error) = await CultureAsync(context, page.ContentType, requestedCulture);
        if (error != null) return "Error: " + error;
        var type = schema.Type(page.ContentType.Key)!;
        var readOnly = context.Settings.Scope.ReadOnlyTypes.Contains(type.Alias, StringComparer.OrdinalIgnoreCase);
        var text = new StringBuilder();
        text.Append($"Page “{Name(page, culture)}” — key {page.Key}, type {type.Alias} ({type.Name}){(culture != null ? $", language {culture}" : "")}\n");
        text.Append($"Location: {Breadcrumb(page.Path, culture)}\n");
        var url = Url(page.Key, culture);
        text.Append($"Status: {Status(page, culture)}{(url != null ? $"; live at {url}" : "")}\n");
        if (culture != null)
        {
            var others = (await LanguagesAsync()).Where(l => l.IsoCode != culture).Select(l => page.IsCultureAvailable(l.IsoCode) ? $"{l.IsoCode} “{page.GetCultureName(l.IsoCode)}” ({Status(page, l.IsoCode)})" : $"{l.IsoCode} (not created)").ToList();
            if (others.Count > 0) text.Append($"Other languages: {string.Join("; ", others)}\n");
        }
        var writer = users.GetProfileById(page.WriterId)?.Name;
        text.Append($"Last saved: {page.UpdateDate:yyyy-MM-dd HH:mm}{(writer != null ? " by " + writer : "")}\n");
        if (readOnly) text.Append("This page type is read-only for the assistant: you can read it but not change it.\n");
        text.Append(only is { Count: > 0 } ? "Requested fields in full:\n" : "Fields (path [kind]: value). Change them with update_content; add, remove or move blocks with edit_blocks.\n");
        var varies = page.ContentType.VariesByCulture();
        foreach (var property in ContentSchema.Properties(type))
        {
            var alias = property.Alias;
            if (only is { Count: > 0 } && !only.Any(o => o.Split('/')[0].Equals(alias, StringComparison.OrdinalIgnoreCase))) continue;
            var c = property.VariesByCulture() ? culture : null;
            var raw = page.GetValue(alias, c);
            var notes = new List<string>();
            if (varies && !property.VariesByCulture()) notes.Add("shared by all languages");
            await FieldAsync(context, text, alias, property.Name ?? alias, property.PropertyEditorAlias, property.DataTypeKey, property.Mandatory, raw, culture, notes, 0, only, readOnly);
        }
        // A very large page would crowd out the conversation: the rest is read field by field.
        if (text.Length > MaxRead) return text.ToString(0, MaxRead) + $"\n… (the page is long: {text.Length - MaxRead:N0} more characters were left out. Read the fields you need with fields=[path].)";
        return text.ToString().TrimEnd();
    }

    public const int MaxRead = 40_000;

    private async Task FieldAsync(ToolContext context, StringBuilder text, string path, string label, string editor, Guid dataTypeKey, bool mandatory, object? raw, string? culture,
        List<string> notes, int depth, IReadOnlyList<string>? only, bool readOnly)
    {
        var (dataEditor, config) = await schema.DataTypeAsync(dataTypeKey);
        editor = dataEditor.Length > 0 ? dataEditor : editor;
        var kind = FieldKinds.Of(editor);
        var indent = new string(' ', depth * 2);
        var alias = path.Split('/').Last().Split(':').Last();
        var isProtected = context.Settings.Scope.ProtectedFields.Contains(alias, StringComparer.OrdinalIgnoreCase);
        if (mandatory) notes.Add("required");
        if (isProtected || readOnly) notes.Add("read-only for the assistant");
        // Only limits that matter for normal text (Umbraco's textstring allows 250 by default).
        if (kind is FieldKinds.Text or FieldKinds.TextArea && ContentSchema.Number(config, "maxChars") is { } max && max < 250) notes.Add($"max {max} characters");
        var full = only is { Count: > 0 } && only.Any(o => o.Equals(path, StringComparison.OrdinalIgnoreCase) || path.StartsWith(o + "/", StringComparison.OrdinalIgnoreCase));
        var annotation = notes.Count > 0 ? ", " + string.Join(", ", notes) : "";
        if (kind == FieldKinds.Blocks)
        {
            var blocks = BlockValue.Parse(raw, editor);
            var items = blocks?.Items() ?? [];
            var focused = only is { Count: > 0 } && !full;
            if (!focused) text.Append($"{indent}- {path} [{(editor == "Umbraco.BlockGrid" ? "Block Grid" : "Block List")}: {label}{annotation}]: {(items.Count == 0 ? "no blocks" : $"{items.Count} block{(items.Count == 1 ? "" : "s")}")}\n");
            if (blocks == null) return;
            var allowed = string.Join(", ", ContentSchema.Blocks(config).Select(b => schema.Type(b.Content)?.Alias).Where(a => a != null));
            if (allowed.Length > 0 && depth == 0 && (only == null || only.Count == 0)) text.Append($"{indent}  (accepts: {allowed})\n");
            foreach (var (item, _, level, _, _) in items)
            {
                var key = BlockValue.Key(item);
                var data = blocks.Data(key);
                if (data == null) continue;
                if (focused && !only!.Any(o => o.StartsWith($"{path}/{ContentFields.ShortId(key)}", StringComparison.OrdinalIgnoreCase) || $"{path}/{key:N}".StartsWith(o, StringComparison.OrdinalIgnoreCase))) continue;
                var element = Guid.TryParse(data["contentTypeKey"]?.ToString(), out var typeKey) ? schema.Type(typeKey) : null;
                var blockPath = $"{path}/{ContentFields.ShortId(key)}";
                var hidden = culture != null && !blocks.Exposed(key, culture) ? $" — not shown in {culture} yet" : "";
                text.Append($"{indent}  {new string(' ', level * 2)}- block {blockPath} [{element?.Name ?? "unknown type"} ({element?.Alias})]{hidden}\n");
                if (element == null) continue;
                foreach (var p in ContentSchema.Properties(element))
                {
                    var entryCulture = p.VariesByCulture() ? culture : null;
                    var entry = BlockValue.Entry(data, p.Alias, entryCulture);
                    var value = entry?["value"];
                    var inner = new List<string>();
                    await FieldAsync(context, text, $"{blockPath}/{p.Alias}", p.Name ?? p.Alias, p.PropertyEditorAlias, p.DataTypeKey, p.Mandatory, value, culture, inner, depth + 2 + level, only, readOnly);
                }
                if (BlockValue.SettingsKey(item) is { } settingsKey && blocks.SettingsData(settingsKey) is { } settings
                    && Guid.TryParse(settings["contentTypeKey"]?.ToString(), out var settingsTypeKey) && schema.Type(settingsTypeKey) is { } settingsType)
                {
                    var set = ContentSchema.Properties(settingsType).Where(p => BlockValue.Entry(settings, p.Alias, p.VariesByCulture() ? culture : null)?["value"] is { } v && ContentFields.String(v) is { Length: > 0 }).ToList();
                    if (set.Count > 0) text.Append($"{indent}  {new string(' ', level * 2)}  settings ({settingsType.Alias}):\n");
                    foreach (var p in set)
                        await FieldAsync(context, text, $"{blockPath}:settings/{p.Alias}", p.Name ?? p.Alias, p.PropertyEditorAlias, p.DataTypeKey, false, BlockValue.Entry(settings, p.Alias, p.VariesByCulture() ? culture : null)?["value"], culture, [], depth + 3 + level, only, readOnly);
                }
            }
            return;
        }
        if (only is { Count: > 0 } && !full) return;
        var shown = Display(kind, editor, raw, config, full ? 200_000 : ContentFields.ValuePreview);
        text.Append($"{indent}- {path} [{KindLabel(kind, editor, config)}: {label}{annotation}]: {shown}\n");
    }

    public static string KindLabel(string kind, string editor, JsonObject config) => kind switch
    {
        FieldKinds.Text => "text",
        FieldKinds.TextArea => "text area",
        FieldKinds.Markdown => "markdown",
        FieldKinds.Email => "email",
        FieldKinds.RichText => "rich text HTML",
        FieldKinds.Integer => "whole number",
        FieldKinds.Decimal => "number",
        FieldKinds.Boolean => "true/false",
        FieldKinds.Choice => (ContentSchema.Flag(config, "multiple") ? "choices of " : "choice of ") + string.Join(" | ", ContentSchema.Items(config)),
        FieldKinds.Radio => "choice of " + string.Join(" | ", ContentSchema.Items(config)),
        FieldKinds.Checkboxes => "choices of " + string.Join(" | ", ContentSchema.Items(config)),
        FieldKinds.Tags => "tags",
        FieldKinds.Page => "page picker",
        FieldKinds.Pages => "page pickers",
        FieldKinds.Media => ContentSchema.Flag(config, "multiple") ? "media pickers" : "media picker",
        FieldKinds.Links => "links",
        FieldKinds.Date => "date",
        _ => $"not editable here ({editor})",
    };

    /// <summary>A stored value as the model reads it (and writes it back).</summary>
    public string Display(string kind, string editor, object? raw, JsonObject config, int max = ContentFields.ValuePreview)
    {
        string? text = ContentFields.String(raw);
        if (string.IsNullOrEmpty(text) || text is "[]" or "null") return kind == FieldKinds.Boolean ? "false" : "(empty)";
        switch (kind)
        {
            case FieldKinds.Text or FieldKinds.TextArea or FieldKinds.Markdown or FieldKinds.Email or FieldKinds.Radio or FieldKinds.Date:
                return ContentFields.Quote(text, max);
            case FieldKinds.RichText:
                var markup = ContentFields.RichMarkup(raw);
                return markup.Length == 0 ? "(empty)" : ContentFields.Quote(markup, max);
            case FieldKinds.Integer or FieldKinds.Decimal:
                return text;
            case FieldKinds.Boolean:
                return text is "1" or "true" or "True" ? "true" : "false";
            case FieldKinds.Choice or FieldKinds.Checkboxes or FieldKinds.Tags:
                return JsonSerializer.Serialize(List(raw), ContentFields.Readable);
            case FieldKinds.Page or FieldKinds.Pages:
                var pages = text.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(ContentFields.Udi).Where(k => k != null).Select(k => new { page = NameOf(k!.Value), key = k }).ToList();
                return JsonSerializer.Serialize(kind == FieldKinds.Page && pages.Count == 1 ? (object)pages[0] : pages, ContentFields.Readable);
            case FieldKinds.Media:
                var items = (ContentFields.Node(raw) as JsonArray ?? []).OfType<JsonObject>().Select(m => Guid.TryParse(m["mediaKey"]?.ToString(), out var k) ? new { media = NameOf(k), key = k } : null).Where(m => m != null).ToList();
                return JsonSerializer.Serialize(items, ContentFields.Readable);
            case FieldKinds.Links:
                var links = (ContentFields.Node(raw) as JsonArray ?? []).OfType<JsonObject>().Select(l =>
                {
                    var target = ContentFields.Udi(l["udi"]?.ToString() ?? l["unique"]?.ToString());
                    var link = new Dictionary<string, object?> { ["name"] = l["name"]?.ToString() };
                    if (target is { } key && (l["udi"]?.ToString() ?? "").Contains("/media/")) { link["media"] = NameOf(key); link["key"] = key; }
                    else if (target is { } page) { link["page"] = NameOf(page); link["key"] = page; }
                    else link["url"] = l["url"]?.ToString();
                    if (l["queryString"]?.ToString() is { Length: > 0 } query) link["query"] = query;
                    if (l["target"]?.ToString() is "_blank") link["newWindow"] = true;
                    return link;
                }).ToList();
                return JsonSerializer.Serialize(links, ContentFields.Readable);
            default:
                return ContentFields.Quote(text, Math.Min(max, 300));
        }
    }

    public static List<string> List(object? raw)
    {
        var node = ContentFields.Node(raw);
        if (node is JsonArray array) return array.Select(i => i?.ToString() ?? "").Where(s => s.Length > 0).ToList();
        var text = ContentFields.String(raw) ?? "";
        return text.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
    }

    // ---------- describe_type ----------
    public async Task<string> DescribeAsync(ToolContext context, string? alias)
    {
        var type = string.IsNullOrWhiteSpace(alias) ? null : schema.Type(alias.Trim());
        if (type == null) return $"Error: no document or block type with alias {alias}.";
        var text = new StringBuilder();
        text.Append($"{(type.IsElement ? "Block type" : "Page type")} {type.Alias} (“{type.Name}”){(type.VariesByCulture() ? ", varies by language" : ", the same in every language")}{(string.IsNullOrWhiteSpace(type.Description) ? "" : ": " + type.Description)}\n");
        if (context.Settings.Scope.ReadOnlyTypes.Contains(type.Alias, StringComparer.OrdinalIgnoreCase)) text.Append("Read-only for the assistant.\n");
        if (!type.IsElement)
        {
            var allowed = type.AllowedContentTypes?.Select(t => schema.Type(t.Key)).Where(t => t != null).Select(t => $"{t!.Alias} (“{t.Name}”)").ToList() ?? [];
            text.Append($"Pages allowed below it: {(allowed.Count > 0 ? string.Join(", ", allowed) : "none")}{(type.AllowedAsRoot ? "; may be created at the top level" : "")}\n");
        }
        text.Append("Fields:\n");
        foreach (var p in ContentSchema.Properties(type))
        {
            var (editor, config) = await schema.DataTypeAsync(p.DataTypeKey);
            editor = editor.Length > 0 ? editor : p.PropertyEditorAlias;
            var kind = FieldKinds.Of(editor);
            var notes = new List<string>();
            if (p.Mandatory) notes.Add("required");
            if (type.VariesByCulture() && !p.VariesByCulture()) notes.Add("shared by all languages");
            if (context.Settings.Scope.ProtectedFields.Contains(p.Alias, StringComparer.OrdinalIgnoreCase)) notes.Add("read-only for the assistant");
            if (ContentSchema.Number(config, "maxChars") is { } max) notes.Add($"max {max} characters");
            if (!string.IsNullOrWhiteSpace(p.ValidationRegExp)) notes.Add($"must match {p.ValidationRegExp}");
            var label = kind == FieldKinds.Blocks ? (editor == "Umbraco.BlockGrid" ? "Block Grid" : "Block List") : KindLabel(kind, editor, config);
            text.Append($"- {p.Alias} [{label}] “{p.Name}”{(notes.Count > 0 ? " (" + string.Join(", ", notes) + ")" : "")}{(string.IsNullOrWhiteSpace(p.Description) ? "" : ": " + p.Description.Trim().Replace('\n', ' '))}\n");
            if (kind == FieldKinds.Blocks)
            {
                var blocks = ContentSchema.Blocks(config).Select(b => (Type: schema.Type(b.Content), b.AtRoot)).Where(b => b.Type != null).ToList();
                text.Append($"  accepts blocks: {string.Join(", ", blocks.Select(b => $"{b.Type!.Alias} (“{b.Type.Name}”){(editor == "Umbraco.BlockGrid" && !b.AtRoot ? " only inside areas" : "")}"))}\n");
                if (ContentSchema.Get(config, "validationLimit") is JsonObject limit && (limit["min"] != null || limit["max"] != null)) text.Append($"  number of blocks: {limit["min"]?.ToString() ?? "0"} to {limit["max"]?.ToString() ?? "any"}\n");
            }
        }
        return text.ToString().TrimEnd();
    }

    // ---------- search_media ----------
    public string SearchMedia(string? query, int limit)
    {
        limit = Math.Clamp(limit <= 0 ? 15 : limit, 1, MaxResults);
        var folded = Ligata.AI.Services.KnowledgeSnapshot.Fold(query ?? "");
        var items = entities.GetAll(UmbracoObjectTypes.Media).Where(e => !e.Trashed).OfType<IMediaEntitySlim>()
            .Where(e => e.ContentTypeAlias != Constants.Conventions.MediaTypes.Folder)
            .Select(e => (Entity: e, Score: folded.Length == 0 ? 1 : Ligata.AI.Services.KnowledgeSnapshot.Fold(e.Name ?? "") is var name && name == folded ? 3 : name.Contains(folded) ? 2 : 0))
            .Where(x => x.Score > 0).OrderByDescending(x => x.Score).ThenByDescending(x => x.Entity.UpdateDate).Take(limit).ToList();
        if (items.Count == 0) return $"No media found{(folded.Length > 0 ? $" for “{query}”" : "")}.";
        return $"{items.Count} media item{(items.Count == 1 ? "" : "s")} found:\n" + string.Join("\n", items.Select(x => $"- “{x.Entity.Name}” — key {x.Entity.Key}, type {x.Entity.ContentTypeAlias}{(string.IsNullOrEmpty(x.Entity.MediaPath) ? "" : ", " + x.Entity.MediaPath)}"));
    }
}
