using System.Text.Json;
using System.Text.Json.Nodes;
using Umbraco.Cms.Core;
using Umbraco.Cms.Core.Models;
using Umbraco.Cms.Core.Services;
using Umbraco.Extensions;

namespace Ligata.AI.Editor;

public sealed record FieldChange(string Path, JsonElement Value);

public sealed partial class ContentTools
{
    private async Task<(IContent? Page, string? Culture, Proposal? Refusal)> PageAsync(ToolContext context, string? id, string? requestedCulture, string action)
    {
        var page = Find(id);
        if (page == null) return (null, null, Proposal.Refused($"No page with key {id}. Find it with search_content first."));
        var (culture, error) = await CultureAsync(context, page.ContentType, requestedCulture);
        if (error != null) return (null, null, Proposal.Refused(error));
        if (!access.InScope(context.Settings, page.Path)) return (null, null, Proposal.Refused("This page is outside the part of the site the assistant may work in (Content assistant → Settings → Where it may work)."));
        if (!await access.ReadableAsync(context.Settings, context.User, page)) return (null, null, Proposal.Refused("You may not see this page."));
        if (await access.RefuseAsync(context.Settings, context.User, page, action, culture) is { } refused) return (null, null, Proposal.Refused(refused));
        return (page, culture, null);
    }

    private static string In(string? culture) => culture != null ? $" ({culture})" : "";

    // ---------- update_content ----------
    public async Task<Proposal> PlanUpdateAsync(ToolContext context, string? id, string? requestedCulture, string? rename, IReadOnlyList<FieldChange> changes)
    {
        var (page, culture, refusal) = await PageAsync(context, id, requestedCulture, EditorActions.Edit);
        if (refusal != null) return refusal;
        if (changes.Count == 0 && string.IsNullOrWhiteSpace(rename)) return Proposal.Refused("Nothing to change: give changes or a new name.");
        if (changes.Count > 40) return Proposal.Refused("At most 40 changes at once.");
        var working = new Working(page!);
        var proposal = new Proposal { Kind = EditorActions.Edit, DocumentKey = page!.Key, DocumentName = Name(page, culture), Culture = culture, ParentKey = Parent(page) };
        var errors = new List<string>();
        var refs = new List<FieldRef>();
        foreach (var change in changes)
        {
            var (field, error) = await ResolveAsync(working, change.Path, culture);
            if (error != null) { errors.Add($"{change.Path}: {error}"); continue; }
            var (value, invalid) = await ConvertAsync(context, field!, change.Value);
            if (invalid != null) { errors.Add(invalid); continue; }
            var before = Stored(field!.Current);
            Write(working, field, value);
            var after = Stored(value);
            if (Same(before, after)) continue;
            refs.Add(field);
            proposal.Changes.Add(new EditorChange(field.Path, field.Label, field.Steps.Count > 0 ? field.Steps[^1].Culture : field.Culture, before, after,
                Readable(field.Kind, field.Editor, field.Current, field.Config), Readable(field.Kind, field.Editor, value, field.Config)));
            if (field.Shared && culture != null)
            {
                proposal.Notes.Add($"{field.Path} is shared by all languages: the change applies to every language.");
                proposal.Risks.Add($"changes {field.Label} in every language");
            }
            if (field.Mandatory && string.IsNullOrEmpty(after)) proposal.Notes.Add($"{field.Path} is required: the page cannot be published while it is empty.");
            var (beforeText, afterText) = (proposal.Changes[^1].BeforeText ?? "", proposal.Changes[^1].AfterText ?? "");
            if (beforeText.Trim().Length > 0 && afterText.Trim().Length == 0) proposal.Risks.Add($"clears {field.Label}");
            else if (beforeText.Length > 200 && afterText.Length < beforeText.Length / 2) proposal.Risks.Add($"removes most of {field.Label}");
        }
        if (errors.Count > 0) return Proposal.Refused("Nothing was changed. " + string.Join(" ", errors));
        string? newName = null;
        if (!string.IsNullOrWhiteSpace(rename))
        {
            newName = rename.Trim();
            if (newName.Length > 255) return Proposal.Refused("A page name can have at most 255 characters.");
            var old = Name(page, culture);
            if (newName != old) proposal.Changes.Insert(0, new EditorChange("(name)", "Page name", culture, old, newName, old, newName));
            else newName = null;
        }
        if (proposal.Changes.Count == 0) return Proposal.Refused("These values are already set: nothing to change.");
        proposal.Title = proposal.Changes.Count == 1 ? $"Change {proposal.Changes[0].Label} on “{proposal.DocumentName}”{In(culture)}" : $"Change {proposal.Changes.Count} fields on “{proposal.DocumentName}”{In(culture)}";
        proposal.Notes = proposal.Notes.Distinct().ToList();
        proposal.Risks = proposal.Risks.Distinct().ToList();
        proposal.Commit = async () =>
        {
            if (newName != null) { if (page.ContentType.VariesByCulture()) page.SetCultureName(newName, culture); else page.Name = newName; }
            foreach (var (alias, c, value) in working.Changed) page.SetValue(alias, value, c);
            var saved = contents.Save(page, context.User.Id);
            if (!saved.Success) throw new EditorToolException($"Umbraco did not save the page ({saved.Result}).");
            return await VerifyAsync(context, page.Key, culture, proposal.Changes, "Saved as a draft");
        };
        return proposal;
    }

