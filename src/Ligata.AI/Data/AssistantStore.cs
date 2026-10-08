using System.Security.Cryptography;
using Ligata.AI.Models;
using Umbraco.Cms.Infrastructure.Scoping;

namespace Ligata.AI.Data;

public sealed record KnowledgeSummary(Guid Id, string Title, string Kind, string Source, Guid? ContentKey, int Tokens, bool Estimated, bool Enabled, int SortOrder, DateTime UpdatedUtc, int Characters, string Preview, bool Pinned = false);

/// <summary>Settings, knowledge and anonymous daily counters, all in the host's CMS database.</summary>
public sealed class AssistantStore(IScopeProvider scopes)
{
    private static readonly object Gate = new();
    // Pages read the settings on every render; keep the row in memory until it changes (single process).
    private static volatile SettingsRow? cached;
    private static volatile List<KnowledgeSummary>? cachedKnowledge;
    public const int MaxKnowledgeItems = 300;
    public const int MaxKnowledgeCharacters = 2_000_000;

    private static SettingsRow NewRow() => new()
    {
        Id = 1, Version = 0, Json = AssistantJson.Write(new AssistantSettings()), UpdatedUtc = DateTime.UtcNow,
        VisitorSecret = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
    };

    public SettingsRow Row()
    {
        if (cached is { } hit) return hit;
        lock (Gate)
        {
            using var scope = scopes.CreateScope();
            var row = scope.Database.SingleOrDefaultById<SettingsRow>(1);
            if (row == null) { row = NewRow(); scope.Database.Insert(row); }
            scope.Complete();
            return cached = row;
        }
    }

    public (AssistantSettings Settings, int Version) Settings()
    {
        var row = Row();
        var settings = AssistantJson.Read<AssistantSettings>(row.Json);
        // An untouched notice from an earlier version reads as today's default (shown translated to visitors).
        if (AssistantIdentity.EarlierDefaultNotices.Contains(settings.Identity.PrivacyNotice)) settings = settings with { Identity = settings.Identity with { PrivacyNotice = AssistantIdentity.DefaultPrivacyNotice } };
        // Likewise the earlier conversation limit: conversations may now use what the AI server gives each one.
        if (settings.Behaviour.ContextLimit == AssistantBehaviour.EarlierDefaultContextLimit) settings = settings with { Behaviour = settings.Behaviour with { ContextLimit = AssistantBehaviour.DefaultContextLimit } };
        return (settings, row.Version);
    }

    public int Save(AssistantSettings settings, int expectedVersion)
    {
        AssistantValidation.Settings(settings);
        lock (Gate)
        {
            Row();
            using var scope = scopes.CreateScope();
            var count = scope.Database.Execute("UPDATE LigataAISettings SET Json=@0, Version=Version+1, UpdatedUtc=@1 WHERE Id=1 AND Version=@2", AssistantJson.Write(settings), DateTime.UtcNow, expectedVersion);
            if (count != 1) { cached = null; throw new AssistantConflictException("The settings were changed elsewhere. Reload before saving."); }
            scope.Complete();
            cached = null;
            return expectedVersion + 1;
        }
    }

    public void SetKey(string? protectedKey, string? hint)
    {
        lock (Gate)
        {
            Row();
            using var scope = scopes.CreateScope();
            scope.Database.Execute("UPDATE LigataAISettings SET ProtectedKey=@0, KeyHint=@1, UpdatedUtc=@2 WHERE Id=1", (object?)protectedKey ?? DBNull.Value, (object?)hint ?? DBNull.Value, DateTime.UtcNow);
            scope.Complete();
            cached = null;
        }
    }

    public List<KnowledgeSummary> Knowledge()
    {
        if (cachedKnowledge is { } hit) return hit;
        using var scope = scopes.CreateScope(autoComplete: true);
        // SUBSTRING keeps list responses small even when items hold whole documents (SQLite and SQL Server).
        return scope.Database.Fetch<KnowledgeRow>("SELECT Id, Title, Kind, Source, ContentKey, Characters, Tokens, Estimated, Enabled, SortOrder, UpdatedUtc, Pinned, SUBSTRING(Text, 1, 300) AS Text FROM LigataAIKnowledge ORDER BY SortOrder, Id")
            .Select(r => new KnowledgeSummary(r.Id, r.Title, r.Kind, r.Source, r.ContentKey, r.Tokens, r.Estimated, r.Enabled, r.SortOrder, r.UpdatedUtc, r.Characters, r.Text, r.Pinned)).ToList() is var list ? cachedKnowledge = list : null!;
    }

    /// <summary>Increases with every change to the knowledge items, so the search index knows when to read them again.</summary>
    public static int KnowledgeVersion => knowledgeVersion;
    private static int knowledgeVersion;
    private static void Changed() { cachedKnowledge = null; Interlocked.Increment(ref knowledgeVersion); }

