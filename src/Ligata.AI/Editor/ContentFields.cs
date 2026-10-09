using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Umbraco.Cms.Core.Models;
using Umbraco.Cms.Core.Services;
using Umbraco.Extensions;

namespace Ligata.AI.Editor;

/// <summary>What the assistant can do with a property editor's value: how it is read, written and described.</summary>
public static class FieldKinds
{
    public const string Text = "text", TextArea = "textarea", Markdown = "markdown", Email = "email", RichText = "richtext", Integer = "integer", Decimal = "decimal",
        Boolean = "boolean", Choice = "choice", Radio = "radio", Checkboxes = "checkboxes", Tags = "tags", Page = "page", Pages = "pages", Media = "media",
        Links = "links", Blocks = "blocks", Date = "date", Other = "other";

    public static string Of(string editor) => editor switch
    {
        "Umbraco.TextBox" => Text,
        "Umbraco.TextArea" => TextArea,
        "Umbraco.MarkdownEditor" => Markdown,
        "Umbraco.EmailAddress" => Email,
        "Umbraco.RichText" or "Umbraco.TinyMCE" => RichText,
        "Umbraco.Integer" => Integer,
        "Umbraco.Decimal" => Decimal,
        "Umbraco.TrueFalse" => Boolean,
        "Umbraco.DropDown.Flexible" => Choice,
        "Umbraco.RadioButtonList" => Radio,
        "Umbraco.CheckBoxList" => Checkboxes,
        "Umbraco.Tags" => Tags,
        "Umbraco.ContentPicker" => Page,
        "Umbraco.MultiNodeTreePicker" => Pages,
        "Umbraco.MediaPicker3" => Media,
        "Umbraco.MultiUrlPicker" => Links,
        "Umbraco.BlockList" or "Umbraco.BlockGrid" => Blocks,
        "Umbraco.DateTime" => Date,
        _ => Other,
    };

    /// <summary>Values stored as JSON (inside blocks: a string or an object, as the block already has them).</summary>
    public static bool Json(string kind) => kind is RichText or Choice or Checkboxes or Media or Links or Blocks || kind == Tags;
}

/// <summary>Content types and data type configurations, looked up once per request.</summary>
public sealed class ContentSchema(IContentTypeService contentTypes, IDataTypeService dataTypes)
{
    private readonly Dictionary<Guid, IContentType?> byKey = [];
    private readonly Dictionary<string, IContentType?> byAlias = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<Guid, (string Editor, JsonObject Config)> configs = [];

    public IContentType? Type(Guid key)
    {
        if (!byKey.TryGetValue(key, out var type)) byKey[key] = type = contentTypes.Get(key);
        return type;
    }

    public IContentType? Type(string alias)
    {
        if (!byAlias.TryGetValue(alias, out var type)) byAlias[alias] = type = contentTypes.Get(alias);
        return type;
    }

    public IEnumerable<IContentType> All() => contentTypes.GetAll();

    /// <summary>The data type's editor and configuration as JSON (camelCase keys as stored).</summary>
    public async Task<(string Editor, JsonObject Config)> DataTypeAsync(Guid key)
    {
        if (configs.TryGetValue(key, out var known)) return known;
        var dataType = await dataTypes.GetAsync(key);
        JsonObject config;
        try { config = JsonSerializer.SerializeToNode(dataType?.ConfigurationData ?? new Dictionary<string, object>()) as JsonObject ?? []; }
        catch (Exception) { config = []; }
        return configs[key] = (dataType?.EditorAlias ?? "", config);
    }

    /// <summary>The type's properties (with compositions) in the order of their tabs and groups.</summary>
    public static List<IPropertyType> Properties(IContentType type)
    {
        var grouped = type.CompositionPropertyGroups.OrderBy(g => g.Type).ThenBy(g => g.SortOrder).SelectMany(g => g.PropertyTypes?.OrderBy(p => p.SortOrder) ?? Enumerable.Empty<IPropertyType>()).ToList();
        var seen = grouped.Select(p => p.Alias).ToHashSet(StringComparer.OrdinalIgnoreCase);
        return grouped.Concat(type.CompositionPropertyTypes.Where(p => !seen.Contains(p.Alias)).OrderBy(p => p.SortOrder)).ToList();
    }

    public static IPropertyType? Property(IContentType type, string alias) => type.CompositionPropertyTypes.FirstOrDefault(p => string.Equals(p.Alias, alias, StringComparison.OrdinalIgnoreCase));

