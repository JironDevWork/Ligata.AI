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
}
