using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Ligata.AI.Data;
using Ligata.AI.Models;
using Microsoft.Extensions.Options;

namespace Ligata.AI.Services;

public sealed class GatewayException(string code, string message, int status = 503, int? retryAfter = null, JsonElement? details = null) : Exception(message)
{
    public string Code { get; } = code;
    public int Status { get; } = status;
    public int? RetryAfter { get; } = retryAfter;
    public JsonElement? Details { get; } = details;
}

public sealed record GatewayStatus(string State, string? Model, int ContextTokens, bool Vision, int QueueWaiting, bool QueueRunning, int EstimatedWaitSeconds, bool GpuHealthy, JsonElement Limits, JsonElement Usage, string Engine = "gpu", string? ModelId = null);
public sealed record ExtractedDocument(string Text, int Pages, int PagesRead, bool Truncated, int? Tokens);

/// <summary>Server-to-server client for the shared Ligata AI gateway. The API key never leaves this server.</summary>
public sealed class GatewayClient(HttpClient http, AssistantStore store, EngineSelector engines, IOptions<AssistantOptions> options)
{
    public (string Url, string? Key, string KeySource) Target()
    {
        var settings = AssistantJson.Read<AssistantSettings>(store.Row().Json);
        var url = (options.Value.GatewayUrl is { Length: > 0 } configured ? configured : settings.GatewayUrl).TrimEnd('/');
        var key = engines.GatewayKey();
        return (url, key.Key, key.Source);
    }

    private HttpRequestMessage Request(HttpMethod method, string path, object? body = null)
    {
        var (url, key, source) = Target();
        if (key == null) throw new GatewayException("not_configured", source == "unreadable"
            ? "The stored API key can no longer be decrypted on this server. Enter it again under Connection."
            : "No API key is configured. Add the key from the Ligata AI gateway under Connection.", 503);
        if (!Uri.TryCreate(url + path, UriKind.Absolute, out var uri)) throw new GatewayException("not_configured", "The gateway URL is invalid.", 503);
        var request = new HttpRequestMessage(method, uri);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        if (body != null) request.Content = JsonContent.Create(body, options: AssistantJson.Options);
        return request;
    }

    private static async Task<GatewayException> Failure(HttpResponseMessage response, CancellationToken token)
    {
        var retry = response.Headers.RetryAfter?.Delta is { } delta ? (int)delta.TotalSeconds : (int?)null;
        try
        {
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(token));
            var error = document.RootElement.GetProperty("error");
            return new GatewayException(error.GetProperty("code").GetString() ?? "gateway_error", error.GetProperty("message").GetString() ?? "The assistant failed.", (int)response.StatusCode, retry, error.Clone());
        }
        catch (Exception e) when (e is JsonException or KeyNotFoundException or InvalidOperationException)
        {
            return response.StatusCode == HttpStatusCode.Unauthorized
                ? new GatewayException("invalid_key", "The gateway rejected the API key.", 401)
                : new GatewayException("gateway_unavailable", "The assistant service is not reachable right now.", 503, retry);
        }
    }

    private async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, HttpCompletionOption completion, CancellationToken token, TimeSpan? timeout = null)
    {
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(token);
        if (timeout != null) limit.CancelAfter(timeout.Value);
        try
        {
            var response = await http.SendAsync(request, completion, limit.Token);
            if (response.IsSuccessStatusCode) return response;
            using (response) throw await Failure(response, token);
        }
        catch (Exception e) when (e is HttpRequestException || (e is TaskCanceledException or OperationCanceledException && !token.IsCancellationRequested))
        {
            throw new GatewayException("gateway_unavailable", "The assistant service is not reachable right now.", 503, 30);
        }
    }

    // Whether the gateway lets the model look things up (0.6+), as last reported by its status.
    private static (DateTime At, bool Tools)? features;

    /// <summary>The gateway runs lookups (tools). Known from the last status, refreshed at most every minute.</summary>
    public async Task<bool> SupportsToolsAsync(CancellationToken token)
    {
        if (features is { } known && DateTime.UtcNow - known.At < TimeSpan.FromMinutes(1)) return known.Tools;
        try { await StatusAsync(token); } catch (GatewayException) { return features?.Tools ?? false; }
        return features?.Tools ?? false;
    }

    public async Task<GatewayStatus> StatusAsync(CancellationToken token)
    {
        using var response = await SendAsync(Request(HttpMethod.Get, "/v1/status"), HttpCompletionOption.ResponseContentRead, token, TimeSpan.FromSeconds(8));
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(token));
        var root = document.RootElement; var model = root.GetProperty("model"); var queue = root.GetProperty("queue");
        features = (DateTime.UtcNow, root.TryGetProperty("features", out var list) && list.ValueKind == JsonValueKind.Array && list.EnumerateArray().Any(f => f.ValueKind == JsonValueKind.String && f.GetString() == "tools"));
        return new GatewayStatus(model.GetProperty("state").GetString() ?? "down", model.GetProperty("name").GetString(), model.GetProperty("contextTokens").GetInt32(), model.GetProperty("vision").GetBoolean(),
            queue.GetProperty("waiting").GetInt32(), queue.GetProperty("running").GetBoolean(), queue.GetProperty("estimatedWaitSeconds").GetInt32(),
            root.GetProperty("gpu").GetProperty("healthy").GetBoolean(), root.GetProperty("limits").Clone(), root.GetProperty("usage").Clone());
    }

    public async Task<int[]> CountAsync(IReadOnlyList<string> texts, CancellationToken token)
    {
        if (texts.Count == 0) return [];
        using var response = await SendAsync(Request(HttpMethod.Post, "/v1/tokenize", new { texts }), HttpCompletionOption.ResponseContentRead, token, TimeSpan.FromSeconds(60));
        var data = await response.Content.ReadFromJsonAsync<JsonElement>(token);
        return data.GetProperty("counts").EnumerateArray().Select(c => c.GetInt32()).ToArray();
    }

    public async Task<ExtractedDocument> ExtractPdfAsync(byte[] bytes, CancellationToken token)
    {
        using var response = await SendAsync(Request(HttpMethod.Post, "/v1/extract", new { data = Convert.ToBase64String(bytes) }), HttpCompletionOption.ResponseContentRead, token, TimeSpan.FromSeconds(90));
        var data = await response.Content.ReadFromJsonAsync<ExtractedDocument>(AssistantJson.Options, token);
        return data!;
    }

    /// <summary>Starts a streamed chat. The caller owns the response and copies its event stream to the browser.</summary>
    public Task<HttpResponseMessage> ChatAsync(object body, CancellationToken token) =>
        SendAsync(Request(HttpMethod.Post, "/v1/chat", body), HttpCompletionOption.ResponseHeadersRead, token);

    /// <summary>The results of one round of lookups; the gateway continues the answer that waits for them.</summary>
    public async Task ToolResultsAsync(string round, object results, CancellationToken token)
    {
        using var response = await SendAsync(Request(HttpMethod.Post, "/v1/chat/tool-results", new { round, results }), HttpCompletionOption.ResponseContentRead, token, TimeSpan.FromSeconds(15));
    }
}
