using System.Globalization;
using System.Text;
using System.Text.Json;
using Ligata.AI.Data;
using Ligata.AI.Models;
using Microsoft.Extensions.Logging;
using Umbraco.Cms.Core.Events;
using Umbraco.Cms.Core.Notifications;

namespace Ligata.AI.Services;

/// <summary>A website page in one language (Culture, empty when pages do not vary) or a knowledge item (text or file, without url) the assistant can look up.</summary>
/// <param name="Page">The same for every language version of a page (empty for items).</param>
/// <param name="Parts">The page's forms and other parts by kind and name (Form “Book a visit”), for the list of pages (see <see cref="PageParts"/>).</param>
public sealed record KnowledgeDocument(string Kind, string Title, string Url, int Level, string Text, string Culture = "", string Page = "", string Parts = "");

/// <summary>One matching passage: about a paragraph of a document, Order is its place in the document.</summary>
public sealed record KnowledgeHit(KnowledgeDocument Document, int Order, string Text, double Score);

/// <summary>
/// Everything the assistant can look up at one moment, with a full-text index: BM25 over passages of about a paragraph,
/// with the title and url counted in every passage. Words match without accents and by prefix, so "kontakt" finds
/// "Kontaktformular" and "preise" finds "Preis". The same content always gives the same results, so earlier lookups of a
/// conversation can be repeated word for word.
/// </summary>
public sealed class KnowledgeSnapshot
{
    private sealed record Section(int Document, int Order, string Text, int Length);
    private const double K1 = 1.2, B = 0.75;
    private readonly List<Section> sections = [];
    private readonly Dictionary<string, List<(int Section, int Count)>> postings = new(StringComparer.Ordinal);
    private readonly string[] vocabulary;
    private readonly double averageLength;

    public IReadOnlyList<KnowledgeDocument> Documents { get; }
    public int Pages => Documents.Count(d => d.Kind == "page");
    /// <summary>The languages of a multilingual website (empty when pages do not vary by culture).</summary>
    public IReadOnlyList<string> Cultures { get; }
    public int Passages => sections.Count;
    /// <summary>Results of lookups, by what was asked: earlier lookups are repeated with every question of a conversation.</summary>
    internal System.Collections.Concurrent.ConcurrentDictionary<string, string> Results { get; } = new(StringComparer.Ordinal);
    /// <summary>The website has more pages than are read (see ContentKnowledge.MaxPages): the rest cannot be looked up.</summary>
    public bool Truncated { get; init; }
    /// <summary>The page list for the prompt, built once per snapshot and budget (see PromptBuilder.SiteMap).</summary>
    internal System.Collections.Concurrent.ConcurrentDictionary<int, string> SiteMaps { get; } = new();

    // Words that say nothing about what a visitor looks for (English, German, French, Italian), without accents.
    private static readonly HashSet<string> Stop = new(StringComparer.Ordinal)
    {
        "the", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "was", "what", "how", "do", "does", "you", "your", "we", "our", "my", "me", "it", "with", "at", "by", "from", "be", "can", "there", "this", "that", "about", "have", "has",
        "der", "die", "das", "den", "dem", "des", "und", "oder", "ist", "sind", "ein", "eine", "einen", "einem", "einer", "ich", "du", "sie", "wir", "ihr", "mit", "von", "zu", "im", "am", "an", "auf", "fur", "was", "wie", "wo", "gibt", "es", "bei", "habt", "haben", "kann", "ihre", "eure", "euer", "ihr", "mir", "mich",
        "le", "la", "les", "un", "une", "des", "et", "ou", "de", "du", "est", "sont", "je", "vous", "nous", "il", "elle", "pour", "avec", "que", "qui", "quoi", "comment", "votre", "vos",
        "lo", "gli", "il", "di", "da", "sono", "per", "con", "che", "cosa", "come", "una", "uno", "del", "della", "vostro", "vostra",
        // Question words, greetings, thanks and the verbs of requests ("write me…")
        "when", "where", "who", "why", "which", "will", "would", "could", "should", "since", "also",
        "wann", "warum", "wer", "wen", "wem", "welche", "welcher", "welches", "konnt", "konnen", "mochte", "gerne", "auch", "noch", "seit", "uber", "unter", "nach", "vor", "fuer", "aus",
        "quand", "pourquoi", "quel", "quelle", "aussi", "sur", "dans", "quando", "dove", "perche", "quale", "anche", "su", "sul",
        "hi", "hello", "hey", "thanks", "thank", "bye", "ok", "okay", "yes", "no", "please", "hallo", "gruezi", "gruessech", "servus", "moin", "danke", "merci", "tschuss", "ja", "nein", "bitte",
        "bonjour", "salut", "oui", "non", "ciao", "buongiorno", "grazie", "si",
        "good", "morning", "afternoon", "evening", "guten", "gute", "morgen", "abend", "geht", "gehts", "gaht", "bonsoir", "buonasera",
        "write", "tell", "give", "schreib", "schreibe", "erzahl", "erzahle", "ecris", "scrivi",
    };

