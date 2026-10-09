<!-- if docs -->
# Datenschutzerklärung: Bausteine für den Website-Chat (Ligata AI)

> **Für Website-Betreiber, bitte vor dem Kopieren lesen.**
>
> - Diese Bausteine ergänzen Ihre bestehende Datenschutzerklärung um den Chat. Sie sind ein Muster und **keine Rechtsberatung**. Lassen Sie den Text vor der Veröffentlichung von Ihrer Datenschutzberatung prüfen.
> - **Einfacher geht es im Backoffice:** Unter *AI Assistant → Datenschutz* erzeugt das Paket diesen Text passend zu Ihrer Konfiguration (eigener KI-Server oder Claude API, Live-Chat, E-Mail-Formular, reCAPTCHA, Fristen). Abschnitte, die nicht zutreffen, fallen dort weg, und Werte in doppelten geschweiften Klammern werden eingesetzt.
> - Hier im Repository sehen Sie alle Varianten. HTML-Kommentare im Quelltext (zum Beispiel „if api“ bis „endif“) markieren, wofür ein Abschnitt gilt: `gpu` = eigener KI-Server, `api` = Claude API, `chat` = Live-Chat mit dem Team, `email` = E-Mail-Formular, `captcha` = Google reCAPTCHA, `consent` = Einwilligung vor der ersten Frage (Standard), `cookiebot` = Einwilligung über Cookiebot, `history` = die Website bewahrt Gespräche mit der KI für ihr Team auf, mitgeteilt im Chat vor der ersten Frage, mit Widerspruchsrecht (standardmässig aus), `historyending` = die Aufbewahrung wurde ausgeschaltet, frühere Gespräche sind aber noch nicht gelöscht.
> - Angaben in [eckigen Klammern] ergänzen Sie selbst.
> - Der Text ist so formuliert, dass er in Deutschland, Österreich und der Schweiz passt. Für Schweizer Websites, die nur dem DSG unterliegen, können Sie die DSGVO-Artikel durch einen Hinweis auf das DSG ersetzen; die nach Art. 19 DSG nötigen Angaben (Zweck, Empfänger, Empfängerstaaten und Garantien nach Art. 16 DSG) sind enthalten; Ihre Identität und Kontaktangaben ergänzen Sie.
> - Die Angaben zu Anthropic beruhen auf deren öffentlichen Bedingungen (Stand Oktober 2026: Löschung von API-Daten innerhalb von 30 Tagen, Data Processing Addendum mit EU-Standardvertragsklauseln, kein Training mit API-Daten). Prüfen Sie den aktuellen Stand unter anthropic.com/legal und privacy.claude.com, und halten Sie fest, mit welcher Anthropic-Gesellschaft Ihr Vertrag besteht.

---
<!-- endif -->
## Chat auf dieser Website

Auf unserer Website können Sie uns über ein Chatfenster erreichen. Der Chat wird von unserem eigenen Website-Server bereitgestellt (Software: Ligata AI) und setzt keine Cookies<!-- if captcha --> (zu Google reCAPTCHA siehe unten)<!-- endif -->. Welche Daten wir verarbeiten, hängt davon ab, wie Sie den Chat nutzen.

<!-- if ai -->
### KI-Assistent

Der Assistent im Chat ist ein KI-System. Seine Antworten werden automatisch erzeugt und können fehlerhaft oder unvollständig sein; bitte prüfen Sie wichtige Angaben nach. Bitte geben Sie im Chat keine sensiblen Daten ein, zum Beispiel Gesundheitsdaten, Passwörter oder Bank- und Kreditkartendaten.

**Verarbeitete Daten**

