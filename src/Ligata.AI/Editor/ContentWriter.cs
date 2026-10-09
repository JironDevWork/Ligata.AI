using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Ligata.AI.Models;
using Umbraco.Cms.Core;
using Umbraco.Cms.Core.Models;
using Umbraco.Cms.Core.Services;
using Umbraco.Extensions;

namespace Ligata.AI.Editor;

/// <summary>Where a path points: a page property, or a field of a block inside it (any depth).</summary>
internal sealed record FieldRef(string Path, string Alias, string? Culture, string Editor, string Kind, JsonObject Config, string Label, bool Mandatory, string? Regex,
    List<BlockStep> Steps, object? Current, bool Shared, string LeafAlias);

/// <summary>One step into a block: its key, content or settings, the field alias and that field's language and editor.</summary>
internal sealed record BlockStep(Guid Block, bool Settings, string Editor, string Alias, string? Culture, string FieldEditor);

/// <summary>The values of a page while a change is planned: several changes to one property build on each other.</summary>
internal sealed class Working(IContent content)
{
    private readonly Dictionary<(string, string?), object?> values = [];
    public IContent Content { get; } = content;
    public object? Get(string alias, string? culture) => values.TryGetValue((alias.ToLowerInvariant(), culture), out var v) ? v : Content.GetValue(alias, culture);
    public void Set(string alias, string? culture, object? value) => values[(alias.ToLowerInvariant(), culture)] = value;
    public IEnumerable<(string Alias, string? Culture, object? Value)> Changed => values.Select(v => (v.Key.Item1, v.Key.Item2, v.Value));
}

public sealed partial class ContentTools
{
    // ---------- paths ----------
    /// <summary>
    /// Resolves "alias", "alias/3f2a91c0/field" or "alias/3f2a91c0:settings/field" (blocks nest further the same way) on the
    /// working values of a page in a language.
    /// </summary>
    internal async Task<(FieldRef? Field, string? Error)> ResolveAsync(Working working, string path, string? culture)
    {
        var segments = (path ?? "").Trim().Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (segments.Length == 0) return (null, "Empty path.");
        var type = schema.Type(working.Content.ContentType.Key)!;
        var property = ContentSchema.Property(type, segments[0]);
        if (property == null) return (null, $"The page has no field {segments[0]}. Use the paths from read_content.");
        var propertyCulture = property.VariesByCulture() ? culture : null;
        if (property.VariesByCulture() && culture == null) return (null, $"{property.Alias} varies by language: give a culture.");
        var (editor, config) = await schema.DataTypeAsync(property.DataTypeKey);
        editor = editor.Length > 0 ? editor : property.PropertyEditorAlias;
        var shared = working.Content.ContentType.VariesByCulture() && !property.VariesByCulture();
        object? current = working.Get(property.Alias, propertyCulture);
        var steps = new List<BlockStep>();
        string label = property.Name ?? property.Alias, leafAlias = property.Alias;
        bool mandatory = property.Mandatory; string? regex = property.ValidationRegExp;
        var i = 1;
        while (i < segments.Length)
        {
            if (FieldKinds.Of(editor) != FieldKinds.Blocks) return (null, $"{string.Join('/', segments[..i])} is not a block field, so it has no {segments[i]}.");
            if (i + 1 >= segments.Length) return (null, $"Name a field of block {segments[i]}, e.g. {string.Join('/', segments[..(i + 1)])}/<field>.");
            var blocks = BlockValue.Parse(current, editor);
            var reference = segments[i];
            var settings = reference.EndsWith(":settings", StringComparison.OrdinalIgnoreCase);
            if (settings) reference = reference[..^9];
            var (block, error) = FindBlock(blocks, reference);
            if (error != null) return (null, error);
            var data = settings ? blocks!.SettingsData(BlockValue.SettingsKey(blocks.Items().First(x => BlockValue.Key(x.Item) == block).Item) ?? Guid.Empty) : blocks!.Data(block);
            if (data == null) return (null, settings ? $"Block {reference} has no settings." : $"Block {reference} has no content.");
            var element = Guid.TryParse(data["contentTypeKey"]?.ToString(), out var elementKey) ? schema.Type(elementKey) : null;
            if (element == null) return (null, $"The type of block {reference} is unknown.");
            var field = ContentSchema.Property(element, segments[i + 1]);
            if (field == null) return (null, $"Blocks of type {element.Alias} have no field {segments[i + 1]}. Fields: {string.Join(", ", ContentSchema.Properties(element).Select(p => p.Alias))}.");
            var fieldCulture = field.VariesByCulture() ? culture : null;
            var (fieldEditor, fieldConfig) = await schema.DataTypeAsync(field.DataTypeKey);
            fieldEditor = fieldEditor.Length > 0 ? fieldEditor : field.PropertyEditorAlias;
            steps.Add(new BlockStep(block, settings, editor, field.Alias, fieldCulture, fieldEditor));
            current = BlockValue.Entry(data, field.Alias, fieldCulture)?["value"];
            shared = working.Content.ContentType.VariesByCulture() && fieldCulture == null;
            editor = fieldEditor; config = fieldConfig; label = $"{label} › {element.Name} › {field.Name}"; leafAlias = field.Alias;
            mandatory = field.Mandatory; regex = field.ValidationRegExp;
            i += 2;
        }
        return (new FieldRef(string.Join('/', segments), property.Alias, propertyCulture, editor, FieldKinds.Of(editor), config, label, mandatory, regex, steps, current, shared, leafAlias), null);
    }

