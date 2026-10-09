using Ligata.AI.Models;
using NPoco;
using Umbraco.Cms.Infrastructure.Persistence.DatabaseAnnotations;
using Umbraco.Cms.Infrastructure.Scoping;

namespace Ligata.AI.Editor;

[TableName("LigataAIEditorSettings"), PrimaryKey("Id", AutoIncrement = false), ExplicitColumns]
public sealed class EditorSettingsRow
{
    [Column("Id"), PrimaryKeyColumn(AutoIncrement = false)] public int Id { get; set; } = 1;
    [Column("Version")] public int Version { get; set; }
    [Column("Json"), SpecialDbType(SpecialDbTypes.NVARCHARMAX)] public string Json { get; set; } = "";
    [Column("UpdatedUtc")] public DateTime UpdatedUtc { get; set; }
}

/// <summary>One conversation of one backoffice user: what the model sees (State) and what the chat shows (Transcript).</summary>
[TableName("LigataAIEditorChat"), PrimaryKey("Id", AutoIncrement = false), ExplicitColumns]
public sealed class EditorChatRow
{
    [Column("Id"), PrimaryKeyColumn(AutoIncrement = false)] public Guid Id { get; set; }
    [Column("UserKey"), Index(IndexTypes.NonClustered)] public Guid UserKey { get; set; }
    [Column("Title"), Length(200)] public string Title { get; set; } = "";
    [Column("Mode"), Length(10)] public string Mode { get; set; } = EditorModes.Manual;
    [Column("State"), SpecialDbType(SpecialDbTypes.NVARCHARMAX)] public string State { get; set; } = "{}";
    [Column("Transcript"), SpecialDbType(SpecialDbTypes.NVARCHARMAX)] public string Transcript { get; set; } = "[]";
    [Column("Messages")] public int Messages { get; set; }
    [Column("PromptTokens")] public long PromptTokens { get; set; }
    [Column("CompletionTokens")] public long CompletionTokens { get; set; }
    [Column("CreatedUtc")] public DateTime CreatedUtc { get; set; }
    [Column("UpdatedUtc"), Index(IndexTypes.NonClustered)] public DateTime UpdatedUtc { get; set; }
}

/// <summary>Something the assistant did or proposed: who steered it, what changed (before and after), how it was approved.</summary>
[TableName("LigataAIEditorAction"), PrimaryKey("Id", AutoIncrement = false), ExplicitColumns]
public sealed class EditorActionRow
{
    [Column("Id"), PrimaryKeyColumn(AutoIncrement = false)] public Guid Id { get; set; }
    [Column("ChatId"), Index(IndexTypes.NonClustered)] public Guid ChatId { get; set; }
    [Column("UserKey"), Index(IndexTypes.NonClustered)] public Guid UserKey { get; set; }
    [Column("UserName"), Length(200)] public string UserName { get; set; } = "";
    [Column("CreatedUtc"), Index(IndexTypes.NonClustered)] public DateTime CreatedUtc { get; set; }
    /// <summary>edit | create | publish | unpublish | move | delete | media</summary>
    [Column("Kind"), Length(20)] public string Kind { get; set; } = "";
    [Column("Tool"), Length(40)] public string Tool { get; set; } = "";
    [Column("DocumentKey"), NullSetting(NullSetting = NullSettings.Null), Index(IndexTypes.NonClustered)] public Guid? DocumentKey { get; set; }
    [Column("DocumentName"), Length(255)] public string DocumentName { get; set; } = "";
    [Column("Culture"), Length(20), NullSetting(NullSetting = NullSettings.Null)] public string? Culture { get; set; }
    [Column("Summary"), Length(500)] public string Summary { get; set; } = "";
    /// <summary>JSON: the changes with their values before and after (see <see cref="EditorChange"/>).</summary>
    [Column("Changes"), SpecialDbType(SpecialDbTypes.NVARCHARMAX)] public string Changes { get; set; } = "[]";
    /// <summary>manual (the user approved) | auto (Auto mode) | bypass (Bypass mode) | undo (the user undid an earlier action)</summary>
    [Column("Approval"), Length(10)] public string Approval { get; set; } = "";
    /// <summary>done | failed | declined | undone</summary>
    [Column("Outcome"), Length(12)] public string Outcome { get; set; } = "";
    [Column("Error"), Length(500), NullSetting(NullSetting = NullSettings.Null)] public string? Error { get; set; }
    /// <summary>The user's message the action answered (shortened).</summary>
    [Column("Request"), Length(500)] public string Request { get; set; } = "";
    [Column("UndoneUtc"), NullSetting(NullSetting = NullSettings.Null)] public DateTime? UndoneUtc { get; set; }
    [Column("UndoneBy"), Length(200), NullSetting(NullSetting = NullSettings.Null)] public string? UndoneBy { get; set; }
}

