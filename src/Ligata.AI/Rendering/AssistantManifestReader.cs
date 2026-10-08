using Ligata.AI.Data;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Umbraco.Cms.Core.Manifest;
using Umbraco.Cms.Core.Services;
using Umbraco.Cms.Infrastructure.Manifest;

namespace Ligata.AI.Rendering;

/// <summary>
/// The backoffice manifest, generated from the host's feature flags: unlicensed dashboards never load,
/// the section is called "AI Assistant" or "Support", the Inbox shows to agents and Settings only to
/// editors (Umbraco's user-group condition needs the groups' keys, which only the server knows).
/// </summary>
public sealed class AssistantManifestReader(IOptions<AssistantOptions> options, IServiceScopeFactory scopes, ILogger<AssistantManifestReader> logger) : IPackageManifestReader
{
    public const string Version = Rendering.AssistantMarkup.Version;

    public async Task<IEnumerable<PackageManifest>> ReadPackageManifestsAsync()
    {
        var o = options.Value;
        if (!o.Features.Any) return [];
        var editors = await GroupKeysAsync(o.EditorGroups);
        var agents = (await GroupKeysAsync(o.AgentGroups)).Concat(editors).Distinct().ToArray();
        object Section() => new { alias = "Umb.Condition.SectionAlias", match = AssistantInstaller.SectionAlias };
        object Groups(string[] keys) => new { alias = "Umb.Condition.CurrentUser.GroupId", oneOf = keys };
        var extensions = new List<object>
        {
            new
            {
                type = "section", alias = AssistantInstaller.SectionAlias, name = "Ligata AI", weight = 50,
                meta = new { label = o.Features.Assistant ? "AI Assistant" : "Support", pathname = "ai-assistant" },
            },
        };
        if (o.Features.Inbox)
        {
            extensions.Add(new
            {
                type = "dashboard", alias = "Ligata.AI.Inbox", name = "Ligata AI inbox", element = $"/App_Plugins/LigataAI/inbox.js?v={Version}", weight = 200,
                meta = new { label = "Inbox", pathname = "inbox" },
                conditions = agents.Length > 0 ? new[] { Section(), Groups(agents) } : new[] { Section() },
            });
            extensions.Add(new
            {
                type = "headerApp", alias = "Ligata.AI.HeaderApp", name = "Ligata AI inbox badge", element = $"/App_Plugins/LigataAI/header-app.js?v={Version}", weight = 600,
                conditions = agents.Length > 0 ? new[] { Groups(agents) } : Array.Empty<object>(),
            });
        }
        if (o.Features.Assistant)
        {
            // The history of AI conversations, for the same people as the Inbox; it explains how to start one while the site keeps none.
            extensions.Add(new
            {
                type = "dashboard", alias = "Ligata.AI.History", name = "Ligata AI conversations", element = $"/App_Plugins/LigataAI/history.js?v={Version}", weight = 150,
                meta = new { label = "AI conversations", pathname = "conversations" },
                conditions = agents.Length > 0 ? new[] { Section(), Groups(agents) } : new[] { Section() },
            });
        }
        extensions.Add(new
        {
            type = "dashboard", alias = "Ligata.AI.Dashboard", name = "Ligata AI settings", element = $"/App_Plugins/LigataAI/dashboard.js?v={Version}", weight = 100,
            meta = new { label = o.Features.Inbox ? "Settings" : "Assistant", pathname = "settings" },
            conditions = editors.Length > 0 ? new[] { Section(), Groups(editors) } : new[] { Section() },
        });
        return [new PackageManifest { Name = "Ligata AI", Version = Version, AllowPublicAccess = false, AllowTelemetry = false, Extensions = extensions.ToArray() }];
    }

    private async Task<string[]> GroupKeysAsync(IEnumerable<string> aliases)
    {
        try
        {
            using var scope = scopes.CreateScope();
            var groups = scope.ServiceProvider.GetRequiredService<IUserGroupService>();
            var keys = new List<string>();
            foreach (var alias in aliases.Distinct(StringComparer.OrdinalIgnoreCase))
                if (await groups.GetAsync(alias) is { } group) keys.Add(group.Key.ToString());
            return keys.ToArray();
        }
        catch (Exception e)
        {
            // Before installation there are no groups; the server-side filters still protect every endpoint.
            logger.LogDebug(e, "Ligata AI could not resolve user groups for the backoffice manifest.");
            return [];
        }
    }
}
