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

/// <summary>Reads published website pages as plain text, so editors can add their own content as knowledge.</summary>
public sealed class ContentKnowledge(IUmbracoContextFactory contexts, IDocumentNavigationQueryService navigation)
{
    public async Task<List<SitePage>> PagesAsync()
    {
        using var reference = contexts.EnsureUmbracoContext();
        var cache = reference.UmbracoContext.Content;
        var pages = new List<SitePage>();
        if (cache == null || !navigation.TryGetRootKeys(out var roots)) return pages;
        foreach (var key in roots)
        {
            var root = await cache.GetByIdAsync(key);
            if (root == null) continue;
            foreach (var page in new[] { root }.Concat(root.Descendants()))
                if (page.IsPublished() && pages.Count < 2000)
                    pages.Add(new SitePage(page.Key, page.Name ?? "", page.TemplateId > 0 ? page.Url(mode: UrlMode.Relative) : "", page.Level, page.ContentType.Alias, page.TemplateId > 0));
        }
        return pages;
    }

    public async Task<(string Title, string Url, string Text)?> PageTextAsync(Guid key)
    {
        using var reference = contexts.EnsureUmbracoContext();
        var content = reference.UmbracoContext.Content == null ? null : await reference.UmbracoContext.Content.GetByIdAsync(key);
        if (content == null || !content.IsPublished()) return null;
        var text = new StringBuilder();
        Collect(content, text, 0);
        var url = content.TemplateId > 0 ? content.Url(mode: UrlMode.Relative) : "";
        return (content.Name ?? "Page", url, DocumentText.Normalize(text.ToString()));
    }

    // Walks text-like property values, including nested block list/grid elements. Pickers, media and
    // numbers are skipped: they rarely carry answerable content and would only cost context.
    private static void Collect(IPublishedElement element, StringBuilder text, int depth)
    {
        if (depth > 6) return;
        foreach (var property in element.Properties)
        {
            object? value;
            try { value = property.GetValue(); } catch { continue; }
            Append(value, text, depth);
        }
    }

    private static void Append(object? value, StringBuilder text, int depth)
    {
        switch (value)
        {
            case null: return;
            case string s when s.Length > 0 && !LooksLikeData(s): text.AppendLine(s.Contains('<') ? DocumentText.FromHtml(s) : s); break;
            case IHtmlEncodedString html: text.AppendLine(DocumentText.FromHtml(html.ToHtmlString() ?? "")); break;
            case IHtmlContent content: { using var writer = new StringWriter(); content.WriteTo(writer, System.Text.Encodings.Web.HtmlEncoder.Default); text.AppendLine(DocumentText.FromHtml(writer.ToString())); break; }
            case BlockGridModel grid: foreach (var item in grid) { Collect(item.Content, text, depth + 1); foreach (var area in item.Areas) foreach (var nested in area) Collect(nested.Content, text, depth + 2); } break;
            case BlockListModel list: foreach (var item in list) Collect(item.Content, text, depth + 1); break;
            case IPublishedElement element when value is not IPublishedContent: Collect(element, text, depth + 1); break;
            case IEnumerable<string> strings: foreach (var s in strings) Append(s, text, depth); break;
            case IEnumerable items and not IEnumerable<IPublishedContent>: foreach (var item in items) if (item is IPublishedElement e and not IPublishedContent) Collect(e, text, depth + 1); break;
        }
    }

    // JSON, GUIDs and udi references are configuration, not content.
    private static bool LooksLikeData(string value) =>
        value.StartsWith("umb://") || Guid.TryParse(value, out _) || (value.Length > 1 && (value[0] is '{' or '[') && (value[^1] is '}' or ']'));
}