- Ihre Nachrichten an den Assistenten und der bisherige Verlauf des Gesprächs (er wird mit jeder Frage erneut übermittelt, damit der Assistent den Zusammenhang kennt)
<!-- if images -->
- Bilder, zum Beispiel Screenshots, die Sie an eine Nachricht anhängen
<!-- endif -->
<!-- if pdfs -->
- PDF-Dateien, die Sie anhängen; verarbeitet wird der daraus gelesene Text, die Datei selbst speichern wir nicht
<!-- endif -->
<!-- if pagecontext -->
- Titel und Pfad der Seite, auf der Sie den Chat nutzen, sowie das aktuelle Datum
<!-- endif -->
- Ihre IP-Adresse, die für die Verbindung zu unserem Server technisch nötig ist. Wir speichern sie nicht. Für Begrenzungen gegen Missbrauch (zum Beispiel die Anzahl Fragen pro Zeitraum) berechnen wir daraus mit einem geheimen Schlüssel eine pseudonyme Kennung, die wir nur im Arbeitsspeicher halten.

**Zweck und Rechtsgrundlage**

<!-- if consent -->
Wir verarbeiten diese Daten, um Ihre Fragen zu beantworten. Rechtsgrundlage ist Ihre Einwilligung (Art. 6 Abs. 1 lit. a DSGVO), um die wir Sie im Chat bitten, bevor Sie die erste Frage stellen<!-- if cookiebot --> (über die Kategorie „{{cookiebotCategory}}“ in unseren Cookie-Einstellungen)<!-- endif -->. Ohne Ihre Einwilligung übermitteln wir keine Daten an den KI-Dienst.<!-- if team --> Sie können uns auch ohne den KI-Assistenten erreichen, wie unten beschrieben.<!-- endif -->

Sie können Ihre Einwilligung jederzeit mit Wirkung für die Zukunft widerrufen: im Chat über „Gespräche“ und dann „Einwilligung widerrufen“<!-- if cookiebot --> oder in den Cookie-Einstellungen<!-- endif -->. Verarbeitungen bis zum Widerruf bleiben davon unberührt.

Die Begrenzungen gegen Missbrauch beruhen auf unserem berechtigten Interesse an einem sicheren und wirtschaftlichen Betrieb des Chats (Art. 6 Abs. 1 lit. f DSGVO).
<!-- endif -->
<!-- if noconsent -->
Wir verarbeiten diese Daten, um Ihre Fragen zu beantworten. Rechtsgrundlage ist [bitte ergänzen, zum Beispiel unser berechtigtes Interesse an der Beantwortung von Anfragen, Art. 6 Abs. 1 lit. f DSGVO, oder Art. 6 Abs. 1 lit. b DSGVO bei vertragsbezogenen Fragen].
<!-- endif -->

<!-- if gpu -->
**Empfänger: KI-Server von {{gpuOperator}}**

Die Antworten erzeugt ein KI-Modell, das auf einem eigenen Server von {{gpuOperator}} in {{gpuCountry}} läuft. {{gpuOperator}} betreibt diesen Server in unserem Auftrag und ist an unsere Weisungen gebunden (Auftragsverarbeitung nach Art. 28 DSGVO). Unser Website-Server übermittelt die oben genannten Daten und die pseudonyme Kennung an diesen Server; Ihre IP-Adresse wird nicht weitergegeben. Dort werden die Daten nur verarbeitet, um die Antwort zu erzeugen: Sie werden nicht auf Datenträgern gespeichert, Inhalte werden nicht protokolliert, nicht an Dritte weitergegeben und nicht zum Training von KI-Modellen verwendet. Damit Folgefragen schneller beantwortet werden, bleibt der Gesprächszusammenhang vorübergehend im Arbeitsspeicher der Grafikkarte, bis spätere Anfragen ihn überschreiben.
<!-- if gpuabroad -->

[Der Server steht nicht in der EU, im EWR oder in der Schweiz. Ergänzen Sie hier, worauf sich die Übermittlung stützt, zum Beispiel einen Angemessenheitsbeschluss oder Standardvertragsklauseln (Art. 46 DSGVO bzw. Art. 16 DSG).]
<!-- endif -->
<!-- endif -->

<!-- if api -->
**Empfänger: Anthropic (USA)**

Die Antworten erzeugt das KI-Modell {{model}} der Anthropic, PBC, San Francisco, USA („Anthropic“). Unser Website-Server übermittelt die oben genannten Daten direkt an Anthropic; Ihr Browser stellt dabei keine Verbindung zu Anthropic her. Ihre IP-Adresse geben wir nicht weiter, wohl aber die pseudonyme Kennung, damit Anthropic Missbrauch erkennen kann.

