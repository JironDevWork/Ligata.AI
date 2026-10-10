using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using Ligata.AI.Models;
using Ligata.AI.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Ligata.AI.Editor;

public sealed record EditorOpenPage(Guid Key, string? Culture);
/// <param name="Data">An image as a data URL (data:image/png;base64,…) or base64.</param>
public sealed record EditorImage(string? Name, string Data);
public sealed record EditorMessageRequest(Guid? ChatId, string Message, string? Mode = null, string? Effort = null, EditorOpenPage? Page = null, List<EditorImage>? Images = null);
public sealed record EditorDecision(string Id, bool Approve, string? Note = null);
public sealed record EditorDecideRequest(Guid ChatId, List<EditorDecision> Decisions, string? Mode = null, EditorOpenPage? Page = null);

/// <summary>What the model sees of a conversation, plus what is waiting for the editor's approval.</summary>
public sealed class EditorState
{
    public List<StoredMessage> Messages { get; set; } = [];
    public PendingRound? Pending { get; set; }
    /// <summary>The editor's latest message (for the activity log).</summary>
    public string Request { get; set; } = "";
    public string Effort { get; set; } = "medium";
    /// <summary>Tool calls and changes made without asking since the editor's latest message.</summary>
    public int Steps { get; set; }
    public int AutoChanges { get; set; }
    public int Summaries { get; set; }
    /// <summary>Images attached in this conversation, in order (upload_media refers to them by number).</summary>
    public List<StoredBlock> Attachments { get; set; } = [];
}

public sealed class PendingRound
{
    public List<PendingCall> Calls { get; set; } = [];
}

public sealed class PendingCall
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public JsonElement Input { get; set; }
    /// <summary>The result of a call already made (reads, and changes made before the first one that asks).</summary>
    public string? Result { get; set; }
    public bool Error { get; set; }
    /// <summary>ask | auto | bypass</summary>
    public string Decision { get; set; } = "ask";
    public Proposal? Proposal { get; set; }
    public string ItemId { get; set; } = "";
}

/// <summary>A line of the chat as the panel shows it.</summary>
public sealed class EditorItem
{
    public string Id { get; set; } = "";
    /// <summary>user | assistant | step | change | notice | error</summary>
    public string Type { get; set; } = "";
    public DateTime At { get; set; }
    public string? Text { get; set; }
    public string? Tool { get; set; }
    /// <summary>step: running | done | failed. change: pending | done | failed | declined | undone.</summary>
    public string? State { get; set; }
    public string? Detail { get; set; }
    public EditorPageInfo? Page { get; set; }
    public List<string>? Images { get; set; }
    public EditorChangeView? Change { get; set; }
}

public sealed record EditorPageInfo(Guid Key, string Name, string? Culture);

public sealed class EditorChangeView
{
    public string Kind { get; set; } = "";
    public string Title { get; set; } = "";
    public Guid? DocumentKey { get; set; }
    public string DocumentName { get; set; } = "";
    public string? Culture { get; set; }
    public List<EditorChange> Changes { get; set; } = [];
    public List<string> Notes { get; set; } = [];
    /// <summary>manual | auto | bypass</summary>
    public string? Approval { get; set; }
    /// <summary>Why the change waits for approval.</summary>
    public string? Reason { get; set; }
    public Guid? ActionId { get; set; }
}

public sealed class EditorException(string code, string message, int status) : Exception(message)
{
    public string Code { get; } = code;
    public int Status { get; } = status;
}

/// <summary>
/// The content assistant's loop: the editor's message goes to Claude with the content tools; reads run at once, changes run,
/// wait for approval or are refused according to the permission mode (Manual, Auto, Bypass) and the settings. Everything the
/// assistant does is logged with the user who steered it. The conversation is kept on the server per user (the panel can be
/// closed, the backoffice reloaded), and summarized when it grows long.
/// </summary>
public sealed class EditorAgent(EditorStore store, EditorModel model, EditorTools tools, ContentTools content, Ligata.AI.Data.AssistantStore site, IOptions<AssistantOptions> options, ILogger<EditorAgent> logger)
{
    public const int MaxMessage = 8000, MaxImages = 4, MaxImageBase64 = 7_400_000, MaxItems = 600;
    private static readonly ConcurrentDictionary<Guid, byte> running = new();
    private static long lastPurge;

    public const string SummaryInstruction = "(Message from the backoffice, not from the editor.) This conversation is getting long. Write a summary of everything so far for yourself, so you can continue with only the summary: what the editor wants and prefers; the pages you found, read and changed (with their keys and languages) and whether the changes were saved as drafts or published; what was declined; open questions. At most 400 words, in the editor's language. Write nothing else.";

    public static string SummaryMessage(string summary) =>
        "Summary of the earlier part of this conversation (older messages were removed to save memory):\n<conversation_summary>\n" + summary.Replace("</conversation_summary>", "").Trim() + "\n</conversation_summary>";

