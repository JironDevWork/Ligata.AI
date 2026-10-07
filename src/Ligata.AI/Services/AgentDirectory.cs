using System.Security.Cryptography;
using System.Text;
using Ligata.AI.Data;
using Ligata.AI.Models;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Umbraco.Cms.Core.IO;
using Umbraco.Cms.Core.Services;

namespace Ligata.AI.Services;

/// <summary>How one team member appears to visitors, resolved from their Umbraco profile and their chosen display.</summary>
public sealed record AgentCard(Guid UserKey, Guid PublicId, string Mode, string RealName, string? Name, string Initials, bool Photo, string AvatarVersion)
{
    /// <summary>The visitor-facing shape. Anonymous team members have no id, so visitors cannot tell them apart.</summary>
    public object Public() => new { id = Mode == "anonymous" ? (Guid?)null : PublicId, name = Name, initials = Initials, photo = Photo, v = Photo ? AvatarVersion : null };
}

public sealed class AgentDirectory(IServiceScopeFactory scopes, IMemoryCache cache, MediaFileManager media)
{
    public const long MaxAvatarBytes = 3 * 1024 * 1024;

    public AgentCard Card(Guid userKey, AssistantSettings settings) =>
        cache.GetOrCreate(("Ligata.AI.Agent", userKey, settings.Support.AgentDisplay, settings.Support.AgentsChoose), entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(20);
            return Resolve(userKey, settings);
        })!;

    public void Forget(Guid userKey, AssistantSettings settings) => cache.Remove(("Ligata.AI.Agent", userKey, settings.Support.AgentDisplay, settings.Support.AgentsChoose));

    private AgentCard Resolve(Guid userKey, AssistantSettings settings)
    {
        using var scope = scopes.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<SupportStore>();
        var agent = store.Agent(userKey);
        var user = scope.ServiceProvider.GetRequiredService<IUserService>().GetAsync(userKey).GetAwaiter().GetResult();
        var realName = string.IsNullOrWhiteSpace(user?.Name) ? "Team member" : user.Name.Trim();
        var mode = settings.Support.AgentsChoose && agent.Display != "default" ? agent.Display : settings.Support.AgentDisplay;
        if (!AssistantValidation.AgentDisplays.Contains(mode)) mode = "full";
        var alias = string.IsNullOrWhiteSpace(agent.Alias) ? realName.Split(' ', StringSplitOptions.RemoveEmptyEntries)[0] : agent.Alias.Trim();
        var name = mode switch { "full" or "name" => realName, "alias" => alias, _ => null };
        var photo = mode == "full" && AvatarPath(user?.Avatar) != null;
        return new AgentCard(userKey, agent.PublicId, mode, realName, name, Initials(name ?? ""), photo,
            Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(user?.Avatar ?? "")))[..10].ToLowerInvariant());
    }

    public static string Initials(string name)
    {
        var parts = name.Split([' ', '-', '.'], StringSplitOptions.RemoveEmptyEntries);
        return parts.Length == 0 ? "" : string.Concat(parts.Take(2).Select(p => char.ToUpperInvariant(p[0])));
    }

    /// <summary>Raster avatars only (SVG could carry script when opened directly from this origin).</summary>
    private static string? AvatarPath(string? avatar) =>
        !string.IsNullOrWhiteSpace(avatar) && Path.GetExtension(avatar).ToLowerInvariant() is ".jpg" or ".jpeg" or ".png" or ".webp" or ".gif" ? avatar : null;

    public (byte[] Bytes, string ContentType)? Avatar(Guid userKey)
    {
        using var scope = scopes.CreateScope();
        var user = scope.ServiceProvider.GetRequiredService<IUserService>().GetAsync(userKey).GetAwaiter().GetResult();
        var path = AvatarPath(user?.Avatar);
        if (path == null) return null;
        try
        {
            using var stream = media.FileSystem.OpenFile(path);
            if (stream.CanSeek && stream.Length > MaxAvatarBytes) return null;
            using var memory = new MemoryStream();
            stream.CopyTo(memory);
            if (memory.Length > MaxAvatarBytes) return null;
            var type = Path.GetExtension(path).ToLowerInvariant() switch { ".png" => "image/png", ".webp" => "image/webp", ".gif" => "image/gif", _ => "image/jpeg" };
            return (memory.ToArray(), type);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or FileNotFoundException) { return null; }
    }
}