    public static JsonNode? Get(JsonObject config, string key) => config.FirstOrDefault(p => string.Equals(p.Key, key, StringComparison.OrdinalIgnoreCase)).Value;
    public static int? Number(JsonObject config, string key) => Get(config, key) is JsonValue v && v.TryGetValue<int>(out var n) && n > 0 ? n : Get(config, key) is JsonValue s && s.TryGetValue<string>(out var text) && int.TryParse(text, out var parsed) && parsed > 0 ? parsed : null;
    public static bool Flag(JsonObject config, string key) => Get(config, key) is JsonValue v && ((v.TryGetValue<bool>(out var b) && b) || (v.TryGetValue<string>(out var s) && s is "1" or "true" or "True") || (v.TryGetValue<int>(out var i) && i == 1));

    /// <summary>The allowed values of a dropdown, radio or checkbox list (strings, or older {id, value} objects).</summary>
    public static List<string> Items(JsonObject config) => (Get(config, "items") as JsonArray ?? [])
        .Select(i => i is JsonObject o ? o["value"]?.ToString() : i?.ToString()).Where(v => !string.IsNullOrEmpty(v)).Select(v => v!).ToList();

    /// <summary>Block types a block field accepts: content element type key, settings element type key, label, root/area rules.</summary>
    public static List<(Guid Content, Guid? Settings, bool AtRoot)> Blocks(JsonObject config) => (Get(config, "blocks") as JsonArray ?? [])
        .OfType<JsonObject>().Select(b => (Guid.TryParse(Get(b, "contentElementTypeKey")?.ToString(), out var c) ? c : Guid.Empty,
            Guid.TryParse(Get(b, "settingsElementTypeKey")?.ToString(), out var s) ? s : (Guid?)null,
            Get(b, "allowAtRoot") is not JsonValue root || !root.TryGetValue<bool>(out var r) || r))
        .Where(b => b.Item1 != Guid.Empty).ToList();
}

/// <summary>
/// A Block List or Block Grid value as stored (Umbraco 15+): layout, contentData, settingsData and expose. Edited in place
/// and written back in the form it came in (a JSON string or an object).
/// </summary>
public sealed class BlockValue
{
    public JsonObject Root { get; }
    public string Editor { get; }
    public bool Grid => Editor == "Umbraco.BlockGrid";

    private BlockValue(JsonObject root, string editor) { Root = root; Editor = editor; }

    public static BlockValue Empty(string editor) => new(new JsonObject { ["layout"] = new JsonObject { [editor] = new JsonArray() }, ["contentData"] = new JsonArray(), ["settingsData"] = new JsonArray(), ["expose"] = new JsonArray() }, editor);

    public static BlockValue? Parse(object? raw, string editor)
    {
        var node = ContentFields.Node(raw);
        if (node is not JsonObject root) return null;
        foreach (var key in new[] { "contentData", "settingsData", "expose" }) if (root[key] is not JsonArray) root[key] = new JsonArray();
        if (root["layout"] is not JsonObject layout) root["layout"] = layout = new JsonObject();
        // The layout is keyed by the editor; an older value may carry another alias for the same editor.
        if (layout[editor] is not JsonArray) layout[editor] = layout.Select(p => p.Value).OfType<JsonArray>().FirstOrDefault()?.DeepClone() as JsonArray ?? new JsonArray();
        return new(root, editor);
    }

    public JsonArray Layout => (JsonArray)Root["layout"]![Editor]!;
    public JsonArray Content => (JsonArray)Root["contentData"]!;
    public JsonArray Settings => (JsonArray)Root["settingsData"]!;
    public JsonArray Expose => (JsonArray)Root["expose"]!;

    public static Guid Key(JsonNode? node) => Guid.TryParse((node?["contentKey"] ?? node?["key"])?.ToString(), out var key) ? key : Guid.TryParse(node?["contentUdi"]?.ToString()?.Split('/').LastOrDefault(), out var udi) ? udi : Guid.Empty;
    public static Guid? SettingsKey(JsonNode? node) => Guid.TryParse(node?["settingsKey"]?.ToString(), out var key) ? key : null;

    public JsonObject? Data(Guid key) => Content.OfType<JsonObject>().FirstOrDefault(d => Key(d) == key);
    public JsonObject? SettingsData(Guid key) => Settings.OfType<JsonObject>().FirstOrDefault(d => Key(d) == key);

    /// <summary>The layout items in order, with the list each sits in (the root list or an area of a grid block).</summary>
    public List<(JsonObject Item, JsonArray List, int Depth, Guid? Parent, string? Area)> Items()
    {
        var items = new List<(JsonObject, JsonArray, int, Guid?, string?)>();
        void Walk(JsonArray list, int depth, Guid? parent, string? area)
        {
            foreach (var item in list.OfType<JsonObject>().ToList())
            {
                items.Add((item, list, depth, parent, area));
                if (item["areas"] is JsonArray areas)
                    foreach (var a in areas.OfType<JsonObject>())
                        if (a["items"] is JsonArray inner) Walk(inner, depth + 1, Key(item), a["key"]?.ToString());
            }
        }
        Walk(Layout, 0, null, null);
        return items;
    }