    private sealed class Run(EditorChatRow chat, EditorState state, List<EditorItem> items, ToolContext context, EditorStream stream, string mode, string system, List<EditorTool> tools)
    {
        public EditorChatRow Chat { get; } = chat;
        public EditorState State { get; } = state;
        public List<EditorItem> Items { get; } = items;
        public ToolContext Context { get; } = context;
        public EditorStream Stream { get; } = stream;
        public string Mode { get; } = mode;
        public string System { get; } = system;
        public List<EditorTool> Tools { get; } = tools;
        public long Prompt, Cached, Output;
        public async Task Item(EditorItem item)
        {
            var at = Items.FindIndex(i => i.Id == item.Id);
            if (at >= 0) Items[at] = item; else Items.Add(item);
            await Stream.Send("item", item);
        }
    }

    // ---------- entry points ----------
    /// <summary>The editor sends a message (a new conversation when ChatId is empty).</summary>
    public async Task MessageAsync(HttpContext http, EditorUser user, EditorMessageRequest request)
    {
        var settings = Check(user);
        var text = (request.Message ?? "").Trim();
        var images = request.Images ?? [];
        if (text.Length == 0 && images.Count == 0) throw new EditorException("empty", "Write a message.", 400);
        if (text.Length > MaxMessage) throw new EditorException("message_too_long", $"Messages can be at most {MaxMessage:N0} characters.", 413);
        if (images.Count > MaxImages) throw new EditorException("too_many_images", $"Attach at most {MaxImages} images per message.", 413);
        var limits = settings.Limits;
        var (mine, site) = store.MessagesToday(user.Key);
        if (limits.MessagesPerUser > 0 && mine >= limits.MessagesPerUser) throw new EditorException("user_quota", $"You have used your {limits.MessagesPerUser} messages for today. The limit is set under Content assistant → Settings.", 429);
        if (limits.MessagesPerDay > 0 && site >= limits.MessagesPerDay) throw new EditorException("daily_quota", "The content assistant has reached the site's daily limit. Try again tomorrow.", 429);
        var attachments = new List<StoredBlock>();
        foreach (var image in images)
        {
            var (mediaType, data) = Image(image.Data);
            if (mediaType == null) throw new EditorException("invalid_image", "Only PNG, JPEG, WebP and GIF images can be attached.", 415);
            if (data.Length > MaxImageBase64) throw new EditorException("image_too_large", "Images can be at most 5 MB.", 413);
            attachments.Add(new StoredBlock { Type = "image", MediaType = mediaType, Data = data, Name = string.IsNullOrWhiteSpace(image.Name) ? "image" : image.Name.Trim()[..Math.Min(image.Name.Trim().Length, 120)] });
        }

        var chat = request.ChatId is { } id ? store.Chat(id, user.Key) ?? throw new EditorException("not_found", "This conversation no longer exists.", 404)
            : new EditorChatRow { Id = Guid.NewGuid(), UserKey = user.Key, CreatedUtc = DateTime.UtcNow, Title = Title(text, attachments) };
        if (!running.TryAdd(chat.Id, 0)) throw new EditorException("busy", "The assistant is still working on this conversation.", 409);
        try
        {
            var run = await StartAsync(http, chat, user, settings, request.Mode, request.Page);
            var state = run.State;
            state.Effort = Effort(settings, request.Effort, options.Value.ContentAssistant.Effort);
            await run.Stream.Send("chat", new { id = chat.Id, title = chat.Title, mode = run.Mode, effort = state.Effort });
            // A message while changes wait for approval declines them: the editor moved on.
            if (state.Pending != null) await ResolveAsync(run, [], "The editor did not answer this and wrote a new message instead.");
            if (Estimate(state) > CompactAt()) await CompactAsync(run);

            var first = state.Attachments.Count + 1;
            state.Attachments.AddRange(attachments);
            foreach (var image in attachments) run.Context.Attachments.Add((image.Name ?? "image", image.MediaType ?? "image/png", image.Data ?? ""));
            var blocks = new List<StoredBlock> { StoredBlock.Of(EditorPrompt.Context(user, DateTime.Now, await PageLineAsync(run.Context, request.Page), run.Mode)) };
            for (var i = 0; i < attachments.Count; i++)
            {
                blocks.Add(StoredBlock.Of($"[Image {first + i} attached: {attachments[i].Name}]"));
                blocks.Add(new StoredBlock { Type = "image", MediaType = attachments[i].MediaType, Data = attachments[i].Data });
            }
            if (text.Length > 0) blocks.Add(StoredBlock.Of(text));
            AppendUser(state, blocks);
            state.Request = text.Length > 500 ? text[..500] : text;
            state.Steps = 0; state.AutoChanges = 0;
            chat.Messages++;
            await run.Item(new EditorItem { Id = NewId(), Type = "user", At = DateTime.UtcNow, Text = text, Page = await PageInfoAsync(run.Context, request.Page), Images = attachments.Count > 0 ? attachments.Select(a => a.Name ?? "image").ToList() : null });
            store.Count(user.Key, user.Name, u => u.Messages++);
            await LoopAsync(run, http.RequestAborted);
        }
        finally { running.TryRemove(chat.Id, out _); }
    }