/// <summary>Daily usage per user (messages, steps, changes, tokens), apart from the website assistant's counters.</summary>
[TableName("LigataAIEditorUsage"), PrimaryKey("Id", AutoIncrement = false), ExplicitColumns]
public sealed class EditorUsageRow
{
    /// <summary>Day + ":" + user key.</summary>
    [Column("Id"), PrimaryKeyColumn(AutoIncrement = false), Length(60)] public string Id { get; set; } = "";
    [Column("Day"), Length(10), Index(IndexTypes.NonClustered)] public string Day { get; set; } = "";
    [Column("UserKey")] public Guid UserKey { get; set; }
    [Column("UserName"), Length(200)] public string UserName { get; set; } = "";
    [Column("Messages")] public int Messages { get; set; }
    [Column("Steps")] public int Steps { get; set; }
    [Column("Changes")] public int Changes { get; set; }
    [Column("PromptTokens")] public long PromptTokens { get; set; }
    [Column("CachedTokens")] public long CachedTokens { get; set; }
    [Column("CompletionTokens")] public long CompletionTokens { get; set; }
}

/// <summary>One field change with the stored values before and after (what Undo puts back).</summary>
public sealed record EditorChange(string Path, string Label, string? Culture, string? Before, string? After, string? BeforeText = null, string? AfterText = null);

/// <summary>activity filter: kind (edit, publish, …, or declined/failed/undone), user, a page or words in the summary.</summary>
public sealed record ActivityQuery(string? Kind = null, Guid? User = null, Guid? Document = null, string? Search = null, int Skip = 0, int Take = 50);

public sealed class EditorStore(IScopeProvider scopes)
{
    private static readonly object Gate = new();
    private static volatile EditorSettingsRow? cached;

    // ---------- settings ----------
    private EditorSettingsRow Row()
    {
        if (cached is { } hit) return hit;
        lock (Gate)
        {
            using var scope = scopes.CreateScope();
            var row = scope.Database.SingleOrDefaultById<EditorSettingsRow>(1);
            if (row == null)
            {
                row = new EditorSettingsRow { Id = 1, Json = AssistantJson.Write(new EditorSettings()), UpdatedUtc = DateTime.UtcNow };
                scope.Database.Insert(row);
            }
            scope.Complete();
            return cached = row;
        }
    }

    public (EditorSettings Settings, int Version) Settings()
    {
        var row = Row();
        return (AssistantJson.Read<EditorSettings>(row.Json), row.Version);
    }

    public int Save(EditorSettings settings, int expectedVersion)
    {
        EditorValidation.Settings(settings);
        lock (Gate)
        {
            Row();
            using var scope = scopes.CreateScope();
            var count = scope.Database.Execute("UPDATE LigataAIEditorSettings SET Json=@0, Version=Version+1, UpdatedUtc=@1 WHERE Id=1 AND Version=@2", AssistantJson.Write(settings), DateTime.UtcNow, expectedVersion);
            cached = null;
            if (count != 1) throw new AssistantConflictException("The settings were changed elsewhere. Reload before saving.");
            scope.Complete();
            return expectedVersion + 1;
        }
    }

    // ---------- conversations ----------
    public EditorChatRow? Chat(Guid id, Guid user)
    {
        using var scope = scopes.CreateScope(autoComplete: true);
        return scope.Database.FirstOrDefault<EditorChatRow>("WHERE Id=@0 AND UserKey=@1", id, user);
    }

    /// <summary>The user's conversations, newest first (without their content).</summary>
    public List<EditorChatRow> Chats(Guid user, int take = 30)
    {
        using var scope = scopes.CreateScope(autoComplete: true);
        return scope.Database.Fetch<EditorChatRow>("SELECT Id, UserKey, Title, Mode, Messages, PromptTokens, CompletionTokens, CreatedUtc, UpdatedUtc FROM LigataAIEditorChat WHERE UserKey=@0 ORDER BY UpdatedUtc DESC", user).Take(Math.Clamp(take, 1, 200)).ToList();
    }

    public void SaveChat(EditorChatRow row)
    {
        using var scope = scopes.CreateScope();
        if (scope.Database.ExecuteScalar<int>("SELECT COUNT(*) FROM LigataAIEditorChat WHERE Id=@0", row.Id) == 0) scope.Database.Insert(row);
        else scope.Database.Update(row);
        scope.Complete();
    }

    public bool DeleteChat(Guid id, Guid user)
    {
        using var scope = scopes.CreateScope();
        var count = scope.Database.Execute("DELETE FROM LigataAIEditorChat WHERE Id=@0 AND UserKey=@1", id, user);
        scope.Complete();
        return count > 0;
    }

    // ---------- activity ----------
    public void Log(EditorActionRow row)
    {
        using var scope = scopes.CreateScope();
        if (scope.Database.ExecuteScalar<int>("SELECT COUNT(*) FROM LigataAIEditorAction WHERE Id=@0", row.Id) == 0) scope.Database.Insert(row);
        else scope.Database.Update(row);
        scope.Complete();
    }