Anthropic verarbeitet die Daten in unserem Auftrag (Auftragsverarbeitung nach Art. 28 DSGVO auf Grundlage des Data Processing Addendum von Anthropic) und verwendet sie nach seinen kommerziellen Bedingungen nicht zum Training von KI-Modellen. Nach eigenen Angaben löscht Anthropic Ein- und Ausgaben innerhalb von 30 Tagen. Inhalte, die Anthropic als Verletzung seiner Nutzungsrichtlinien einstuft, kann Anthropic bis zu 2 Jahre aufbewahren.

Die Daten werden in den USA verarbeitet. Die Übermittlung stützt sich auf die Standardvertragsklauseln der EU-Kommission (Art. 46 Abs. 2 lit. c DSGVO), für Übermittlungen aus der Schweiz in der vom EDÖB anerkannten, an das Schweizer Recht angepassten Fassung (Art. 16 Abs. 2 lit. d DSG); sie sind Bestandteil des Data Processing Addendum von Anthropic. [Nur falls Anthropic auf dataprivacyframework.gov zertifiziert ist: Zudem ist Anthropic unter dem EU-U.S. und dem Swiss-U.S. Data Privacy Framework zertifiziert (Art. 45 DSGVO; Art. 16 Abs. 1 DSG).] Weitere Informationen: https://www.anthropic.com/legal/privacy und https://privacy.claude.com.
<!-- endif -->

**Speicherdauer**

<!-- if nohistory -->
Gespräche mit dem KI-Assistenten speichern wir nicht auf unserem Server. Für Statistiken zählen wir lediglich anonym pro Tag, zum Beispiel die Anzahl Fragen und die Antwortzeit, ohne Bezug zu Personen oder Inhalten. Den Gesprächsverlauf speichert Ihr Browser (siehe „Speicherung in Ihrem Browser“).
<!-- endif -->
<!-- if historyending -->
Gespräche mit dem KI-Assistenten bewahren wir nicht mehr auf. Gespräche, die wir früher für unser Team aufbewahrt haben, löschen wir spätestens am Ende der Frist, die für sie galt; bis dahin können Sie sie im Chat mit „Gespräch löschen“ oder „Nicht mehr aufbewahren“ oder durch Widerruf Ihrer Einwilligung löschen. Für Statistiken zählen wir lediglich anonym pro Tag, zum Beispiel die Anzahl Fragen und die Antwortzeit, ohne Bezug zu Personen oder Inhalten.
<!-- endif -->
<!-- if history -->
Für Statistiken zählen wir lediglich anonym pro Tag, zum Beispiel die Anzahl Fragen und die Antwortzeit, ohne Bezug zu Personen oder Inhalten. Den Gesprächsverlauf speichert Ihr Browser (siehe „Speicherung in Ihrem Browser“). Zusätzlich bewahren wir Gespräche für unser Team auf unserem Server auf, wie im Folgenden beschrieben.

**Aufbewahrung von Gesprächen**

<!-- if consent -->
Wie wir Ihnen im Chat vor Ihrer ersten Frage mitteilen, bewahren wir Ihre Gespräche mit dem Assistenten auf unserem Website-Server auf,
<!-- endif -->
<!-- if noconsent -->
Wie wir Ihnen im Chat mitteilen, bewahren wir Ihre Gespräche mit dem Assistenten auf unserem Website-Server auf,
<!-- endif -->
damit unser Team die Antworten des Assistenten und die Informationen auf unserer Website prüfen und verbessern kann, und zwar {{historyDays}} Tage nach der letzten Nachricht. Gespeichert werden Ihre Fragen und die Antworten des Assistenten (sie können Inhalte angehängter Dateien wiedergeben), die Namen angehängter Dateien (nicht die Dateien selbst), Titel und Pfad der Seite, auf der Sie gefragt haben, die Sprache des Chats, die Zeitpunkte, ob eine Antwort fehlschlug, welche Seiten der Assistent nachgeschlagen und mit welchen Suchbegriffen er gesucht hat sowie gegebenenfalls die Verknüpfung mit einer Anfrage an unser Team, die Sie aus dem Gespräch gestellt haben. Ihre IP-Adresse oder eine daraus abgeleitete Kennung speichern wir dazu nicht. Lesen können die Gespräche nur berechtigte Mitglieder unseres Teams in unserem Verwaltungsbereich.