    /// <summary>The words of a question that say what it is about (without function words, greetings and request verbs).</summary>
    public static List<string> Meaningful(string text) => Terms(text).Where(t => !Stop.Contains(t)).Distinct().ToList();

    /// <summary>A meaningful word of the question occurs on the website (as a word or the start of one).</summary>
    public bool Mentions(string question) => Meaningful(question).Any(term => postings.ContainsKey(term) || (term.Length >= 4 && Forms(term).Any(f => f.Weight >= 0.7)));

    public KnowledgeSnapshot(IReadOnlyList<KnowledgeDocument> documents)
    {
        Documents = documents;
        Cultures = [.. documents.Where(d => d.Kind == "page" && d.Culture != "").Select(d => d.Culture).Distinct(StringComparer.OrdinalIgnoreCase)];
        for (var d = 0; d < documents.Count; d++)
        {
            var document = documents[d];
            var heading = document.Title + " " + document.Url.Replace('/', ' ').Replace('-', ' ');
            var order = 0;
            foreach (var text in Split(document.Text))
            {
                var terms = Terms(heading + "\n" + text);
                var index = sections.Count;
                sections.Add(new Section(d, order++, text, terms.Count));
                foreach (var group in terms.GroupBy(t => t, StringComparer.Ordinal))
                {
                    if (!postings.TryGetValue(group.Key, out var list)) postings[group.Key] = list = [];
                    list.Add((index, group.Count()));
                }
            }
        }
        vocabulary = [.. postings.Keys.Order(StringComparer.Ordinal)];
        averageLength = sections.Count == 0 ? 1 : sections.Average(s => s.Length);
    }

    /// <summary>Lower case, without accents (ß as ss), split into words; digits count as words of any length.</summary>
    public static List<string> Terms(string text)
    {
        var folded = Fold(text);
        var terms = new List<string>();
        var start = -1;
        for (var i = 0; i <= folded.Length; i++)
        {
            if (i < folded.Length && char.IsLetterOrDigit(folded[i])) { if (start < 0) start = i; continue; }
            if (start < 0) continue;
            var term = folded[start..i];
            if (term.Length > 1 || char.IsDigit(term[0])) terms.Add(term.Length > 40 ? term[..40] : term);
            start = -1;
        }
        return terms;
    }

