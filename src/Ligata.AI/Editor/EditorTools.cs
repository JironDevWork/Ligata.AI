using System.Text.Json;

namespace Ligata.AI.Editor;

/// <summary>A tool the model may call. Action is null for tools that only read (or open a page); others are changes of that kind.</summary>
public sealed record EditorTool(string Name, string? Action, string Description, string Schema)
{
    public JsonElement Parameters { get; } = JsonDocument.Parse(Schema).RootElement.Clone();
}

/// <summary>The content tools as the model sees them, and their dispatch.</summary>
public sealed class EditorTools(ContentTools content, EditorMedia media)
{
    public const string Search = "search_content", Children = "list_children", Read = "read_content", Describe = "describe_type", Media = "search_media", Open = "open_page",
        Update = "update_content", Blocks = "edit_blocks", Create = "create_content", Publish = "publish_content", Unpublish = "unpublish_content", Move = "move_content",
        Delete = "delete_content", Upload = "upload_media";

    public static readonly IReadOnlyList<EditorTool> All =
    [
        new(Search, null, "Find pages by words in their name or content, in every language, published or not. Returns the best matches with key, type, location, status and a snippet. Use it when the editor names a page, a topic or a phrase.",
            """{"type":"object","properties":{"query":{"type":"string","description":"Words to look for, e.g. a page name or a phrase from its text."},"culture":{"type":"string","description":"Language for names and snippets (ISO code), default: the open page's language."},"type":{"type":"string","description":"Only pages of this document type alias."},"limit":{"type":"integer","description":"1 to 25, default 10."}},"required":["query"]}"""),
        new(Children, null, "List the pages directly below a page, in tree order, with key, type and status. parent \"root\" lists the top of the tree.",
            """{"type":"object","properties":{"parent":{"type":"string","description":"A page key, or \"root\"."},"culture":{"type":"string"},"skip":{"type":"integer"}},"required":["parent"]}"""),
        new(Read, null, "Read a page: name, status, URL, other languages, and every field with its path, kind and current draft value, including the fields inside blocks (paths like modules/3f2a91c0/heading). Always read a page before changing it. Long values are shortened: pass their paths in fields to read them in full.",
            """{"type":"object","properties":{"id":{"type":"string","description":"The page key."},"culture":{"type":"string","description":"Language to read (ISO code) for pages that vary by language; default: the open page's language, else the default language."},"fields":{"type":"array","items":{"type":"string"},"description":"Only these paths, in full."}},"required":["id"]}"""),
        new(Describe, null, "Describe a page type or block type: its fields (kind, required, shared by all languages, allowed values, limits), the block types a block field accepts, and the page types allowed below it. Use it before creating pages or adding blocks.",
            """{"type":"object","properties":{"type":{"type":"string","description":"The document or block type alias, as shown by read_content."}},"required":["type"]}"""),
        new(Media, null, "Find images and files in the media library by name, for media picker fields (returns their keys).",
            """{"type":"object","properties":{"query":{"type":"string","description":"Part of the name; empty lists the newest."},"limit":{"type":"integer"}},"required":[]}"""),
        new(Open, null, "Open a page in the editor's backoffice so they see it (changes nothing). Use it when they ask where something is, and to show the page you are about to change.",
            """{"type":"object","properties":{"id":{"type":"string","description":"The page key."},"culture":{"type":"string"}},"required":["id"]}"""),
        new(Update, EditorActions.Edit, "Change fields of one page and save it as a draft (never published). changes: [{path, value}] with paths from read_content. Values: text fields a string; rich text HTML using <p>, <h2>–<h4>, <strong>, <em>, <a href>, <ul>/<ol>/<li>, <blockquote> (keep the existing structure); numbers; true/false; choices one allowed value or a list; tags a list; page pickers a page key; media pickers a media key or a list of keys; links [{\"name\":…, \"page\": key} or {\"name\":…, \"url\":…}]; dates \"2026-10-31\". name renames the page in that language. Fields marked shared by all languages change in every language. The saved values are checked after saving and returned.",
            """{"type":"object","properties":{"id":{"type":"string","description":"The page key."},"culture":{"type":"string","description":"Language to change (ISO code) for pages that vary by language."},"name":{"type":"string","description":"New page name in this language (optional)."},"changes":{"type":"array","items":{"type":"object","properties":{"path":{"type":"string"},"value":{"description":"The new value, see the tool description."}},"required":["path","value"]}}},"required":["id"]}"""),
        new(Blocks, EditorActions.Edit, "Add, remove or move a block in a block field (Block List or Block Grid) of one page and save it as a draft. path: the block field (e.g. modules, or modules/3f2a91c0/cards for blocks inside a block). add: type (a block type alias the field accepts), position (start, end, before:<block>, after:<block>; default end) and values {fieldAlias: value} for the new block. remove: block. move: block and position. Removing a block from a field shared by all languages removes it in every language.",
            """{"type":"object","properties":{"id":{"type":"string","description":"The page key."},"culture":{"type":"string"},"path":{"type":"string","description":"The block field's path."},"operation":{"type":"string","enum":["add","remove","move"]},"block":{"type":"string","description":"The block (its short key from read_content) to remove or move."},"type":{"type":"string","description":"Block type alias to add."},"position":{"type":"string"},"values":{"type":"object","description":"Field values of the new block, by field alias."}},"required":["id","path","operation"]}"""),
        new(Create, EditorActions.Create, "Create a page below a parent and save it as a draft (not published). type: a page type allowed below the parent (describe_type of the parent's type lists them). values: {fieldAlias: value} for top-level fields; add blocks afterwards with edit_blocks.",
            """{"type":"object","properties":{"parent":{"type":"string","description":"Parent page key, or \"root\"."},"type":{"type":"string"},"name":{"type":"string"},"culture":{"type":"string"},"values":{"type":"object"}},"required":["parent","type","name"]}"""),
        new(Publish, EditorActions.Publish, "Publish a page: its saved draft goes live in the given languages (default: the language you worked in). Umbraco refuses with the reason when a required field is empty or the parent is not published.",
            """{"type":"object","properties":{"id":{"type":"string"},"cultures":{"type":"array","items":{"type":"string"},"description":"ISO codes, or [\"*\"] for every language."}},"required":["id"]}"""),
        new(Unpublish, EditorActions.Unpublish, "Unpublish a page: take it off the website (it stays as a draft).",
            """{"type":"object","properties":{"id":{"type":"string"},"cultures":{"type":"array","items":{"type":"string"}}},"required":["id"]}"""),
        new(Move, EditorActions.Move, "Move a page below another parent, and/or change its position among its siblings (position: start, end, before:<page key>, after:<page key>).",
            """{"type":"object","properties":{"id":{"type":"string"},"parent":{"type":"string","description":"New parent key or \"root\"; leave out to keep the parent."},"position":{"type":"string"}},"required":["id"]}"""),
        new(Delete, EditorActions.Delete, "Move a page and everything below it to the recycle bin. It is never deleted for good and can be restored.",
            """{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}"""),
        new(Upload, EditorActions.Media, "Save an image the editor attached in this conversation to the media library. Returns its media key for media picker fields.",
            """{"type":"object","properties":{"attachment":{"type":"integer","description":"Which attached image: 1 for the first in this conversation."},"name":{"type":"string","description":"Name in the media library."},"folder":{"type":"string","description":"A media folder key (optional)."}},"required":["attachment","name"]}"""),
    ];