    /// <summary>The editor approved or declined the changes that wait; the assistant continues.</summary>
    public async Task DecideAsync(HttpContext http, EditorUser user, EditorDecideRequest request)
    {
        var settings = Check(user);
        var chat = store.Chat(request.ChatId, user.Key) ?? throw new EditorException("not_found", "This conversation no longer exists.", 404);
        // Read only changes nothing, not even a change that waited from before the switch: it can still be declined.
        if (EditorAccess.Mode(settings, user, request.Mode ?? chat.Mode) == EditorModes.ReadOnly && (request.Decisions ?? []).Any(d => d.Approve))
            throw new EditorException("read_only", "Read only mode changes nothing. Switch to Manual, Auto or Bypass to approve.", 409);
        if (!running.TryAdd(chat.Id, 0)) throw new EditorException("busy", "The assistant is still working on this conversation.", 409);
        try
        {
            var run = await StartAsync(http, chat, user, settings, request.Mode, request.Page);
            if (run.State.Pending == null) { await run.Stream.Send("done", new { }); await run.Stream.DisposeAsync(); return; }
            await run.Stream.Send("chat", new { id = chat.Id, title = chat.Title, mode = run.Mode, effort = run.State.Effort });
            await ResolveAsync(run, request.Decisions ?? [], null);
            await LoopAsync(run, http.RequestAborted);
        }
        finally { running.TryRemove(chat.Id, out _); }
    }

    /// <summary>Licensed, switched on, Claude set up, and this user may use it. Throws with the reason.</summary>
    public EditorSettings Check(EditorUser user)
    {
        if (!options.Value.Features.ContentAssistant) throw new EditorException("not_licensed", "The content assistant is not included in this installation.", 404);
        var settings = store.Settings().Settings;
        if (!settings.Enabled) throw new EditorException("disabled", "The content assistant is switched off (Content assistant → Settings).", 403);
        if (EditorAccess.Modes(settings, user).Length == 0) throw new EditorException("forbidden", "Your user group may not use the content assistant.", 403);
        if (!model.Ready) throw new EditorException("not_configured", "The content assistant needs an Anthropic API key (AI Assistant → Settings → Connection).", 503);
        return settings;
    }

    private async Task<Run> StartAsync(HttpContext http, EditorChatRow chat, EditorUser user, EditorSettings settings, string? wantedMode, EditorOpenPage? page)
    {
        Purge(settings);
        var state = string.IsNullOrEmpty(chat.State) || chat.State == "{}" ? new EditorState() : AssistantJson.Read<EditorState>(chat.State);
        Repair(state);
        var items = string.IsNullOrEmpty(chat.Transcript) ? [] : AssistantJson.Read<List<EditorItem>>(chat.Transcript);
        var mode = EditorAccess.Mode(settings, user, wantedMode ?? chat.Mode);
        chat.Mode = mode;
        var context = new ToolContext(settings, user) { OpenCulture = page?.Culture };
        foreach (var image in state.Attachments) context.Attachments.Add((image.Name ?? "image", image.MediaType ?? "image/png", image.Data ?? ""));
        var languages = await content.LanguagesAsync();
        var system = EditorPrompt.System(settings, languages, SiteName(languages));
        return new Run(chat, state, items, context, new EditorStream(http), mode, system, ToolsFor(settings, state, mode));
    }

    /// <summary>
    /// The tools declared to the model: those the settings allow (in Read only mode only those that read), plus any the
    /// conversation already used. The API refuses a conversation whose earlier tool calls name a tool it does not declare, so an
    /// action switched off later stays declared, but calling it is refused ("Not allowed") and the instructions say it is not possible.
    /// </summary>
    public static List<EditorTool> ToolsFor(EditorSettings settings, EditorState state, string mode = EditorModes.Manual)
    {
        var tools = EditorTools.For(settings);
        if (mode == EditorModes.ReadOnly) tools = [.. tools.Where(t => t.Action == null)];
        foreach (var name in state.Messages.SelectMany(m => m.Blocks).Where(b => b.Type == "tool_use").Select(b => b.Name).Distinct())
            if (EditorTools.Find(name ?? "") is { } used && !tools.Contains(used)) tools.Add(used);
        return tools;
    }

    /// <summary>The site's name from the website assistant's settings, else the backoffice host.</summary>
    private string SiteName(IReadOnlyList<Umbraco.Cms.Core.Models.ILanguage> _)
    {
        try { if (site.Settings().Settings.Behaviour.SiteName is { Length: > 0 } name) return name; } catch (Exception) { }
        return options.Value.BackofficeUrl is { Length: > 0 } url && Uri.TryCreate(url, UriKind.Absolute, out var uri) ? uri.Host : "this website";
    }

