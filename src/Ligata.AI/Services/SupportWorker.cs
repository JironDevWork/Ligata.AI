using Ligata.AI.Data;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Umbraco.Cms.Core;
using Umbraco.Cms.Core.Services;

namespace Ligata.AI.Services;

/// <summary>
/// Every 30 s: closes inactive conversations, removes absent team members, deletes conversations past
/// retention and sends queued emails (with retries). Every hour: deletes old and unused consent records and AI conversations
/// past the history period.
/// Keep the application running (IIS: AlwaysRunning) so this also happens without traffic.
/// </summary>
public sealed class SupportWorker(IServiceScopeFactory scopes, IOptions<AssistantOptions> options, ILogger<SupportWorker> logger) : BackgroundService
{
    public static TimeSpan Interval { get; set; } = TimeSpan.FromSeconds(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.Features.Inbox && !options.Value.Features.Assistant) return;
        using var timer = new PeriodicTimer(Interval);
        var consentsPurged = DateTime.MinValue;
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                using var scope = scopes.CreateScope();
                if (scope.ServiceProvider.GetRequiredService<IRuntimeState>().Level != RuntimeLevel.Run) continue;
                if (options.Value.Features.Inbox)
                {
                    scope.ServiceProvider.GetRequiredService<SupportService>().Maintain();
                    await SendAsync(scope.ServiceProvider, stoppingToken);
                }
                if (DateTime.UtcNow - consentsPurged > TimeSpan.FromHours(1))
                {
                    PurgeConsents(scope.ServiceProvider.GetRequiredService<ConsentStore>(), options.Value.Privacy, DateTime.UtcNow);
                    PurgeHistory(scope.ServiceProvider.GetRequiredService<ChatHistoryStore>(), scope.ServiceProvider.GetRequiredService<AssistantStore>().Settings().Settings, DateTime.UtcNow);
                    consentsPurged = DateTime.UtcNow;
                }
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogError("Ligata AI support worker failed: {Type}. Check database availability and the package migration.", e.GetType().Name);
            }
        }
    }

    /// <summary>Proof of consent is kept for KeepConsentRecordsDays; a consent never used for a question proves nothing and goes after a day.</summary>
    public static int PurgeConsents(ConsentStore store, PrivacyOptions privacy, DateTime now) =>
        store.Purge(now.AddDays(-Math.Clamp(privacy.KeepConsentRecordsDays, Math.Clamp(privacy.ConsentDays, 1, 400), 3650)), now.AddDays(-1));

    /// <summary>AI conversations go HistoryDays after their last message unless the team keeps them (also once the history is switched off).</summary>
    public static int PurgeHistory(ChatHistoryStore store, Models.AssistantSettings settings, DateTime now) =>
        store.Purge(now.AddDays(-Math.Clamp(settings.Privacy.HistoryDays, 1, 365)));

    public static async Task<int> SendAsync(IServiceProvider services, CancellationToken token)
    {
        var delivery = services.GetRequiredService<IAssistantEmailDelivery>();
        if (!delivery.Ready) return 0; // The queue waits until SMTP is configured, without using up retries.
        var store = services.GetRequiredService<SupportStore>();
        var logger = services.GetRequiredService<ILogger<SupportWorker>>();
        var sent = 0;
        for (var i = 0; i < 20 && !token.IsCancellationRequested; i++)
        {
            var email = store.ClaimEmail(); if (email == null) break;
            try { await delivery.SendAsync(email); store.CompleteEmail(email, null); sent++; }
            catch (Exception)
            {
                // Provider exceptions can contain addresses or credentials: keep logs generic.
                logger.LogWarning("Ligata AI email {Id} ({Kind}) attempt {Attempt} failed", email.Id, email.Kind, email.Attempts);
                store.CompleteEmail(email, "Sending failed. Check the SMTP settings and the mail provider; retries are automatic (5 attempts).");
            }
        }
        return sent;
    }
}
