using System.Net;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Umbraco.Cms.Core;
using Umbraco.Cms.Core.Services;

namespace Ligata.AI.Services;

/// <summary>
/// Gets pages of this website as visitors get them, without a network request: the request runs through the site's own
/// pipeline in memory (captured when the site starts, see <see cref="PageReaderStartup"/>), so proxies, TLS, Cloudflare and
/// firewalls play no part. Used for what a page's text properties do not hold, such as the form a form module renders.
/// </summary>
public sealed class PageReader(IHttpContextFactory contexts, ILogger<PageReader> logger)
{
    public const int MaxBytes = 4 * 1024 * 1024;
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(20);
    private static volatile RequestDelegate? site;

    /// <summary>The site's pipeline is built: pages can be read.</summary>
    public static bool Ready => site != null;

    internal static void Capture(RequestDelegate pipeline) => site = pipeline;

    /// <summary>The page's HTML, or null when it is not a page (redirected elsewhere, not found, an error, not HTML).</summary>
    public async Task<string?> HtmlAsync(Uri address, CancellationToken token)
    {
        Task<string?> reading;
        // A request of its own: nothing of the request or job that asks flows into it (the current HttpContext, Umbraco's
        // context), and nothing of it flows back.
        using (ExecutionContext.SuppressFlow()) reading = Task.Run(() => FollowAsync(address, token), token);
        return await reading;
    }

    private async Task<string?> FollowAsync(Uri address, CancellationToken token)
    {
        for (var hop = 0; hop < 3; hop++)
        {
            var (status, location, html) = await RunAsync(address, token);
            // A trailing slash, http to https, or a language's start page: followed on the same host only.
            if (status is >= 300 and < 400 && Uri.TryCreate(address, location, out var next) && next.Host == address.Host && next.Scheme is "http" or "https") { address = next; continue; }
            return html;
        }
        return null;
    }

    private async Task<(int Status, string? Location, string? Html)> RunAsync(Uri address, CancellationToken token)
    {
        var pipeline = site;
        if (pipeline == null) return (0, null, null);
        using var body = new MemoryStream();
        var request = new HttpRequestFeature
        {
            Method = "GET",
            Scheme = address.Scheme,
            Protocol = "HTTP/1.1",
            PathBase = "",
            Path = PathString.FromUriComponent(address).Value ?? "/",
            QueryString = address.Query,
            RawTarget = address.PathAndQuery,
        };
        request.Headers.Host = address.Authority;
        request.Headers.Accept = "text/html";
        request.Headers.UserAgent = "Ligata.AI page reader";
        request.Headers["X-Ligata-AI"] = "page-reader";
        var features = new FeatureCollection();
        features.Set<IHttpRequestFeature>(request);
        features.Set<IHttpResponseFeature>(new HttpResponseFeature());
        features.Set<IHttpResponseBodyFeature>(new StreamResponseBodyFeature(body));
        features.Set<IHttpConnectionFeature>(new HttpConnectionFeature { ConnectionId = Guid.NewGuid().ToString("N"), LocalIpAddress = IPAddress.Loopback, RemoteIpAddress = IPAddress.Loopback, LocalPort = address.Port });
        features.Set<IHttpRequestLifetimeFeature>(new HttpRequestLifetimeFeature { RequestAborted = token });
        features.Set<IHttpRequestIdentifierFeature>(new HttpRequestIdentifierFeature());
        var context = contexts.Create(features);
        try
        {
            await pipeline(context).WaitAsync(Timeout, token);
            await context.Response.CompleteAsync();
            var status = context.Response.StatusCode;
            if (status is >= 300 and < 400) return (status, context.Response.Headers.Location.ToString(), null);
            if (status != 200 || context.Response.ContentType?.StartsWith("text/html", StringComparison.OrdinalIgnoreCase) != true) return (status, null, null);
            return (status, null, Encoding.UTF8.GetString(body.GetBuffer(), 0, (int)Math.Min(body.Length, MaxBytes)));
        }
        catch (Exception exception) when (exception is not OperationCanceledException || !token.IsCancellationRequested)
        {
            logger.LogDebug(exception, "Ligata AI could not read {Address} as visitors get it.", address);
            return (500, null, null);
        }
        finally { contexts.Dispose(context); }
    }
}

