using NPoco;
using Umbraco.Cms.Infrastructure.Persistence.DatabaseAnnotations;

namespace Ligata.AI.Data;

[TableName("LigataAISettings"), PrimaryKey("Id", AutoIncrement = false), ExplicitColumns]
public sealed class SettingsRow
{
    [Column("Id"), PrimaryKeyColumn(AutoIncrement = false)] public int Id { get; set; } = 1;
    [Column("Version")] public int Version { get; set; }
    [Column("Json"), SpecialDbType(SpecialDbTypes.NVARCHARMAX)] public string Json { get; set; } = "";
    // API key protected with ASP.NET Data Protection; never returned to the browser.
    [Column("ProtectedKey"), Length(2000), NullSetting(NullSetting = NullSettings.Null)] public string? ProtectedKey { get; set; }
    [Column("KeyHint"), Length(40), NullSetting(NullSetting = NullSettings.Null)] public string? KeyHint { get; set; }
    // Random secret used to pseudonymise visitor IPs before they leave this server.
    [Column("VisitorSecret"), Length(100)] public string VisitorSecret { get; set; } = "";
    [Column("UpdatedUtc")] public DateTime UpdatedUtc { get; set; }
}

[TableName("LigataAIKnowledge"), PrimaryKey("Id", AutoIncrement = false), ExplicitColumns]
public sealed class KnowledgeRow
{
    [Column("Id"), PrimaryKeyColumn(AutoIncrement = false)] public Guid Id { get; set; }
    [Column("Title"), Length(200)] public string Title { get; set; } = "";
    /// <summary>text | file | page</summary>
    [Column("Kind"), Length(20)] public string Kind { get; set; } = "text";
    [Column("Source"), Length(300)] public string Source { get; set; } = "";
    [Column("ContentKey"), NullSetting(NullSetting = NullSettings.Null), Index(IndexTypes.NonClustered)] public Guid? ContentKey { get; set; }
    [Column("Text"), SpecialDbType(SpecialDbTypes.NVARCHARMAX)] public string Text { get; set; } = "";
    [Column("Characters")] public int Characters { get; set; }
    [Column("Tokens")] public int Tokens { get; set; }
    [Column("Estimated")] public bool Estimated { get; set; }
    [Column("Enabled")] public bool Enabled { get; set; } = true;
    [Column("SortOrder")] public int SortOrder { get; set; }
    [Column("UpdatedUtc")] public DateTime UpdatedUtc { get; set; }
    // Added in ai-v4: read with every question instead of being looked up when needed (counts against the knowledge budget).
    [Column("Pinned"), Constraint(Default = 0)] public bool Pinned { get; set; }
}

[TableName("LigataAIStat"), PrimaryKey("Day", AutoIncrement = false), ExplicitColumns]
public sealed class StatRow
{
    [Column("Day"), PrimaryKeyColumn(AutoIncrement = false), Length(10)] public string Day { get; set; } = "";
    [Column("Conversations")] public int Conversations { get; set; }
    [Column("Questions")] public int Questions { get; set; }
    [Column("Answered")] public int Answered { get; set; }
    [Column("Failed")] public int Failed { get; set; }
    [Column("Busy")] public int Busy { get; set; }
    [Column("Offline")] public int Offline { get; set; }
    [Column("Attachments")] public int Attachments { get; set; }
    [Column("PromptTokens")] public long PromptTokens { get; set; }
    [Column("CompletionTokens")] public long CompletionTokens { get; set; }
    [Column("AnswerMs")] public long AnswerMs { get; set; }
    // Added in ai-v2.
    [Column("ChatRequests"), Constraint(Default = 0)] public int ChatRequests { get; set; }
    [Column("EmailRequests"), Constraint(Default = 0)] public int EmailRequests { get; set; }
    [Column("Suggested"), Constraint(Default = 0)] public int Suggested { get; set; }
    [Column("AgentReplies"), Constraint(Default = 0)] public int AgentReplies { get; set; }
    [Column("Responses"), Constraint(Default = 0)] public int Responses { get; set; }
    [Column("FirstResponseMs"), Constraint(Default = 0)] public long FirstResponseMs { get; set; }
}