    /// <summary>A value of a block element (alias, culture), or null.</summary>
    public static JsonObject? Entry(JsonObject data, string alias, string? culture) => (data["values"] as JsonArray ?? []).OfType<JsonObject>()
        .FirstOrDefault(v => string.Equals(v["alias"]?.ToString(), alias, StringComparison.OrdinalIgnoreCase) && (v["culture"]?.ToString() ?? null) == culture && v["segment"] == null);

    public static void SetEntry(JsonObject data, string alias, string editor, string? culture, JsonNode? value)
    {
        if (data["values"] is not JsonArray values) data["values"] = values = new JsonArray();
        var entry = Entry(data, alias, culture);
        if (entry == null) values.Add(entry = new JsonObject { ["editorAlias"] = editor, ["culture"] = culture, ["segment"] = null, ["alias"] = alias, ["value"] = null });
        entry["value"] = value;
    }

    /// <summary>The block shows in this language (block-level variance): Umbraco lists every exposed variant.</summary>
    public void ExposeIn(Guid key, string? culture)
    {
        if (Expose.OfType<JsonObject>().Any(e => Key(e) == key && e["culture"]?.ToString() == culture)) return;
        Expose.Add(new JsonObject { ["contentKey"] = key.ToString(), ["culture"] = culture, ["segment"] = null });
    }

    public bool Exposed(Guid key, string? culture) => Expose.Count == 0 || Expose.OfType<JsonObject>().Any(e => Key(e) == key && (e["culture"] == null || e["culture"]?.ToString() == culture));
}

/// <summary>Reads and converts field values: stored value ↔ what the model reads and writes.</summary>
public static partial class ContentFields
{
    /// <summary>Longest value shown in a page overview; longer ones are shortened (read them with fields=[path]).</summary>
    public const int ValuePreview = 1200;

    /// <summary>JSON for the model and for people: umlauts and quotes as they are, not 00F6.</summary>
    public static readonly JsonSerializerOptions Readable = new(JsonSerializerDefaults.Web) { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    public static JsonNode? Node(object? raw)
    {
        switch (raw)
        {
            case null: return null;
            case JsonNode node: return node.DeepClone();
            case JsonElement element: return JsonNode.Parse(element.GetRawText());
            case string text:
                var trimmed = text.TrimStart();
                if (trimmed.StartsWith('{') || trimmed.StartsWith('['))
                    try { return JsonNode.Parse(text); } catch (JsonException) { return null; }
                return null;
            default:
                try { return JsonSerializer.SerializeToNode(raw); } catch (Exception) { return null; }
        }
    }

    public static string? String(object? raw) => raw switch
    {
        null => null,
        string s => s,
        JsonValue v when v.TryGetValue<string>(out var s) => s,
        JsonNode n => n.ToJsonString(),
        JsonElement { ValueKind: JsonValueKind.String } e => e.GetString(),
        JsonElement e => e.GetRawText(),
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => raw.ToString(),
    };

    /// <summary>The markup of a rich text value: stored as {"markup","blocks"} since Umbraco 14, as plain HTML before.</summary>
    public static string RichMarkup(object? raw)
    {
        var node = Node(raw);
        if (node is JsonObject o) return o["markup"]?.ToString() ?? "";
        return String(raw) ?? "";
    }

    /// <summary>Rich text as plain text (for before/after cards and summaries).</summary>
    public static string Plain(string html)
    {
        var text = BreakTags().Replace(html, "\n");
        text = Tags().Replace(text, "");
        text = System.Net.WebUtility.HtmlDecode(text);
        return BlankLines().Replace(text.Replace("\r", ""), "\n\n").Trim();
    }

    [GeneratedRegex(@"<\s*(br|/p|/h[1-6]|/li|/div|/blockquote|/tr)\b[^>]*>", RegexOptions.IgnoreCase)] private static partial Regex BreakTags();
    [GeneratedRegex(@"<[^>]+>")] private static partial Regex Tags();
    [GeneratedRegex(@"\n\s*\n+")] private static partial Regex BlankLines();

    public static string Quote(string? text, int max = ValuePreview)
    {
        if (string.IsNullOrEmpty(text)) return "(empty)";
        var shown = text.Length > max ? text[..max] : text;
        var quoted = JsonSerializer.Serialize(shown, Readable);
        return text.Length > max ? quoted + $" … ({text.Length - max:N0} more characters: read this field in full with fields=[path])" : quoted;
    }

    /// <summary>"3f2a91c0": the first 8 hex digits of a block key (enough within one page; more are accepted).</summary>
    public static string ShortId(Guid key) => key.ToString("N")[..8];

    public static Guid? Udi(string? value) =>
        value != null && value.StartsWith("umb://", StringComparison.OrdinalIgnoreCase) && Guid.TryParseExact(value.Split('/').Last(), "N", out var key) ? key :
        Guid.TryParse(value, out var plain) ? plain : null;

    public static string DocumentUdi(Guid key) => "umb://document/" + key.ToString("N");
    public static string MediaUdi(Guid key) => "umb://media/" + key.ToString("N");

    // ---------- rich text: only safe markup ----------
    private static readonly HashSet<string> AllowedTags = new(StringComparer.OrdinalIgnoreCase)
    {
        "p", "br", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "s", "sub", "sup", "a", "ul", "ol", "li", "blockquote", "code", "pre", "hr",
        "table", "thead", "tbody", "tr", "th", "td", "img", "span", "umb-rte-block", "umb-rte-block-inline",
    };
    private static readonly Dictionary<string, string[]> AllowedAttributes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["a"] = ["href", "title", "target", "rel", "type", "data-anchor"],
        ["img"] = ["src", "alt", "width", "height", "data-udi", "data-caption"],
        ["umb-rte-block"] = ["data-content-key"], ["umb-rte-block-inline"] = ["data-content-key"],
        ["td"] = ["colspan", "rowspan"], ["th"] = ["colspan", "rowspan", "scope"],
    };
    [GeneratedRegex(@"<(/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>|<!--.*?-->", RegexOptions.Singleline)] private static partial Regex Tag();
    [GeneratedRegex(@"([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(""[^""]*""|'[^']*'|[^\s""'>]+)")] private static partial Regex Attribute();
    [GeneratedRegex(@"<(script|style|iframe|object|embed|noscript|template)\b.*?</\1\s*>", RegexOptions.IgnoreCase | RegexOptions.Singleline)] private static partial Regex Dangerous();
    [GeneratedRegex(@"<\s*/?\s*(p|br|h[1-6]|ul|ol|li|strong|b|em|i|u|s|a|blockquote|table|thead|tbody|tr|th|td|img|span|div|code|pre|hr|sub|sup|script|style|iframe|umb-rte-block|umb-rte-block-inline)\b", RegexOptions.IgnoreCase)] private static partial Regex KnownTag();

