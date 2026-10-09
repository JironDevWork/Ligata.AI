using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace Ligata.AI.Services;

/// <summary>Origin allowlist, per-IP rate limits and "one question at a time" per visitor.</summary>
public sealed class RequestGuard(IOptions<AssistantOptions> options) : IDisposable
{
    private readonly MemoryCache limits = new(new MemoryCacheOptions { SizeLimit = 20000 });
    // Site-wide counters, outside the size-limited cache so a flood of addresses cannot reset them.
    private readonly Dictionary<string, (int Count, DateTime Until)> global = new();
    private readonly ConcurrentDictionary<string, byte> inFlight = new();
    private readonly object gate = new();

    public IPAddress? Address(HttpContext context)
    {
        var address = context.Connection.RemoteIpAddress;
        if (options.Value.TrustCloudflareLoopbackHeader && address != null && IPAddress.IsLoopback(address) &&
            IPAddress.TryParse(context.Request.Headers["CF-Connecting-IP"].ToString(), out var forwarded)) address = forwarded;
        return address;
    }

    /// <summary>A stable, non-reversible visitor id: HMAC of the IP with this site's secret. Raw IPs never leave the server.</summary>
    public string Visitor(HttpContext context, string secret)
    {
        var address = Address(context)?.ToString() ?? "unknown";
        return Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(address)))[..32].ToLowerInvariant();
    }

    public bool Origin(HttpContext context, bool require)
    {
        var origin = context.Request.Headers.Origin.ToString();
        context.Response.Headers.CacheControl = "no-store, private";
        context.Response.Headers.Vary = "Origin";
        if (origin == "") return !require;
        if (!options.Value.AllowedOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase)) return false;
        context.Response.Headers.AccessControlAllowOrigin = origin;
        context.Response.Headers.AccessControlAllowMethods = "GET, POST, OPTIONS";
        context.Response.Headers.AccessControlAllowHeaders = "Content-Type";
        context.Response.Headers.AccessControlMaxAge = "600";
        return true;
    }

    /// <summary>
    /// kind: read (config/status), ask (AI questions), file (attachment processing), contact (team requests
    /// and emails), say (visitor chat messages), poll (live chat long polls), typing, avatar, consent (given or withdrawn).
    /// </summary>
    public bool Allow(HttpContext context, string kind)
    {
        var key = kind + ":" + Address(context);
        var (maximum, period) = kind switch
        {
            "ask" => (Math.Clamp(options.Value.MessagesPerTenMinutes, 1, 500), TimeSpan.FromMinutes(10)),
            "file" => (20, TimeSpan.FromMinutes(10)),
            "contact" => (Math.Clamp(options.Value.Support.ContactRequestsPerTenMinutes, 1, 1000), TimeSpan.FromMinutes(10)),
            "say" => (Math.Clamp(options.Value.Support.VisitorMessagesPerMinute, 1, 120), TimeSpan.FromMinutes(1)),
            "poll" => (900, TimeSpan.FromMinutes(10)),
            "typing" => (400, TimeSpan.FromMinutes(10)),
            "avatar" => (300, TimeSpan.FromMinutes(10)),
            // Agreeing is rarer than asking; offices share one address.
            "consent" => (Math.Clamp(options.Value.MessagesPerTenMinutes * 2, 10, 1000), TimeSpan.FromMinutes(10)),
            _ => (Math.Clamp(options.Value.ReadsPerTenMinutes, 10, 100000), TimeSpan.FromMinutes(10)),
        };
        var site = kind switch { "read" => 5000, "poll" => 30000, "typing" => 10000, "avatar" => 5000, "consent" => 300, _ => 1000 };
        lock (gate)
        {
            bool Take(string bucket, int max, TimeSpan window)
            {
                if (!limits.TryGetValue<Counter>(bucket, out var count)) limits.Set(bucket, count = new Counter(), new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = window, Size = 1 });
                return ++count!.Value <= max;
            }
            // The address first: requests it is refused do not count against everyone else.
            if (!Take(key, maximum, period)) return false;
            var now = DateTime.UtcNow;
            var (count, until) = this.global.TryGetValue(kind, out var current) && current.Until > now ? current : (0, now.AddMinutes(1));
            this.global[kind] = (count + 1, until);
            return count + 1 <= site;
        }
    }

    /// <summary>Marks a visitor as having a question in progress. Dispose the result when the answer ends.</summary>
    public IDisposable? Begin(string visitor) => inFlight.TryAdd(visitor, 0) ? new Release(() => inFlight.TryRemove(visitor, out _)) : null;

    private sealed class Counter { public int Value; }
    private sealed class Release(Action action) : IDisposable { public void Dispose() => action(); }
    public void Dispose() => limits.Dispose();
}
