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

/// <summary>0.2: team conversations, agents, the email queue and new counters.</summary>
public sealed class SupportMigration(IMigrationContext context) : AsyncMigrationBase(context)
{
    protected override Task MigrateAsync()
    {
        if (!TableExists("LigataAIConversation")) Create.Table<ConversationRow>().Do();
        if (!TableExists("LigataAIMessage")) Create.Table<MessageRow>().Do();
        if (!TableExists("LigataAIAgent")) Create.Table<AgentRow>().Do();
        if (!TableExists("LigataAIEmail")) Create.Table<EmailRow>().Do();
        // AddColumn issues a plain ADD COLUMN (supported by SQLite and SQL Server); the DTO supplies DEFAULT 0.
        foreach (var column in new[] { "ChatRequests", "EmailRequests", "Suggested", "AgentReplies", "Responses", "FirstResponseMs" })
            if (!ColumnExists("LigataAIStat", column)) AddColumn<StatRow>("LigataAIStat", column);
        return Task.CompletedTask;
    }
}

/// <summary>0.4: proof of consent before the AI reads a visitor's messages.</summary>
public sealed class ConsentMigration(IMigrationContext context) : AsyncMigrationBase(context)
{
    protected override Task MigrateAsync()
    {
        if (!TableExists("LigataAIConsent")) Create.Table<ConsentRow>().Do();
        return Task.CompletedTask;
    }
}

/// <summary>0.6: knowledge is looked up while answering; items can be marked "always known".</summary>
public sealed class LookupMigration(IMigrationContext context) : AsyncMigrationBase(context)
{
    protected override Task MigrateAsync()
    {
        if (!ColumnExists("LigataAIKnowledge", "Pinned")) AddColumn<KnowledgeRow>("LigataAIKnowledge", "Pinned");
        return Task.CompletedTask;
    }
}

public sealed class AssistantInstaller(IMigrationPlanExecutor executor, ICoreScopeProvider scopes, Umbraco.Cms.Infrastructure.Scoping.IScopeProvider database, IKeyValueService keys, IUserGroupService groups, IOptions<AssistantOptions> options, ILogger<AssistantInstaller> logger)
{
    public const string SectionAlias = "Ligata.AI.Section";

    public async Task InstallAsync()
    {
        var plan = new MigrationPlan("Ligata.AI");
        plan.From(string.Empty).To<AssistantMigration>("ai-v1").To<SupportMigration>("ai-v2").To<ConsentMigration>("ai-v3").To<LookupMigration>("ai-v4");
        var result = await new Upgrader(plan).ExecuteAsync(executor, scopes, keys);
        if (!result.Successful) throw new InvalidOperationException("Ligata AI migration failed. Inspect the Umbraco migration log.");
        LivePages();
        await GrantSectionAsync();
    }

    /// <summary>
    /// Until 0.6, editors imported pages as copies. Pages are now read live, every page unless left out, so the copies go:
    /// a copy that was switched off becomes a left-out page, and its text is read from the page itself from now on.
    /// </summary>
    private void LivePages()
    {
        if (keys.GetValue("Ligata.AI.LivePages") == "1") return;
        var store = new AssistantStore(database);
        var pages = store.KnowledgeRows().Where(k => k.Kind == "page").ToList();
        if (pages.Count > 0)
        {
            var (settings, version) = store.Settings();
            var off = pages.Where(p => !p.Enabled && p.ContentKey is { } key && !settings.Knowledge.ExcludedPages.Contains(key)).Select(p => p.ContentKey!.Value).ToList();
            if (off.Count > 0) store.Save(settings with { Knowledge = settings.Knowledge with { ExcludedPages = [.. settings.Knowledge.ExcludedPages, .. off] } }, version);
            foreach (var page in pages) store.Delete(page.Id);
            logger.LogInformation("Ligata AI: {Count} imported page copies replaced by live pages ({Off} left out).", pages.Count, off.Count);
        }
        keys.SetValue("Ligata.AI.LivePages", "1");
    }

    /// <summary>
    /// New backoffice sections are invisible until a user group allows them. Grant the section once to
    /// the configured editor groups (settings) and, from 0.2, agent groups (Inbox), so installing the
    /// package is enough to see it. Removing it from a group later is respected.
    /// </summary>
    private async Task GrantSectionAsync()
    {
        await GrantAsync("Ligata.AI.SectionGranted", options.Value.EditorGroups);
        if (options.Value.Features.Inbox) await GrantAsync("Ligata.AI.SectionGranted.Agents", options.Value.AgentGroups);
    }

    private async Task GrantAsync(string flag, IEnumerable<string> aliases)
    {
        if (keys.GetValue(flag) == "1") return;
        foreach (var alias in aliases)
        {
            var group = await groups.GetAsync(alias);
            if (group == null || group.AllowedSections.Contains(SectionAlias)) continue;
            group.AddAllowedSection(SectionAlias);
            var update = await groups.UpdateAsync(group, Constants.Security.SuperUserKey);
            if (!update.Success) logger.LogWarning("Could not add the AI Assistant section to user group {Group}: {Status}", alias, update.Status);
        }
        keys.SetValue(flag, "1");
    }
}

public sealed class AssistantStarting(AssistantInstaller installer, IRuntimeState runtime) : INotificationAsyncHandler<UmbracoApplicationStartingNotification>
{
    public async Task HandleAsync(UmbracoApplicationStartingNotification notification, CancellationToken cancellationToken)
    {
        if (runtime.Level == RuntimeLevel.Run) await installer.InstallAsync();
    }
}