    /// <summary>Reads the page again after saving and compares every changed field with what was meant.</summary>
    private async Task<string> VerifyAsync(ToolContext context, Guid key, string? culture, List<EditorChange> changes, string done)
    {
        var page = contents.GetById(key)!;
        var working = new Working(page);
        var lines = new List<string>();
        var mismatches = 0;
        foreach (var change in changes)
        {
            string? now;
            if (change.Path == "(name)") now = Name(page, culture);
            else if (change.Path.StartsWith('(')) continue;
            else
            {
                var (field, _) = await ResolveAsync(working, change.Path, culture);
                now = Stored(field?.Current);
                if (field != null && change.AfterText != null)
                {
                    var readable = Readable(field.Kind, field.Editor, field.Current, field.Config);
                    if (Same(now, change.After)) { lines.Add($"{change.Path} = {Short(readable)}"); continue; }
                }
            }
            if (Same(now, change.After)) lines.Add($"{change.Path} = {Short(change.AfterText ?? now ?? "")}");
            else { mismatches++; lines.Add($"{change.Path}: NOT as intended, it is now {Short(now ?? "(empty)")}"); }
        }
        var url = Url(key, culture);
        var live = page.Published && (culture == null || page.IsCulturePublished(culture));
        var status = live ? $" The live page{(url != null ? " " + url : "")} still shows the published version until the draft is published." : " The page is not published.";
        return $"{done} of “{Name(page, culture)}”{In(culture)}.{(done.StartsWith("Saved") ? status : "")} Checked after saving: {(mismatches == 0 ? "all changes are in place" : $"{mismatches} change(s) did not take")}.\n" + string.Join("\n", lines.Select(l => "- " + l));
    }

    private static string Short(string text) => text.Length > 160 ? JsonSerializer.Serialize(text[..160], ContentFields.Readable) + "…" : JsonSerializer.Serialize(text, ContentFields.Readable);

    private Guid? Parent(IContent page) => page.ParentId > 0 ? entities.Get(page.ParentId, UmbracoObjectTypes.Document)?.Key : null;

