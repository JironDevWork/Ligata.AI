using System.Net;
using System.Text;
using Ligata.AI.Data;
using Ligata.AI.Models;
using Microsoft.Extensions.Options;
using Umbraco.Cms.Core.Configuration.Models;
using Umbraco.Cms.Core.Mail;
using Umbraco.Cms.Core.Models.Email;

namespace Ligata.AI.Services;

public interface IAssistantEmailDelivery
{
    bool Ready { get; }
    Task SendAsync(EmailRow email);
}

/// <summary>Sends through the host's Umbraco SMTP settings (Umbraco:CMS:Global:Smtp), like Ligata.Forms.</summary>
public sealed class UmbracoEmailDelivery(IEmailSender sender, IOptionsMonitor<GlobalSettings> global, IOptions<AssistantOptions> options) : IAssistantEmailDelivery
{
    public bool Ready => options.Value.Features.Email && !string.IsNullOrWhiteSpace(global.CurrentValue.Smtp?.From) &&
        (!string.IsNullOrWhiteSpace(global.CurrentValue.Smtp?.Host) || !string.IsNullOrWhiteSpace(global.CurrentValue.Smtp?.PickupDirectoryLocation));

    public async Task SendAsync(EmailRow email)
    {
        if (!Ready) throw new InvalidOperationException("SMTP is not configured.");
        var to = email.ToAddress.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Where(AssistantValidation.Email).ToArray();
        if (to.Length == 0) throw new InvalidOperationException("No valid recipient.");
        var replyTo = AssistantValidation.Email(email.ReplyTo) ? new[] { email.ReplyTo! } : [];
        var message = new EmailMessage(global.CurrentValue.Smtp!.From, to, [], [], replyTo, email.Subject, email.Body, true, []);
        // Request exceptions explicitly: an SMTP error must not be marked as sent.
        await sender.SendAsync(message, "Ligata.AI", true, TimeSpan.FromSeconds(45));
    }
}

/// <summary>Composes notification and reply emails and puts them in the queue. The worker sends them.</summary>
public sealed class SupportMailer(SupportStore store, IAssistantEmailDelivery delivery, IOptions<AssistantOptions> options, IOptionsMonitor<WebRoutingSettings> routing)
{
    public bool Licensed => options.Value.Features.Email;
    public bool Ready => delivery.Ready;
    public bool CanNotify(AssistantSettings settings) => Licensed && settings.Notifications.Recipients.Count > 0;

    /// <summary>
    /// Base address for links in team emails. Only trusted configuration is used, never the request's
    /// Host header (which a visitor controls and could turn into a phishing link).
    /// </summary>
    public string? Backoffice()
    {
        static string? Origin(string? value) => Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme is "https" or "http" ? uri.GetLeftPart(UriPartial.Authority) : null;
        return Origin(options.Value.BackofficeUrl) ?? Origin(options.Value.PublicApiBase) ?? Origin(routing.CurrentValue.UmbracoApplicationUrl);
    }

    public string? InboxLink(Guid conversation) => Backoffice() is { } origin ? $"{origin}/umbraco/section/ai-assistant/dashboard/inbox?conversation={conversation:D}" : null;

    private static string Site(AssistantSettings s) => string.IsNullOrWhiteSpace(s.Behaviour.SiteName) ? s.Identity.Name : s.Behaviour.SiteName.Trim();
    private static string Prefix(AssistantSettings s) => s.Notifications.SubjectPrefix.Trim() is { Length: > 0 } p ? p + " " : $"[{Site(s)}] ";
    private static string Line(string value, int max = 120) { var line = value.ReplaceLineEndings(" ").Trim(); return line.Length > max ? line[..(max - 1)].TrimEnd() + "…" : line; }
    private static string Who(ConversationRow c) => !string.IsNullOrWhiteSpace(c.Name) ? c.Name! : !string.IsNullOrWhiteSpace(c.Email) ? c.Email! : "A visitor";
    private static string TeamReplyTo(AssistantSettings s) => s.Notifications.ReplyTo is { Length: > 0 } r ? r : s.Notifications.Recipients.FirstOrDefault() ?? "";

    private void Queue(string kind, IEnumerable<string> to, string? replyTo, string subject, string body, Guid? conversation) => store.Enqueue(new EmailRow
    {
        Kind = kind, ToAddress = string.Join(",", to.Where(AssistantValidation.Email).Distinct(StringComparer.OrdinalIgnoreCase)), ReplyTo = AssistantValidation.Email(replyTo) ? replyTo : null,
        Subject = Line(subject, 240), Body = body, ConversationId = conversation,
    });

