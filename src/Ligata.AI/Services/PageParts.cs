using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;

namespace Ligata.AI.Services;

/// <summary>A part of a rendered page: Kind is form, embed or "" (marked by the site), Name what the widget finds it by, Text its visible words.</summary>
public sealed record PagePart(string Kind, string Name, IReadOnlyList<string> Text);

/// <summary>What was read of a page as visitors get it: lines for its knowledge text, and the parts by name for the list of pages.</summary>
public sealed record PagePartsRead(DateTime Updated, string Text, string Names);

/// <summary>
/// The parts of a page that its text properties do not hold, read from the page as visitors get it: forms (a form module such as
/// Ligata.Forms stores only the form's id on the page), embedded maps and videos (an iframe with a title), and whatever a site or
/// module marks with data-ligata-ai-part="Name". Each becomes a line of the page's knowledge text, by kind and name
/// (Form “Book a visit”: Your name · Preferred day …), so the assistant knows the page has it and can point at it; the widget
/// finds the same parts by the same names. Forms in the header, menu or footer (search, newsletter) are on every page and left out.
/// </summary>
public static partial class PageParts
{
    public const int MaxParts = 6, MaxLine = 600;

    [GeneratedRegex(@"<(script|style|noscript|template|svg|textarea)\b[^>]*>.*?</\1\s*>|<!--.*?-->", RegexOptions.Singleline | RegexOptions.IgnoreCase)] private static partial Regex Raw();
    [GeneratedRegex(@"<(/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>""']|""[^""]*""|'[^']*')*)>")] private static partial Regex Tag();
    [GeneratedRegex(@"([^\s""'=<>/]+)(?:\s*=\s*(?:""([^""]*)""|'([^']*)'|([^\s""'=<>`]+)))?")] private static partial Regex Attribute();
    [GeneratedRegex(@"display\s*:\s*none|visibility\s*:\s*hidden", RegexOptions.IgnoreCase)] private static partial Regex HiddenStyle();
    [GeneratedRegex(@"<html\b[^>]*\blang\s*=\s*[""']?([a-zA-Z]{2})", RegexOptions.IgnoreCase)] private static partial Regex HtmlLanguage();
    [GeneratedRegex(@"\s+")] private static partial Regex Spaces();