    // ---------- edit_blocks ----------
    public async Task<Proposal> PlanBlocksAsync(ToolContext context, string? id, string? requestedCulture, string path, string operation, string? block, string? typeAlias, string? position, JsonElement? values)
    {
        var (page, culture, refusal) = await PageAsync(context, id, requestedCulture, EditorActions.Edit);
        if (refusal != null) return refusal;
        var working = new Working(page!);
        var (field, error) = await ResolveAsync(working, path, culture);
        if (error != null) return Proposal.Refused(error);
        if (field!.Kind != FieldKinds.Blocks) return Proposal.Refused($"{path} is not a block field. Block fields show as [Block List] or [Block Grid] in read_content.");
        if (context.Settings.Scope.ProtectedFields.Contains(field.LeafAlias, StringComparer.OrdinalIgnoreCase)) return Proposal.Refused($"{path} is protected: the assistant may not change it.");
        var blocks = BlockValue.Parse(field.Current, field.Editor) ?? BlockValue.Empty(field.Editor);
        var before = Stored(field.Current);
        var beforeList = Outline(blocks, culture);
        string title, result;
        var notes = new List<string>();
        var risks = new List<string>();
        var allowed = ContentSchema.Blocks(field.Config);
        int? limit = ContentSchema.Get(field.Config, "validationLimit") is JsonObject l && l["max"] is JsonValue m && m.TryGetValue<int>(out var max) && max > 0 ? max : null;
        Guid touched;
        switch ((operation ?? "").Trim().ToLowerInvariant())
        {
            case "add":
            {
                var type = string.IsNullOrWhiteSpace(typeAlias) ? null : schema.Type(typeAlias.Trim());
                var config = type == null ? default : allowed.FirstOrDefault(b => b.Content == type.Key);
                if (type == null || config.Content == Guid.Empty) return Proposal.Refused($"{path} accepts these block types: {string.Join(", ", allowed.Select(b => schema.Type(b.Content)?.Alias))}.");
                if (context.Settings.Scope.ReadOnlyTypes.Contains(type.Alias, StringComparer.OrdinalIgnoreCase)) return Proposal.Refused($"Blocks of type {type.Alias} are read-only for the assistant.");
                if (limit is { } most && blocks.Items().Count(x => x.Depth == 0) >= most) return Proposal.Refused($"{path} takes at most {most} blocks.");
                var (list, index, placeError) = Place(blocks, position, null);
                if (placeError != null) return Proposal.Refused(placeError);
                if (blocks.Grid && list == blocks.Layout && !config.AtRoot) return Proposal.Refused($"Blocks of type {type.Alias} can only be placed inside areas of other blocks.");
                touched = Guid.NewGuid();
                var data = new JsonObject { ["contentTypeKey"] = type.Key.ToString(), ["key"] = touched.ToString(), ["values"] = new JsonArray() };
                var fieldErrors = new List<string>();
                var element = schema.Type(type.Key)!;
                if (values is { ValueKind: JsonValueKind.Object } given)
                    foreach (var property in given.EnumerateObject())
                    {
                        var p = ContentSchema.Property(element, property.Name);
                        if (p == null) { fieldErrors.Add($"{type.Alias} has no field {property.Name} (fields: {string.Join(", ", ContentSchema.Properties(element).Select(x => x.Alias))})."); continue; }
                        var (editor, cfg) = await schema.DataTypeAsync(p.DataTypeKey);
                        editor = editor.Length > 0 ? editor : p.PropertyEditorAlias;
                        var leaf = new FieldRef($"{path}/new/{p.Alias}", p.Alias, null, editor, FieldKinds.Of(editor), cfg, p.Name ?? p.Alias, p.Mandatory, p.ValidationRegExp, [], null, false, p.Alias);
                        var (value, invalid) = await ConvertAsync(context, leaf, property.Value);
                        if (invalid != null) { fieldErrors.Add(invalid); continue; }
                        BlockValue.SetEntry(data, p.Alias, editor, p.VariesByCulture() ? culture : null, EntryNode(value, leaf.Kind, null));
                    }
                if (fieldErrors.Count > 0) return Proposal.Refused("Nothing was changed. " + string.Join(" ", fieldErrors));
                var missing = ContentSchema.Properties(element).Where(p => p.Mandatory && BlockValue.Entry(data, p.Alias, p.VariesByCulture() ? culture : null) == null).Select(p => p.Alias).ToList();
                if (missing.Count > 0) notes.Add($"Required fields still empty: {string.Join(", ", missing)}.");
                blocks.Content.Add(data);
                Guid? settingsKey = null;
                if (config.Settings is { } settingsType && settingsType != Guid.Empty)
                {
                    settingsKey = Guid.NewGuid();
                    blocks.Settings.Add(new JsonObject { ["contentTypeKey"] = settingsType.ToString(), ["key"] = settingsKey.ToString(), ["values"] = new JsonArray() });
                }
                var item = new JsonObject();
                if (blocks.Grid) { item["columnSpan"] = ContentSchema.Number(field.Config, "gridColumns") ?? 12; item["rowSpan"] = 1; item["areas"] = new JsonArray(); }
                item["contentKey"] = touched.ToString();
                item["settingsKey"] = settingsKey?.ToString();
                list!.Insert(index, item);
                // A block that varies by language shows in the language it was written in; one that does not, everywhere.
                blocks.ExposeIn(touched, element.VariesByCulture() ? culture : null);
                if (culture != null && element.VariesByCulture() && (await LanguagesAsync()).Count > 1) notes.Add($"The new block shows in {culture} only until it is filled in for the other languages.");
                title = $"Add a “{element.Name}” block to {field.Label} on “{Name(page!, culture)}”{In(culture)}";
                result = $"Added block {path}/{ContentFields.ShortId(touched)} ({element.Alias}).";
                break;
            }
            case "remove":
            {
                var (key, findError) = FindBlock(blocks, block ?? "");
                if (findError != null) return Proposal.Refused(findError);
                var (item, list, _, _, _) = blocks.Items().First(x => BlockValue.Key(x.Item) == key);
                var name = BlockName(blocks, key);
                var removed = new List<JsonObject> { item };
                if (item["areas"] is JsonArray areas) removed.AddRange(areas.OfType<JsonObject>().SelectMany(a => a["items"] as JsonArray ?? []).OfType<JsonObject>());
                list.Remove(item);
                foreach (var gone in removed)
                {
                    var k = BlockValue.Key(gone);
                    if (blocks.Data(k) is { } d) blocks.Content.Remove(d);
                    if (BlockValue.SettingsKey(gone) is { } s && blocks.SettingsData(s) is { } sd) blocks.Settings.Remove(sd);
                    foreach (var e in blocks.Expose.OfType<JsonObject>().Where(e => BlockValue.Key(e) == k).ToList()) blocks.Expose.Remove(e);
                }
                var everywhere = field.Shared || field.Culture == null && culture != null;
                if (everywhere) notes.Add("This block field is shared by all languages: the block disappears in every language.");
                risks.Add($"removes the “{name}” block{(everywhere ? " in every language" : "")}");
                touched = key;
                title = $"Remove the “{name}” block from {field.Label} on “{Name(page!, culture)}”{In(culture)}";
                result = $"Removed block {path}/{ContentFields.ShortId(key)} ({name}).";
                break;
            }
            case "move":
            {
                var (key, findError) = FindBlock(blocks, block ?? "");
                if (findError != null) return Proposal.Refused(findError);
                var (item, list, _, _, _) = blocks.Items().First(x => BlockValue.Key(x.Item) == key);
                var (target, index, placeError) = Place(blocks, position, key);
                if (placeError != null) return Proposal.Refused(placeError);
                if (target != list) return Proposal.Refused("Blocks can only be moved within the same list (not into or out of areas).");
                var from = list.IndexOf(item);
                list.RemoveAt(from);
                list.Insert(index > from ? index - 1 : index, item);
                touched = key;
                title = $"Move the “{BlockName(blocks, key)}” block in {field.Label} on “{Name(page!, culture)}”{In(culture)}";
                result = $"Moved block {path}/{ContentFields.ShortId(key)}.";
                break;
            }
            default:
                return Proposal.Refused("operation must be add, remove or move.");
        }
        var stored = field.Current is string || field.Current == null ? blocks.Root.ToJsonString() : (object)blocks.Root;
        Write(working, field with { Kind = FieldKinds.Blocks }, stored);
        var after = Stored(stored);
        if (Same(before, after)) return Proposal.Refused("The blocks are already in this order: nothing to change.");
        var proposal = new Proposal
        {
            Kind = EditorActions.Edit, Title = title, DocumentKey = page!.Key, DocumentName = Name(page, culture), Culture = culture, ParentKey = Parent(page), Notes = notes, Risks = risks,
            Changes = [new EditorChange(field.Path, field.Label, field.Culture, before, after, beforeList, Outline(blocks, culture))],
        };
        // Blocks inside blocks: the top-level property holds the change.
        if (field.Steps.Count > 0) proposal.Changes[0] = proposal.Changes[0] with { Path = field.Alias, Before = Stored(page.GetValue(field.Alias, field.Culture)), After = Stored(working.Get(field.Alias, field.Culture)) };
        proposal.Commit = async () =>
        {
            foreach (var (alias, c, value) in working.Changed) page.SetValue(alias, value, c);
            var saved = contents.Save(page, context.User.Id);
            if (!saved.Success) throw new EditorToolException($"Umbraco did not save the page ({saved.Result}).");
            var check = await ResolveAsync(new Working(contents.GetById(page.Key)!), path, culture);
            var now = BlockValue.Parse(check.Field?.Current, field.Editor);
            var present = now?.Items().Any(x => BlockValue.Key(x.Item) == touched) == true;
            var ok = operation.Trim().Equals("remove", StringComparison.OrdinalIgnoreCase) ? !present : present;
            return $"{result} Saved as a draft of “{proposal.DocumentName}”{In(culture)}. Checked after saving: {(ok ? "in place" : "NOT as intended")}. The field now holds: {Outline(now ?? BlockValue.Empty(field.Editor), culture)}."
                + (operation.Trim().Equals("add", StringComparison.OrdinalIgnoreCase) ? $" Fill or change its fields with update_content paths {path}/{ContentFields.ShortId(touched)}/<field>." : "");
        };
        return proposal;
    }

