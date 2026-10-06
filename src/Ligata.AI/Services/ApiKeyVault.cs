using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;

namespace Ligata.AI.Services;

/// <summary>Encrypts the gateway API key at rest with the host's ASP.NET Data Protection keys.</summary>
public sealed class ApiKeyVault(IDataProtectionProvider protection)
{
    private readonly IDataProtector protector = protection.CreateProtector("Ligata.AI.GatewayKey.v1");

    public static bool LooksValid(string key) => System.Text.RegularExpressions.Regex.IsMatch(key, "^lai_[a-f0-9]{12}_[A-Za-z0-9_-]{43}$");
    public static string Hint(string key) => key.Length < 20 ? "••••" : key[..8] + "…" + key[^4..];

    public string Protect(string key) => protector.Protect(key);

    public string? Unprotect(string? value)
    {
        if (string.IsNullOrEmpty(value)) return null;
        try { return protector.Unprotect(value); }
        catch (CryptographicException) { return null; }
    }
}
