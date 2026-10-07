using System.Collections.Concurrent;

namespace Ligata.AI.Services;

/// <summary>
/// In-memory wake-ups for long polling, typing indicators and presence (single CMS instance, like
/// Ligata.Forms). The database stays the source of truth: a poll that wakes up re-reads it, so a missed
/// signal only delays an update until the next poll.
/// </summary>
public sealed class SupportHub
{
    public static readonly TimeSpan PresenceWindow = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan TypingWindow = TimeSpan.FromSeconds(6);
    private readonly ConcurrentDictionary<Guid, Pulse> conversations = new();
    private readonly ConcurrentDictionary<Guid, (DateTime Seen, bool Away)> agents = new();
    private readonly ConcurrentDictionary<Guid, DateTime> visitors = new();
    private readonly ConcurrentDictionary<(Guid Conversation, string Who), DateTime> typing = new();
    private readonly ConcurrentDictionary<string, int> polls = new();
    public Pulse Inbox { get; } = new();
    public DateTime StartedUtc { get; } = DateTime.UtcNow;

    public Pulse For(Guid conversation) => conversations.GetOrAdd(conversation, _ => new Pulse());

    /// <summary>Something changed in a conversation: wake its visitor and every open inbox.</summary>
    public void Changed(Guid conversation)
    {
        if (conversations.TryGetValue(conversation, out var pulse)) pulse.Fire();
        Inbox.Fire();
    }

    // ---------- typing ----------
    public void Typing(Guid conversation, string who, bool active)
    {
        var key = (conversation, who);
        var was = typing.TryGetValue(key, out var until) && until > DateTime.UtcNow;
        if (active) typing[key] = DateTime.UtcNow + TypingWindow; else typing.TryRemove(key, out _);
        if (was != active) Changed(conversation);
    }

    /// <summary>Who is typing in a conversation right now: "visitor" and/or agent user keys.</summary>
    public IReadOnlyList<string> TypingIn(Guid conversation)
    {
        var now = DateTime.UtcNow;
        return typing.Where(t => t.Key.Conversation == conversation && t.Value > now).Select(t => t.Key.Who).ToList();
    }

    // ---------- presence ----------
    public void AgentSeen(Guid user, bool away)
    {
        var before = OnlineAgents();
        agents[user] = (DateTime.UtcNow, away);
        if (OnlineAgents() != before) Inbox.Fire();
    }

    public void AgentGone(Guid user) { if (agents.TryRemove(user, out _)) Inbox.Fire(); }

    public DateTime? AgentLastSeen(Guid user) => agents.TryGetValue(user, out var seen) ? seen.Seen : null;

    public int OnlineAgents()
    {
        var since = DateTime.UtcNow - PresenceWindow;
        return agents.Values.Count(a => a.Seen > since && !a.Away);
    }

    public IReadOnlyList<Guid> OnlineAgentKeys()
    {
        var since = DateTime.UtcNow - PresenceWindow;
        return agents.Where(a => a.Value.Seen > since && !a.Value.Away).Select(a => a.Key).ToList();
    }

    public void VisitorSeen(Guid conversation)
    {
        var known = visitors.TryGetValue(conversation, out var last) && last > DateTime.UtcNow - PresenceWindow;
        visitors[conversation] = DateTime.UtcNow;
        if (!known) Inbox.Fire();
    }

    public DateTime? VisitorLastSeen(Guid conversation) => visitors.TryGetValue(conversation, out var seen) ? seen : null;

    // ---------- concurrent long polls per address ----------
    public IDisposable? BeginPoll(string address, int maximum)
    {
        var count = polls.AddOrUpdate(address, 1, (_, n) => n + 1);
        if (count > maximum || polls.Count > 5000) { EndPoll(address); return null; }
        return new Release(() => EndPoll(address));
    }

    private void EndPoll(string address)
    {
        if (polls.AddOrUpdate(address, 0, (_, n) => n - 1) <= 0) polls.TryRemove(new KeyValuePair<string, int>(address, 0));
    }

    /// <summary>Drops state for conversations nobody listened to for a while.</summary>
    public void Sweep()
    {
        var old = DateTime.UtcNow.AddMinutes(-30);
        foreach (var (id, pulse) in conversations) if (pulse.LastUsedUtc < old) conversations.TryRemove(id, out _);
        foreach (var (id, seen) in visitors) if (seen < old) visitors.TryRemove(id, out _);
        foreach (var (key, until) in typing) if (until < DateTime.UtcNow) typing.TryRemove(key, out _);
        foreach (var (id, seen) in agents) if (seen.Seen < DateTime.UtcNow.AddHours(-2)) agents.TryRemove(id, out _);
    }

    private sealed class Release(Action action) : IDisposable { public void Dispose() => action(); }
}

/// <summary>A version number plus a task that completes when it changes.</summary>
public sealed class Pulse
{
    private long version;
    private TaskCompletionSource next = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly object gate = new();
    public DateTime LastUsedUtc { get; private set; } = DateTime.UtcNow;
    public long Version { get { lock (gate) return version; } }

    public void Fire()
    {
        TaskCompletionSource fired;
        lock (gate) { version++; fired = next; next = new(TaskCreationOptions.RunContinuationsAsynchronously); }
        fired.TrySetResult();
    }

    /// <summary>Waits until the version differs from <paramref name="known"/> or the timeout passes. Returns the current version.</summary>
    public async Task<long> WaitAsync(long known, TimeSpan timeout, CancellationToken token)
    {
        Task changed;
        lock (gate) { LastUsedUtc = DateTime.UtcNow; if (version != known) return version; changed = next.Task; }
        try { await changed.WaitAsync(timeout, token); } catch (TimeoutException) { }
        return Version;
    }
}
