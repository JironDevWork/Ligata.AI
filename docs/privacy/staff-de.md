<!-- if docs -->
# Datenschutzhinweis für Mitarbeitende: der Inhaltsassistent im Backoffice (Ligata AI)

> **Für Arbeitgeber und Website-Betreiber, bitte vor dem Weitergeben lesen.**
>
> - Dieser Hinweis informiert die Personen, die im Umbraco-Backoffice mit dem Inhaltsassistenten arbeiten (Art. 13 DSGVO, Art. 19 DSG). Er ist ein Muster und **keine Rechtsberatung**. Lassen Sie ihn von Ihrer Datenschutzberatung prüfen.
> - **Einfacher geht es im Backoffice:** Unter *AI Assistant → Content assistant → Privacy* erzeugt das Paket diesen Text mit Ihren Einstellungen (Fristen, Benutzergruppen, Modell, wer verantwortlich ist). Die Mitarbeitenden sehen ihn auch im Chat unter *Privacy note*, in der Sprache ihres Backoffice.
> - Hier im Repository sehen Sie alle Varianten. HTML-Kommentare im Quelltext markieren, wofür ein Abschnitt gilt: `responsible` = die verantwortliche Stelle ist im Backoffice eingetragen, `media` = der Assistent darf angehängte Bilder in die Medienbibliothek hochladen, `nomonitoring` = im Backoffice ist bestätigt, dass Protokoll und Nutzungszahlen nicht zur Leistungs- oder Verhaltenskontrolle dienen (nur einschalten, wenn das zutrifft, etwa nach einer Betriebsvereinbarung). Werte in doppelten geschweiften Klammern setzt das Backoffice ein; Angaben in [eckigen Klammern] ergänzen Sie selbst.
> - **Mitbestimmung.** Das Aktivitätsprotokoll und die Nutzung pro Person zeigen, wer wann was mit dem Assistenten getan hat. In Deutschland ist eine technische Einrichtung, die dazu geeignet ist, Verhalten oder Leistung zu überwachen, mitbestimmungspflichtig (§ 87 Abs. 1 Nr. 6 BetrVG): Beziehen Sie einen vorhandenen Betriebsrat vor der Einführung ein. In Österreich kann eine Betriebsvereinbarung nötig sein (§§ 96, 96a ArbVG). In der Schweiz verbietet Art. 26 ArGV 3 Systeme, die das Verhalten am Arbeitsplatz überwachen sollen; ein Protokoll, das Änderungen nachvollziehbar und rückgängig macht, ist zulässig, wenn es verhältnismässig ist und die Mitarbeitenden informiert sind.
> - **Rechtsgrundlage.** Der Text nennt Art. 6 Abs. 1 lit. b und f DSGVO. § 26 BDSG ist seit dem Urteil des EuGH vom 30. März 2023 (C-34/21) als alleinige Grundlage umstritten und wird deshalb nicht genannt.
> - Die Angaben zu Anthropic entsprechen denen der Datenschutzerklärung für den Website-Chat (Stand Oktober 2026: Löschung von API-Daten innerhalb von 30 Tagen, Data Processing Addendum mit EU-Standardvertragsklauseln, kein Training mit API-Daten). Prüfen Sie den aktuellen Stand unter anthropic.com/legal.

---
<!-- endif -->
## Datenschutzhinweis: der KI-Assistent im Backoffice

Im Backoffice unserer Website (Umbraco) steht Ihnen ein KI-Assistent zur Verfügung. Er findet und liest Seiten und ändert Inhalte, wenn Sie ihn darum bitten. Hier erfahren Sie, welche Daten dabei verarbeitet werden.

### Verantwortlich

<!-- if responsible -->
{{responsible}}
<!-- endif -->
<!-- if !responsible -->
[Name und Anschrift des Arbeitgebers bzw. Website-Betreibers; Kontakt für Datenschutzfragen, gegebenenfalls die oder der Datenschutzbeauftragte]
<!-- endif -->

### Welche Daten verarbeitet werden