    private string BlockName(BlockValue blocks, Guid key) =>
        blocks.Data(key) is { } data && Guid.TryParse(data["contentTypeKey"]?.ToString(), out var type) ? schema.Type(type)?.Name ?? "block" : "block";

    /// <summary>"1. Hero (d4b33427) · 2. Text (d9bfce27)": the blocks of a field, for the model and for before/after cards.</summary>
    private string Outline(BlockValue blocks, string? culture)
    {
        var items = blocks.Items();
        if (items.Count == 0) return "(no blocks)";
        return string.Join(" · ", items.Select((x, i) =>
        {
            var key = BlockValue.Key(x.Item);
            var heading = blocks.Data(key)?["values"] is JsonArray values ? values.OfType<JsonObject>().Where(v => v["alias"]?.ToString() is "heading" or "title" or "headline" or "name" && (v["culture"] == null || v["culture"]?.ToString() == culture)).Select(v => ContentFields.String(v["value"])).FirstOrDefault(v => !string.IsNullOrWhiteSpace(v)) : null;
            return $"{new string('›', x.Depth)}{i + 1}. {BlockName(blocks, key)}{(heading != null ? $" “{(heading.Length > 40 ? heading[..40] + "…" : heading)}”" : "")} ({ContentFields.ShortId(key)})";
        }));
    }

    /// <summary>Where a block goes: start, end, before:&lt;block&gt;, after:&lt;block&gt; (in the list that block is in).</summary>
    private static (JsonArray? List, int Index, string? Error) Place(BlockValue blocks, string? position, Guid? moving)
    {
        var p = (position ?? "end").Trim();
        if (p.Equals("end", StringComparison.OrdinalIgnoreCase) || p.Length == 0)
        {
            var list = moving is { } m ? blocks.Items().First(x => BlockValue.Key(x.Item) == m).List : blocks.Layout;
            return (list, list.Count, null);
        }
        if (p.Equals("start", StringComparison.OrdinalIgnoreCase))
            return (moving is { } m ? blocks.Items().First(x => BlockValue.Key(x.Item) == m).List : blocks.Layout, 0, null);
        var parts = p.Split(':', 2);
        if (parts.Length == 2 && parts[0].Trim().ToLowerInvariant() is "before" or "after")
        {
            var (key, error) = FindBlock(blocks, parts[1].Trim());
            if (error != null) return (null, 0, error);
            var (item, list, _, _, _) = blocks.Items().First(x => BlockValue.Key(x.Item) == key);
            var index = list.IndexOf(item);
            return (list, parts[0].Trim().Equals("after", StringComparison.OrdinalIgnoreCase) ? index + 1 : index, null);
        }
        return (null, 0, "position must be start, end, before:<block> or after:<block>.");
    }