Rechtsgrundlage ist unser berechtigtes Interesse an der Prüfung und Verbesserung der Antworten des Assistenten und der Informationen auf unserer Website (Art. 6 Abs. 1 lit. f DSGVO). Wir bewahren die Gespräche ohne Ihren Namen und ohne IP-Adresse und nur für die genannte Frist auf, und lesen können sie nur berechtigte Mitglieder unseres Teams.<!-- if consent --> Ändern wir die Frist, teilen wir Ihnen das im Chat vor Ihrer nächsten Frage mit und bitten Sie erneut um Ihre Zustimmung.<!-- endif -->

**Ihr Widerspruchsrecht:** Sie können dieser Aufbewahrung jederzeit widersprechen (Art. 21 DSGVO; Art. 30 Abs. 2 lit. b DSG), einfach im Chat unter „Gespräche“ mit „Nicht mehr aufbewahren“. Wir löschen dann die bisher aufbewahrten Gespräche und bewahren keine weiteren auf; den Assistenten können Sie weiter nutzen.<!-- if consent --> Auch der Widerruf Ihrer Einwilligung in den KI-Assistenten löscht sie.<!-- endif -->

Solange ein Gespräch im Chat angezeigt wird, können Sie es dort auch einzeln mit „Gespräch löschen“ löschen; es wird dann auf Ihrem Gerät und auf unserem Server gelöscht.

Im Einzelfall, etwa zur Bearbeitung einer Beschwerde oder zur Klärung von Rechtsansprüchen, kann unser Team ein Gespräch über diese Frist hinaus aufbewahren, solange dies dafür nötig ist und höchstens ein Jahr ab diesem Entscheid. Rechtsgrundlage ist dann unser berechtigtes Interesse an der Klärung des Anliegens (Art. 6 Abs. 1 lit. f DSGVO); Sie können dem widersprechen (Art. 21 DSGVO). Löschen Sie das Gespräch im Chat, widersprechen Sie mit „Nicht mehr aufbewahren“<!-- if consent --> oder widerrufen Sie Ihre Einwilligung<!-- endif -->, löschen wir es auch dann.
<!-- endif -->
<!-- if consent -->

**Nachweis Ihrer Einwilligung**

Damit wir Ihre Einwilligung nachweisen können (Art. 7 Abs. 1 DSGVO), speichern wir auf unserem Server einen Einwilligungsnachweis: eine zufällige Kennung, den Zeitpunkt, die Version des Einwilligungstexts, die Sprache, die Quelle (Chat oder Cookie-Einstellungen) sowie die Zeitpunkte der ersten Frage und eines Widerrufs<!-- if historyany -->, die im Chat genannte Frist für die Aufbewahrung von Gesprächen sowie ob und wann Sie ihr widersprochen haben<!-- endif -->. Ihre IP-Adresse und Gesprächsinhalte gehören nicht dazu. Rechtsgrundlage ist unsere Nachweispflicht (Art. 6 Abs. 1 lit. c in Verbindung mit Art. 7 Abs. 1 DSGVO). Ihre Einwilligung gilt {{consentDays}} Tage, danach fragen wir erneut. Nachweise löschen wir nach {{keepDays}} Tagen; Einwilligungen, nach denen keine Frage gestellt wurde, nach einem Tag.
<!-- endif -->
<!-- endif -->

<!-- if chat -->
### Chat mit unserem Team

