using Ligata.AI.Controllers;
using Ligata.AI.Data;
using Ligata.AI.Rendering;
using Ligata.AI.Services;
using Microsoft.AspNetCore.Razor.TagHelpers;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Umbraco.Cms.Core.Composing;
using Umbraco.Cms.Core.DependencyInjection;
using Umbraco.Cms.Core.Notifications;
using Umbraco.Cms.Infrastructure.Manifest;

namespace Ligata.AI;

public sealed class AssistantComposer : IComposer
{
    public void Compose(IUmbracoBuilder builder)
    {
        builder.Services.Configure<AssistantOptions>(builder.Config.GetSection("LigataAI"));
        // reCAPTCHA is configured once per site: LigataAI:Recaptcha if present, otherwise the Ligata.Forms settings.
        var config = builder.Config;
        builder.Services.Configure<RecaptchaSettings>(options =>
        {
            var own = config.GetSection("LigataAI:Recaptcha");
            var forms = config.GetSection("LigataForms:Recaptcha");
            var source = !string.IsNullOrWhiteSpace(own["SiteKey"]) ? own : forms;
            source.Bind(options);
            options.Source = !string.IsNullOrWhiteSpace(own["SiteKey"]) ? "LigataAI" : !string.IsNullOrWhiteSpace(forms["SiteKey"]) ? "LigataForms" : "none";
        });
        builder.Services.AddTransient<AssistantInstaller>();
        builder.Services.AddScoped<AssistantStore>();
        builder.Services.AddScoped<ConsentStore>();
        builder.Services.AddScoped<ChatHistoryStore>();
        builder.Services.AddScoped<ChatHistory>();
        builder.Services.AddScoped<HistoryFilter>();
        builder.Services.AddScoped<AssistantEditorFilter>();
        builder.Services.AddScoped<SupportAgentFilter>();
        builder.Services.AddScoped<ChatRelay>();
        builder.Services.AddScoped<ContentKnowledge>();
        builder.Services.AddScoped<KnowledgeIndex>();
        builder.AddNotificationHandler<ContentCacheRefresherNotification, KnowledgeIndexRefresher>();
        builder.Services.AddSingleton<RequestGuard>();
        builder.Services.AddSingleton<ApiKeyVault>();
        builder.Services.AddSingleton<SupportHub>();
        builder.Services.AddSingleton<AgentDirectory>();
        builder.Services.AddScoped<SupportStore>();
        builder.Services.AddScoped<SupportService>();
        builder.Services.AddScoped<SupportMailer>();
        builder.Services.TryAddScoped<IAssistantEmailDelivery, UmbracoEmailDelivery>();
        builder.Services.AddHttpClient<IContactCaptcha, RecaptchaVerifier>();
        builder.Services.AddHostedService<SupportWorker>();
        builder.Services.AddMemoryCache();
        builder.Services.AddHttpContextAccessor();
        // Streaming answers can take minutes; individual calls set their own shorter limits.
        builder.Services.AddHttpClient<GatewayClient>(client => client.Timeout = Timeout.InfiniteTimeSpan);
        builder.Services.AddScoped<EngineSelector>();
        builder.Services.AddSingleton<ClaudeGate>();
        builder.Services.AddScoped<ClaudeEngine>();
        builder.Services.AddScoped<AssistantEngine>();
        // The content assistant in the backoffice (0.9).
        builder.Services.AddScoped<Editor.EditorStore>();
        builder.Services.AddScoped<Editor.ContentSchema>();
        builder.Services.AddScoped<Editor.EditorAccess>();
        builder.Services.AddScoped<Editor.ContentTools>();
        builder.Services.AddScoped<Editor.EditorMedia>();
        builder.Services.AddScoped<Editor.EditorTools>();
        builder.Services.AddScoped<Editor.EditorModel>();
        builder.Services.AddScoped<Editor.EditorAgent>();
        builder.Services.AddScoped<EditorUserFilter>();
        builder.Services.AddTransient<ITagHelperComponent, AssistantTagHelperComponent>();
        builder.Services.AddSingleton<IPackageManifestReader, AssistantManifestReader>();
        builder.AddNotificationAsyncHandler<UmbracoApplicationStartingNotification, AssistantStarting>();
    }
}