    // ---------- create_content ----------
    public async Task<Proposal> PlanCreateAsync(ToolContext context, string? parentId, string? typeAlias, string? name, string? requestedCulture, JsonElement? values)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Trim().Length > 255) return Proposal.Refused("Give the new page a name (at most 255 characters).");
        var type = string.IsNullOrWhiteSpace(typeAlias) ? null : schema.Type(typeAlias.Trim());
        if (type == null || type.IsElement) return Proposal.Refused($"No page type {typeAlias}. See describe_type of the parent's type for the types allowed below it.");
        if (context.Settings.Scope.ReadOnlyTypes.Contains(type.Alias, StringComparer.OrdinalIgnoreCase)) return Proposal.Refused($"Pages of type {type.Alias} are read-only for the assistant.");
        IContent? parent = null;
        var atRoot = string.IsNullOrWhiteSpace(parentId) || parentId.Trim().Equals("root", StringComparison.OrdinalIgnoreCase);
        if (atRoot)
        {
            if (context.Settings.Scope.Roots.Count > 0) return Proposal.Refused("The assistant may only create pages inside its part of the site, not at the top level.");
            if (!type.AllowedAsRoot) return Proposal.Refused($"{type.Alias} pages cannot be created at the top level.");
            if (!await access.RootAllowedAsync(context.User, EditorAccess.Permission(EditorActions.Create))) return Proposal.Refused($"{context.User.Name} may not create pages at the top level.");
        }
        else
        {
            parent = Find(parentId);
            if (parent == null) return Proposal.Refused($"No page with key {parentId}.");
            if (!await access.ReadableAsync(context.Settings, context.User, parent)) return Proposal.Refused("You may not see the parent page.");
            var parentType = schema.Type(parent.ContentType.Key)!;
            if (parentType.AllowedContentTypes?.Any(t => t.Key == type.Key) != true)
                return Proposal.Refused($"{type.Alias} is not allowed below {parentType.Alias}. Allowed: {string.Join(", ", parentType.AllowedContentTypes?.Select(t => t.Alias) ?? [])}.");
            if (!access.InScope(context.Settings, parent.Path)) return Proposal.Refused("The parent is outside the part of the site the assistant may work in.");
            if (!await access.AllowedAsync(context.User, parent.Key, EditorAccess.Permission(EditorActions.Create))) return Proposal.Refused($"{context.User.Name} may not create pages below this page.");
        }
        var (culture, error) = await CultureAsync(context, type, requestedCulture);
        if (error != null) return Proposal.Refused(error);
        if (!await access.CultureAllowedAsync(context.Settings, context.User, culture)) return Proposal.Refused($"The assistant may not write in {culture}.");
        var draft = contents.Create(name.Trim(), parent?.Id ?? Constants.System.Root, type.Alias, context.User.Id);
        if (culture != null) draft.SetCultureName(name.Trim(), culture);
        var working = new Working(draft);
        var changes = new List<EditorChange> { new("(name)", "Page name", culture, null, name.Trim(), null, name.Trim()) };
        var errors = new List<string>();
        if (values is { ValueKind: JsonValueKind.Object } given)
            foreach (var property in given.EnumerateObject())
            {
                var (field, resolveError) = await ResolveAsync(working, property.Name, culture);
                if (resolveError != null) { errors.Add(resolveError); continue; }
                if (field!.Steps.Count > 0) { errors.Add($"{property.Name}: set block fields after creating the page."); continue; }
                var (value, invalid) = await ConvertAsync(context, field, property.Value);
                if (invalid != null) { errors.Add(invalid); continue; }
                Write(working, field, value);
                changes.Add(new EditorChange(field.Path, field.Label, field.Culture, null, Stored(value), null, Readable(field.Kind, field.Editor, value, field.Config)));
            }
        if (errors.Count > 0) return Proposal.Refused("Nothing was created. " + string.Join(" ", errors));
        var where = parent == null ? "at the top level" : $"below “{Name(parent, culture)}”";
        var proposal = new Proposal
        {
            Kind = EditorActions.Create, Title = $"Create the page “{name.Trim()}” ({type.Name}) {where}{In(culture)}", DocumentName = name.Trim(), Culture = culture, ParentKey = parent?.Key, Changes = changes,
        };
        var missing = ContentSchema.Properties(type).Where(p => p.Mandatory && working.Get(p.Alias, p.VariesByCulture() ? culture : null) is null or "").Select(p => p.Alias).ToList();
        if (missing.Count > 0) proposal.Notes.Add($"Required fields still empty: {string.Join(", ", missing)} (needed before publishing).");
        proposal.Commit = () =>
        {
            foreach (var (alias, c, value) in working.Changed) draft.SetValue(alias, value, c);
            var saved = contents.Save(draft, context.User.Id);
            if (!saved.Success || draft.Id == 0) throw new EditorToolException($"Umbraco did not create the page ({saved.Result}).");
            proposal.DocumentKey = draft.Key;
            var check = contents.GetById(draft.Key);
            return Task.FromResult($"Created the draft “{Name(check!, culture)}”{In(culture)} — key {draft.Key}, {where}, not published. Checked after saving: it exists{(missing.Count > 0 ? $"; required fields still empty: {string.Join(", ", missing)}" : "")}. Read it with read_content to fill more fields or add blocks.");
        };
        return proposal;
    }

    // ---------- publish_content / unpublish_content ----------
    public async Task<Proposal> PlanPublishAsync(ToolContext context, string? id, IReadOnlyList<string>? requested, bool unpublish)
    {
        var action = unpublish ? EditorActions.Unpublish : EditorActions.Publish;
        var page = Find(id);
        if (page == null) return Proposal.Refused($"No page with key {id}.");
        if (!await access.ReadableAsync(context.Settings, context.User, page)) return Proposal.Refused("You may not see this page.");
        var all = await LanguagesAsync();
        List<string> cultures;
        if (!page.ContentType.VariesByCulture()) cultures = ["*"];
        else
        {
            var wanted = requested is { Count: > 0 } ? requested.Select(c => c.Trim()).ToList() : [context.OpenCulture ?? (await DefaultCultureAsync())!];
            if (wanted.Contains("*")) wanted = unpublish ? ["*"] : page.AvailableCultures.ToList();
            cultures = [];
            foreach (var w in wanted)
            {
                if (w == "*") { cultures.Add("*"); continue; }
                var match = all.FirstOrDefault(l => string.Equals(l.IsoCode, w, StringComparison.OrdinalIgnoreCase));
                if (match == null) return Proposal.Refused($"Unknown language {w}.");
                if (!unpublish && !page.IsCultureAvailable(match.IsoCode)) return Proposal.Refused($"The page has no {match.IsoCode} version yet (give it a name in that language first).");
                cultures.Add(match.IsoCode);
            }
        }
        foreach (var c in cultures.Where(c => c != "*"))
            if (await access.RefuseAsync(context.Settings, context.User, page, action, c) is { } refused) return Proposal.Refused(refused);
        if (cultures.Contains("*") && await access.RefuseAsync(context.Settings, context.User, page, action, null) is { } refusedAll) return Proposal.Refused(refusedAll);
        var label = cultures.Contains("*") ? (page.ContentType.VariesByCulture() ? " (all languages)" : "") : $" ({string.Join(", ", cultures)})";
        var first = cultures.FirstOrDefault(c => c != "*");
        var proposal = new Proposal { Kind = action, DocumentKey = page.Key, DocumentName = Name(page, first), Culture = first, ParentKey = Parent(page) };
        if (unpublish)
        {
            proposal.Title = $"Unpublish “{proposal.DocumentName}”{label}: take it off the website";
            proposal.Changes.Add(new EditorChange("(status)", "Status", first, "published", "not published", "Published", "Not published"));
            if (contents.HasChildren(page.Id)) proposal.Notes.Add("Its subpages are no longer reachable on the website either.");
            if (first != null && all.FirstOrDefault(l => l.IsoCode == first)?.IsMandatory == true) proposal.Notes.Add($"{first} is a mandatory language: unpublishing it takes the whole page offline.");
        }
        else
        {
            proposal.Title = $"Publish “{proposal.DocumentName}”{label}: make the saved draft live";
            // What goes live: the fields whose draft differs from the published version.
            var type = schema.Type(page.ContentType.Key)!;
            foreach (var c in cultures.Contains("*") ? [first] : cultures)
                foreach (var p in ContentSchema.Properties(type))
                {
                    var pc = p.VariesByCulture() ? c : null;
                    var live = page.GetValue(p.Alias, pc, published: true);
                    var draft = page.GetValue(p.Alias, pc);
                    if (Same(Stored(live), Stored(draft))) continue;
                    var (editor, config) = await schema.DataTypeAsync(p.DataTypeKey);
                    var kind = FieldKinds.Of(editor.Length > 0 ? editor : p.PropertyEditorAlias);
                    proposal.Changes.Add(new EditorChange(p.Alias, p.Name ?? p.Alias, pc, null, null,
                        kind == FieldKinds.Blocks ? Outline(BlockValue.Parse(live, editor) ?? BlockValue.Empty(editor), c) : Readable(kind, editor, live, config),
                        kind == FieldKinds.Blocks ? Outline(BlockValue.Parse(draft, editor) ?? BlockValue.Empty(editor), c) : Readable(kind, editor, draft, config)));
                }
            if (proposal.Changes.Count == 0) proposal.Changes.Add(new EditorChange("(status)", "Status", first, null, null, Status(page, first), "published"));
        }
        proposal.Commit = () =>
        {
            var current = contents.GetById(page.Key)!;
            var result = unpublish ? contents.Unpublish(current, cultures.Count == 1 ? cultures[0] : "*", context.User.Id) : contents.Publish(current, cultures.ToArray(), context.User.Id);
            if (!result.Success) throw new EditorToolException(PublishProblem(result, unpublish));
            var check = contents.GetById(page.Key)!;
            var now = cultures.Where(c => c != "*").Select(c => $"{c}: {(check.IsCulturePublished(c) ? "published" : "not published")}").ToList();
            if (now.Count == 0) now.Add(check.Published ? "published" : "not published");
            var url = unpublish ? null : Url(page.Key, first);
            return Task.FromResult($"{(unpublish ? "Unpublished" : "Published")} “{Name(check, first)}”. Checked: {string.Join(", ", now)}.{(url != null ? $" Live at {url}." : "")}");
        };
        return proposal;
    }

    private static string PublishProblem(PublishResult result, bool unpublish)
    {
        var invalid = result.InvalidProperties?.Select(p => p.Alias).ToList() ?? [];
        return result.Result switch
        {
            PublishResultType.FailedPublishContentInvalid => $"Umbraco refused: some fields are not valid{(invalid.Count > 0 ? ": " + string.Join(", ", invalid) : "")} (for example a required field is empty). Fill them, then publish again.",
            PublishResultType.FailedPublishPathNotPublished => "Umbraco refused: the parent page is not published.",
            PublishResultType.FailedPublishMandatoryCultureMissing => "Umbraco refused: the mandatory language must be published too.",
            PublishResultType.FailedPublishHasExpired or PublishResultType.FailedPublishIsTrashed => "Umbraco refused: the page is expired or in the recycle bin.",
            PublishResultType.FailedPublishAwaitingRelease => "Umbraco refused: the page is scheduled for a later release.",
            PublishResultType.FailedPublishCancelledByEvent => "Umbraco refused: another extension of this site stopped it.",
            _ => $"Umbraco did not {(unpublish ? "unpublish" : "publish")} the page ({result.Result}).",
        };
    }

    // ---------- move_content ----------
    public async Task<Proposal> PlanMoveAsync(ToolContext context, string? id, string? parentId, string? position)
    {
        var page = Find(id);
        if (page == null) return Proposal.Refused($"No page with key {id}.");
        if (!await access.ReadableAsync(context.Settings, context.User, page)) return Proposal.Refused("You may not see this page.");
        if (await access.RefuseAsync(context.Settings, context.User, page, EditorActions.Move, null) is { } refused) return Proposal.Refused(refused);
        var oldParentId = page.ParentId;
        var target = string.IsNullOrWhiteSpace(parentId) ? (page.ParentId > 0 ? contents.GetById(page.ParentId) : null) : parentId.Trim().Equals("root", StringComparison.OrdinalIgnoreCase) ? null : Find(parentId);
        var targetId = target?.Id ?? Constants.System.Root;
        if (!string.IsNullOrWhiteSpace(parentId) && !parentId.Trim().Equals("root", StringComparison.OrdinalIgnoreCase) && target == null) return Proposal.Refused($"No page with key {parentId}.");
        var culture = context.OpenCulture ?? await DefaultCultureAsync();
        var changes = new List<EditorChange>();
        if (targetId != oldParentId)
        {
            if (target != null)
            {
                if (target.Path.Split(',').Contains(page.Id.ToString())) return Proposal.Refused("A page cannot be moved below itself.");
                if (!await access.ReadableAsync(context.Settings, context.User, target)) return Proposal.Refused("You may not see the new parent.");
                if (schema.Type(target.ContentType.Key)!.AllowedContentTypes?.Any(t => t.Key == page.ContentType.Key) != true) return Proposal.Refused($"{page.ContentType.Alias} pages are not allowed below {target.ContentType.Alias}.");
                if (!await access.AllowedAsync(context.User, target.Key, EditorAccess.Permission(EditorActions.Create))) return Proposal.Refused($"{context.User.Name} may not add pages below the new parent.");
            }
            else
            {
                if (context.Settings.Scope.Roots.Count > 0) return Proposal.Refused("The assistant may not move pages to the top level.");
                if (!schema.Type(page.ContentType.Key)!.AllowedAsRoot) return Proposal.Refused($"{page.ContentType.Alias} pages cannot be at the top level.");
            }
            changes.Add(new EditorChange("(location)", "Location", null, entities.Get(oldParentId, UmbracoObjectTypes.Document)?.Key.ToString() ?? "root", target?.Key.ToString() ?? "root",
                Breadcrumb(page.Path, culture), (target != null ? Breadcrumb(target.Path, culture) + " › " : "") + Name(page, culture)));
        }
        var siblings = entities.GetChildren(targetId, UmbracoObjectTypes.Document).Where(e => !e.Trashed && e.Id != page.Id).OrderBy(e => e.SortOrder).ToList();
        var oldSiblings = entities.GetChildren(oldParentId, UmbracoObjectTypes.Document).Where(e => !e.Trashed).OrderBy(e => e.SortOrder).ToList();
        int index;
        var p = (position ?? "").Trim();
        if (p.Length == 0 || p.Equals("end", StringComparison.OrdinalIgnoreCase)) index = siblings.Count;
        else if (p.Equals("start", StringComparison.OrdinalIgnoreCase)) index = 0;
        else if (p.Split(':', 2) is [var where, var reference] && where.Trim().ToLowerInvariant() is "before" or "after")
        {
            var other = Find(reference.Trim());
            var at = other == null ? -1 : siblings.FindIndex(s => s.Id == other.Id);
            if (at < 0) return Proposal.Refused($"{reference.Trim()} is not a page next to it (below the same parent).");
            index = where.Trim().Equals("after", StringComparison.OrdinalIgnoreCase) ? at + 1 : at;
        }
        else return Proposal.Refused("position must be start, end, before:<page key> or after:<page key>.");
        var order = siblings.Select(s => s.Id).ToList();
        order.Insert(Math.Min(index, order.Count), page.Id);
        var oldIndex = oldSiblings.FindIndex(s => s.Id == page.Id);
        var sorting = !string.IsNullOrWhiteSpace(position) && (targetId != oldParentId || oldIndex != order.IndexOf(page.Id));
        if (sorting)
        {
            if (!await access.AllowedAsync(context.User, target?.Key ?? Guid.Empty, Umbraco.Cms.Core.Actions.ActionSort.ActionLetter) && target != null) return Proposal.Refused($"{context.User.Name} may not sort the pages below the parent.");
            changes.Add(new EditorChange("(position)", "Position", null, (oldIndex + 1).ToString(), (order.IndexOf(page.Id) + 1).ToString(),
                $"{oldIndex + 1}. of {oldSiblings.Count}", $"{order.IndexOf(page.Id) + 1}. of {order.Count}"));
        }
        if (changes.Count == 0) return Proposal.Refused("The page is already there.");
        var proposal = new Proposal
        {
            Kind = EditorActions.Move, DocumentKey = page.Key, DocumentName = Name(page, culture), ParentKey = target?.Key, Changes = changes,
            Title = targetId != oldParentId ? $"Move “{Name(page, culture)}” below “{(target != null ? Name(target, culture) : "the top level")}”" : $"Change the position of “{Name(page, culture)}”",
        };
        if (page.Published) proposal.Notes.Add("Its address on the website changes; Umbraco adds a redirect from the old address.");
        proposal.Commit = () =>
        {
            if (targetId != oldParentId)
            {
                var moved = contents.Move(page, targetId, context.User.Id);
                if (!moved.Success) throw new EditorToolException($"Umbraco did not move the page ({moved.Result}).");
            }
            if (sorting) contents.Sort(order, context.User.Id);
            var check = contents.GetById(page.Key)!;
            var siblingsNow = entities.GetChildren(check.ParentId, UmbracoObjectTypes.Document).Where(e => !e.Trashed).OrderBy(e => e.SortOrder).Select(e => e.Id).ToList();
            return Task.FromResult($"Moved “{Name(check, culture)}”. Checked: it is now at {Breadcrumb(check.Path, culture)}, position {siblingsNow.IndexOf(check.Id) + 1} of {siblingsNow.Count}.");
        };
        return proposal;
    }

    // ---------- delete_content ----------
    public async Task<Proposal> PlanDeleteAsync(ToolContext context, string? id)
    {
        var page = Find(id);
        if (page == null) return Proposal.Refused($"No page with key {id}.");
        if (!await access.ReadableAsync(context.Settings, context.User, page)) return Proposal.Refused("You may not see this page.");
        if (await access.RefuseAsync(context.Settings, context.User, page, EditorActions.Delete, null) is { } refused) return Proposal.Refused(refused);
        if (context.Settings.Scope.Roots.Contains(page.Key)) return Proposal.Refused("This page is a start point of the assistant's part of the site; it cannot delete it.");
        var culture = context.OpenCulture ?? await DefaultCultureAsync();
        var below = entities.GetDescendants(page.Id, UmbracoObjectTypes.Document).Count(e => !e.Trashed);
        var parent = entities.Get(page.ParentId, UmbracoObjectTypes.Document);
        var proposal = new Proposal
        {
            Kind = EditorActions.Delete, DocumentKey = page.Key, DocumentName = Name(page, culture), ParentKey = parent?.Key,
            Title = $"Move “{Name(page, culture)}”{(below > 0 ? $" and its {below} subpage{(below == 1 ? "" : "s")}" : "")} to the recycle bin",
            Changes = [new EditorChange("(location)", "Location", null, parent?.Key.ToString() ?? "root", "recycle bin", Breadcrumb(page.Path, culture), "Recycle bin")],
        };
        if (page.Published) proposal.Notes.Add("It disappears from the website at once.");
        proposal.Notes.Add("It can be restored from the recycle bin (or with Undo in the activity log).");
        proposal.Commit = () =>
        {
            var result = contents.MoveToRecycleBin(page, context.User.Id);
            if (!result.Success) throw new EditorToolException($"Umbraco did not move the page to the recycle bin ({result.Result}).");
            return Task.FromResult($"Moved “{proposal.DocumentName}”{(below > 0 ? $" and {below} subpage(s)" : "")} to the recycle bin. Checked: {(contents.GetById(page.Key)?.Trashed == true ? "it is in the recycle bin" : "NOT in the recycle bin")}.");
        };
        return proposal;
    }

    // ---------- undo ----------
    /// <summary>Puts back what an action changed, if nothing changed it since. Returns null when done, else why not.</summary>
    public async Task<string?> UndoAsync(ToolContext context, EditorActionRow action)
    {
        var changes = Ligata.AI.Models.AssistantJson.Read<List<EditorChange>>(action.Changes);
        var page = action.DocumentKey is { } key ? contents.GetById(key) : null;
        if (page == null) return "The page no longer exists.";
        switch (action.Kind)
        {
            case EditorActions.Edit:
            {
                if (await access.RefuseAsync(context.Settings, context.User, page, EditorActions.Edit, action.Culture) is { } refused) return refused;
                var working = new Working(page);
                foreach (var change in Enumerable.Reverse(changes))
                {
                    if (change.Path == "(name)")
                    {
                        if (Name(page, change.Culture) != change.After) return "The page name was changed since; undo it by hand.";
                        if (page.ContentType.VariesByCulture()) page.SetCultureName(change.Before, change.Culture); else page.Name = change.Before;
                        continue;
                    }
                    var (field, error) = await ResolveAsync(working, change.Path, action.Culture);
                    if (error != null) return $"{change.Path} can no longer be found ({error}).";
                    if (!Same(Stored(field!.Current), change.After)) return $"{change.Path} was changed again since; undo it by hand.";
                    Write(working, field, field.Kind == FieldKinds.Integer && int.TryParse(change.Before, out var i) ? i : field.Kind == FieldKinds.Decimal && decimal.TryParse(change.Before, System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out var d) ? d : field.Kind == FieldKinds.Boolean && int.TryParse(change.Before, out var b) ? b : change.Before);
                }
                foreach (var (alias, c, value) in working.Changed) page.SetValue(alias, value, c);
                var saved = contents.Save(page, context.User.Id);
                return saved.Success ? null : $"Umbraco did not save the page ({saved.Result}).";
            }
            case EditorActions.Create:
            {
                if (await access.RefuseAsync(context.Settings, context.User, page, EditorActions.Delete, null) is { } refused) return "Undo moves the page to the recycle bin: " + refused;
                if (page.Trashed) return "It is already in the recycle bin.";
                return contents.MoveToRecycleBin(page, context.User.Id).Success ? null : "Umbraco did not move the page to the recycle bin.";
            }
            case EditorActions.Delete:
            {
                if (!page.Trashed) return "The page is no longer in the recycle bin.";
                var parent = changes.FirstOrDefault(c => c.Path == "(location)")?.Before;
                var parentId = parent is null or "root" ? Constants.System.Root : Guid.TryParse(parent, out var parentKey) ? contents.GetById(parentKey)?.Id ?? -2 : -2;
                if (parentId == -2) return "The original parent no longer exists; restore it from the recycle bin by hand.";
                return contents.Move(page, parentId, context.User.Id).Success ? null : "Umbraco did not restore the page.";
            }
            case EditorActions.Move:
            {
                if (await access.RefuseAsync(context.Settings, context.User, page, EditorActions.Move, null) is { } refused) return refused;
                var location = changes.FirstOrDefault(c => c.Path == "(location)");
                if (location != null)
                {
                    var parentId = location.Before is null or "root" ? Constants.System.Root : Guid.TryParse(location.Before, out var parentKey) ? contents.GetById(parentKey)?.Id ?? -2 : -2;
                    if (parentId == -2) return "The original parent no longer exists.";
                    if (!contents.Move(page, parentId, context.User.Id).Success) return "Umbraco did not move the page back.";
                }
                if (changes.FirstOrDefault(c => c.Path == "(position)") is { } position && int.TryParse(position.Before, out var at))
                {
                    var siblings = entities.GetChildren(contents.GetById(page.Key)!.ParentId, UmbracoObjectTypes.Document).Where(e => !e.Trashed && e.Id != page.Id).OrderBy(e => e.SortOrder).Select(e => e.Id).ToList();
                    siblings.Insert(Math.Clamp(at - 1, 0, siblings.Count), page.Id);
                    contents.Sort(siblings, context.User.Id);
                }
                return null;
            }
            default:
                return "This kind of action cannot be undone here.";
        }
    }
}

/// <summary>A change Umbraco refused while it was made (the model is told why).</summary>
public sealed class EditorToolException(string message) : Exception(message);