    // ---------- the loop ----------
    private async Task LoopAsync(Run run, CancellationToken token)
    {
        var state = run.State;
        var limits = run.Context.Settings.Limits;
        try
        {
            while (!token.IsCancellationRequested)
            {
                var force = state.Steps >= limits.MaxSteps;
                var answerId = NewId();
                var started = false;
                var answer = new StringBuilder();
                ModelRound round;
                try
                {
                    round = await model.RoundAsync(run.System, run.Tools, state.Messages, state.Effort, force, "editor-" + run.Context.User.Key.ToString("N"),
                        async piece =>
                        {
                            answer.Append(piece);
                            if (!started) { started = true; await run.Item(new EditorItem { Id = answerId, Type = "assistant", At = DateTime.UtcNow, Text = "" }); }
                            await run.Stream.Send("delta", new { id = answerId, text = piece });
                        },
                        () => run.Stream.Send("thinking", new { }), token);
                }
                catch (Exception) when (token.IsCancellationRequested)
                {
                    if (started) await Stopped(run, answerId, answer.ToString());
                    break;
                }
                catch (GatewayException e)
                {
                    if (started) await Stopped(run, answerId, answer.ToString());
                    await Problem(run, e.Code, e.Message);
                    break;
                }
                Usage(run, round);
                state.Messages.Add(new StoredMessage { Role = "assistant", Blocks = round.Blocks });
                if (started) await run.Item(new EditorItem { Id = answerId, Type = "assistant", At = DateTime.UtcNow, Text = round.Text });

                var calls = round.Blocks.Where(b => b.Type == "tool_use").ToList();
                if (round.StopReason != "tool_use" || calls.Count == 0)
                {
                    if (round.StopReason == "max_tokens" && round.Text.Length == 0) await Problem(run, "thinking_limit", "The assistant thought for too long without an answer. Try again, or ask for less at once.");
                    else if (round.StopReason == "refusal" && round.Text.Length == 0) await Problem(run, "refused", "The assistant declined this request.");
                    else if (round.Text.Trim().Length == 0) await Problem(run, "empty_answer", "The assistant did not write an answer. Try again.");
                    break;
                }

                var pending = new PendingRound();
                var waiting = false;
                foreach (var call in calls)
                {
                    state.Steps++;
                    store.Count(run.Context.User.Key, run.Context.User.Name, u => u.Steps++);
                    var input = call.Input ?? default;
                    var entry = new PendingCall { Id = call.Id ?? "", Name = call.Name ?? "", Input = input.ValueKind == JsonValueKind.Undefined ? JsonDocument.Parse("{}").RootElement.Clone() : input };
                    var tool = EditorTools.Find(entry.Name);
                    if (tool == null || (tool.Action != null && !run.Context.Settings.Actions.Contains(tool.Action)))
                    {
                        entry.Result = tool == null ? $"Error: unknown tool {entry.Name}." : $"Not allowed: this site does not let the assistant {EditorAccess.Verb(tool.Action!)} pages.";
                        entry.Error = true;
                        await run.Item(new EditorItem { Id = entry.ItemId = NewId(), Type = "step", At = DateTime.UtcNow, Tool = entry.Name, Text = $"Could not {Verb(entry.Name)}", State = "failed", Detail = tool == null ? "unknown tool" : "not allowed on this site" });
                    }
                    else if (tool.Action == null) await ReadAsync(run, entry);
                    else if (run.Mode == EditorModes.ReadOnly)
                    {
                        // Only reachable through a tool the conversation used before switching to Read only (still declared).
                        entry.Result = "Not done: the editor chose Read only mode, so nothing can be changed. Say exactly what you would change (page, field, before → after); they can switch to Manual, Auto or Bypass to have it made.";
                        entry.Error = true;
                        await run.Item(new EditorItem { Id = entry.ItemId = NewId(), Type = "step", At = DateTime.UtcNow, Tool = entry.Name, Text = $"Could not {Verb(entry.Name)}", State = "failed", Detail = "read only mode" });
                    }
                    else
                    {
                        var proposal = await PlanAsync(run, entry);
                        if (proposal.Error != null)
                        {
                            entry.Result = "Not done: " + proposal.Error;
                            entry.Error = true;
                            await run.Item(new EditorItem { Id = entry.ItemId = NewId(), Type = "step", At = DateTime.UtcNow, Tool = entry.Name, Text = $"Could not {Verb(entry.Name)}", State = "failed", Detail = proposal.Error });
                        }
                        else
                        {
                            var (decision, reason) = Decide(run.Mode, run.Context.Settings, proposal, run.State.AutoChanges);
                            entry.Decision = decision;
                            entry.Proposal = proposal;
                            entry.ItemId = NewId();
                            if (decision == "ask" || waiting)
                            {
                                // Once one change waits, the later ones wait too: they run in order after the editor decides.
                                if (decision != "ask") run.State.AutoChanges++;
                                await run.Item(Card(entry, proposal, decision == "ask" ? "pending" : "queued", decision == "ask" ? reason : null));
                                waiting |= decision == "ask";
                            }
                            else
                            {
                                await run.Item(Card(entry, proposal, "running", null));
                                entry.Result = await ExecuteAsync(run, entry, decision);
                                state.AutoChanges++;
                            }
                        }
                    }
                    pending.Calls.Add(entry);
                }
                if (waiting)
                {
                    state.Pending = pending;
                    Save(run);
                    await run.Stream.Send("waiting", new { count = pending.Calls.Count(c => c.Decision == "ask" && c.Result == null) });
                    return;
                }
                AppendResults(state, pending);
                Save(run);
            }
            Save(run);
            await run.Stream.Send("done", new { usage = new { promptTokens = run.Prompt, cachedTokens = run.Cached, completionTokens = run.Output }, context = new { used = Estimate(state), limit = CompactAt() } });
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            logger.LogError(e, "Ligata AI content assistant failed.");
            try { Save(run); await Problem(run, "failed", "Something went wrong. The conversation was saved; try again."); } catch (Exception) { }
        }
        finally { await run.Stream.DisposeAsync(); }
    }

