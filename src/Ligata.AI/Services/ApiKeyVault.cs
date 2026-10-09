using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;

namespace Ligata.AI.Services;

/// <summary>Encrypts the API keys (Ligata AI gateway, Anthropic) at rest with the host's ASP.NET Data Protection keys.</summary>
public sealed class ApiKeyVault(IDataProtectionProvider protection)
{
    private readonly IDataProtector protector = protection.CreateProtector("Ligata.AI.GatewayKey.v1");
    private readonly IDataProtector claude = protection.CreateProtector("Ligata.AI.ClaudeKey.v1");
    // Pages ask which engine answers on every render: the last few decrypted values are kept instead of decrypting each time.
    private readonly Dictionary<string, string?> recent = [];

    public static bool LooksValid(string key) => System.Text.RegularExpressions.Regex.IsMatch(key, "^lai_[a-f0-9]{12}_[A-Za-z0-9_-]{43}$");
    /// <summary>An Anthropic API key (sk-ant-api03-…). Only the shape is checked here; Anthropic checks the key itself.</summary>
    public static bool LooksLikeClaude(string key) => System.Text.RegularExpressions.Regex.IsMatch(key, "^sk-ant-[A-Za-z0-9_-]{20,300}$");
    public static string Hint(string key) => key.Length < 20 ? "••••" : key[..8] + "…" + key[^4..];
    public static string ClaudeHint(string key) => key.Length < 24 ? "••••" : key[..10] + "…" + key[^4..];

    public string Protect(string key) => protector.Protect(key);
    public string ProtectClaude(string key) => claude.Protect(key);

    public string? Unprotect(string? value) => Read(protector, value);
    public string? UnprotectClaude(string? value) => Read(claude, value);

    private string? Read(IDataProtector with, string? value)
    {
        if (string.IsNullOrEmpty(value)) return null;
        var entry = (with == claude ? "claude:" : "gateway:") + value;
        lock (recent) if (recent.TryGetValue(entry, out var known)) return known;
        string? key;
        try { key = with.Unprotect(value); }
        catch (CryptographicException) { key = null; }
        lock (recent)
        {
            if (recent.Count >= 8) recent.Clear();
            recent[entry] = key;
        }
        return key;
    }
}