    /// <summary>The tools this site allows: reading always, changes only of the allowed kinds.</summary>
    public static List<EditorTool> For(EditorSettings settings) => All.Where(t => t.Action == null || settings.Actions.Contains(t.Action)).ToList();

    public static EditorTool? Find(string name) => All.FirstOrDefault(t => t.Name == name);

    private static string? Str(JsonElement input, string name) => input.ValueKind == JsonValueKind.Object && input.TryGetProperty(name, out var v) ? v.ValueKind switch
    {
        JsonValueKind.String => v.GetString(),
        JsonValueKind.Number or JsonValueKind.True or JsonValueKind.False => v.GetRawText(),
        _ => null,
    } : null;
    private static int Int(JsonElement input, string name) => int.TryParse(Str(input, name), out var n) ? n : 0;
    private static List<string>? List(JsonElement input, string name) => input.ValueKind == JsonValueKind.Object && input.TryGetProperty(name, out var v)
        ? v.ValueKind == JsonValueKind.Array ? v.EnumerateArray().Select(i => i.ValueKind == JsonValueKind.String ? i.GetString() ?? "" : i.GetRawText()).Where(s => s.Length > 0).ToList() : v.ValueKind == JsonValueKind.String ? [v.GetString()!] : null
        : null;
    private static JsonElement? Element(JsonElement input, string name) => input.ValueKind == JsonValueKind.Object && input.TryGetProperty(name, out var v) ? v : null;

