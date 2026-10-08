using System.Collections;
using System.Text;
using Microsoft.AspNetCore.Html;
using Umbraco.Cms.Core.Models.Blocks;
using Umbraco.Cms.Core.Models.PublishedContent;
using Umbraco.Cms.Core.Services.Navigation;
using Umbraco.Cms.Core.Strings;
using Umbraco.Cms.Core.Web;
using Umbraco.Extensions;

namespace Ligata.AI.Services;

public sealed record SitePage(Guid Key, string Name, string Url, int Level, string ContentType, bool HasTemplate);

/// <summary>
/// A published page in one language (Culture is empty for pages that do not vary by culture), with its text as the assistant
/// reads it. Updated tells whether a cached text is still current.
/// </summary>
public sealed record LivePage(Guid Key, string Culture, string Name, string Url, int Level, DateTime Updated, string Text)
{
    public string Id => Key.ToString("N") + "|" + Culture;
}

/// <summary>Reads published website pages as plain text: the assistant looks them up while answering.</summary>
public sealed class ContentKnowledge(IUmbracoContextFactory contexts, IDocumentNavigationQueryService navigation, IVariationContextAccessor variation)
{
    public const int MaxPages = 2000;

    /// <summary>Published pages in tree order (each page before its subpages).</summary>
    public async Task<List<SitePage>> PagesAsync()
    {
        using var reference = contexts.EnsureUmbracoContext();
        // The url in the first language that has one (a page may be published in some languages only).
        string Url(IPublishedContent p) => p.TemplateId <= 0 ? "" : Cultures(p).Select(c => p.Url(c == "" ? null : c, UrlMode.Relative)).FirstOrDefault(u => u is not ("" or "#")) ?? "";
        return (await PublishedAsync()).Select(p => new SitePage(p.Key, p.Name ?? "", Url(p), p.Level, p.ContentType.Alias, p.TemplateId > 0)).ToList();
    }

    private async Task<List<IPublishedContent>> PublishedAsync()
    {
        using var reference = contexts.EnsureUmbracoContext();
        var cache = reference.UmbracoContext.Content;
        var pages = new List<IPublishedContent>();
        if (cache == null || !navigation.TryGetRootKeys(out var roots)) return pages;
        void Walk(IPublishedContent page)
        {
            if (pages.Count >= MaxPages || Cultures(page).Count == 0) return;
            pages.Add(page);
            // "*": children in every language, not only in the default one.
            foreach (var child in page.Children("*").OrderBy(c => c.SortOrder)) Walk(child);
        }
        foreach (var key in roots)
            if (await cache.GetByIdAsync(key) is { } root) Walk(root);
        return pages;
    }

    /// <summary>The languages a page is published in; one empty culture for pages that do not vary by culture.</summary>
    private static List<string> Cultures(IPublishedContent page) =>
        page.Cultures.Keys.Any(c => c != "") ? page.Cultures.Keys.Where(c => c != "" && page.IsPublished(c)).Order(StringComparer.OrdinalIgnoreCase).ToList()
        : page.IsPublished() ? [""] : [];

    /// <summary>
    /// The text of every page the assistant may read, in every language it is published in (each language is a page of its own,
    /// with its own name, url and text). Pages unchanged since `previous` keep their text, so only edited pages are read again.
    /// </summary>
    public async Task<List<LivePage>> LivePagesAsync(Func<Guid, string, bool> include, IReadOnlyDictionary<string, LivePage> previous)
    {
        using var reference = contexts.EnsureUmbracoContext();
        var found = new List<(IPublishedContent Page, string Culture, string Url)>();
        foreach (var page in await PublishedAsync())
        {
            if (page.TemplateId <= 0) continue;
            foreach (var culture in Cultures(page))
            {
                var url = page.Url(culture == "" ? null : culture, UrlMode.Relative);
                if (url is "" or "#" || !include(page.Key, url)) continue;
                found.Add((page, culture, url));
            }
        }
        // Languages on their own domains can share a path ("/" on example.ch and example.com): those pages keep the domain.
        var shared = found.GroupBy(f => f.Url, StringComparer.OrdinalIgnoreCase).Where(g => g.Select(f => f.Culture).Distinct().Count() > 1).SelectMany(g => g).ToHashSet();
        var result = new List<LivePage>();
        foreach (var item in found)
        {
            var (page, culture, url) = item;
            if (shared.Contains(item) && page.Url(culture, UrlMode.Absolute) is { Length: > 0 } absolute && absolute != "#") url = absolute;
            var info = culture != "" && page.Cultures.TryGetValue(culture, out var c) ? c : null;
            var name = info?.Name ?? page.Name ?? "Page";
            var updated = info != null && info.Date > page.UpdateDate ? info.Date : page.UpdateDate;
            var id = page.Key.ToString("N") + "|" + culture;
            if (previous.TryGetValue(id, out var known) && known.Updated == updated && known.Url == url && known.Name == name) { result.Add(known with { Level = page.Level }); continue; }
            var text = new StringBuilder();
            // Block list and grid items read their values in the variation context: set it to this language while reading.
            var before = variation.VariationContext;
            variation.VariationContext = new VariationContext(culture);
            try { Collect(page, text, 0, culture); }
            finally { variation.VariationContext = before; }
            result.Add(new LivePage(page.Key, culture, name, url, page.Level, updated, DocumentText.Normalize(text.ToString())));
        }
        return result;
    }

    // Walks text-like property values, including nested block list/grid elements. Pickers, media and
    // numbers are skipped: they rarely carry answerable content and would only cost context.
    private static void Collect(IPublishedElement element, StringBuilder text, int depth, string culture)
    {
        if (depth > 6) return;
        foreach (var property in element.Properties)
        {
            object? value;
            try { value = property.GetValue(culture == "" ? null : culture); } catch { continue; }
            Append(value, text, depth, culture);
        }
    }

    private static void Append(object? value, StringBuilder text, int depth, string culture)
    {
        switch (value)
        {
            case null: return;
            case string s when s.Length > 0 && !LooksLikeData(s): text.AppendLine(s.Contains('<') ? DocumentText.FromHtml(s) : s); break;
            case IHtmlEncodedString html: text.AppendLine(DocumentText.FromHtml(html.ToHtmlString() ?? "")); break;
            case IHtmlContent content: { using var writer = new StringWriter(); content.WriteTo(writer, System.Text.Encodings.Web.HtmlEncoder.Default); text.AppendLine(DocumentText.FromHtml(writer.ToString())); break; }
            case BlockGridModel grid: foreach (var item in grid) { Collect(item.Content, text, depth + 1, culture); foreach (var area in item.Areas) foreach (var nested in area) Collect(nested.Content, text, depth + 2, culture); } break;
            case BlockListModel list: foreach (var item in list) Collect(item.Content, text, depth + 1, culture); break;
            case IPublishedElement element when value is not IPublishedContent: Collect(element, text, depth + 1, culture); break;
            case IEnumerable<string> strings: foreach (var s in strings) Append(s, text, depth, culture); break;
            case IEnumerable items and not IEnumerable<IPublishedContent>: foreach (var item in items) if (item is IPublishedElement e and not IPublishedContent) Collect(e, text, depth + 1, culture); break;
        }
    }

    // JSON, GUIDs and udi references are configuration, not content.
    private static bool LooksLikeData(string value) =>
        value.StartsWith("umb://") || Guid.TryParse(value, out _) || (value.Length > 1 && (value[0] is '{' or '[') && (value[^1] is '}' or ']'));
}