    /// <summary>A block by the start of its key (8 hex digits are shown; more are accepted).</summary>
    private static (Guid Block, string? Error) FindBlock(BlockValue? blocks, string reference)
    {
        var wanted = reference.Replace("-", "").ToLowerInvariant();
        if (blocks == null || wanted.Length < 4) return (Guid.Empty, $"No block {reference}.");
        var matches = blocks.Items().Select(x => BlockValue.Key(x.Item)).Where(k => k.ToString("N").StartsWith(wanted)).Distinct().ToList();
        return matches.Count switch
        {
            0 => (Guid.Empty, $"No block {reference} in this field (read the page again: blocks may have changed)."),
            1 => (matches[0], null),
            _ => (Guid.Empty, $"Several blocks start with {reference}; use more of the key."),
        };
    }

    /// <summary>Writes a new value at a resolved path into the working values (rebuilding the blocks around it).</summary>
    internal void Write(Working working, FieldRef field, object? value)
    {
        if (field.Steps.Count == 0) { working.Set(field.Alias, field.Culture, value); return; }
        var top = working.Get(field.Alias, field.Culture);
        working.Set(field.Alias, field.Culture, SetIn(top, field.Steps, 0, value, field.Kind));
    }

    private static object? SetIn(object? container, List<BlockStep> steps, int index, object? value, string leafKind)
    {
        var step = steps[index];
        var asString = container is null or string || container is JsonValue;
        var blocks = BlockValue.Parse(container, step.Editor) ?? BlockValue.Empty(step.Editor);
        var data = step.Settings
            ? blocks.SettingsData(BlockValue.SettingsKey(blocks.Items().First(x => BlockValue.Key(x.Item) == step.Block).Item) ?? Guid.Empty)
            : blocks.Data(step.Block);
        if (data == null) return container;
        var existing = BlockValue.Entry(data, step.Alias, step.Culture)?["value"];
        JsonNode? node;
        if (index == steps.Count - 1) node = EntryNode(value, leafKind, existing);
        else
        {
            var inner = SetIn(existing is JsonValue v && v.TryGetValue<string>(out var s) ? s : existing, steps, index + 1, value, leafKind);
            node = inner is JsonNode n ? n : inner == null ? null : JsonValue.Create(ContentFields.String(inner));
        }
        BlockValue.SetEntry(data, step.Alias, step.FieldEditor, step.Culture, node);
        if (!step.Settings) blocks.ExposeIn(step.Block, step.Culture);
        return asString ? blocks.Root.ToJsonString() : blocks.Root;
    }