/// <summary>Captures the site's request pipeline when it is built, for <see cref="PageReader"/>. Every request passes on unchanged.</summary>
internal sealed class PageReaderStartup : IStartupFilter
{
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        app.Use(pipeline => { PageReader.Capture(pipeline); return pipeline; });
        next(app);
    };
}

/// <summary>
/// Reads the website's pages as visitors get them, in the background, for their forms and other parts (see <see cref="PageParts"/>):
/// shortly after the site starts, after every publication (the pages that changed), and every page again every six hours, since
/// a form changed in its module publishes no page. A visitor never waits for it; the next answer uses what was read.
/// </summary>
public sealed class PageReading(IServiceScopeFactory scopes, IRuntimeState runtime, PageReader reader, IOptions<AssistantOptions> options, ILogger<PageReading> logger) : BackgroundService
{
    public static readonly TimeSpan Refresh = TimeSpan.FromHours(6);
    private bool warned;

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        if (!options.Value.ReadRenderedPages) return;
        try
        {
            while (!PageReader.Ready || runtime.Level != RuntimeLevel.Run) await Task.Delay(TimeSpan.FromSeconds(2), stop);
            await Task.Delay(TimeSpan.FromSeconds(3), stop);
            int? seen = null;
            var all = DateTime.MinValue;
            while (!stop.IsCancellationRequested)
            {
                var version = KnowledgeIndex.ContentVersion;
                var everything = DateTime.UtcNow - all > Refresh;
                if (version != seen || everything)
                {
                    try { await ReadAsync(everything, stop); }
                    catch (Exception exception) when (exception is not OperationCanceledException) { logger.LogWarning(exception, "Ligata AI could not read the website's pages for their forms."); }
                    seen = version;
                    if (everything) all = DateTime.UtcNow;
                }
                await Task.Delay(TimeSpan.FromSeconds(5), stop);
            }
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
    }

    private async Task ReadAsync(bool everything, CancellationToken stop)
    {
        using var scope = scopes.CreateScope();
        var settings = scope.ServiceProvider.GetRequiredService<Data.AssistantStore>().Settings().Settings.Knowledge;
        // The snapshot for the saved settings lists the pages to read, with their latest text.
        await scope.ServiceProvider.GetRequiredService<KnowledgeIndex>().SnapshotAsync(settings, stop);
        var pages = KnowledgeIndex.LatestPages ?? [];
        PageParts.Keep(pages.Select(p => p.Id).ToHashSet(StringComparer.Ordinal));
        int read = 0, failed = 0;
        foreach (var page in pages)
        {
            if (!everything && PageParts.For(page.Id)?.Updated == page.Updated) continue;
            var html = await reader.HtmlAsync(Address(page), stop);
            // A page that could not be read is tried again when it changes, or with the next round of every page.
            var (text, names) = html == null ? ("", "") : PageParts.Describe(html, page.Culture);
            PageParts.Set(page.Id, new PagePartsRead(page.Updated, text, names));
            if (html == null) failed++; else read++;
            await Task.Delay(50, stop);
        }
        if (read + failed > 0) logger.LogDebug("Ligata AI read {Read} pages as visitors get them ({Failed} could not be read).", read, failed);
        if (failed > 0 && read == 0 && !warned)
        {
            warned = true;
            logger.LogWarning("Ligata AI could not read this website's pages as visitors get them, so the assistant does not know their forms. Pages are read in memory, through the site's own request pipeline.");
        }
    }

    /// <summary>The page's absolute url when Umbraco knows its domain, else its path on this site.</summary>
    private static Uri Address(LivePage page) =>
        Uri.TryCreate(page.Address, UriKind.Absolute, out var address) ? address
        : Uri.TryCreate(page.Url, UriKind.Absolute, out var url) && url.Scheme is "http" or "https" ? url
        : new Uri("https://localhost" + (page.Url.StartsWith('/') ? page.Url : "/" + page.Url));
}