    /// <summary>
    /// Whether a change runs at once. Bypass: always. Auto: safe changes run, risky ones ask. Safe means the kind is listed under
    /// AutoApprove and the change has no risk (it clears nothing, removes no block or most of a text, and changes nothing all
    /// languages share), until AskAfterChanges. Manual: never.
    /// </summary>
    public static (string Decision, string Reason) Decide(string mode, EditorSettings settings, Proposal proposal, int autoChanges)
    {
        switch (mode)
        {
            case EditorModes.Bypass: return ("bypass", "");
            case EditorModes.Auto:
                if (!settings.AutoApprove.Contains(proposal.Kind)) return ("ask", $"{Kind(proposal.Kind)} always asks in Auto mode.");
                if (proposal.Risks.Count > 0) return ("ask", $"Auto mode asks before risky changes: this one {string.Join(", ", proposal.Risks)}.");
                if (settings.AskAfterChanges > 0 && autoChanges >= settings.AskAfterChanges) return ("ask", $"{autoChanges} changes were made for this message without asking: this one asks.");
                return ("auto", "");
            default: return ("ask", "Manual mode: every change waits for you.");
        }
    }

    private static string Kind(string kind) => kind switch
    {
        EditorActions.Publish => "Publishing", EditorActions.Unpublish => "Unpublishing", EditorActions.Move => "Moving", EditorActions.Delete => "Deleting",
        EditorActions.Create => "Creating pages", EditorActions.Media => "Uploading media", _ => "Changing content",
    };

    private static string Verb(string tool) => tool switch
    {
        EditorTools.Update => "change the page", EditorTools.Blocks => "change the blocks", EditorTools.Create => "create the page", EditorTools.Publish => "publish",
        EditorTools.Unpublish => "unpublish", EditorTools.Move => "move the page", EditorTools.Delete => "delete the page", EditorTools.Upload => "upload the image", _ => tool,
    };

    private async Task ReadAsync(Run run, PendingCall entry)
    {
        var item = new EditorItem { Id = entry.ItemId = NewId(), Type = "step", At = DateTime.UtcNow, Tool = entry.Name, State = "running" };
        try { item.Text = tools.Label(run.Context, entry.Name, entry.Input); } catch (Exception) { item.Text = entry.Name; }
        await run.Item(item);
        try
        {
            var (result, navigate) = await tools.ReadAsync(run.Context, entry.Name, entry.Input);
            entry.Result = result;
            entry.Error = result.StartsWith("Error:");
            item.State = entry.Error ? "failed" : "done";
            item.Detail = entry.Error ? result[6..].Trim() : Summary(entry.Name, result);
            if (navigate is { } go)
            {
                item.Page = new EditorPageInfo(go.Key, go.Name, go.Culture);
                await run.Stream.Send("navigate", new { key = go.Key, culture = go.Culture, name = go.Name });
            }
        }
        catch (Exception e)
        {
            logger.LogWarning(e, "Ligata AI content assistant: {Tool} failed.", entry.Name);
            entry.Result = "Error: the tool failed on the server. Try another way or tell the editor.";
            entry.Error = true;
            item.State = "failed"; item.Detail = "The tool failed on the server.";
        }
        await run.Item(item);
    }

    /// <summary>"3 pages found", "12 fields": a few words about a read result for the chat.</summary>
    private static string? Summary(string tool, string result)
    {
        var first = result.Split('\n')[0];
        return tool switch
        {
            EditorTools.Search or EditorTools.Media => System.Text.RegularExpressions.Regex.Match(first, @"^(\d+ (pages?|media items?) found|No (pages|media)[^.]*)") is { Success: true } m ? m.Value : first.Length > 60 ? first[..60] + "…" : first.TrimEnd(':'),
            EditorTools.Read => $"{result.Split('\n').Count(l => l.TrimStart().StartsWith("- "))} fields",
            _ => null,
        };
    }

    private async Task<Proposal> PlanAsync(Run run, PendingCall entry)
    {
        try { return await tools.PlanAsync(run.Context, entry.Name, entry.Input); }
        catch (Exception e)
        {
            logger.LogWarning(e, "Ligata AI content assistant could not plan {Tool}.", entry.Name);
            return Proposal.Refused("The change could not be prepared on the server.");
        }
    }

    private static EditorItem Card(PendingCall entry, Proposal proposal, string state, string? reason) => new()
    {
        Id = entry.ItemId, Type = "change", At = DateTime.UtcNow, Tool = entry.Name, State = state,
        Change = new EditorChangeView
        {
            Kind = proposal.Kind, Title = proposal.Title, DocumentKey = proposal.DocumentKey, DocumentName = proposal.DocumentName, Culture = proposal.Culture,
            Changes = proposal.Changes.Select(c => c with { Before = null, After = null, BeforeText = Cut(c.BeforeText), AfterText = Cut(c.AfterText) }).ToList(),
            Notes = proposal.Notes, Reason = reason, Approval = entry.Decision is "auto" or "bypass" ? entry.Decision : null,
        },
    };

