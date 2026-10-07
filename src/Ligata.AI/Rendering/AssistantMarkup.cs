using System.Net;
using Ligata.AI.Data;
using Ligata.AI.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Razor.TagHelpers;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Ligata.AI.Rendering;

public static class AssistantMarkup
{
    public const string Version = "0.2.0";
    private const string RenderedKey = "Ligata.AI.Rendered";

    /// <summary>
    /// One deferred script tag. The settings snapshot lets the bubble render instantly, even on a
    /// statically exported page while the CMS is offline; live availability is fetched on open.
    /// </summary>
    public static string Script(AssistantSettings settings, string apiBase, int baseTokens, FeatureState features, RecaptchaSettings captcha) =>
        $"<script src=\"/assets/ligata-ai/ligata-ai.js?v={Version}\" defer data-ligata-ai data-api=\"{WebUtility.HtmlEncode(apiBase.TrimEnd('/'))}\" data-settings=\"{WebUtility.HtmlEncode(AssistantJson.Write(settings.Public(settings.Behaviour.ContextLimit, Controllers.PublicAssistantController.Limits(null), baseTokens, features, captcha)))}\"></script>";

    public static string? Render(HttpContext context, AssistantStore store, AssistantOptions options, bool manual)
    {
        if (context.Items.ContainsKey(RenderedKey)) return null;
        var path = context.Request.Path.Value ?? "/";
        if (path.StartsWith("/umbraco", StringComparison.OrdinalIgnoreCase)) return null;
        AssistantSettings settings;
        try { settings = store.Settings().Settings; } catch { return null; } // never break page rendering
        var features = settings.Effective(options.Features);
        if (!settings.Enabled || !features.Any) return null;
        if (!manual && (settings.Display.Mode == "manual" || !AssistantValidation.ShowsOn(settings.Display, path))) return null;
        context.Items[RenderedKey] = true;
        var captcha = context.RequestServices.GetRequiredService<IOptions<RecaptchaSettings>>().Value;
        return Script(settings, options.PublicApiBase, Controllers.PublicAssistantController.BaseTokens(settings, store, features), features, captcha);
    }
}

/// <summary>Adds the chat bubble before &lt;/body&gt; on every Razor page that uses the MVC tag helpers.</summary>
public sealed class AssistantTagHelperComponent(IHttpContextAccessor accessor, IOptions<AssistantOptions> options) : TagHelperComponent
{
    public override int Order => 1000;
    public override void Process(TagHelperContext context, TagHelperOutput output)
    {
        if (!options.Value.AutoInject || !string.Equals(context.TagName, "body", StringComparison.OrdinalIgnoreCase)) return;
        var http = accessor.HttpContext;
        if (http == null) return;
        var markup = AssistantMarkup.Render(http, http.RequestServices.GetRequiredService<AssistantStore>(), options.Value, manual: false);
        if (markup != null) output.PostContent.AppendHtml(markup);
    }
}

/// <summary>Manual placement: @await Component.InvokeAsync("LigataAssistant")</summary>
[ViewComponent(Name = "LigataAssistant")]
public sealed class LigataAssistantViewComponent(AssistantStore store, IOptions<AssistantOptions> options) : ViewComponent
{
    public IViewComponentResult Invoke() =>
        new Microsoft.AspNetCore.Mvc.ViewComponents.HtmlContentViewComponentResult(new Microsoft.AspNetCore.Html.HtmlString(AssistantMarkup.Render(HttpContext, store, options.Value, manual: true) ?? ""));
}