    public static string Fold(string text)
    {
        var decomposed = text.ToLowerInvariant().Replace("ß", "ss").Normalize(NormalizationForm.FormD);
        var folded = new StringBuilder(decomposed.Length);
        foreach (var c in decomposed) if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark) folded.Append(c);
        return folded.ToString();
    }

    /// <summary>Passages of about `size` characters at line ends; very long lines (PDF paragraphs) are split at sentence ends.</summary>
    /// <remarks>
    /// A short last line is repeated at the start of the next passage, so what belongs together (a name and the role on the
    /// line after it) is found in one passage.
    /// </remarks>
    public static IEnumerable<string> Split(string text, int size = 1000)
    {
        var current = new StringBuilder();
        var last = "";
        foreach (var line in text.Split('\n'))
            foreach (var part in Pieces(line.TrimEnd(), size * 3 / 2))
            {
                if (current.Length > 0 && current.Length + part.Length > size)
                {
                    if (current.ToString().Trim() is { Length: > 0 } full) yield return full;
                    current.Clear();
                    if (last.Trim().Length is > 0 and <= 160) current.Append(last).Append('\n');
                }
                current.Append(part).Append('\n');
                last = part;
            }
        if (current.ToString().Trim() is { Length: > 0 } rest) yield return rest;
    }

    private static IEnumerable<string> Pieces(string line, int max)
    {
        while (line.Length > max)
        {
            var cut = line.LastIndexOf(". ", max, StringComparison.Ordinal);
            if (cut < max / 3) cut = line.LastIndexOf(' ', max);
            if (cut < max / 3) cut = max - 1;
            yield return line[..(cut + 1)].Trim();
            line = line[(cut + 1)..].TrimStart();
        }
        yield return line;
    }

    /// <summary>The best passages for a few key words, best first.</summary>
    /// <param name="culture">The language of the page the visitor is on: on a multilingual website its pages win a tie, and of the
    /// language versions of one page only the best matching one is returned, so other pages are not crowded out.</param>
    public List<KnowledgeHit> Search(string query, int max = 8, string? culture = null)
    {
        var terms = Terms(query).Distinct().Take(12).ToList();
        var meaningful = terms.Where(t => !Stop.Contains(t)).ToList();
        if (meaningful.Count > 0) terms = meaningful;
        if (terms.Count == 0 || sections.Count == 0) return [];
        var scores = new Dictionary<int, double>();
        var matched = new Dictionary<int, int>();
        foreach (var term in terms)
        {
            // Each passage counts its best form of the word once (exact beats prefix beats part of a longer word).
            var best = new Dictionary<int, double>();
            foreach (var (form, weight) in Forms(term))
            {
                var list = postings[form];
                var idf = Math.Log(1 + (sections.Count - list.Count + 0.5) / (list.Count + 0.5));
                foreach (var (section, count) in list)
                {
                    var value = weight * idf * count * (K1 + 1) / (count + K1 * (1 - B + B * sections[section].Length / averageLength));
                    if (!best.TryGetValue(section, out var known) || value > known) best[section] = value;
                }
            }
            foreach (var (section, value) in best) { scores[section] = scores.GetValueOrDefault(section) + value; matched[section] = matched.GetValueOrDefault(section) + 1; }
        }
        // Passages that contain more of the words rank higher than passages that repeat one of them.
        var ranked = scores.Select(p => (Section: p.Key, Score: p.Value * (0.5 + 0.5 * matched[p.Key] / terms.Count) * (culture != null && Documents[sections[p.Key].Document].Culture == culture ? 1.5 : 1)))
            .OrderByDescending(x => x.Score).ThenBy(x => x.Section);
        var hits = new List<KnowledgeHit>();
        var chosen = new Dictionary<string, KnowledgeDocument>();
        foreach (var (section, score) in ranked)
        {
            var document = Documents[sections[section].Document];
            // One language version per page: the first (best) one found.
            if (document.Page != "" && chosen.TryGetValue(document.Page, out var version) && version != document) continue;
            if (document.Page != "") chosen[document.Page] = document;
            hits.Add(new KnowledgeHit(document, sections[section].Order, sections[section].Text, score));
            if (hits.Count >= max) break;
        }
        return hits;
    }

    /// <summary>
    /// The forms of a word on the website: the word itself, longer words it starts (prefix), shorter words it starts with (stem of
    /// a compound) and, for longer words, words that contain it. At most 200. The prefix and stem forms come from the sorted
    /// vocabulary without scanning it, so nonsense queries stay cheap on big websites.
    /// </summary>
    private IEnumerable<(string Form, double Weight)> Forms(string term)
    {
        if (postings.ContainsKey(term)) yield return (term, 1);
        if (term.Length < 3 || term.All(char.IsDigit)) yield break;
        var found = 0;
        var start = Array.BinarySearch(vocabulary, term, StringComparer.Ordinal);
        for (var i = start < 0 ? ~start : start; i < vocabulary.Length && found < 200 && vocabulary[i].StartsWith(term, StringComparison.Ordinal); i++)
            if (vocabulary[i] != term) { found++; yield return (vocabulary[i], 0.8); }
        for (var length = term.Length - 1; length >= 4 && found < 200; length--)
            if (postings.ContainsKey(term[..length])) { found++; yield return (term[..length], 0.7); }
        if (term.Length < 5) yield break;
        foreach (var word in vocabulary)
        {
            if (found >= 200) yield break;
            if (word.Length > term.Length && !word.StartsWith(term, StringComparison.Ordinal) && word.Contains(term, StringComparison.Ordinal)) { found++; yield return (word, 0.5); }
        }
    }

    /// <summary>A page by its url (with or without the domain and trailing slash) or a page or document by its title.</summary>
    /// <summary>The language of the page at this path (the longest page url it starts with); null on a website in one language.</summary>
    public string? CultureOf(string? path)
    {
        if (Cultures.Count < 2 || string.IsNullOrWhiteSpace(path)) return null;
        var bare = path.Split('?', '#')[0];
        return Documents.Where(d => d.Kind == "page" && d.Culture != "" && d.Url.StartsWith('/') && AssistantValidation.Below(bare, d.Url)).OrderByDescending(d => d.Url.Length).FirstOrDefault()?.Culture;
    }

    public KnowledgeDocument? Find(string reference)
    {
        var value = reference.Trim();
        if (value.Length == 0) return null;
        var path = Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" ? uri.AbsolutePath : value.StartsWith('/') ? value.Split('?', '#')[0] : null;
        static string Bare(string url) => Uri.UnescapeDataString(url).Trim().TrimEnd('/').ToLowerInvariant();
        if (path != null && Documents.FirstOrDefault(d => d.Url != "" && Bare(d.Url) == Bare(path)) is { } page) return page;
        var folded = Fold(value.Trim('"', '“', '”', '„', '«', '»'));
        return Documents.FirstOrDefault(d => Fold(d.Title) == folded)
            ?? Documents.FirstOrDefault(d => d.Url != "" && Bare(d.Url).Split('/').Last() == folded.Replace(' ', '-'))
            ?? (folded.Length >= 4 ? Documents.FirstOrDefault(d => Fold(d.Title).Contains(folded, StringComparison.Ordinal)) : null);
    }
}

