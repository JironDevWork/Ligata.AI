using System.Collections.Concurrent;
using Umbraco.Cms.Infrastructure.Scoping;

namespace Ligata.AI.Data;

public sealed record ConsentSummary(int Given, int Used, int Withdrawn, int Active);

/// <summary>Consent records (proof of consent). Every question checks one, so recent lookups stay in memory for a minute.</summary>
public sealed class ConsentStore(IScopeProvider scopes)
{
    private static readonly ConcurrentDictionary<Guid, (ConsentRow? Row, DateTime Until)> recent = new();
    private static readonly TimeSpan Remember = TimeSpan.FromMinutes(1);

    /// <param name="history">The history version the visitor also agreed to (the separate checkbox), or null.</param>
    public ConsentRow Create(string version, string engine, string source, string language, DateTime now, DateTime expires, string? history = null)
    {
        var row = new ConsentRow { Id = Guid.NewGuid(), Version = version, Engine = engine, Source = source, Language = language, CreatedUtc = now, ExpiresUtc = expires,
            HistoryVersion = history, HistoryUtc = history == null ? null : now };
        using var scope = scopes.CreateScope();
        scope.Database.Insert(row);
        scope.Complete();
        return row;
    }

    public ConsentRow? Find(Guid id)
    {
        if (recent.TryGetValue(id, out var hit) && hit.Until > DateTime.UtcNow) return hit.Row;
        using var scope = scopes.CreateScope();
        var row = scope.Database.SingleOrDefaultById<ConsentRow>(id);
        scope.Complete();
        if (recent.Count > 20000) recent.Clear();
        recent[id] = (row, DateTime.UtcNow + Remember);
        return row;
    }

    /// <summary>Records the first question or file sent with this consent (unused consents are deleted after a day).</summary>
    public void MarkUsed(ConsentRow row, DateTime now)
    {
        if (row.UsedUtc != null) return;
        row.UsedUtc = now;
        using var scope = scopes.CreateScope();
        scope.Database.Execute("UPDATE LigataAIConsent SET UsedUtc=@0 WHERE Id=@1 AND UsedUtc IS NULL", now, row.Id);
        scope.Complete();
    }

    /// <summary>The visitor lets the site keep their conversations (version) or stops it (null). False for an unknown or withdrawn consent.</summary>
    public bool SetHistory(Guid id, string? version, DateTime now)
    {
        using var scope = scopes.CreateScope();
        var count = version != null
            ? scope.Database.Execute("UPDATE LigataAIConsent SET HistoryVersion=@0, HistoryUtc=@1, HistoryStoppedUtc=NULL WHERE Id=@2 AND WithdrawnUtc IS NULL", version, now, id)
            : scope.Database.Execute("UPDATE LigataAIConsent SET HistoryVersion=NULL, HistoryStoppedUtc=@0 WHERE Id=@1", now, id);
        scope.Complete();
        recent.TryRemove(id, out _);
        return count > 0;
    }

    public bool Withdraw(Guid id, DateTime now)
    {
        using var scope = scopes.CreateScope();
        var count = scope.Database.Execute("UPDATE LigataAIConsent SET WithdrawnUtc=@0 WHERE Id=@1 AND WithdrawnUtc IS NULL", now, id);
        scope.Complete();
        recent.TryRemove(id, out _);
        return count > 0;
    }

    /// <summary>Deletes records past the keeping period and consents that were never used for a question.</summary>
    public int Purge(DateTime createdBefore, DateTime unusedBefore)
    {
        using var scope = scopes.CreateScope();
        var count = scope.Database.Execute("DELETE FROM LigataAIConsent WHERE CreatedUtc<@0 OR (UsedUtc IS NULL AND CreatedUtc<@1)", createdBefore, unusedBefore);
        scope.Complete();
        if (count > 0) recent.Clear();
        return count;
    }

    public ConsentSummary Summary(DateTime since, DateTime now)
    {
        using var scope = scopes.CreateScope();
        var db = scope.Database;
        var summary = new ConsentSummary(
            db.ExecuteScalar<int>("SELECT COUNT(*) FROM LigataAIConsent WHERE CreatedUtc>=@0", since),
            db.ExecuteScalar<int>("SELECT COUNT(*) FROM LigataAIConsent WHERE CreatedUtc>=@0 AND UsedUtc IS NOT NULL", since),
            db.ExecuteScalar<int>("SELECT COUNT(*) FROM LigataAIConsent WHERE WithdrawnUtc>=@0", since),
            db.ExecuteScalar<int>("SELECT COUNT(*) FROM LigataAIConsent WHERE WithdrawnUtc IS NULL AND ExpiresUtc>@0 AND UsedUtc IS NOT NULL", now));
        scope.Complete();
        return summary;
    }
}
