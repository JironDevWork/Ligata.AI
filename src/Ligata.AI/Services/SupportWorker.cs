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
/// retention and sends queued emails (with retries). Keep the application running (IIS: AlwaysRunning)
/// so this also happens without traffic.
/// </summary>
public sealed class SupportWorker(IServiceScopeFactory scopes, IOptions<AssistantOptions> options, ILogger<SupportWorker> logger) : BackgroundService
{
    public static TimeSpan Interval { get; set; } = TimeSpan.FromSeconds(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.Features.Inbox) return;
        using var timer = new PeriodicTimer(Interval);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                using var scope = scopes.CreateScope();
                if (scope.ServiceProvider.GetRequiredService<IRuntimeState>().Level != RuntimeLevel.Run) continue;
                scope.ServiceProvider.GetRequiredService<SupportService>().Maintain();
                await SendAsync(scope.ServiceProvider, stoppingToken);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogError("Ligata AI support worker failed: {Type}. Check database availability and the package migration.", e.GetType().Name);
            }
        }
    }

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