/// <summary>
/// The tools the assistant uses to look things up, and what one answer may look up: at most a few rounds and about 7,000
/// tokens of results, so a conversation keeps room for the next questions. Results are plain text for the model.
/// </summary>
/// <param name="team">The model may offer the team: every result ends with a reminder, because the results now stand between
/// the rule in the system prompt and the answer (the model follows a nearby reminder more reliably).</param>
/// <param name="culture">The language of the page the visitor is on (multilingual websites): its pages win ties in search results.</param>
/// <param name="guide">The site lets the assistant show visitors where something is (<see cref="Show"/>).</param>
/// <param name="page">The path of the page the visitor is on: what is shown there needs no other page.</param>
public sealed class Lookups(KnowledgeSnapshot snapshot, bool team = false, string? culture = null, GuideSettings? guide = null, string? page = null)
{
    public const string Search = "search_website", Read = "read_pages", Show = "show_on_website";
    public const int MaxRounds = 3, MaxCalls = 6, Characters = 24_000, SearchCharacters = 6_000, PageCharacters = 12_000;
    /// <summary>What lookups may add to one answer, in tokens. The widget keeps this free before it summarizes.</summary>
    public const int Tokens = 7_000;
    /// <summary>History limits: the gateway stops a model after six rounds; more than eight calls at once are not kept.</summary>
    public const int MaxRecordedRounds = 6, MaxRecordedCalls = 8;

    public KnowledgeSnapshot Snapshot => snapshot;

    /// <summary>The tool definitions, in the gateway's format (name, description, JSON-schema parameters).</summary>
    public static readonly IReadOnlyList<object> Tools =
    [
        new
        {
            name = Search,
            description = "Searches all pages and documents of this website and returns the best matching passages with the url of their page. Use a few key words in the language of the website. For several topics, call it several times at once.",
            parameters = new { type = "object", properties = new { query = new { type = "string", description = "A few key words, for example: opening hours" } }, required = new[] { "query" } },
        },
        new
        {
            name = Read,
            description = "Returns the whole text of up to three pages of this website (by url from the list of pages) or documents (by title).",
            parameters = new { type = "object", properties = new { pages = new { type = "array", items = new { type = "string" }, description = "Page urls such as /contact/, or document titles" } }, required = new[] { "pages" } },
        },
    ];

    /// <summary>
    /// Shows the visitor a place on the website. Declared only when the site allows it; the description says how far it reaches,
    /// so the model does not offer other pages where only the current one may be shown.
    /// </summary>
    public static object ShowTool(GuideSettings guide) => new
    {
        name = Show,
        description = (guide.Ask == "never" ? "Shows the visitor" : "Offers to show the visitor (with a button under your answer)") + (guide.Pages
            ? " where something is on this website: the website opens the page if needed, scrolls to the given words and highlights them for a few seconds. Use it when the visitor asks where something is or cannot find it. It never clicks or fills in anything."
            : guide.Reach == "scroll"
                ? " where something is on the page they are on: the website scrolls to the given words and highlights them for a few seconds. Use it when the visitor asks where something is or cannot find it. Other pages cannot be shown; link to them instead."
                : " where something is on the page they are on: the website highlights the given words for a few seconds, where they are (the page does not scroll). Other pages cannot be shown; link to them instead."),
        parameters = new
        {
            type = "object",
            properties = new
            {
                page = new { type = "string", description = guide.Pages ? "Url of the page from the list of pages, for example /contact/. Leave it out for the page the visitor is on." : "Leave it out: only the page the visitor is on can be shown." },
                text = new { type = "string", description = "Words exactly as they appear on that page, short and distinctive, for example the phone number itself or a heading (at most about 80 characters)." },
                label = new { type = "string", description = "What it is, in the visitor's language, in one to four words, for example: Phone number" },
            },
            required = new[] { "text", "label" },
        },
    };