    private static readonly HashSet<string> Void = new(StringComparer.Ordinal) { "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr" };
    // Text flows on through these; any other tag ends a piece of text (a label, an option, a paragraph, a button).
    private static readonly HashSet<string> Inline = new(StringComparer.Ordinal) { "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn", "em", "i", "kbd", "mark", "q", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr" };
    private static readonly HashSet<string> Headings = new(StringComparer.Ordinal) { "h1", "h2", "h3", "h4", "h5", "h6", "legend" };

    /// <summary>The words for each kind, by language: the widget knows them too (see "parts" in ligata-ai.js).</summary>
    private static readonly Dictionary<string, (string Form, string Embed, string Open, string Close)> Languages = new()
    {
        ["en"] = ("Form", "Embedded", "“", "”"),
        ["de"] = ("Formular", "Eingebettet", "„", "“"),
        ["fr"] = ("Formulaire", "Intégré", "« ", " »"),
        ["it"] = ("Modulo", "Incorporato", "«", "»"),
    };

    private sealed record Element(string Name, bool Hidden, bool Frame, bool Content);

    private sealed class Reading(string kind, string? name, int depth)
    {
        public string Kind = kind;
        public string? Name = name;
        public readonly int Depth = depth;
        public int NameDepth = -1;
        public bool Search;
        public readonly StringBuilder Heading = new(), Piece = new();
        public readonly List<string> Pieces = [];

        public void Flush()
        {
            var piece = Clean(Piece.ToString(), name: false);
            Piece.Clear();
            if (piece.Length > 0) Pieces.Add(piece);
        }
    }

    /// <summary>The parts of a rendered page, in the order they appear.</summary>
    public static List<PagePart> Read(string html)
    {
        var parts = new List<PagePart>();
        html = Raw().Replace(html, " ");
        var stack = new List<Element>();
        Reading? part = null;
        var position = 0;

        void Finish()
        {
            part!.Flush();
            if (!part.Search && parts.Count < MaxParts)
            {
                var name = part.Name ?? "";
                var pieces = part.Pieces.Where(p => !Clean(p).Equals(name, StringComparison.OrdinalIgnoreCase)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                if (name.Length > 0 || pieces.Count > 0) parts.Add(new PagePart(part.Kind, name, pieces));
            }
            part = null;
        }

        foreach (Match tag in Tag().Matches(html))
        {
            var hidden = stack.Count > 0 && stack[^1].Hidden;
            if (part != null && !hidden && tag.Index > position)
            {
                var text = WebUtility.HtmlDecode(html[position..tag.Index]);
                part.Piece.Append(text);
                if (part.NameDepth >= 0) part.Heading.Append(text);
            }
            position = tag.Index + tag.Length;
            var name = tag.Groups[2].Value.ToLowerInvariant();
            if (part != null && !Inline.Contains(name)) part.Flush();
            else if (part != null && name == "br") part.Piece.Append(' ');

            if (tag.Groups[1].Value == "/")
            {
                var at = stack.FindLastIndex(e => e.Name == name);
                if (at < 0) continue;
                if (part != null && part.NameDepth >= at)
                {
                    var heading = Clean(part.Heading.ToString());
                    part.NameDepth = -1;
                    if (heading.Length > 0) part.Name = heading;
                }
                stack.RemoveRange(at, stack.Count - at);
                if (part != null && part.Depth >= stack.Count) Finish();
                continue;
            }

            var attributes = Attributes(tag.Groups[3].Value);
            string? Get(string key) => attributes.TryGetValue(key, out var value) ? value : null;
            var role = Get("role")?.Trim().ToLowerInvariant();
            var isHidden = hidden || attributes.ContainsKey("hidden") || Get("aria-hidden") == "true" || HiddenStyle().IsMatch(Get("style") ?? "")
                || role is "status" or "alert" or "log" || (name == "input" && Get("type")?.ToLowerInvariant() == "hidden")
                || (name == "option" && Get("value") == "");
            var frame = name is "header" or "footer" or "nav" || role is "banner" or "contentinfo" or "navigation" or "search";
            var element = new Element(name, isHidden, frame && !(name == "header" && stack.Any(e => e.Content)), name is "main" or "article" || role == "main");
            if (part != null && name == "input" && Get("type")?.ToLowerInvariant() == "search") part.Search = true;

            if (part == null && !isHidden)
            {
                // The header, menu and footer: a header inside the content (the page's own title block) is content, a menu never is.
                var chrome = stack.Any(e => e.Name is "nav" || e.Frame && !stack.Any(c => c.Content)) || role == "search";
                var marked = Get("data-ligata-ai-part");
                if (marked != null) part = new Reading("", Blank(Clean(marked)) ?? Blank(Clean(Get("aria-label") ?? "")), stack.Count);
                else if (name == "form" && !chrome) part = new Reading("form", Blank(Clean(Get("aria-label") ?? "")), stack.Count);
                else if (name == "iframe" && !chrome && Blank(Clean(Get("title") ?? "")) is { } title)
                {
                    if (parts.Count < MaxParts) parts.Add(new PagePart("embed", title, []));
                    if (!Void.Contains(name) && !tag.Value.EndsWith("/>")) stack.Add(element with { Hidden = true });
                    continue;
                }
            }
            else if (part != null && !isHidden && part.Name == null && part.NameDepth < 0 && Headings.Contains(name)) { part.NameDepth = stack.Count; part.Heading.Clear(); }

            if (!Void.Contains(name) && !tag.Value.EndsWith("/>")) stack.Add(element);
            else if (part != null && part.Depth >= stack.Count) Finish();
        }
        if (part != null) Finish();
        return parts;
    }

    /// <summary>
    /// The parts of a page as lines of its knowledge text and by name for the list of pages, in the page's language: the
    /// culture it is published in, else its html lang, else English.
    /// </summary>
    public static (string Text, string Names) Describe(string html, string culture)
    {
        var parts = Read(html);
        if (parts.Count == 0) return ("", "");
        var code = culture.Length >= 2 ? culture[..2].ToLowerInvariant() : HtmlLanguage().Match(html) is { Success: true } lang ? lang.Groups[1].Value.ToLowerInvariant() : "en";
        var words = Languages.TryGetValue(code, out var known) ? known : Languages["en"];
        string Title(PagePart part)
        {
            var named = part.Name.Length > 0 ? words.Open + part.Name + words.Close : "";
            var kind = part.Kind switch { "form" => words.Form, "embed" => words.Embed, _ => "" };
            return kind.Length > 0 && named.Length > 0 ? kind + " " + named : kind + named;
        }
        var text = new StringBuilder();
        foreach (var part in parts)
        {
            var line = Title(part) + (part.Text.Count > 0 ? ": " : "");
            foreach (var piece in part.Text)
            {
                if (line.Length + piece.Length + 3 > MaxLine) { line = line.TrimEnd(' ', '·') + " …"; break; }
                line += (line.EndsWith(": ") ? "" : " · ") + piece;
            }
            text.Append(line).Append('\n');
        }
        return (text.ToString().TrimEnd(), string.Join(", ", parts.Select(Title)));
    }

    private static Dictionary<string, string> Attributes(string source)
    {
        var attributes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (Match match in Attribute().Matches(source))
        {
            var value = match.Groups[2].Success ? match.Groups[2].Value : match.Groups[3].Success ? match.Groups[3].Value : match.Groups[4].Value;
            attributes.TryAdd(match.Groups[1].Value, WebUtility.HtmlDecode(value));
        }
        return attributes;
    }

    /// <summary>Spaces collapsed. A name leaves off the asterisk of a required field ("Name *" is named "Name"); the text keeps it, as the visitor sees which fields are required.</summary>
    private static string Clean(string text, bool name = true)
    {
        text = Spaces().Replace(text, " ").Trim();
        while (name && text.EndsWith('*')) text = text[..^1].TrimEnd();
        return text.Length > 160 ? text[..160].TrimEnd() + "…" : text;
    }

    private static string? Blank(string text) => text.Length == 0 ? null : text;

    // ---------- what was read, kept in memory ----------

    private static readonly ConcurrentDictionary<string, PagePartsRead> known = new(StringComparer.Ordinal);
    private static int version;

    /// <summary>Changes whenever what was read of a page changes: the knowledge snapshot is then rebuilt with it.</summary>
    public static int Version => Volatile.Read(ref version);

    /// <summary>What was read of a page (by <see cref="LivePage.Id"/>), or null when it has not been read yet.</summary>
    public static PagePartsRead? For(string page) => known.TryGetValue(page, out var read) ? read : null;

    public static void Set(string page, PagePartsRead read)
    {
        var before = For(page);
        known[page] = read;
        if (before == null || before.Text != read.Text || before.Names != read.Names) Interlocked.Increment(ref version);
    }

    /// <summary>Forgets pages that are no longer read (unpublished, left out).</summary>
    public static void Keep(IReadOnlySet<string> pages)
    {
        var changed = false;
        foreach (var page in known.Keys) if (!pages.Contains(page)) changed |= known.TryRemove(page, out var read) && read.Text.Length > 0;
        if (changed) Interlocked.Increment(ref version);
    }
}