    public EditorActionRow? Action(Guid id)
    {
        using var scope = scopes.CreateScope(autoComplete: true);
        return scope.Database.SingleOrDefaultById<EditorActionRow>(id);
    }

    public (List<EditorActionRow> Items, int Total) Activity(ActivityQuery q)
    {
        var where = new List<string>(); var args = new List<object>();
        string Arg(object value) { args.Add(value); return "@" + (args.Count - 1); }
        if (q.Kind is "declined" or "failed" or "undone") where.Add($"Outcome={Arg(q.Kind)}");
        else if (q.Kind != null && EditorActions.All.Contains(q.Kind)) where.Add($"Kind={Arg(q.Kind)}");
        if (q.User is { } user) where.Add($"UserKey={Arg(user)}");
        if (q.Document is { } document) where.Add($"DocumentKey={Arg(document)}");
        if (!string.IsNullOrWhiteSpace(q.Search))
        {
            var text = q.Search.Trim().Replace("[", "").Replace("%", "").Replace("_", "");
            var term = Arg("%" + text[..Math.Min(text.Length, 80)] + "%");
            where.Add($"(Summary LIKE {term} OR DocumentName LIKE {term} OR Request LIKE {term} OR UserName LIKE {term})");
        }
        var filter = where.Count == 0 ? "" : "WHERE " + string.Join(" AND ", where);
        using var scope = scopes.CreateScope(autoComplete: true);
        var total = scope.Database.ExecuteScalar<int>("SELECT COUNT(*) FROM LigataAIEditorAction " + filter, args.ToArray());
        var items = scope.Database.SkipTake<EditorActionRow>(Math.Max(0, q.Skip), Math.Clamp(q.Take, 1, 200), filter + " ORDER BY CreatedUtc DESC", args.ToArray());
        return (items, total);
    }

    /// <summary>The people in the activity log (for its filter).</summary>
    public List<(Guid Key, string Name)> ActivityUsers()
    {
        using var scope = scopes.CreateScope(autoComplete: true);
        return scope.Database.Fetch<EditorActionRow>("SELECT DISTINCT UserKey, UserName FROM LigataAIEditorAction").GroupBy(r => r.UserKey).Select(g => (g.Key, g.First().UserName)).OrderBy(u => u.Item2).ToList();
    }

    // ---------- usage ----------
    public static string Today => DateTime.UtcNow.ToString("yyyy-MM-dd");

    public void Count(Guid user, string name, Action<EditorUsageRow> change)
    {
        var day = Today;
        lock (Gate)
        {
            try
            {
                using var scope = scopes.CreateScope();
                var id = day + ":" + user.ToString("N");
                var row = scope.Database.SingleOrDefaultById<EditorUsageRow>(id);
                var isNew = row == null;
                row ??= new EditorUsageRow { Id = id, Day = day, UserKey = user };
                row.UserName = name.Length > 200 ? name[..200] : name;
                change(row);
                if (isNew) scope.Database.Insert(row); else scope.Database.Update(row);
                scope.Complete();
            }
            catch (Exception) { /* Counting must never break a conversation. */ }
        }
    }

    public List<EditorUsageRow> Usage(int days)
    {
        var from = DateTime.UtcNow.AddDays(-Math.Clamp(days, 1, 366)).ToString("yyyy-MM-dd");
        using var scope = scopes.CreateScope(autoComplete: true);
        return scope.Database.Fetch<EditorUsageRow>("WHERE Day>=@0 ORDER BY Day", from);
    }

    /// <summary>Messages today: this user's and the whole site's.</summary>
    public (int User, int Site) MessagesToday(Guid user)
    {
        using var scope = scopes.CreateScope(autoComplete: true);
        var rows = scope.Database.Fetch<EditorUsageRow>("WHERE Day=@0", Today);
        return (rows.Where(r => r.UserKey == user).Sum(r => r.Messages), rows.Sum(r => r.Messages));
    }

    // ---------- retention ----------
    /// <summary>Deletes conversations and activity past their period. Returns how many rows went.</summary>
    public int Purge(EditorSettings settings, DateTime now)
    {
        using var scope = scopes.CreateScope();
        var chats = scope.Database.Execute("DELETE FROM LigataAIEditorChat WHERE UpdatedUtc<@0", now.AddDays(-settings.Limits.KeepChatsDays));
        var actions = scope.Database.Execute("DELETE FROM LigataAIEditorAction WHERE CreatedUtc<@0", now.AddDays(-settings.Limits.KeepActivityDays));
        var usage = scope.Database.Execute("DELETE FROM LigataAIEditorUsage WHERE Day<@0", now.AddDays(-400).ToString("yyyy-MM-dd"));
        scope.Complete();
        return chats + actions + usage;
    }
}