/// <summary>A visitor's request to the team: a live chat or an email message. Deleted after the retention period.</summary>
[TableName("LigataAIConversation"), PrimaryKey("Id", AutoIncrement = false), ExplicitColumns]
public sealed class ConversationRow
{
    [Column("Id"), PrimaryKeyColumn(AutoIncrement = false)] public Guid Id { get; set; }
    // SHA-256 of the visitor's random access token; the token itself is never stored.
    [Column("TokenHash"), Length(64)] public string TokenHash { get; set; } = "";
    /// <summary>chat | email</summary>
    [Column("Kind"), Length(10)] public string Kind { get; set; } = "chat";
    /// <summary>open (nobody from the team present) | active (a team member joined) | closed</summary>
    [Column("State"), Length(10), Index(IndexTypes.NonClustered)] public string State { get; set; } = "open";
    [Column("Name"), Length(100), NullSetting(NullSetting = NullSettings.Null)] public string? Name { get; set; }
    [Column("Email"), Length(200), NullSetting(NullSetting = NullSettings.Null)] public string? Email { get; set; }
    [Column("Topic"), Length(200)] public string Topic { get; set; } = "";
    [Column("PagePath"), Length(300)] public string PagePath { get; set; } = "";
    [Column("PageTitle"), Length(150)] public string PageTitle { get; set; } = "";
    [Column("Language"), Length(10)] public string Language { get; set; } = "";
    // HMAC of the visitor IP with the site secret: used only for per-visitor limits.
    [Column("Visitor"), Length(32), Index(IndexTypes.NonClustered)] public string Visitor { get; set; } = "";
    /// <summary>Comma-separated Umbraco user keys of team members currently in the conversation.</summary>
    [Column("Agents"), Length(1000)] public string Agents { get; set; } = "";
    [Column("LastSeq")] public int LastSeq { get; set; }
    [Column("LastVisitorSeq")] public int LastVisitorSeq { get; set; }
    [Column("LastAgentSeq")] public int LastAgentSeq { get; set; }
    [Column("TeamReadSeq")] public int TeamReadSeq { get; set; }
    [Column("CreatedUtc")] public DateTime CreatedUtc { get; set; }
    [Column("UpdatedUtc"), Index(IndexTypes.NonClustered)] public DateTime UpdatedUtc { get; set; }
    [Column("FirstResponseUtc"), NullSetting(NullSetting = NullSettings.Null)] public DateTime? FirstResponseUtc { get; set; }
    [Column("ClosedUtc"), NullSetting(NullSetting = NullSettings.Null)] public DateTime? ClosedUtc { get; set; }
    /// <summary>team | visitor | inactive</summary>
    [Column("ClosedReason"), Length(20), NullSetting(NullSetting = NullSettings.Null)] public string? ClosedReason { get; set; }
    // Throttles "visitor wrote" emails to the team.
    [Column("NotifiedUtc"), NullSetting(NullSetting = NullSettings.Null)] public DateTime? NotifiedUtc { get; set; }

    [Ignore] public IReadOnlyList<Guid> AgentKeys => Agents.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(Guid.Parse).ToList();
    [Ignore] public bool NeedsReply => State != "closed" && LastVisitorSeq > LastAgentSeq;
}

[TableName("LigataAIMessage"), PrimaryKey("Id", AutoIncrement = true), ExplicitColumns]
public sealed class MessageRow
{
    [Column("Id"), PrimaryKeyColumn(AutoIncrement = true)] public int Id { get; set; }
    [Column("ConversationId"), Index(IndexTypes.NonClustered)] public Guid ConversationId { get; set; }
    [Column("Seq")] public int Seq { get; set; }
    /// <summary>visitor | agent | ai | system</summary>
    [Column("Author"), Length(10)] public string Author { get; set; } = "visitor";
    [Column("AgentKey"), NullSetting(NullSetting = NullSettings.Null)] public Guid? AgentKey { get; set; }
    /// <summary>message | note (team only) | history (the AI chat before the request) | join | leave | close | reopen | request | email</summary>
    [Column("Kind"), Length(12)] public string Kind { get; set; } = "message";
    [Column("Text"), SpecialDbType(SpecialDbTypes.NVARCHARMAX)] public string Text { get; set; } = "";
    // The browser's id for a message, so a retried send is stored once.
    [Column("ClientId"), Length(40), NullSetting(NullSetting = NullSettings.Null)] public string? ClientId { get; set; }
    [Column("CreatedUtc")] public DateTime CreatedUtc { get; set; }
}

