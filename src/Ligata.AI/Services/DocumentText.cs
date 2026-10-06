using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;

namespace Ligata.AI.Services;

/// <summary>Turns uploaded knowledge files into plain text. PDFs are converted by the gateway.</summary>
public static partial class DocumentText
{
    public static readonly string[] Extensions = [".pdf", ".txt", ".md", ".markdown", ".csv", ".json", ".html", ".htm", ".docx"];
    public const int MaxUploadBytes = 15 * 1024 * 1024;

    [GeneratedRegex(@"<(script|style|noscript|template|svg)[^>]*>.*?</\1\s*>", RegexOptions.Singleline | RegexOptions.IgnoreCase)] private static partial Regex Invisible();
    [GeneratedRegex(@"<(br|/p|/div|/li|/h[1-6]|/tr|/section|/article|/blockquote)[^>]*>", RegexOptions.IgnoreCase)] private static partial Regex Breaks();
    [GeneratedRegex(@"<li[^>]*>", RegexOptions.IgnoreCase)] private static partial Regex Items();
    [GeneratedRegex("<[^>]+>")] private static partial Regex Tags();
    [GeneratedRegex(@"[ \t ]+")] private static partial Regex Spaces();
    [GeneratedRegex(@"\n\s*\n\s*\n+")] private static partial Regex BlankLines();

    public static string Normalize(string text) =>
        BlankLines().Replace(Spaces().Replace(text.Replace("\r\n", "\n").Replace('\r', '\n'), " ").Replace(" \n", "\n").Replace("\n ", "\n"), "\n\n").Trim();

    public static string FromHtml(string html)
    {
        var text = Invisible().Replace(html, " ");
        text = Items().Replace(Breaks().Replace(text, "\n"), "\n- ");
        return Normalize(WebUtility.HtmlDecode(Tags().Replace(text, " ")));
    }

    public static string Decode(byte[] bytes)
    {
        var text = new UTF8Encoding(false, false).GetString(bytes);
        return text.Length > 0 && text[0] == '﻿' ? text[1..] : text;
    }

    /// <summary>Reads the paragraphs of a Word document (word/document.xml) without any Office dependency.</summary>
    public static string FromDocx(byte[] bytes)
    {
        using var zip = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
        var entry = zip.GetEntry("word/document.xml") ?? throw new InvalidDataException("This is not a Word document.");
        if (entry.Length > 50 * 1024 * 1024) throw new InvalidDataException("This Word document is too large.");
        using var stream = entry.Open();
        using var reader = XmlReader.Create(stream, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null });
        var text = new StringBuilder();
        while (reader.Read())
        {
            if (reader.NodeType != XmlNodeType.Element && reader.NodeType != XmlNodeType.EndElement) continue;
            switch (reader.LocalName)
            {
                case "t" when reader.NodeType == XmlNodeType.Element: text.Append(reader.ReadElementContentAsString()); break;
                case "tab" when reader.NodeType == XmlNodeType.Element: text.Append('\t'); break;
                case "br" when reader.NodeType == XmlNodeType.Element: text.Append('\n'); break;
                case "p" when reader.NodeType == XmlNodeType.EndElement: text.Append('\n'); break;
                case "tc" when reader.NodeType == XmlNodeType.EndElement: text.Append(" | "); break;
            }
        }
        return Normalize(text.ToString());
    }

    /// <summary>Returns the text of a non-PDF upload, or throws InvalidDataException with a readable message.</summary>
    public static string Extract(string fileName, byte[] bytes)
    {
        var extension = Path.GetExtension(fileName).ToLowerInvariant();
        var text = extension switch
        {
            ".html" or ".htm" => FromHtml(Decode(bytes)),
            ".docx" => FromDocx(bytes),
            ".txt" or ".md" or ".markdown" or ".csv" or ".json" => Normalize(Decode(bytes)),
            _ => throw new InvalidDataException("Upload PDF, Word (.docx), text, Markdown, CSV, JSON or HTML files."),
        };
        if (text.Contains('\0')) throw new InvalidDataException("This file does not contain readable text.");
        return text;
    }
}