    private static IEnumerable<(string Label, string Value)> Details(ConversationRow c) => new[]
    {
        ("Name", c.Name ?? ""), ("Email", c.Email ?? ""), ("Page", string.IsNullOrEmpty(c.PagePath) ? "" : $"{c.PageTitle} ({c.PagePath})"),
        ("Received", c.CreatedUtc.ToLocalTime().ToString("dddd, d MMMM yyyy HH:mm")),
    }.Where(r => r.Item2 != "");

    public void TeamNewChat(AssistantSettings settings, ConversationRow c, IReadOnlyList<MessageRow> messages, int online)
    {
        if (!CanNotify(settings) || !settings.Notifications.NewChat) return;
        var history = messages.Where(m => m.Kind == "history").TakeLast(12).ToList();
        var request = messages.LastOrDefault(m => m.Author == "visitor" && m.Kind == "message")?.Text ?? c.Topic;
        var body = EmailTemplate.Render(settings, $"{Who(c)} would like to chat with your team",
            online > 0 ? $"{online} team member{(online == 1 ? " is" : "s are")} online in the Inbox right now." : "Nobody from the team is in the Inbox right now. Join the conversation, or reply by email if the visitor left an address.",
            Details(c), [("Message", request)], history.Select(m => (m.Author == "ai" ? "AI assistant" : "Visitor", m.Text)).ToList(),
            ("Open the conversation", InboxLink(c.Id)));
        Queue("team-chat", settings.Notifications.Recipients, c.Email, $"{Prefix(settings)}Chat request: {Line(c.Topic, 80)}", body, c.Id);
    }

    public void TeamVisitorMessage(AssistantSettings settings, ConversationRow c, IReadOnlyList<MessageRow> unanswered)
    {
        if (!CanNotify(settings) || !settings.Notifications.VisitorMessages) return;
        var body = EmailTemplate.Render(settings, $"New message from {Who(c)}", "Nobody from the team is in this conversation right now.",
            Details(c), unanswered.TakeLast(10).Select(m => ("Visitor", m.Text)).ToList(), [], ("Reply in the Inbox", InboxLink(c.Id)));
        Queue("team-message", settings.Notifications.Recipients, c.Email, $"{Prefix(settings)}New message from {Who(c)}: {Line(unanswered.LastOrDefault()?.Text ?? "", 70)}", body, c.Id);
    }

    public void TeamEmail(AssistantSettings settings, ConversationRow c, string message)
    {
        if (!CanNotify(settings)) return;
        var body = EmailTemplate.Render(settings, $"Message from {Who(c)}", "Sent with the contact form in the website chat. Reply to this email to answer the visitor directly.",
            Details(c), [("Message", message)], [], ("Open in Umbraco", InboxLink(c.Id)));
        Queue("team-email", settings.Notifications.Recipients, c.Email, $"{Prefix(settings)}{Who(c)}: {Line(c.Topic, 80)}", body, c.Id);
    }

    public void VisitorConfirmation(AssistantSettings settings, ConversationRow c, string message)
    {
        if (!Licensed || !settings.Contact.SendConfirmation || !AssistantValidation.Email(c.Email)) return;
        var text = Texts.For(c.Language);
        var intro = (settings.Contact.ConfirmationText is { Length: > 0 } custom ? custom : text.ConfirmationText).Replace("{name}", c.Name ?? "").Replace("{site}", Site(settings));
        var subject = (settings.Contact.ConfirmationSubject is { Length: > 0 } s ? s : text.ConfirmationSubject).Replace("{site}", Site(settings));
        var body = EmailTemplate.Render(settings, subject, intro, [], [(text.YourMessage, message)], [], null);
        Queue("visitor-confirmation", [c.Email!], TeamReplyTo(settings), subject, body, c.Id);
    }

    public void Reply(AssistantSettings settings, ConversationRow c, string text, string signature)
    {
        if (!Licensed || !AssistantValidation.Email(c.Email)) return;
        var strings = Texts.For(c.Language);
        var body = EmailTemplate.Render(settings, strings.ReplyTitle.Replace("{site}", Site(settings)), text, [], [], [], null, signature);
        Queue("reply", [c.Email!], TeamReplyTo(settings), $"Re: {Line(c.Topic, 100)}", body, c.Id);
    }

    public void Test(AssistantSettings settings, IEnumerable<string> to)
    {
        var body = EmailTemplate.Render(settings, "Test email from the website chat", "If you can read this, notification emails work. New chat requests and messages will arrive like this.",
            [("Website", Site(settings))], [], [], ("Open the Inbox", Backoffice() is { } origin ? origin + "/umbraco/section/ai-assistant/dashboard/inbox" : null));
        Queue("test", to, null, $"{Prefix(settings)}Test email", body, null);
    }

