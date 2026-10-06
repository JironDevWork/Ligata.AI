using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Umbraco.Cms.Core;
using Umbraco.Cms.Core.Events;
using Umbraco.Cms.Core.Migrations;
using Umbraco.Cms.Core.Notifications;
using Umbraco.Cms.Core.Scoping;
using Umbraco.Cms.Core.Services;
using Umbraco.Cms.Infrastructure.Migrations;
using Umbraco.Cms.Infrastructure.Migrations.Upgrade;

namespace Ligata.AI.Data;

public sealed class AssistantMigration(IMigrationContext context) : AsyncMigrationBase(context)
{
    protected override Task MigrateAsync()
    {
        if (!TableExists("LigataAISettings")) Create.Table<SettingsRow>().Do();
        if (!TableExists("LigataAIKnowledge")) Create.Table<KnowledgeRow>().Do();
        if (!TableExists("LigataAIStat")) Create.Table<StatRow>().Do();
        return Task.CompletedTask;
    }
}

public sealed class AssistantInstaller(IMigrationPlanExecutor executor, ICoreScopeProvider scopes, IKeyValueService keys, IUserGroupService groups, IOptions<AssistantOptions> options, ILogger<AssistantInstaller> logger)
{
    public const string SectionAlias = "Ligata.AI.Section";

    public async Task InstallAsync()
    {
        var plan = new MigrationPlan("Ligata.AI");
        plan.From(string.Empty).To<AssistantMigration>("ai-v1");
        var result = await new Upgrader(plan).ExecuteAsync(executor, scopes, keys);
        if (!result.Successful) throw new InvalidOperationException("Ligata AI migration failed. Inspect the Umbraco migration log.");
        await GrantSectionAsync();
    }

    /// <summary>
    /// New backoffice sections are invisible until a user group allows them. Grant the AI Assistant
    /// section once to the configured editor groups, so installing the package is enough to see it.
    /// </summary>
    private async Task GrantSectionAsync()
    {
        if (keys.GetValue("Ligata.AI.SectionGranted") == "1") return;
        foreach (var alias in options.Value.EditorGroups)
        {
            var group = await groups.GetAsync(alias);
            if (group == null || group.AllowedSections.Contains(SectionAlias)) continue;
            group.AddAllowedSection(SectionAlias);
            var update = await groups.UpdateAsync(group, Constants.Security.SuperUserKey);
            if (!update.Success) logger.LogWarning("Could not add the AI Assistant section to user group {Group}: {Status}", alias, update.Status);
        }
        keys.SetValue("Ligata.AI.SectionGranted", "1");
    }
}

public sealed class AssistantStarting(AssistantInstaller installer, IRuntimeState runtime) : INotificationAsyncHandler<UmbracoApplicationStartingNotification>
{
    public async Task HandleAsync(UmbracoApplicationStartingNotification notification, CancellationToken cancellationToken)
    {
        if (runtime.Level == RuntimeLevel.Run) await installer.InstallAsync();
    }
}