    /// <summary>The tools of this site: the lookups, and showing the way when the site allows it.</summary>
    public IReadOnlyList<object> Definitions => guide is { Enabled: true } shown ? [.. Tools, ShowTool(shown)] : Tools;

    /// <summary>The tool is declared to the model now. Earlier calls to a tool the site has since switched off are not repeated: the API refuses calls to undeclared tools.</summary>
    public bool Declares(string name) => name is Search or Read || (name == Show && guide is { Enabled: true });

    /// <summary>Calls the browser may keep and send back: known tools with small object arguments.</summary>
    public static bool Valid(ChatLookup call) => call.Name is Search or Read or Show && call.Arguments.ValueKind == JsonValueKind.Object && call.Arguments.GetRawText().Length <= 1000;

    /// <summary>What became of a place shown with an earlier answer, as the browser reports it.</summary>
    public static readonly string[] Outcomes = ["offered", "shown", "declined", "missing"];

    public Answer Begin() => new(snapshot, team, culture, guide, page);
    /// <summary>An earlier answer's lookups, repeated. <paramref name="outcome"/> is what became of the place it showed (see <see cref="Outcomes"/>).</summary>
    public Answer Again(string? outcome) => new(snapshot, team, culture, guide, page, outcome ?? "offered");

    /// <summary>
    /// The question touches the website's content (its words occur in it): the GPU model must then look something up
    /// before it answers, because a 12B model otherwise answers too often from the prompt alone. Greetings and unrelated
    /// requests stay free.
    /// </summary>
    public bool Touches(string question) => snapshot.Mentions(question);

    /// <summary>
    /// The question touches the website with something the conversation does not contain yet: words the website uses, or a
    /// question with words it does not use (another language, other words for the same thing). Without a lookup the model then
    /// guessed: asked in German on an English website, it said opening hours differed "by location" and asked which one.
    /// Otherwise (a follow-up about what was already found, thanks, small talk) the model decides itself.
    /// </summary>
    public bool Touches(string question, IEnumerable<string> conversation)
    {
        var known = conversation.SelectMany(KnowledgeSnapshot.Meaningful).ToHashSet(StringComparer.Ordinal);
        var asked = KnowledgeSnapshot.Meaningful(question).Where(term => !known.Contains(term)).ToList();
        if (asked.Count == 0) return false;
        return snapshot.Mentions(string.Join(' ', asked)) || (question.Contains('?') && asked.Any(term => term.Length >= 4 && !term.All(char.IsDigit)));
    }

    /// <summary>Added to every result when the model may offer the team.</summary>
    public const string TeamReminder = "\n\n(If this does not answer the visitor's question, say so in one short sentence, offer the team and end your reply with " + PromptBuilder.TeamMarker + ".)";

    /// <summary>A place the widget shows the visitor: Url and Title are empty for the page the visitor is on.</summary>
    public sealed record Place(string Url, string Title, string Text, string Label);

    /// <summary>The lookups of one answer, in order. Repeating the same calls on the same content gives the same results.</summary>
    /// <param name="outcome">Set when an earlier answer is repeated: what became of the place it showed (the browser reports it).</param>
    public sealed class Answer(KnowledgeSnapshot snapshot, bool team, string? culture = null, GuideSettings? guide = null, string? page = null, string? outcome = null)
    {
        private int used, rounds, places;
        private bool complete;
        private readonly List<Place> shown = [];

        /// <summary>The last round only showed a place after the answer was written: nothing more is needed from the model.</summary>
        public bool Complete => complete;

        /// <summary>The places this answer shows that the browser has not been told about yet (at most one per answer).</summary>
        public List<Place> TakePlaces() { var taken = shown.ToList(); shown.Clear(); return taken; }

        /// <param name="answered">The model already wrote an answer before these calls. When they only show a place, the answer is complete:
        /// told to finish it, a smaller model wrote the same answer a second time.</param>
        public List<string> Round(IReadOnlyList<ChatLookup> calls, bool answered = false)
        {
            rounds++;
            complete = answered && calls.Count > 0 && calls.All(c => c.Name == Show);
            return calls.Select((call, i) => Run(call, i)).ToList();
        }

