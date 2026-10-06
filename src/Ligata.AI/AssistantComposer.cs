using Ligata.AI.Controllers;
using Ligata.AI.Data;
using Ligata.AI.Rendering;
using Ligata.AI.Services;
using Microsoft.AspNetCore.Razor.TagHelpers;
using Microsoft.Extensions.DependencyInjection;
using Umbraco.Cms.Core.Composing;
using Umbraco.Cms.Core.DependencyInjection;
using Umbraco.Cms.Core.Notifications;

namespace Ligata.AI;

public sealed class AssistantComposer : IComposer
{
    public void Compose(IUmbracoBuilder builder)
    {
        builder.Services.Configure<AssistantOptions>(builder.Config.GetSection("LigataAI"));
        builder.Services.AddTransient<AssistantInstaller>();
        builder.Services.AddScoped<AssistantStore>();
        builder.Services.AddScoped<AssistantEditorFilter>();
        builder.Services.AddScoped<ChatRelay>();
        builder.Services.AddScoped<ContentKnowledge>();
        builder.Services.AddSingleton<RequestGuard>();
        builder.Services.AddSingleton<ApiKeyVault>();
        builder.Services.AddMemoryCache();
        builder.Services.AddHttpContextAccessor();
        // Streaming answers can take minutes; individual calls set their own shorter limits.
        builder.Services.AddHttpClient<GatewayClient>(client => client.Timeout = Timeout.InfiniteTimeSpan);
        builder.Services.AddTransient<ITagHelperComponent, AssistantTagHelperComponent>();
        builder.AddNotificationAsyncHandler<UmbracoApplicationStartingNotification, AssistantStarting>();
    }
}
