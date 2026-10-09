using Umbraco.Cms.Core;
using Umbraco.Cms.Core.IO;
using Umbraco.Cms.Core.Models;
using Umbraco.Cms.Core.PropertyEditors;
using Umbraco.Cms.Core.Services;
using Umbraco.Cms.Core.Services.AuthorizationStatus;
using Umbraco.Cms.Core.Strings;
using Umbraco.Extensions;

namespace Ligata.AI.Editor;

/// <summary>upload_media: an image the editor attached in the chat becomes an Image in the media library (with the user's media permissions).</summary>
public sealed class EditorMedia(IMediaService media, IMediaPermissionService permissions, MediaFileManager files, MediaUrlGeneratorCollection urls, IShortStringHelper names,
    IContentTypeBaseServiceProvider types)
{
    public const int MaxBytes = 10 * 1024 * 1024;
    private static readonly Dictionary<string, string> Extensions = new() { ["image/png"] = ".png", ["image/jpeg"] = ".jpg", ["image/webp"] = ".webp", ["image/gif"] = ".gif" };

    public async Task<Proposal> PlanUploadAsync(ToolContext context, int attachment, string? name, string? folderId)
    {
        if (attachment < 1 || attachment > context.Attachments.Count)
            return Proposal.Refused(context.Attachments.Count == 0 ? "No image was attached in this conversation. Ask the editor to attach one (paperclip or paste)." : $"attachment must be 1 to {context.Attachments.Count} (the images attached in this conversation, in order).");
        var (fileName, mediaType, data) = context.Attachments[attachment - 1];
        if (!Extensions.TryGetValue(mediaType, out var extension)) return Proposal.Refused("Only PNG, JPEG, WebP and GIF images can be uploaded.");
        byte[] bytes;
        try { bytes = Convert.FromBase64String(data); } catch (FormatException) { return Proposal.Refused("The attachment could not be read."); }
        if (bytes.Length > MaxBytes) return Proposal.Refused("The image is larger than 10 MB.");
        var title = string.IsNullOrWhiteSpace(name) ? Path.GetFileNameWithoutExtension(fileName) : name.Trim();
        if (title.Length is 0 or > 255) return Proposal.Refused("Give the image a name (at most 255 characters).");
        IMedia? folder = null;
        if (!string.IsNullOrWhiteSpace(folderId))
        {
            folder = ContentFields.Udi(folderId) is { } key ? media.GetById(key) : null;
            if (folder == null || folder.Trashed || folder.ContentType.Alias != Constants.Conventions.MediaTypes.Folder) return Proposal.Refused($"No media folder with key {folderId}.");
            if (await permissions.AuthorizeAccessAsync(context.User.User, folder.Key) != MediaAuthorizationStatus.Success) return Proposal.Refused($"{context.User.Name} may not add media to this folder.");
        }
        else if (await permissions.AuthorizeRootAccessAsync(context.User.User) != MediaAuthorizationStatus.Success)
            return Proposal.Refused($"{context.User.Name} may not add media at the top of the media library; give a folder key (search_media lists folders by name).");
        var where = folder != null ? $"the folder “{folder.Name}”" : "the media library";
        var proposal = new Proposal
        {
            Kind = EditorActions.Media, Title = $"Upload the image “{title}” to {where}", DocumentName = title,
            Changes = [new EditorChange("(media)", "Image", null, null, fileName, null, $"{fileName} ({bytes.Length / 1024:N0} KB) → {where}")],
        };
        proposal.Commit = () =>
        {
            var item = media.CreateMedia(title, folder?.Id ?? Constants.System.Root, Constants.Conventions.MediaTypes.Image, context.User.Id);
            using (var stream = new MemoryStream(bytes))
                item.SetValue(files, urls, names, types, Constants.Conventions.Media.File, SafeFile(fileName, title) + extension, stream);
            var saved = media.Save(item, context.User.Id);
            if (!saved.Success) throw new EditorToolException($"Umbraco did not save the image ({saved.Result}).");
            proposal.DocumentKey = item.Key;
            var check = media.GetById(item.Key);
            return Task.FromResult($"Uploaded “{title}” to {where} — media key {item.Key}. Checked: {(check != null ? "it is in the media library" : "NOT found")}. Use this key in media picker fields.");
        };
        return proposal;
    }

    private static string SafeFile(string fileName, string title)
    {
        var stem = Path.GetFileNameWithoutExtension(fileName);
        if (string.IsNullOrWhiteSpace(stem)) stem = title;
        var safe = new string(stem.Select(c => char.IsLetterOrDigit(c) || c is '-' or '_' ? c : '-').ToArray()).Trim('-');
        return safe.Length == 0 ? "image" : safe.Length > 80 ? safe[..80] : safe;
    }

    public string? Undo(EditorUser user, Guid key)
    {
        var item = media.GetById(key);
        if (item == null) return "The image no longer exists.";
        if (item.Trashed) return "It is already in the recycle bin.";
        return media.MoveToRecycleBin(item, user.Id).Success ? null : "Umbraco did not move the image to the recycle bin.";
    }
}