        private string Run(ChatLookup call, int index)
        {
            if (rounds > MaxRounds || used >= Characters) return "No more lookups are possible for this question. Answer with what you found, or say that you could not find it.";
            if (index >= MaxCalls) return $"Too many lookups at once; use at most {MaxCalls}.";
            if (call.Name == Show && guide is { Enabled: true }) return Guide(call.Arguments);
            var text = call.Name switch
            {
                Search => Remember("s" + culture + "\u0001" + Text(call.Arguments, "query"), () => SearchText(Text(call.Arguments, "query"))),
                Read => Remember("r" + culture + "\u0001" + string.Join("\u0001", List(call.Arguments, "pages")), () => ReadText(List(call.Arguments, "pages"))),
                _ => $"There is no tool called {call.Name}. Use {Search} or {Read}.",
            };
            var room = Characters - used;
            if (text.Length > room) text = text[..room].TrimEnd() + "\n[shortened]";
            used += text.Length;
            return team && call.Name is Search or Read ? text + TeamReminder : text;
        }

        /// <summary>The same lookup on the same snapshot gives the same text: kept, so repeating a conversation's lookups costs nothing.</summary>
        private string Remember(string key, Func<string> lookup)
        {
            if (snapshot.Results.TryGetValue(key, out var known)) return known;
            if (snapshot.Results.Count > 5000) snapshot.Results.Clear();
            return snapshot.Results[key] = lookup();
        }

        private static string Text(JsonElement arguments, string name) =>
            arguments.ValueKind == JsonValueKind.Object && arguments.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? Clip(value.GetString()!, 200) : "";

        private static List<string> List(JsonElement arguments, string name)
        {
            if (arguments.ValueKind != JsonValueKind.Object || !arguments.TryGetProperty(name, out var value)) return [];
            if (value.ValueKind == JsonValueKind.String) return [Clip(value.GetString()!, 300)];
            return value.ValueKind == JsonValueKind.Array ? value.EnumerateArray().Where(v => v.ValueKind == JsonValueKind.String).Select(v => Clip(v.GetString()!, 300)).Where(v => v.Length > 0).Take(3).ToList() : [];
        }

        private static string Clip(string value, int max) { value = value.Trim(); return value.Length > max ? value[..max] : value; }

        // On a multilingual website the language goes with the url, so the model links to the version in the visitor's language.
        private string Heading(KnowledgeDocument d) => d.Url == "" ? $"## {d.Title} (document)" : snapshot.Cultures.Count > 1 && d.Culture != "" ? $"## {d.Title} ({d.Url}, {d.Culture})" : $"## {d.Title} ({d.Url})";

        private string SearchText(string query)
        {
            if (query == "") return "Give a few key words to search for.";
            var hits = snapshot.Search(query, 12, culture);
            if (hits.Count == 0) return $"Nothing found for \"{query}\". Try fewer or other words, words in the language of the website, or read a page from the list of pages.";
            // Up to two passages per page, pages in the order of their best passage, passages in the order of the page.
            var text = new StringBuilder($"Results for \"{query}\":\n");
            foreach (var group in hits.GroupBy(h => h.Document).Take(5))
            {
                var part = Heading(group.Key) + "\n" + string.Join("\n…\n", group.Take(2).OrderBy(h => h.Order).Select(h => h.Text)) + "\n\n";
                if (text.Length + part.Length > SearchCharacters && text.Length > 40) break;
                text.Append(part);
            }
            return text.ToString().TrimEnd();
        }

        private string ReadText(List<string> pages)
        {
            if (pages.Count == 0) return "Give the urls or titles of the pages to read.";
            var text = new StringBuilder();
            var seen = new HashSet<KnowledgeDocument>();
            foreach (var reference in pages)
            {
                var document = snapshot.Find(reference);
                if (document == null) { text.Append($"Not found: {reference}. Use urls from the list of pages, or {Search}.\n\n"); continue; }
                if (!seen.Add(document)) continue;
                var body = document.Text.Length > PageCharacters ? document.Text[..PageCharacters].TrimEnd() + "\n[the rest of this page is longer; search for details]" : document.Text;
                text.Append(Heading(document)).Append('\n').Append(body.Length > 0 ? body : "(This page has no text.)").Append("\n\n");
            }
            return text.ToString().TrimEnd();
        }