    /// <summary>Runs a reading tool. open_page also tells the backoffice where to go.</summary>
    public async Task<(string Result, (Guid Key, string? Culture, string Name)? Navigate)> ReadAsync(ToolContext context, string name, JsonElement input)
    {
        switch (name)
        {
            case Search: return (await content.SearchAsync(context, Str(input, "query") ?? "", Str(input, "culture"), Str(input, "type"), Int(input, "limit")), null);
            case Children: return (await content.ChildrenAsync(context, Str(input, "parent"), Str(input, "culture"), Int(input, "skip")), null);
            case Read: return (await content.ReadAsync(context, Str(input, "id"), Str(input, "culture"), List(input, "fields")), null);
            case Describe: return (await content.DescribeAsync(context, Str(input, "type")), null);
            case Media: return (content.SearchMedia(Str(input, "query"), Int(input, "limit")), null);
            case Open:
            {
                var page = content.Find(Str(input, "id"));
                if (page == null) return ($"Error: no page with key {Str(input, "id")}.", null);
                var (culture, error) = await content.CultureAsync(context, page.ContentType, Str(input, "culture"));
                if (error != null) return ("Error: " + error, null);
                var shown = await content.ReadableForUserAsync(context, page);
                if (!shown) return ("Error: you may not see this page.", null);
                var title = content.Name(page, culture);
                return ($"Opened “{title}”{(culture != null ? $" ({culture})" : "")} in the editor's backoffice.", (page.Key, culture, title));
            }
            default: return ($"Error: unknown tool {name}.", null);
        }
    }

    /// <summary>Plans a change (nothing happens until its Commit runs).</summary>
    public Task<Proposal> PlanAsync(ToolContext context, string name, JsonElement input) => name switch
    {
        Update => content.PlanUpdateAsync(context, Str(input, "id"), Str(input, "culture"), Str(input, "name"), Changes(input)),
        Blocks => content.PlanBlocksAsync(context, Str(input, "id"), Str(input, "culture"), Str(input, "path") ?? "", Str(input, "operation") ?? "", Str(input, "block"), Str(input, "type"), Str(input, "position"), Element(input, "values")),
        Create => content.PlanCreateAsync(context, Str(input, "parent"), Str(input, "type"), Str(input, "name"), Str(input, "culture"), Element(input, "values")),
        Publish => content.PlanPublishAsync(context, Str(input, "id"), List(input, "cultures") ?? (Str(input, "culture") is { } c ? [c] : null), unpublish: false),
        Unpublish => content.PlanPublishAsync(context, Str(input, "id"), List(input, "cultures") ?? (Str(input, "culture") is { } u ? [u] : null), unpublish: true),
        Move => content.PlanMoveAsync(context, Str(input, "id"), Str(input, "parent"), Str(input, "position")),
        Delete => content.PlanDeleteAsync(context, Str(input, "id")),
        Upload => media.PlanUploadAsync(context, Int(input, "attachment"), Str(input, "name"), Str(input, "folder")),
        _ => Task.FromResult(Proposal.Refused($"Unknown tool {name}.")),
    };

    private static List<FieldChange> Changes(JsonElement input)
    {
        if (Element(input, "changes") is not { ValueKind: JsonValueKind.Array } changes) return [];
        return changes.EnumerateArray().Where(c => c.ValueKind == JsonValueKind.Object && c.TryGetProperty("path", out _))
            .Select(c => new FieldChange(c.GetProperty("path").GetString() ?? "", c.TryGetProperty("value", out var v) ? v.Clone() : default)).ToList();
    }

    /// <summary>A short line for the chat: what a tool call does ("Searched for “phone”", "Read “Kontakt”").</summary>
    public string Label(ToolContext context, string name, JsonElement input)
    {
        string Page() => content.Find(Str(input, "id")) is { } page ? $"“{content.Name(page, page.ContentType.Variations.HasFlag(Umbraco.Cms.Core.Models.ContentVariation.Culture) ? Str(input, "culture") ?? context.OpenCulture : null)}”" : "a page";
        return name switch
        {
            Search => $"Searched for “{Str(input, "query")}”",
            Children => Str(input, "parent") is null or "root" ? "Looked at the top of the tree" : $"Looked below {(content.Find(Str(input, "parent")) is { } p ? $"“{content.Name(p, null)}”" : "a page")}",
            Read => $"Read {Page()}" + (List(input, "fields") is { Count: > 0 } f ? $" ({string.Join(", ", f.Take(3))})" : ""),
            Describe => $"Looked up the type {Str(input, "type")}",
            Media => string.IsNullOrWhiteSpace(Str(input, "query")) ? "Looked in the media library" : $"Searched the media library for “{Str(input, "query")}”",
            Open => $"Opened {Page()}",
            _ => name,
        };
    }
}