    public static bool SafeHref(string href)
    {
        var h = href.Trim();
        if (h.StartsWith("/{localLink:", StringComparison.OrdinalIgnoreCase) || h.StartsWith('#') || h.StartsWith('?')) return true;
        if (h.StartsWith('/') && !h.StartsWith("//")) return true;
        return Uri.TryCreate(h, UriKind.Absolute, out var uri) && uri.Scheme is "https" or "http" or "mailto" or "tel";
    }

    /// <summary>
    /// Keeps the formatting an editor could make in the rich text editor and nothing else: no scripts, styles, event handlers or
    /// javascript: links, whatever the model writes (page text it read could have told it to).
    /// </summary>
    public static string SanitizeHtml(string html)
    {
        // Text without any markup the editor knows is plain text: paragraphs, and a stray "<" stays a character.
        if (!KnownTag().IsMatch(html)) return string.Join("", html.Replace("\r", "").Split("\n\n", StringSplitOptions.RemoveEmptyEntries).Select(p => "<p>" + System.Net.WebUtility.HtmlEncode(p.Trim()).Replace("\n", "<br>") + "</p>"));
        html = Dangerous().Replace(html, "");
        var result = new StringBuilder();
        var last = 0;
        foreach (Match m in Tag().Matches(html))
        {
            result.Append(Text(html[last..m.Index]));
            last = m.Index + m.Length;
            if (m.Value.StartsWith("<!--")) continue;
            var name = m.Groups[2].Value.ToLowerInvariant();
            if (!AllowedTags.Contains(name)) continue;
            if (m.Groups[1].Value == "/") { if (name is not ("br" or "hr" or "img")) result.Append($"</{name}>"); continue; }
            result.Append('<').Append(name);
            if (AllowedAttributes.TryGetValue(name, out var allowed))
                foreach (Match a in Attribute().Matches(m.Groups[3].Value))
                {
                    var attribute = a.Groups[1].Value.ToLowerInvariant();
                    if (!allowed.Contains(attribute)) continue;
                    var value = System.Net.WebUtility.HtmlDecode(a.Groups[2].Value.Trim('"', '\''));
                    if (attribute is "href" or "src" && !SafeHref(value)) continue;
                    if (attribute == "target" && value is not ("_blank" or "_self")) continue;
                    result.Append(' ').Append(attribute).Append("=\"").Append(System.Net.WebUtility.HtmlEncode(value)).Append('"');
                }
            result.Append('>');
        }
        result.Append(Text(html[last..]));
        return result.ToString().Trim();

        // Text between tags: a stray "<" or ">" is encoded, entities stay.
        static string Text(string text) => text.Replace("<", "&lt;").Replace(">", "&gt;");
    }
}