        /// <summary>
        /// Checks a place the model wants to show and tells it what happens. Another page must be a page of the list (never a url
        /// from a page's text) and contain the words, so visitors are not taken to a page where nothing can be highlighted. On the
        /// page the visitor is on the words may also be in the header or footer, which are not looked up: the browser checks them.
        /// </summary>
        private string Guide(JsonElement arguments)
        {
            var words = Words.Clean(Text(arguments, "text"), 200);
            var label = Words.Clean(Text(arguments, "label"), 60);
            var target = Text(arguments, "page");
            if (words.Length == 0) return "Give text: the words on the page to point at, exactly as they appear there.";
            if (label.Length == 0) label = words.Length > 40 ? words[..40].TrimEnd() + "…" : words;
            KnowledgeDocument? document = null;
            var here = target.Length == 0 || (page != null && Words.SamePath(target, page));
            if (!here)
            {
                document = snapshot.Find(target);
                if (document == null || document.Url == "") return $"Not found: {target}. Use a page url from the list of pages, or leave page out for the page the visitor is on.";
                here = page != null && Words.SamePath(document.Url, page);
            }
            if (!here && !guide!.Pages) return $"Only things on the page the visitor is on can be shown{(page != null ? $" ({page})" : "")}. Link to other pages instead.";
            if (!here && !Words.Contains(document!.Text, words)) return $"“{words}” is not on {document.Title} ({document.Url}). Copy a short piece exactly as it appears in your lookup results (read the page first if needed) and try again.";
            if (places++ > 0) return "Only one place can be shown per answer.";
            var where = here ? "the page the visitor is on" : $"{document!.Title} ({document.Url})";
            if (outcome != null) return outcome switch
            {
                "shown" => $"Shown: the visitor saw “{label}” highlighted on {where}.",
                "declined" => $"The visitor chose not to be shown “{label}”.",
                "missing" => $"The website could not find “{words}” on {where}; nothing was highlighted.",
                _ => $"Offered to show “{label}” on {where}; the visitor has not chosen yet.",
            };
            shown.Add(new Place(here ? "" : document!.Url, here ? "" : document!.Title, words, label));
            return (guide!.Ask == "never"
                ? $"Done: right after your answer the website shows the visitor “{label}” on {where} and highlights it."
                : $"Offered: under your answer the visitor gets a button to be shown “{label}” on {where}. Nothing has moved or been highlighted yet.")
                + (complete
                    ? " Your answer above is complete: do not write anything more."
                    : " Finish your answer briefly, saying where it is, without repeating what you already wrote. Do not ask whether to show it and do not mention buttons or tools.");
        }
    }
}

/// <summary>Words to show on a page, compared as the widget finds them: without case, accents and spaces; numbers by their digits.</summary>
public static class Words
{
    /// <summary>Lower case, without accents, spaces and invisible characters; typographic quotes and dashes as plain ones.</summary>
    public static string Squeeze(string text)
    {
        var folded = KnowledgeSnapshot.Fold(text);
        var squeezed = new StringBuilder(folded.Length);
        foreach (var c in folded)
        {
            if (char.IsWhiteSpace(c) || c is '​' or '‌' or '‍' or '­' or '⁠' or '﻿') continue;
            squeezed.Append(c switch { '’' or '‘' or '‚' or '′' => '\'', '“' or '”' or '„' or '«' or '»' or '″' => '"', '–' or '—' or '‐' or '‑' or '−' => '-', _ => c });
        }
        return squeezed.ToString();
    }

    public static string Digits(string text) => new([.. text.Where(char.IsAsciiDigit)]);

    /// <summary>
    /// The words occur in the text. A number with at least six digits also matches in another format (+41 44 … for 044 …): its
    /// digits, or its last nine digits when the country code or trunk zero differ.
    /// </summary>
    public static bool Contains(string text, string words)
    {
        var needle = Squeeze(words);
        if (needle.Length == 0) return false;
        if (Squeeze(text).Contains(needle, StringComparison.Ordinal)) return true;
        var digits = Digits(words);
        if (digits.Length < 6 || digits.Length * 2 < needle.Length) return false;
        var all = Digits(text);
        return all.Contains(digits, StringComparison.Ordinal) || (digits.Length > 9 && all.Contains(digits[^9..], StringComparison.Ordinal));
    }

