using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace Ligata.AI.Services;

public enum CaptchaResult { Accepted, Rejected, Unavailable }
public sealed record RecaptchaResponse(bool Success, double Score, string? Action, string? Hostname,
    [property: JsonPropertyName("challenge_ts")] DateTimeOffset ChallengeTime,
    [property: JsonPropertyName("error-codes")] string[]? ErrorCodes = null);

/// <summary>Spam protection for team requests and email messages. Replaceable for tests.</summary>
public interface IContactCaptcha
{
    bool Ready { get; }
    Task<CaptchaResult> VerifyAsync(string? token, CancellationToken cancellationToken);
}

/// <summary>Google reCAPTCHA v3, verified the same way as Ligata.Forms (score, action, hostname and age).</summary>
public sealed class RecaptchaVerifier(HttpClient client, IOptions<RecaptchaSettings> options) : IContactCaptcha
{
    public const string Action = "ligata_ai_contact";
    public bool Ready => options.Value.Ready;

    public static bool Accept(RecaptchaResponse result, RecaptchaSettings config, DateTimeOffset now) =>
        result.Success && (result.ErrorCodes == null || result.ErrorCodes.Length == 0) && result.Score >= Math.Clamp(config.MinimumScore, 0.1, 1) && result.Score <= 1 &&
        result.Action == Action && config.AllowedHostnames.Contains(result.Hostname ?? "", StringComparer.OrdinalIgnoreCase) &&
        now - result.ChallengeTime <= TimeSpan.FromMinutes(2) && result.ChallengeTime - now <= TimeSpan.FromSeconds(30);

    public async Task<CaptchaResult> VerifyAsync(string? token, CancellationToken cancellationToken)
    {
        if (!Ready) return CaptchaResult.Unavailable;
        if (string.IsNullOrWhiteSpace(token) || token.Length > 10000) return CaptchaResult.Rejected;
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(8));
            using var response = await client.PostAsync("https://www.google.com/recaptcha/api/siteverify", new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["secret"] = options.Value.SecretKey, ["response"] = token,
            }), timeout.Token);
            if (!response.IsSuccessStatusCode) return CaptchaResult.Unavailable;
            var result = await response.Content.ReadFromJsonAsync<RecaptchaResponse>(cancellationToken: timeout.Token);
            return result != null && Accept(result, options.Value, DateTimeOffset.UtcNow) ? CaptchaResult.Accepted : CaptchaResult.Rejected;
        }
        catch (Exception e) when (e is HttpRequestException or OperationCanceledException or System.Text.Json.JsonException) { return CaptchaResult.Unavailable; }
    }
}
