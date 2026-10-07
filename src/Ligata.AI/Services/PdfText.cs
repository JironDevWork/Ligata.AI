using System.Text;
using UglyToad.PdfPig;
using UglyToad.PdfPig.DocumentLayoutAnalysis.TextExtractor;
using UglyToad.PdfPig.Exceptions;

namespace Ligata.AI.Services;

/// <summary>
/// Reads the text of a PDF on this server (API mode has no gateway to do it). Same output shape as the
/// gateway: "--- Page n ---" sections. The file is processed in memory and never written to disk.
/// </summary>
public static class PdfText
{
    public const int MaxPages = 80, MaxBytes = 10 * 1024 * 1024;

    public static Task<ExtractedDocument> ExtractAsync(byte[] bytes, CancellationToken token) => Task.Run(() => Extract(bytes, token), token);

    public static ExtractedDocument Extract(byte[] bytes, CancellationToken token)
    {
        if (bytes.Length > MaxBytes) throw new GatewayException("pdf_too_large", $"PDFs can be at most {MaxBytes / 1048576} MB.", 413);
        if (bytes.Length < 5 || Encoding.ASCII.GetString(bytes, 0, 5) != "%PDF-") throw new GatewayException("invalid_pdf", "This file is not a PDF.", 422);
        PdfDocument document;
        try { document = PdfDocument.Open(bytes, new ParsingOptions { UseLenientParsing = true, SkipMissingFonts = true }); }
        catch (PdfDocumentEncryptedException) { throw new GatewayException("pdf_encrypted", "This PDF is password-protected. Remove the password and upload it again.", 422); }
        catch (Exception e) when (e is not OperationCanceledException) { throw new GatewayException("invalid_pdf", "This PDF could not be read.", 422); }
        using (document)
        {
            var pages = Math.Min(document.NumberOfPages, MaxPages);
            var parts = new List<string>();
            // A deadline on top of the visitor's own cancellation: a hostile PDF must not keep a worker busy.
            var deadline = DateTime.UtcNow.AddSeconds(30);
            for (var number = 1; number <= pages; number++)
            {
                token.ThrowIfCancellationRequested();
                if (DateTime.UtcNow > deadline) { pages = number - 1; break; }
                string text;
                try { text = ContentOrderTextExtractor.GetText(document.GetPage(number)); }
                catch (Exception e) when (e is not OperationCanceledException) { continue; }
                text = DocumentText.Normalize(text);
                if (text.Length > 0) parts.Add($"--- Page {number} ---\n{text}");
            }
            var result = string.Join("\n\n", parts);
            if (result.Length == 0) throw new GatewayException("pdf_no_text", "This PDF contains no readable text (it may be scanned). Upload screenshots of the pages instead.", 422);
            if (result.Length > ChatRelay.MaxDocumentCharacters) result = result[..ChatRelay.MaxDocumentCharacters];
            return new ExtractedDocument(result, document.NumberOfPages, pages, document.NumberOfPages > pages, null);
        }
    }
}