    /// <summary>Two paths of the same page: without domain, query, case and trailing slash.</summary>
    public static bool SamePath(string a, string b)
    {
        static string Bare(string url)
        {
            var path = Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" ? uri.AbsolutePath : url.Split('?', '#')[0];
            return Uri.UnescapeDataString(path).Trim().TrimEnd('/').ToLowerInvariant();
        }
        return Bare(a) == Bare(b);
    }

    public static string Clean(string value, int max)
    {
        var text = new string([.. value.Where(c => !char.IsControl(c))]).Trim();
        return text.Length > max ? text[..max].TrimEnd() : text;
    }
}

/// <summary>
/// Keeps the snapshot of what the assistant can look up. It is rebuilt when pages are published or unpublished (on any server)
/// and when knowledge items or the left-out pages change; pages that did not change keep their text. What the page reader found
/// on a page as visitors get it (forms and other parts, see <see cref="PageParts"/>) is added to its text. Snapshots for settings an
/// editor has not saved yet (the budget meter, the test chat) are kept apart, so visitors never lose theirs to a preview.
/// </summary>
public sealed class KnowledgeIndex(ContentKnowledge content, AssistantStore store, ILogger<KnowledgeIndex> logger)
{
    private sealed record Cache(string Key, KnowledgeSnapshot Snapshot, IReadOnlyDictionary<string, LivePage> Pages);
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static volatile Cache? cache, preview;
    private static int contentVersion;

    /// <summary>The latest snapshot, if one was built (for estimates that must not wait).</summary>
    public static KnowledgeSnapshot? Latest => cache?.Snapshot;

    /// <summary>The pages of the latest snapshot for the saved settings (the page reader reads these), or null before the first one.</summary>
    public static IReadOnlyList<LivePage>? LatestPages => cache?.Pages.Values.ToList();

    /// <summary>Counts publications: the page reader reads changed pages again when it moves.</summary>
    public static int ContentVersion => Volatile.Read(ref contentVersion);

    public static void ContentChanged() => Interlocked.Increment(ref contentVersion);

    public async Task<KnowledgeSnapshot> SnapshotAsync(KnowledgeSettings settings, CancellationToken token = default)
    {
        var json = JsonSerializer.Serialize(settings, AssistantJson.Options);
        string Key() => string.Join('|', Volatile.Read(ref contentVersion), AssistantStore.KnowledgeVersion, PageParts.Version, json);
        var saved = json == JsonSerializer.Serialize(store.Settings().Settings.Knowledge, AssistantJson.Options);
        if ((saved ? cache : preview) is { } hit && hit.Key == Key()) return hit.Snapshot;
        await Gate.WaitAsync(token);
        try
        {
            // Read the versions now: a change while waiting is part of what this build reads.
            var key = Key();
            if ((saved ? cache : preview) is { } again && again.Key == key) return again.Snapshot;
            var pages = await content.LivePagesAsync(settings.Includes, (saved ? cache : preview ?? cache)?.Pages ?? new Dictionary<string, LivePage>());
            var items = store.KnowledgeRows().Where(k => k.Enabled && !k.Pinned && k.Kind != "page");
            var snapshot = new KnowledgeSnapshot([.. pages.Select(Page), .. items.Select(i => new KnowledgeDocument(i.Kind, i.Title, "", 0, i.Text))])
            {
                Truncated = content.Truncated,
            };
            if (content.Truncated && saved && cache?.Snapshot.Truncated != true)
                logger.LogWarning("Ligata AI reads only the first {Max} pages of this website (and {Nodes} content nodes); the assistant cannot look up the rest. Leave out sections it does not need under Knowledge.", ContentKnowledge.MaxPages, ContentKnowledge.MaxNodes);
            var built = new Cache(key, snapshot, pages.ToDictionary(p => p.Id));
            if (saved) cache = built; else preview = built;
            return snapshot;
        }
        finally { Gate.Release(); }
    }

    private static KnowledgeDocument Page(LivePage page)
    {
        var read = PageParts.For(page.Id);
        var text = read is { Text.Length: > 0 } ? (page.Text + "\n\n" + read.Text).Trim() : page.Text;
        return new KnowledgeDocument("page", page.Name, page.Url, page.Level, text, page.Culture, page.Key.ToString("N"), read?.Names ?? "");
    }
}

/// <summary>Published, unpublished, moved or deleted pages (on any server of a load-balanced site) mark the snapshot as outdated.</summary>
public sealed class KnowledgeIndexRefresher : INotificationHandler<ContentCacheRefresherNotification>
{
    public void Handle(ContentCacheRefresherNotification notification) => KnowledgeIndex.ContentChanged();
}