    private static string? Cut(string? text) => text is { Length: > 3000 } ? text[..3000] + " …" : text;

    /// <summary>Makes a change (planned again from the current content), logs it and tells the panel. Returns what the model is told.</summary>
    private async Task<string> ExecuteAsync(Run run, PendingCall entry, string approval)
    {
        Proposal plan;
        try { plan = await tools.PlanAsync(run.Context, entry.Name, entry.Input); }
        catch (Exception e) { logger.LogWarning(e, "Ligata AI content assistant could not plan {Tool}.", entry.Name); plan = Proposal.Refused("The change could not be prepared on the server."); }
        if (plan.Error == null && entry.Proposal != null && !SameBefore(entry.Proposal, plan))
            plan = Proposal.Refused("The content changed after this change was proposed. Read the page again before changing it.");
        string result, outcome;
        string? error = null;
        if (plan.Error != null) { result = "Not done: " + plan.Error; outcome = "failed"; error = plan.Error; }
        else
        {
            try { result = await plan.Commit!(); outcome = "done"; }
            catch (EditorToolException e) { result = "Not done: " + e.Message; outcome = "failed"; error = e.Message; }
            catch (Exception e)
            {
                logger.LogError(e, "Ligata AI content assistant: {Tool} failed.", entry.Name);
                result = "Not done: the change failed on the server."; outcome = "failed"; error = "The change failed on the server.";
            }
        }
        var shown = plan.Error == null ? plan : entry.Proposal ?? plan;
        var action = Log(run, entry, shown, approval, outcome, error);
        var card = Card(entry, shown, outcome, null);
        card.Change!.Approval = approval;
        card.Change.ActionId = action.Id;
        card.Detail = outcome == "done" ? result.Split('\n')[0] : error;
        await run.Item(card);
        if (outcome == "done")
        {
            store.Count(run.Context.User.Key, run.Context.User.Name, u => u.Changes++);
            await run.Stream.Send("refresh", new { kind = shown.Kind, key = shown.DocumentKey, parent = shown.ParentKey, entity = shown.Kind == EditorActions.Media ? "media" : "document" });
        }
        return approval == "manual" && outcome == "done" ? "The editor approved this change. " + result : result;
    }

    private static bool SameBefore(Proposal shown, Proposal now) =>
        shown.Changes.Count == now.Changes.Count && shown.Changes.Zip(now.Changes).All(p => p.First.Path == p.Second.Path && ContentTools.Same(p.First.Before, p.Second.Before));

    private EditorActionRow Log(Run run, PendingCall entry, Proposal proposal, string approval, string outcome, string? error)
    {
        var row = new EditorActionRow
        {
            Id = Guid.NewGuid(), ChatId = run.Chat.Id, UserKey = run.Context.User.Key, UserName = Max(run.Context.User.Name, 200), CreatedUtc = DateTime.UtcNow,
            Kind = proposal.Kind, Tool = entry.Name, DocumentKey = proposal.DocumentKey, DocumentName = Max(proposal.DocumentName, 255), Culture = proposal.Culture,
            Summary = Max(proposal.Title, 500), Changes = AssistantJson.Write(proposal.Changes), Approval = approval, Outcome = outcome, Error = error == null ? null : Max(error, 500),
            Request = Max(run.State.Request, 500),
        };
        try { store.Log(row); } catch (Exception e) { logger.LogError(e, "Ligata AI content assistant could not write the activity log."); }
        return row;
    }

    private static string Max(string text, int max) => text.Length > max ? text[..max] : text;

    /// <summary>
    /// Settles the round that waited: approved changes run in order, declined ones are logged and reported, changes held behind
    /// them run too. Without decisions (the editor wrote instead) every waiting change is declined.
    /// </summary>
    private async Task ResolveAsync(Run run, List<EditorDecision> decisions, string? declineNote)
    {
        var pending = run.State.Pending!;
        foreach (var entry in pending.Calls)
        {
            if (entry.Result != null) continue;
            var decision = decisions.FirstOrDefault(d => d.Id == entry.ItemId || d.Id == entry.Id);
            if (entry.Decision == "ask" && decision is not { Approve: true })
            {
                var own = decision?.Note?.Trim() is { Length: > 0 } n ? n[..Math.Min(n.Length, 1000)] : null;
                var note = own ?? declineNote;
                entry.Result = "The editor declined this change." + (note != null ? $" Their note: {note}" : "") + " Do not make it again unless they ask for it.";
                Log(run, entry, entry.Proposal!, "manual", "declined", note);
                // The panel shows the editor's own note as theirs; a change left open by a new message says why it did not run.
                var card = Card(entry, entry.Proposal!, "declined", own == null && declineNote != null ? "Not run: you wrote a new message instead." : null);
                card.Detail = own;
                await run.Item(card);
                continue;
            }
            if (run.Mode == EditorModes.ReadOnly)
            {
                // A change queued behind one that asked (Auto) does not run once the editor switched to Read only.
                entry.Result = "Not done: the editor switched to Read only mode before this change ran. Do not make it again unless they ask for it.";
                Log(run, entry, entry.Proposal!, entry.Decision ?? "manual", "declined", "Read only mode");
                await run.Item(Card(entry, entry.Proposal!, "declined", "Not run: you switched to Read only."));
                continue;
            }
            var approval = entry.Decision == "ask" ? "manual" : entry.Decision;
            await run.Item(Card(entry, entry.Proposal!, "running", null));
            entry.Result = await ExecuteAsync(run, entry, approval);
        }
        AppendResults(run.State, pending);
        run.State.Pending = null;
        Save(run);
    }