- **Was Sie schreiben:** Ihre Nachrichten an den Assistenten und Bilder, die Sie anhängen.
- **Website-Inhalte:** die Seiten und Felder, die der Assistent liest, um Ihre Anfrage zu bearbeiten, auch Entwürfe. Sie können personenbezogene Daten enthalten, etwa Namen und Kontaktdaten auf einer Team- oder Kontaktseite.
- **Angaben zu Ihnen:** Ihr Name im Backoffice, die Seite, die Sie gerade geöffnet haben, Datum und Uhrzeit.
- **Änderungen:** was der Assistent geändert hat (vorher und nachher), wer ihn dazu angeleitet hat, wann, mit welcher Anfrage, und ob die Änderung von Hand bestätigt, automatisch ausgeführt, abgelehnt oder rückgängig gemacht wurde.
- **Nutzung:** pro Person und Tag die Zahl der Nachrichten, Arbeitsschritte und Änderungen sowie die verbrauchten Tokens, ohne Inhalte.

### Zweck und Rechtsgrundlage

Wir setzen den Assistenten ein, damit Sie die Inhalte unserer Website schneller finden und pflegen können. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Durchführung des Arbeitsverhältnisses) sowie unser berechtigtes Interesse an einer effizienten und nachvollziehbaren Pflege unserer Website (Art. 6 Abs. 1 lit. f DSGVO). Das Aktivitätsprotokoll dient dazu, Änderungen nachzuvollziehen, sie rückgängig zu machen und Fehler oder Missbrauch zu erkennen.<!-- if nomonitoring --> Wir werten das Aktivitätsprotokoll und die Nutzungszahlen nicht zur Leistungs- oder Verhaltenskontrolle aus.<!-- endif -->

### Empfänger: Anthropic (USA)

Die Antworten erzeugt das KI-Modell {{model}} der Anthropic, PBC, San Francisco, USA („Anthropic“). Unser Website-Server übermittelt Ihre Nachrichten, angehängte Bilder, die gelesenen Inhalte und Ihren Namen im Backoffice direkt an Anthropic, dazu eine pseudonyme Kennung Ihres Benutzerkontos, damit Anthropic Missbrauch erkennen kann. Ihre E-Mail-Adresse wird nicht übermittelt. Ihr Browser verbindet sich dabei nicht mit Anthropic.

Anthropic verarbeitet die Daten in unserem Auftrag (Art. 28 DSGVO, auf Grundlage des Data Processing Addendum von Anthropic) und verwendet sie nach seinen kommerziellen Bedingungen nicht zum Training von KI-Modellen. Nach eigenen Angaben löscht Anthropic Ein- und Ausgaben innerhalb von 30 Tagen. Inhalte, die Anthropic als Verstoss gegen seine Nutzungsrichtlinien einstuft, kann Anthropic bis zu 2 Jahre aufbewahren. Die Übermittlung in die USA stützt sich auf die Standardvertragsklauseln der EU-Kommission (Art. 46 Abs. 2 lit. c DSGVO), für Übermittlungen aus der Schweiz in der an das Schweizer Recht angepassten Fassung (Art. 16 Abs. 2 lit. d DSG).

### Wer was sieht und wie lange es gespeichert wird

- **Ihre Gespräche** mit dem Assistenten sehen im Backoffice nur Sie. Sie werden {{chatDays}} Tage nach der letzten Nachricht gelöscht; Sie können sie jederzeit selbst löschen.
- **Das Aktivitätsprotokoll** (jede Änderung mit Ihrem Namen, Ihrer Anfrage in gekürzter Form, vorher und nachher) sehen Mitglieder der Benutzergruppen {{viewers}}. Einträge werden nach {{activityDays}} Tagen gelöscht.
- **Die Nutzungszahlen** pro Person sehen dieselben Gruppen. Sie werden nach {{usageDays}} Tagen gelöscht.
<!-- if media -->
- **Bilder**, die der Assistent mit Ihrer Zustimmung in die Medienbibliothek hochlädt, sind dort wie andere Medien für alle mit Zugriff auf die Medienbibliothek sichtbar und bleiben, bis jemand sie löscht.
<!-- endif -->
- Den Assistenten nutzen können Mitglieder der Benutzergruppen {{users}}. Er arbeitet immer mit Ihren eigenen Berechtigungen im Backoffice.

### Bitte beachten

Geben Sie im Chat keine personenbezogenen Daten Dritter ein, die für die Aufgabe nicht nötig sind (etwa Kundendaten aus E-Mails), und keine Passwörter oder anderen Zugangsdaten.

### Ihre Rechte

Sie haben das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18) und Widerspruch gegen die Verarbeitung auf Grundlage berechtigter Interessen (Art. 21). Sie können sich bei einer Datenschutz-Aufsichtsbehörde beschweren, in der Schweiz beim Eidgenössischen Datenschutz- und Öffentlichkeitsbeauftragten (EDÖB). Fragen richten Sie an die oben genannte verantwortliche Stelle.