    /// <summary>A value as a block keeps it: JSON values in the form the block already uses (a string or an object), numbers as numbers.</summary>
    private static JsonNode? EntryNode(object? value, string kind, JsonNode? existing)
    {
        if (value == null) return null;
        if (FieldKinds.Json(kind) || kind is FieldKinds.Page or FieldKinds.Pages)
        {
            var text = ContentFields.String(value) ?? "";
            if (existing is JsonObject or JsonArray && ContentFields.Node(text) is { } parsed) return parsed;
            return JsonValue.Create(text);
        }
        return value switch
        {
            int i => existing is JsonValue e && e.TryGetValue<string>(out _) ? JsonValue.Create(i.ToString(CultureInfo.InvariantCulture)) : JsonValue.Create(i),
            decimal d => existing is JsonValue e2 && e2.TryGetValue<string>(out _) ? JsonValue.Create(d.ToString(CultureInfo.InvariantCulture)) : JsonValue.Create(d),
            DateTime t => JsonValue.Create(t.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture)),
            _ => JsonValue.Create(ContentFields.String(value)),
        };
    }

    // ---------- values ----------
    /// <summary>The model's value converted to what Umbraco stores for this field, or why it cannot be.</summary>
    internal async Task<(object? Value, string? Error)> ConvertAsync(ToolContext context, FieldRef field, JsonElement value)
    {
        if (context.Settings.Scope.ProtectedFields.Contains(field.LeafAlias, StringComparer.OrdinalIgnoreCase)) return (null, $"{field.Path} is protected: the assistant may not change it.");
        var empty = value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined || (value.ValueKind == JsonValueKind.String && value.GetString()!.Trim().Length == 0) || (value.ValueKind == JsonValueKind.Array && value.GetArrayLength() == 0);
        string? Str() => value.ValueKind == JsonValueKind.String ? value.GetString() : value.ValueKind is JsonValueKind.Number or JsonValueKind.True or JsonValueKind.False ? value.GetRawText() : null;
        switch (field.Kind)
        {
            case FieldKinds.Text or FieldKinds.TextArea or FieldKinds.Markdown or FieldKinds.Email:
            {
                if (empty) return ("", null);
                var text = Str();
                if (text == null) return (null, $"{field.Path} takes text.");
                if (field.Kind == FieldKinds.Text) text = text.Replace("\r", "").Replace("\n", " ");
                if (ContentSchema.Number(field.Config, "maxChars") is { } max && text.Length > max) return (null, $"{field.Path} takes at most {max} characters ({text.Length} given). Shorten it.");
                if (field.Kind == FieldKinds.Email && !AssistantValidation.Email(text)) return (null, $"{field.Path} takes an email address.");
                if (!string.IsNullOrEmpty(field.Regex) && !Regex.IsMatch(text, field.Regex, RegexOptions.None, TimeSpan.FromSeconds(1))) return (null, $"{field.Path} must match {field.Regex}.");
                return (text, null);
            }
            case FieldKinds.RichText:
            {
                if (empty) return (field.Steps.Count == 0 ? null : "", null);
                var html = Str();
                if (html == null) return (null, $"{field.Path} takes HTML text.");
                var markup = ContentFields.SanitizeHtml(html);
                // Keep the blocks inside the rich text (and its form: {"markup","blocks"} since Umbraco 14).
                var existing = ContentFields.Node(field.Current) as JsonObject;
                var blocks = existing?["blocks"]?.DeepClone() ?? new JsonObject { ["layout"] = new JsonObject(), ["contentData"] = new JsonArray(), ["settingsData"] = new JsonArray(), ["expose"] = new JsonArray() };
                return (new JsonObject { ["markup"] = markup, ["blocks"] = blocks }.ToJsonString(), null);
            }
            case FieldKinds.Integer:
                if (empty) return (null, null);
                return value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var whole) || int.TryParse(Str(), NumberStyles.Integer, CultureInfo.InvariantCulture, out whole) ? (whole, null) : (null, $"{field.Path} takes a whole number.");
            case FieldKinds.Decimal:
                if (empty) return (null, null);
                return value.ValueKind == JsonValueKind.Number && value.TryGetDecimal(out var number) || decimal.TryParse(Str(), NumberStyles.Number, CultureInfo.InvariantCulture, out number) ? (number, null) : (null, $"{field.Path} takes a number.");
            case FieldKinds.Boolean:
                return value.ValueKind switch
                {
                    JsonValueKind.True => (1, null),
                    JsonValueKind.False or JsonValueKind.Null => (0, null),
                    _ => Str() is "1" or "true" or "True" ? (1, null) : Str() is "0" or "false" or "False" ? (0, null) : (null, $"{field.Path} takes true or false."),
                };
            case FieldKinds.Choice or FieldKinds.Radio or FieldKinds.Checkboxes:
            {
                var allowed = ContentSchema.Items(field.Config);
                var chosen = value.ValueKind == JsonValueKind.Array ? value.EnumerateArray().Select(v => v.ValueKind == JsonValueKind.String ? v.GetString()! : v.GetRawText()).ToList() : empty ? [] : [Str() ?? ""];
                var unknown = chosen.Where(c => !allowed.Contains(c)).ToList();
                if (unknown.Count > 0) return (null, $"{field.Path} accepts only: {string.Join(" | ", allowed)} (not {string.Join(", ", unknown)}).");
                if (field.Kind == FieldKinds.Radio) return chosen.Count <= 1 ? (chosen.FirstOrDefault() ?? "", null) : (null, $"{field.Path} takes one value.");
                if (field.Kind == FieldKinds.Choice && !ContentSchema.Flag(field.Config, "multiple") && chosen.Count > 1) return (null, $"{field.Path} takes one value.");
                return (JsonSerializer.Serialize(chosen), null);
            }
            case FieldKinds.Tags:
            {
                var tags = value.ValueKind == JsonValueKind.Array ? value.EnumerateArray().Select(v => v.ToString().Trim()).Where(t => t.Length > 0).Distinct().ToList() : (Str() ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct().ToList();
                var csv = ContentSchema.Get(field.Config, "storageType")?.ToString() is "Csv" or "csv";
                return (csv ? string.Join(",", tags) : JsonSerializer.Serialize(tags), null);
            }
            case FieldKinds.Page or FieldKinds.Pages:
            {
                if (empty) return ("", null);
                var keys = new List<Guid>();
                foreach (var item in value.ValueKind == JsonValueKind.Array ? value.EnumerateArray().ToList() : [value])
                {
                    var reference = item.ValueKind == JsonValueKind.Object ? (item.TryGetProperty("key", out var k) ? k.GetString() : item.TryGetProperty("page", out var p) ? p.GetString() : null) : item.ValueKind == JsonValueKind.String ? item.GetString() : null;
                    var target = Find(reference);
                    if (target == null || target.Trashed) return (null, $"{field.Path}: no page with key {reference}. Use keys from search_content.");
                    keys.Add(target.Key);
                }
                if (field.Kind == FieldKinds.Page && keys.Count > 1) return (null, $"{field.Path} takes one page.");
                if (ContentSchema.Number(field.Config, "maxNumber") is { } max && keys.Count > max) return (null, $"{field.Path} takes at most {max} pages.");
                return (string.Join(",", keys.Select(ContentFields.DocumentUdi)), null);
            }
            case FieldKinds.Media:
            {
                if (empty) return ("[]", null);
                var picked = new List<JsonObject>();
                foreach (var item in value.ValueKind == JsonValueKind.Array ? value.EnumerateArray().ToList() : [value])
                {
                    var reference = item.ValueKind == JsonValueKind.Object ? (item.TryGetProperty("key", out var k) ? k.GetString() : item.TryGetProperty("mediaKey", out var mk) ? mk.GetString() : null) : item.GetString();
                    var found = ContentFields.Udi(reference) is { } key ? media.GetById(key) : null;
                    if (found == null || found.Trashed) return (null, $"{field.Path}: no media with key {reference}. Find media with search_media.");
                    picked.Add(new JsonObject { ["key"] = Guid.NewGuid().ToString(), ["mediaKey"] = found.Key.ToString(), ["crops"] = new JsonArray(), ["focalPoint"] = null });
                }
                if (!ContentSchema.Flag(field.Config, "multiple") && picked.Count > 1) return (null, $"{field.Path} takes one media item.");
                return (new JsonArray([.. picked]).ToJsonString(), null);
            }
            case FieldKinds.Links:
            {
                if (empty) return ("[]", null);
                var links = new JsonArray();
                foreach (var item in value.ValueKind == JsonValueKind.Array ? value.EnumerateArray().ToList() : [value])
                {
                    if (item.ValueKind != JsonValueKind.Object) return (null, $"{field.Path} takes links like [{{\"name\": \"Contact\", \"page\": \"<page key>\"}}] or [{{\"name\": \"…\", \"url\": \"https://…\"}}].");
                    string? Prop(string name) => item.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;
                    var name = Prop("name") ?? "";
                    string? udi = null, url = null;
                    if ((Prop("key") ?? Prop("page")) is { } reference && Find(reference) is { Trashed: false } target) udi = ContentFields.DocumentUdi(target.Key);
                    else if (Prop("media") is { } m && ContentFields.Udi(m) is { } mediaKey && media.GetById(mediaKey) is { Trashed: false } file) udi = ContentFields.MediaUdi(file.Key);
                    else if (Prop("url") is { } address && ContentFields.SafeHref(address)) url = address;
                    else return (null, $"{field.Path}: each link needs a page key (\"page\") or a safe url (https://, mailto:, tel: or /path).");
                    links.Add(new JsonObject { ["name"] = name, ["url"] = url, ["udi"] = udi, ["target"] = item.TryGetProperty("newWindow", out var nw) && nw.ValueKind == JsonValueKind.True ? "_blank" : "", ["queryString"] = Prop("query") ?? "" });
                }
                if (ContentSchema.Number(field.Config, "maxNumber") is { } max && links.Count > max) return (null, $"{field.Path} takes at most {max} links.");
                return (links.ToJsonString(), null);
            }
            case FieldKinds.Date:
                if (empty) return (null, null);
                return DateTime.TryParse(Str(), CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) ? (date, null) : (null, $"{field.Path} takes a date like 2026-10-31 or 2026-10-31 14:00.");
            case FieldKinds.Blocks:
                return (null, $"{field.Path} is a block field: add, remove or move its blocks with edit_blocks, and change their fields with paths like {field.Path}/<block>/<field>.");
            default:
                await Task.CompletedTask;
                return (null, $"{field.Path} ({field.Editor}) cannot be changed by the assistant. The editor can change it in the backoffice.");
        }
    }

    /// <summary>A stored value as readable text for before/after cards (rich text without tags, pickers by name).</summary>
    internal string Readable(string kind, string editor, object? raw, JsonObject config)
    {
        if (raw == null || ContentFields.String(raw) is null or "" or "[]") return "";
        if (kind == FieldKinds.RichText) return ContentFields.Plain(ContentFields.RichMarkup(raw));
        var shown = Display(kind, editor, raw, config, 4000);
        return kind is FieldKinds.Text or FieldKinds.TextArea or FieldKinds.Markdown or FieldKinds.Email or FieldKinds.Radio or FieldKinds.Date && shown.StartsWith('"')
            ? JsonSerializer.Deserialize<string>(shown.Split(" … (")[0]) ?? shown : shown;
    }

    internal static string? Stored(object? raw) => raw switch
    {
        null => null,
        DateTime t => t.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
        _ => ContentFields.String(raw),
    };

    /// <summary>Two stored values mean the same (JSON compared without formatting).</summary>
    internal static bool Same(string? a, string? b)
    {
        if ((a ?? "") == (b ?? "")) return true;
        var x = ContentFields.Node(a); var y = ContentFields.Node(b);
        return x != null && y != null && JsonNode.DeepEquals(x, y);
    }
}