    /// <summary>A round that broke off between the model's tool calls and their results (a crash, a restart) gets results, or the API refuses the conversation.</summary>
    private static void Repair(EditorState state)
    {
        if (state.Pending != null || state.Messages.Count == 0 || state.Messages[^1].Role != "assistant") return;
        var open = state.Messages[^1].Blocks.Where(b => b.Type == "tool_use").ToList();
        if (open.Count > 0) AppendUser(state, open.Select(b => new StoredBlock { Type = "tool_result", ToolUseId = b.Id, Content = "Interrupted: this was not run.", IsError = true }).ToList());
    }

    private static void AppendResults(EditorState state, PendingRound round) =>
        AppendUser(state, round.Calls.Select(c => new StoredBlock { Type = "tool_result", ToolUseId = c.Id, Content = c.Result ?? "No result.", IsError = c.Error }).ToList());

    /// <summary>Adds to the conversation as the user: into the last message when that is the user's (tool results, then the new message).</summary>
    private static void AppendUser(EditorState state, List<StoredBlock> blocks)
    {
        if (state.Messages.Count > 0 && state.Messages[^1].Role == "user")
        {
            // Tool results must come first in a user message.
            var target = state.Messages[^1].Blocks;
            target.AddRange(blocks);
            var ordered = target.Where(b => b.Type == "tool_result").Concat(target.Where(b => b.Type != "tool_result")).ToList();
            target.Clear(); target.AddRange(ordered);
        }
        else state.Messages.Add(new StoredMessage { Role = "user", Blocks = blocks });
    }

    // ---------- long conversations ----------
    public int CompactAt() => Math.Max(8_000, Math.Min(options.Value.ContentAssistant.CompactAtTokens, (int)(model.ContextTokens * 0.8)));

    /// <summary>Tokens the conversation takes, estimated (images about 1,600 each), plus the instructions and tools.</summary>
    public static int Estimate(EditorState state) =>
        (int)(state.Messages.Sum(m => m.Blocks.Sum(b => b.Characters)) / 3.2) + state.Messages.Sum(m => m.Blocks.Count(b => b.Type == "image")) * 1600 + 6000;

    private async Task CompactAsync(Run run)
    {
        var state = run.State;
        var messages = state.Messages.Select(m => new StoredMessage { Role = m.Role, Blocks = [.. m.Blocks] }).ToList();
        if (messages.Count > 0 && messages[^1].Role == "user") messages[^1].Blocks.Add(StoredBlock.Of(SummaryInstruction));
        else messages.Add(new StoredMessage { Role = "user", Blocks = [StoredBlock.Of(SummaryInstruction)] });
        var item = new EditorItem { Id = NewId(), Type = "notice", At = DateTime.UtcNow, Text = "Summarizing the conversation so far…", State = "running" };
        await run.Item(item);
        try
        {
            var round = await model.RoundAsync(run.System, run.Tools, messages, state.Effort, forceAnswer: true, "editor-" + run.Context.User.Key.ToString("N"), _ => Task.CompletedTask, () => Task.CompletedTask, CancellationToken.None);
            Usage(run, round);
            if (round.Text.Trim().Length == 0) throw new GatewayException("empty_answer", "No summary.", 502);
            state.Messages = [new StoredMessage { Role = "user", Blocks = [StoredBlock.Of(SummaryMessage(round.Text))] }];
            state.Summaries++;
            item.Text = "The conversation so far was summarized to keep it short. Earlier details may need to be looked up again.";
            item.State = "done";
        }
        catch (GatewayException e)
        {
            logger.LogWarning("Ligata AI content assistant could not summarize a conversation ({Code}).", e.Code);
            item.Text = "The conversation is long; start a new one if the assistant loses track.";
            item.State = "failed";
        }
        await run.Item(item);
        Save(run);
    }

    // ---------- helpers ----------
    private void Usage(Run run, ModelRound round)
    {
        run.Prompt += round.Prompt; run.Cached += round.Cached; run.Output += round.Output;
        run.Chat.PromptTokens += round.Prompt; run.Chat.CompletionTokens += round.Output;
        store.Count(run.Context.User.Key, run.Context.User.Name, u => { u.PromptTokens += round.Prompt; u.CachedTokens += round.Cached; u.CompletionTokens += round.Output; });
    }

    private async Task Stopped(Run run, string id, string text) =>
        await run.Item(new EditorItem { Id = id, Type = "assistant", At = DateTime.UtcNow, Text = text, State = "stopped" });

    private async Task Problem(Run run, string code, string message)
    {
        await run.Item(new EditorItem { Id = NewId(), Type = "error", At = DateTime.UtcNow, Text = message, State = code });
        await run.Stream.Send("error", new { code, message });
    }