Wenn Sie über den Chat mit unserem Team schreiben, verarbeiten wir Ihren Namen und Ihre E-Mail-Adresse, sofern Sie diese angeben, Ihre Nachrichten, Titel und Pfad der Seite, die Sprache des Chats und die Zeitpunkte der Nachrichten.<!-- if ai --> Beginnen Sie das Gespräch aus dem KI-Assistenten heraus, übernehmen wir den bisherigen Verlauf mit dem Assistenten, damit unser Team den Zusammenhang kennt.<!-- endif --> Zum Schutz vor Missbrauch speichern wir zu jedem Gespräch eine pseudonyme Kennung, die wir mit einem geheimen Schlüssel aus Ihrer IP-Adresse berechnen; die IP-Adresse selbst speichern wir nicht.

Die Gespräche werden in der Datenbank unseres Website-Servers gespeichert. Sie sind für die zuständigen Mitarbeitenden in unserem Verwaltungsbereich sichtbar; über neue Anfragen und Nachrichten informieren wir unser Team per E-Mail [E-Mail-Anbieter ergänzen]. Antworten können wir Ihnen im Chat und, wenn Sie eine E-Mail-Adresse angeben, per E-Mail senden.

Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, wenn Ihre Anfrage einen Vertrag oder dessen Anbahnung betrifft, sonst unser berechtigtes Interesse an der Beantwortung von Anfragen (Art. 6 Abs. 1 lit. f DSGVO).

Gespräche ohne neue Nachricht werden nach {{inactivityDays}} Tagen beendet. Beendete Gespräche löschen wir {{retentionDays}} Tage nach dem Ende automatisch. Benachrichtigungen in unserem E-Mail-Postausgang löschen wir 7 Tage nach dem Versand. Auf Wunsch löschen wir Ihr Gespräch früher.
<!-- endif -->

<!-- if email -->
### Nachricht über das E-Mail-Formular

Wenn Sie uns über das Formular im Chat eine Nachricht senden, verarbeiten wir Ihre E-Mail-Adresse, Ihren Namen, sofern Sie ihn angeben, Ihre Nachricht, Titel und Pfad der Seite, die Sprache des Chats, den Zeitpunkt und eine pseudonyme Kennung, die wir mit einem geheimen Schlüssel aus Ihrer IP-Adresse berechnen. Wir speichern die Nachricht in der Datenbank unseres Website-Servers, leiten sie per E-Mail an unser Team weiter und antworten Ihnen per E-Mail.<!-- if confirmation --> An Ihre Adresse senden wir eine Kopie Ihrer Nachricht.<!-- endif -->

Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, wenn Ihre Anfrage einen Vertrag oder dessen Anbahnung betrifft, sonst unser berechtigtes Interesse an der Beantwortung von Anfragen (Art. 6 Abs. 1 lit. f DSGVO). Die Anfrage wird nach Erledigung, spätestens {{inactivityDays}} Tage nach der letzten Nachricht, abgeschlossen und {{retentionDays}} Tage danach automatisch gelöscht. E-Mails in den Postfächern unseres Teams bewahren wir [nach unseren Aufbewahrungsregeln, zum Beispiel bis zur Erledigung oder für die Dauer gesetzlicher Aufbewahrungspflichten] auf.
<!-- endif -->

<!-- if captcha -->
### Spamschutz mit Google reCAPTCHA

Um Missbrauch von Anfragen an unser Team zu verhindern, verwenden wir Google reCAPTCHA v3 der Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland („Google“). reCAPTCHA wird erst geladen, wenn Sie eine Anfrage an unser Team absenden und vorher eingewilligt haben<!-- if captchaexplicit --> (Häkchen im Formular)<!-- endif --><!-- if captchacookiebot --> (Kategorie „{{captchaCategory}}“ in unseren Cookie-Einstellungen)<!-- endif -->. Google erhält dabei Ihre IP-Adresse sowie Angaben zu Ihrem Gerät und Ihrer Nutzung der Seite und kann Cookies setzen. Rechtsgrundlage ist Ihre Einwilligung (Art. 6 Abs. 1 lit. a DSGVO, § 25 Abs. 1 TDDDG), die Sie jederzeit mit Wirkung für die Zukunft widerrufen können. Google kann Daten in die USA übermitteln; Google LLC ist unter dem EU-U.S. Data Privacy Framework zertifiziert. Weitere Informationen: https://policies.google.com/privacy.
<!-- endif -->