    /// <summary>Enabled knowledge in a stable order. The order keeps the prompt prefix identical between questions, so the GPU can reuse it.</summary>
    public List<KnowledgeRow> EnabledKnowledge()
    {
        using var scope = scopes.CreateScope(autoComplete: true);
        return scope.Database.Fetch<KnowledgeRow>("WHERE Enabled=@0 ORDER BY SortOrder, Id", true);
    }

    /// <summary>Every item with its whole text.</summary>
    public List<KnowledgeRow> KnowledgeRows()
    {
        using var scope = scopes.CreateScope(autoComplete: true);
        return scope.Database.Fetch<KnowledgeRow>("ORDER BY SortOrder, Id");
    }

    public void SetPinned(Guid id, bool pinned)
    {
        using var scope = scopes.CreateScope();
        scope.Database.Execute("UPDATE LigataAIKnowledge SET Pinned=@0, UpdatedUtc=@1 WHERE Id=@2", pinned, DateTime.UtcNow, id);
        scope.Complete();
        Changed();
    }

    public KnowledgeRow? Find(Guid id)
    {
        using var scope = scopes.CreateScope(autoComplete: true);
        return scope.Database.SingleOrDefaultById<KnowledgeRow>(id);
    }

    public KnowledgeRow Upsert(KnowledgeRow row)
    {
        if (string.IsNullOrWhiteSpace(row.Title) || row.Title.Length > 200) throw new AssistantValidationException(new() { ["title"] = "Give the knowledge item a title of up to 200 characters." });
        if (string.IsNullOrWhiteSpace(row.Text)) throw new AssistantValidationException(new() { ["text"] = "The knowledge item has no text." });
        if (row.Text.Length > MaxKnowledgeCharacters) throw new AssistantValidationException(new() { ["text"] = "This item is too long (maximum 2 million characters). Split it into smaller parts." });
        lock (Gate)
        {
            using var scope = scopes.CreateScope();
            row.UpdatedUtc = DateTime.UtcNow;
            row.Characters = row.Text.Length;
            if (scope.Database.SingleOrDefaultById<KnowledgeRow>(row.Id) is { } existing)
            {
                row.SortOrder = existing.SortOrder;
                scope.Database.Update(row);
            }
            else
            {
                if (scope.Database.ExecuteScalar<int>("SELECT COUNT(*) FROM LigataAIKnowledge") >= MaxKnowledgeItems) throw new AssistantValidationException(new() { ["knowledge"] = $"You can keep at most {MaxKnowledgeItems} knowledge items." });
                row.SortOrder = scope.Database.ExecuteScalar<int?>("SELECT MAX(SortOrder) FROM LigataAIKnowledge") + 1 ?? 0;
                scope.Database.Insert(row);
            }
            scope.Complete();
            Changed();
            return row;
        }
    }

    public void SetEnabled(Guid id, bool enabled)
    {
        using var scope = scopes.CreateScope();
        scope.Database.Execute("UPDATE LigataAIKnowledge SET Enabled=@0, UpdatedUtc=@1 WHERE Id=@2", enabled, DateTime.UtcNow, id);
        scope.Complete();
        Changed();
    }

    public void SetTokens(Guid id, int tokens, bool estimated)
    {
        using var scope = scopes.CreateScope();
        scope.Database.Execute("UPDATE LigataAIKnowledge SET Tokens=@0, Estimated=@1 WHERE Id=@2", tokens, estimated, id);
        scope.Complete();
        Changed();
    }

    public void Reorder(IReadOnlyList<Guid> ids)
    {
        lock (Gate)
        {
            using var scope = scopes.CreateScope();
            for (var i = 0; i < ids.Count; i++) scope.Database.Execute("UPDATE LigataAIKnowledge SET SortOrder=@0 WHERE Id=@1", i, ids[i]);
            scope.Complete();
            Changed();
        }
    }

    public void Delete(Guid id)
    {
        using var scope = scopes.CreateScope();
        scope.Database.Delete<KnowledgeRow>(id);
        scope.Complete();
        Changed();
    }

    /// <summary>Adds to today's anonymous counters. No message content, IPs or visitor identifiers are stored.</summary>
    public void Count(Action<StatRow> change)
    {
        var day = DateTime.UtcNow.ToString("yyyy-MM-dd");
        lock (Gate)
        {
            try
            {
                using var scope = scopes.CreateScope();
                var row = scope.Database.SingleOrDefaultById<StatRow>(day);
                var isNew = row == null;
                row ??= new StatRow { Day = day };
                change(row);
                if (isNew) scope.Database.Insert(row); else scope.Database.Update(row);
                scope.Complete();
            }
            catch (Exception) { /* Statistics must never break a visitor's chat. */ }
        }
    }

    public List<StatRow> Stats(int days)
    {
        var from = DateTime.UtcNow.AddDays(-Math.Clamp(days, 1, 366)).ToString("yyyy-MM-dd");
        using var scope = scopes.CreateScope(autoComplete: true);
        return scope.Database.Fetch<StatRow>("WHERE Day>=@0 ORDER BY Day", from);
    }
}