/// <summary>How a team member appears to visitors.</summary>
[TableName("LigataAIAgent"), PrimaryKey("UserKey", AutoIncrement = false), ExplicitColumns]
public sealed class AgentRow
{
    [Column("UserKey"), PrimaryKeyColumn(AutoIncrement = false)] public Guid UserKey { get; set; }
    // Public identifier used in visitor-facing URLs instead of the Umbraco user key.
    [Column("PublicId"), Index(IndexTypes.UniqueNonClustered)] public Guid PublicId { get; set; }
    /// <summary>default (site setting) | full | name | alias | anonymous</summary>
    [Column("Display"), Length(12)] public string Display { get; set; } = "default";
    [Column("Alias"), Length(60)] public string Alias { get; set; } = "";
    [Column("Away")] public bool Away { get; set; }
    [Column("UpdatedUtc")] public DateTime UpdatedUtc { get; set; }
}

/// <summary>Outgoing email queue. Sent mail is purged after a week.</summary>
[TableName("LigataAIEmail"), PrimaryKey("Id", AutoIncrement = true), ExplicitColumns]
public sealed class EmailRow
{
    [Column("Id"), PrimaryKeyColumn(AutoIncrement = true)] public int Id { get; set; }
    /// <summary>team-chat | team-message | team-email | visitor-confirmation | reply | test</summary>
    [Column("Kind"), Length(24)] public string Kind { get; set; } = "";
    [Column("ToAddress"), Length(2200)] public string ToAddress { get; set; } = "";
    [Column("ReplyTo"), Length(200), NullSetting(NullSetting = NullSettings.Null)] public string? ReplyTo { get; set; }
    [Column("Subject"), Length(250)] public string Subject { get; set; } = "";
    [Column("Body"), SpecialDbType(SpecialDbTypes.NVARCHARMAX)] public string Body { get; set; } = "";
    [Column("ConversationId"), NullSetting(NullSetting = NullSettings.Null)] public Guid? ConversationId { get; set; }
    /// <summary>pending | sending | sent | failed</summary>
    [Column("State"), Length(10), Index(IndexTypes.NonClustered)] public string State { get; set; } = "pending";
    [Column("Attempts")] public int Attempts { get; set; }
    [Column("NextAttemptUtc")] public DateTime NextAttemptUtc { get; set; }
    [Column("LastError"), Length(300), NullSetting(NullSetting = NullSettings.Null)] public string? LastError { get; set; }
    [Column("CreatedUtc")] public DateTime CreatedUtc { get; set; }
    [Column("SentUtc"), NullSetting(NullSetting = NullSettings.Null)] public DateTime? SentUtc { get; set; }
}

/// <summary>
/// Proof that a visitor agreed before the AI received their messages. Holds no IP address and no content:
/// the random id lives only in that visitor's browser. Deleted after LigataAI:Privacy:KeepConsentRecordsDays.
/// </summary>
[TableName("LigataAIConsent"), PrimaryKey("Id", AutoIncrement = false), ExplicitColumns]
public sealed class ConsentRow
{
    [Column("Id"), PrimaryKeyColumn(AutoIncrement = false)] public Guid Id { get; set; }
    /// <summary>The consent text version the visitor saw (engine, revision and recipient).</summary>
    [Column("Version"), Length(40)] public string Version { get; set; } = "";
    /// <summary>gpu | api</summary>
    [Column("Engine"), Length(10)] public string Engine { get; set; } = "";
    /// <summary>chat (the button in the chat) | cookiebot (the configured Cookiebot category)</summary>
    [Column("Source"), Length(12)] public string Source { get; set; } = "chat";
    [Column("Language"), Length(10)] public string Language { get; set; } = "";
    [Column("CreatedUtc"), Index(IndexTypes.NonClustered)] public DateTime CreatedUtc { get; set; }
    [Column("ExpiresUtc")] public DateTime ExpiresUtc { get; set; }
    /// <summary>First question or file sent with this consent; unused records are deleted after a day.</summary>
    [Column("UsedUtc"), NullSetting(NullSetting = NullSettings.Null)] public DateTime? UsedUtc { get; set; }
    [Column("WithdrawnUtc"), NullSetting(NullSetting = NullSettings.Null)] public DateTime? WithdrawnUtc { get; set; }
}