### Speicherung in Ihrem Browser

Der Chat setzt keine Cookies. Damit Ihre Gespräche beim Wechsel zwischen Seiten erhalten bleiben, speichert er Daten im lokalen Speicher Ihres Browsers (Local Storage). Diese Daten bleiben auf Ihrem Gerät; an uns übermittelt werden nur Inhalte, die Sie im Chat absenden.

- **`ligata-ai:v2:` und der Name unserer Domain:** Ihre Gespräche (Texte; von Anhängen nur die Dateinamen), Zugangsschlüssel zu Gesprächen mit unserem Team<!-- if historyany -->, ein zufälliger Schlüssel je Gespräch, das wir für unser Team aufbewahren (damit können Sie unsere Kopie löschen; er bleibt, bis das Gespräch auf unserem Server gelöscht ist)<!-- endif --> und ob das Chatfenster offen ist. Wird erst angelegt, wenn Sie den Chat nutzen; Gespräche werden nach {{storageDays}} Tagen ohne Aktivität entfernt.
<!-- if consent -->
- **`ligata-ai:consent:` und der Name unserer Domain:** Ihre Einwilligung zum KI-Assistenten (zufällige Kennung, Version, Zeitpunkt). Gespeichert für {{consentDays}} Tage oder bis zum Widerruf.
<!-- endif -->
<!-- if historyany -->
- **`ligata-ai:forget:` und der Name unserer Domain:** nur wenn Sie ein Gespräch löschen, während unser Server nicht erreichbar ist: dessen Schlüssel, damit die Löschung erneut gesendet wird. Wird entfernt, sobald unser Server das Gespräch gelöscht hat.
<!-- endif -->

Diese Speicherung ist unbedingt erforderlich, damit der Chat funktioniert, den Sie ausdrücklich nutzen möchten (§ 25 Abs. 2 Nr. 2 TDDDG).<!-- if historyany --> Dazu gehört der Schlüssel eines Gesprächs, das wir aufbewahren: Er entsteht erst mit Ihrer Frage, ordnet Ihre Fragen diesem Gespräch zu und ermöglicht es Ihnen, unsere Kopie im Chat zu löschen. Nach einem Widerspruch entstehen keine neuen Schlüssel.<!-- endif --> Sie können die Daten jederzeit löschen, im Chat über <!-- if history -->„Gespräch löschen“ oder <!-- endif -->„Von diesem Gerät entfernen“ oder in den Einstellungen Ihres Browsers.

### Ihre Rechte

Sie haben das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16 DSGVO), Löschung (Art. 17 DSGVO), Einschränkung der Verarbeitung (Art. 18 DSGVO) und Datenübertragbarkeit (Art. 20 DSGVO). Verarbeitungen auf Grundlage unseres berechtigten Interesses können Sie widersprechen (Art. 21 DSGVO), eine Einwilligung können Sie jederzeit widerrufen. Zudem können Sie sich bei einer Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO), in der Schweiz beim Eidgenössischen Datenschutz- und Öffentlichkeitsbeauftragten (EDÖB).<!-- if nohistory --> Gespräche mit dem KI-Assistenten speichern wir nicht, deshalb können wir dazu keine Auskunft geben.<!-- endif --><!-- if historyany --> Gespräche mit dem Assistenten bewahren wir ohne Ihren Namen und ohne IP-Adresse auf. Haben Sie aus einem Gespräch unser Team kontaktiert, finden wir es über diese Anfrage (E-Mail-Adresse oder Name); andere Gespräche finden wir nur, wenn Sie uns sagen, was Sie wann geschrieben haben. Löschen können Sie sie selbst im Chat.<!-- endif --><!-- if team --> Gespräche und Nachrichten an unser Team finden wir anhand Ihrer E-Mail-Adresse oder Ihres Namens.<!-- endif --> Kontakt: [Kontaktangaben des Verantwortlichen, gegebenenfalls unseres Vertreters in der EU (Art. 27 DSGVO) und der oder des Datenschutzbeauftragten].