    private void Save(Run run)
    {
        run.Chat.UpdatedUtc = DateTime.UtcNow;
        run.Chat.State = AssistantJson.Write(run.State);
        if (run.Items.Count > MaxItems) run.Items.RemoveRange(0, run.Items.Count - MaxItems);
        run.Chat.Transcript = AssistantJson.Write(run.Items);
        store.SaveChat(run.Chat);
    }

    private void Purge(EditorSettings settings)
    {
        var now = DateTime.UtcNow.Ticks;
        var last = Interlocked.Read(ref lastPurge);
        if (now - last < TimeSpan.FromHours(1).Ticks || Interlocked.CompareExchange(ref lastPurge, now, last) != last) return;
        try { store.Purge(settings, DateTime.UtcNow); } catch (Exception e) { logger.LogWarning(e, "Ligata AI content assistant could not delete old conversations."); }
    }

    public static string NewId() => Guid.NewGuid().ToString("N")[..12];

    private static string Title(string text, List<StoredBlock> images)
    {
        var t = text.Replace('\n', ' ').Trim();
        if (t.Length == 0) t = images.Count > 0 ? "Image" : "Conversation";
        return t.Length > 80 ? t[..80].TrimEnd() + "…" : t;
    }

    /// <summary>The effort for a message: the chat's choice when allowed, else LigataAI:ContentAssistant:Effort when set, else the backoffice default.</summary>
    public static string Effort(EditorSettings settings, string? wanted, string? configured = null) =>
        settings.EffortInChat && wanted != null && EditorValidation.ChatEfforts.Contains(wanted) ? wanted : Configured(configured) ?? settings.Effort;

    /// <summary>A valid effort from the host configuration, or null.</summary>
    public static string? Configured(string? effort) => effort?.Trim().ToLowerInvariant() is { Length: > 0 } e && EditorValidation.Efforts.Contains(e) ? e : null;

    private static (string? MediaType, string Data) Image(string? value)
    {
        var data = value ?? "";
        string? type = null;
        if (data.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            var comma = data.IndexOf(',');
            if (comma < 0) return (null, "");
            type = data[5..comma].Split(';')[0].ToLowerInvariant();
            data = data[(comma + 1)..];
        }
        type ??= data.StartsWith("iVBOR") ? "image/png" : data.StartsWith("/9j/") ? "image/jpeg" : data.StartsWith("UklGR") ? "image/webp" : data.StartsWith("R0lGOD") ? "image/gif" : null;
        return type is "image/png" or "image/jpeg" or "image/webp" or "image/gif" ? (type, data) : (null, "");
    }

    private async Task<string?> PageLineAsync(ToolContext context, EditorOpenPage? open)
    {
        if (open == null) return null;
        var page = content.Find(open.Key.ToString());
        if (page == null || !await content.ReadableForUserAsync(context, page)) return null;
        var (culture, _) = await content.CultureAsync(context, page.ContentType, open.Culture);
        return $"Open in the backoffice: the page “{content.Name(page, culture)}” — key {page.Key}, type {page.ContentType.Alias}{(culture != null ? $", language {culture}" : "")}. When the editor says “this page”, they mean it.";
    }

    private async Task<EditorPageInfo?> PageInfoAsync(ToolContext context, EditorOpenPage? open)
    {
        if (open == null) return null;
        var page = content.Find(open.Key.ToString());
        if (page == null || !await content.ReadableForUserAsync(context, page)) return null;
        var (culture, _) = await content.CultureAsync(context, page.ContentType, open.Culture);
        return new EditorPageInfo(page.Key, content.Name(page, culture), culture);
    }
}

/// <summary>Server-sent events with a heartbeat. Writing after the browser left is ignored: the work goes on and is saved.</summary>
public sealed class EditorStream : IAsyncDisposable
{
    private readonly HttpContext http;
    private readonly SemaphoreSlim write = new(1, 1);
    private readonly CancellationTokenSource stop = new();
    private readonly Task heartbeat;
    private bool gone;

    public EditorStream(HttpContext http)
    {
        this.http = http;
        http.Features.Get<IHttpResponseBodyFeature>()?.DisableBuffering();
        http.Response.StatusCode = 200;
        http.Response.ContentType = "text/event-stream; charset=utf-8";
        http.Response.Headers.CacheControl = "no-store";
        http.Response.Headers["X-Accel-Buffering"] = "no";
        heartbeat = Beat();
    }

    private async Task Beat()
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(15));
        try { while (await timer.WaitForNextTickAsync(stop.Token)) await Write(": ping\n\n"); }
        catch (Exception) { }
    }

    public Task Send(string name, object data) => Write($"event: {name}\ndata: {JsonSerializer.Serialize(data, AssistantJson.Options)}\n\n");

    private async Task Write(string text)
    {
        if (gone) return;
        try
        {
            await write.WaitAsync();
            try
            {
                await http.Response.WriteAsync(text, http.RequestAborted);
                await http.Response.Body.FlushAsync(http.RequestAborted);
            }
            finally { write.Release(); }
        }
        catch (Exception) { gone = true; }
    }

    public async ValueTask DisposeAsync()
    {
        if (stop.IsCancellationRequested) return;
        stop.Cancel();
        await heartbeat;
        stop.Dispose();
    }
}