    private sealed record Texts(string ConfirmationSubject, string ConfirmationText, string YourMessage, string ReplyTitle)
    {
        public static Texts For(string language) => language switch
        {
            "de" => new("Deine Nachricht an {site}", "Hallo {name}\n\nDanke für deine Nachricht. Wir melden uns so bald wie möglich bei dir.", "Deine Nachricht", "Antwort von {site}"),
            "fr" => new("Votre message à {site}", "Bonjour {name}\n\nMerci pour votre message. Nous vous répondrons dès que possible.", "Votre message", "Réponse de {site}"),
            "it" => new("Il tuo messaggio a {site}", "Ciao {name}\n\nGrazie per il tuo messaggio. Ti risponderemo il prima possibile.", "Il tuo messaggio", "Risposta da {site}"),
            _ => new("Your message to {site}", "Hi {name}\n\nThanks for your message. We will get back to you as soon as possible.", "Your message", "Reply from {site}"),
        };
    }
}

/// <summary>A small, robust HTML email: one card, inline styles, every value encoded.</summary>
public static class EmailTemplate
{
    private static string E(string value) => WebUtility.HtmlEncode(value ?? "");
    private static string Paragraphs(string value) => string.Join("", E(value).ReplaceLineEndings("\n").Split("\n\n").Select(p => $"<p style=\"margin:0 0 12px\">{p.Replace("\n", "<br>")}</p>"));

    public static string Render(AssistantSettings settings, string title, string intro, IEnumerable<(string Label, string Value)> details,
        IReadOnlyList<(string Label, string Text)> blocks, IReadOnlyList<(string Author, string Text)> history, (string Text, string? Url)? button, string? signature = null)
    {
        var accent = settings.Appearance.Accent;
        var html = new StringBuilder();
        html.Append("<!doctype html><html><body style=\"margin:0;padding:24px 12px;background:#f3f4f7;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1b1d26\">");
        html.Append("<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\"><tr><td align=\"center\">");
        html.Append("<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3e5ec\">");
        html.Append($"<tr><td style=\"height:5px;background:{E(accent)}\"></td></tr><tr><td style=\"padding:26px 28px 8px\">");
        html.Append($"<h1 style=\"margin:0 0 10px;font-size:20px;line-height:1.3\">{E(title)}</h1>");
        html.Append($"<div style=\"font-size:15px;line-height:1.55;color:#3a3e4c\">{Paragraphs(intro)}</div>");
        var rows = details.ToList();
        if (rows.Count > 0)
        {
            html.Append("<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" style=\"margin:6px 0 16px;font-size:14px;line-height:1.5\">");
            foreach (var (label, value) in rows) html.Append($"<tr><td style=\"padding:3px 16px 3px 0;color:#6b7080;vertical-align:top\">{E(label)}</td><td style=\"padding:3px 0;font-weight:600\">{E(value)}</td></tr>");
            html.Append("</table>");
        }
        foreach (var (label, text) in blocks)
            html.Append($"<div style=\"margin:0 0 16px\"><div style=\"font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#6b7080;margin-bottom:6px\">{E(label)}</div><div style=\"background:#f6f7fa;border-radius:10px;padding:12px 14px;font-size:15px;line-height:1.55\">{Paragraphs(text)}</div></div>");
        if (history.Count > 0)
        {
            html.Append("<div style=\"margin:0 0 16px\"><div style=\"font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#6b7080;margin-bottom:6px\">Before the request</div>");
            foreach (var (author, text) in history)
                html.Append($"<div style=\"border-left:3px solid {(author == "Visitor" ? E(accent) : "#d4d7e0")};padding:2px 0 2px 10px;margin:0 0 8px;font-size:14px;line-height:1.5\"><b style=\"color:#6b7080;font-size:12px\">{E(author)}</b><br>{E(text.Length > 1200 ? text[..1200] + "…" : text).ReplaceLineEndings("<br>")}</div>");
            html.Append("</div>");
        }
        if (signature != null) html.Append($"<p style=\"margin:4px 0 16px;color:#3a3e4c;font-size:15px\">{E(signature)}</p>");
        if (button is { Url: { } url } b) html.Append($"<p style=\"margin:8px 0 20px\"><a href=\"{E(url)}\" style=\"display:inline-block;background:{E(accent)};color:{E(settings.Appearance.AccentText)};text-decoration:none;font-weight:600;padding:11px 18px;border-radius:9px;font-size:14px\">{E(b.Text)}</a></p>");
        html.Append("</td></tr></table>");
        html.Append($"<p style=\"font-size:12px;color:#8a8f9e;margin:14px 0 0\">{E(string.IsNullOrWhiteSpace(settings.Behaviour.SiteName) ? settings.Identity.Name : settings.Behaviour.SiteName)} · website chat</p>");
        html.Append("</td></tr></table></body></html>");
        return html.ToString();
    }
}
