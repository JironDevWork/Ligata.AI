/*! Ligata AI website assistant | (c) Ligata */
(() => {
  'use strict';
  const script = document.currentScript || document.querySelector('script[data-ligata-ai]');
  if (!script || window.__ligataAI) return;
  window.__ligataAI = true;

  let settings;
  try { settings = JSON.parse(script.dataset.settings || '{}'); } catch { settings = {}; }
  const api = (script.dataset.api || '/api/ligata-ai').replace(/\/$/, '');
  const look = Object.assign({
    theme: 'ligata', colorScheme: 'light', position: 'right', accent: '#2f5bff', accentText: '#ffffff', background: '#ffffff', surface: '#f3f4f8', text: '#15171f', mutedText: '#5d6272',
    userBubble: '#2f5bff', userText: '#ffffff', assistantBubble: '#f3f4f8', assistantText: '#15171f', font: 'inherit', radius: 20, launcherSize: 60, launcherIcon: 'chat', launcherLabel: '',
    panelWidth: 400, panelHeight: 640, offsetX: 24, offsetY: 24, showContextMeter: false, showQueuePosition: true, showBranding: true, animations: true, sound: true, teaser: '', teaserDelaySeconds: 6, zIndex: 2147483000,
  }, settings.appearance || {});
  const limits = Object.assign({ maxImages: 8, maxImageBytes: 5242880, maxPdfBytes: 10485760, maxPdfPages: 80, maxAttachments: 4, maxMessageCharacters: 8000 }, settings.limits || {});
  const preview = script.dataset.preview === 'true';
  // Older page snapshots (0.1) have no feature list: they are AI-only.
  const F = {
    ai: settings.features ? !!settings.features.assistant : true,
    chat: !!(settings.features?.liveChat && settings.team),
    email: !!(settings.features?.email && settings.contact),
  };
  const team = settings.team || {};
  const contact = settings.contact || {};
  const captcha = settings.captcha || null;
  const TEAM_MARK = '[[team]]';
  const MAX_TEAM_TEXT = 4000;

  // ---------- language ----------
  const strings = {
    en: { open: 'Open chat', close: 'Close chat', minimize: 'Minimize', newChat: 'New conversation', send: 'Send', stop: 'Stop', attach: 'Attach a screenshot or PDF', placeholder: 'Ask a question…', placeholderTeam: 'Write a message…', online: 'Online', busy: 'Busy right now', starting: 'Starting up', offline: 'Offline', degraded: 'Running slowly', checking: 'Connecting…', queue: n => n === 1 ? 'You are next' : `You are number ${n} in line`, wait: s => s < 60 ? `about ${Math.max(5, Math.round(s / 5) * 5)} s` : `about ${Math.round(s / 60)} min`, thinking: 'Thinking…', reading: 'Reading…', readingDocument: 'Reading your document…', searching: 'Searching the website…', readingPages: 'Reading the page…', contactIntro: 'Our team is happy to help.', compacting: 'Summarizing the conversation so far…', compacted: 'Earlier messages were summarized so the conversation can continue.', image: 'Image', typing: 'Writing…', memory: 'Memory', free: 'free', memoryHelp: p => `This conversation fills ${p} of the assistant’s memory. When it is full, the assistant summarizes the earlier messages and continues.`, retry: 'Try again', reconnect: 'Reconnect', removeAttachment: 'Remove attachment', pages: n => `${n} page${n === 1 ? '' : 's'}`, tokens: n => `${n} tokens`, processing: 'Reading file…', dropHere: 'Drop screenshots or PDFs here', contact: 'Contact us', email: 'Email us', poweredBy: 'Private AI by Ligata', poweredByApi: 'AI by Ligata', poweredByTeam: 'Chat by Ligata', notKept: 'no longer attached', you: 'You', copy: 'Copy', copied: 'Copied', privacy: 'Privacy',
      talkToTeam: 'Talk to a person', conversations: 'Conversations', back: 'Back', ourTeam: 'Our team', chatWithTeam: n => `Chat with ${n}`, chatWithOurTeam: 'Chat with our team', leaveMessage: 'Leave a message', sendEmail: 'Send us an email', handoffTitle: 'Would you like to talk to our team?', noThanks: 'No thanks',
      teamOnline: n => n === 1 ? 'A team member is online' : `${n} team members are online`, teamFast: 'usually replies within minutes', teamOffline: 'Nobody is online right now. We will reply by email.', teamOfflineShort: 'We reply by email', teamHere: 'Here for you',
      name: 'Name', optional: 'optional', emailField: 'Email', message: 'Message', messageHint: 'How can we help?', sendRequest: 'Send request', sendMail: 'Send message', sending: 'Sending…', cancel: 'Cancel', chatTab: 'Chat', emailTab: 'Email',
      emailIntro: 'Leave your message and we will answer by email.', stored: d => `Our team sees this conversation. It is stored for up to ${d} days after the last message.`, storedEmail: 'We store your message to answer it and delete it after a while.',
      captchaConsent: 'Allow Google reCAPTCHA to check this request for spam.', captchaCookie: c => `To send, allow the “${c}” cookie category (spam protection by Google reCAPTCHA).`, cookieSettings: 'Cookie settings', captchaNote: (p, t) => `Protected by reCAPTCHA. The Google ${p('Privacy Policy')} and ${t('Terms of Service')} apply.`,
      waiting: 'Thanks! We let the team know. Someone will join you here shortly.', waitingOffline: 'Thanks! Nobody is online right now, so we will get back to you by email as soon as we can.', waitingNoEmail: 'Thanks! Nobody is online right now. Keep this page open or come back later: answers appear here.',
      joined: n => `${n} joined the conversation`, joinedAnon: 'A team member joined the conversation', left: n => `${n} left the conversation`, leftAnon: 'The team member left the conversation', closedTeam: 'The team closed this conversation.', closedInactive: 'This conversation was closed after a while without messages.', closedYou: 'You ended this conversation.', reopened: 'The conversation was reopened.', requested: 'You asked to talk to the team', isTyping: n => `${n} is typing…`, typingNow: 'typing…', teamTyping: 'The team is typing…',
      endChat: 'End chat', endConfirm: 'End this chat with the team?', closedNotice: 'This conversation is closed.', startNew: 'Start a new conversation', emailSent: e => `Message sent. We will reply to ${e}.`, emailSentShort: 'Message sent', viaEmail: 'by email',
      statusWaiting: 'Waiting for the team', statusActive: 'Team is here', statusReplied: 'Team replied', statusClosed: 'Closed', statusSent: 'Sent', statusAI: 'AI assistant', remove: 'Remove from this device', removeConfirm: 'Remove this conversation from this device?', emptyList: 'No conversations yet.', notSent: 'Not sent', previewSent: 'Preview: this would notify your team. Real requests appear in the Inbox.', homeHint: 'How would you like to reach us?', homeGreeting: 'Hi! How can we help you?', newMessage: 'New message', aiAnswer: 'AI',
      errors: { network: 'The assistant cannot be reached right now.', thinking_limit: 'The assistant thought for too long and could not finish its answer. Please try again or ask more specifically.', refused: 'I can’t help with that. Please ask something else about this website.', visitor_busy: 'Please wait for the current answer before asking the next question.', rate_limited: 'You are sending messages too quickly. Please wait a moment.', site_busy: 'Many people are asking right now. Please try again in a minute.', queue_full: 'The assistant is very busy right now. Please try again in a minute.', queue_timeout: 'The assistant is too busy to answer right now. Please try again shortly.', daily_quota: 'The assistant has answered its maximum number of questions for today.', model_unavailable: 'The assistant is offline right now.', model_loading: 'The assistant is starting up. Please try again in a minute.', gateway_unavailable: 'The assistant is offline right now.', context_full: 'This message does not fit into the assistant’s memory. Remove an attachment, shorten it or start a new conversation.', compact_failed: 'The conversation could not be summarized. Please try again or start a new conversation.', answer_timeout: 'The answer took too long and was stopped. Try a shorter question.', model_failed: 'Something went wrong while answering. Please try again.', disabled: 'The assistant is switched off.', image_too_large: 'This image is too large.', unsupported_image: 'Only PNG, JPEG and WebP images are supported.', unsupported_file: 'Only screenshots (PNG, JPEG, WebP) and PDFs can be attached.', too_many_images: 'This conversation already has the maximum number of images. Start a new one to send more.', too_many_files: 'You can attach up to four files per message.', pdf_too_large: 'This PDF is too large.', pdf_no_text: 'This PDF has no readable text (it may be scanned). Attach screenshots of the pages instead.', pdf_encrypted: 'This PDF is password-protected.', invalid_pdf: 'This PDF could not be read.', documents_disabled: 'PDFs are not accepted here.', images_disabled: 'Images are not accepted here.', message_too_long: 'This message is too long.', origin_denied: 'The assistant is not available on this website.', default: 'Something went wrong. Please try again.',
        too_many_open: 'You already have open conversations with the team. Continue one of them.', inbox_full: 'The team is receiving too many requests right now. Please try again later.', captcha_failed: 'The spam check failed. Please try again.', captcha_unavailable: 'The spam check is not available right now. Please try again in a moment.', captcha_consent: 'Please allow the spam check to send.', channel_disabled: 'This contact option is switched off.', invalid_email: 'Please enter a valid email address.', invalid_name: 'Please check your name.', invalid_message: 'Please write a message.', closed: 'This conversation was closed. Start a new one.', not_found: 'This conversation is no longer available.', conversation_full: 'This conversation is very long. Please start a new one.', send_failed: 'Your message could not be sent.' } },
    de: { open: 'Chat öffnen', close: 'Chat schliessen', minimize: 'Minimieren', newChat: 'Neues Gespräch', send: 'Senden', stop: 'Stopp', attach: 'Screenshot oder PDF anhängen', placeholder: 'Stell eine Frage …', placeholderTeam: 'Schreib eine Nachricht …', online: 'Online', busy: 'Gerade ausgelastet', starting: 'Startet', offline: 'Offline', degraded: 'Läuft langsam', checking: 'Verbinde …', queue: n => n === 1 ? 'Du bist als Nächstes dran' : `Du bist Nummer ${n} in der Warteschlange`, wait: s => s < 60 ? `etwa ${Math.max(5, Math.round(s / 5) * 5)} s` : `etwa ${Math.round(s / 60)} min`, thinking: 'Denkt nach …', reading: 'Liest …', readingDocument: 'Liest dein Dokument …', searching: 'Durchsucht die Website …', readingPages: 'Liest die Seite …', contactIntro: 'Unser Team hilft dir gerne weiter.', compacting: 'Fasst das bisherige Gespräch zusammen …', compacted: 'Frühere Nachrichten wurden zusammengefasst, damit das Gespräch weitergehen kann.', image: 'Bild', typing: 'Schreibt …', memory: 'Gedächtnis', free: 'frei', memoryHelp: p => `Dieses Gespräch belegt ${p} des Gedächtnisses des Assistenten. Wenn es voll ist, fasst der Assistent die früheren Nachrichten zusammen und macht weiter.`, retry: 'Erneut versuchen', reconnect: 'Neu verbinden', removeAttachment: 'Anhang entfernen', pages: n => `${n} Seite${n === 1 ? '' : 'n'}`, tokens: n => `${n} Tokens`, processing: 'Datei wird gelesen …', dropHere: 'Screenshots oder PDFs hier ablegen', contact: 'Kontakt', email: 'E-Mail schreiben', poweredBy: 'Private KI von Ligata', poweredByApi: 'KI von Ligata', poweredByTeam: 'Chat von Ligata', notKept: 'nicht mehr angehängt', you: 'Du', copy: 'Kopieren', copied: 'Kopiert', privacy: 'Datenschutz',
      talkToTeam: 'Mit einer Person sprechen', conversations: 'Gespräche', back: 'Zurück', ourTeam: 'Unser Team', chatWithTeam: n => `Chat mit ${n}`, chatWithOurTeam: 'Mit unserem Team chatten', leaveMessage: 'Nachricht hinterlassen', sendEmail: 'Schreib uns eine E-Mail', handoffTitle: 'Möchtest du mit unserem Team sprechen?', noThanks: 'Nein, danke',
      teamOnline: n => n === 1 ? 'Eine Person aus dem Team ist online' : `${n} Personen aus dem Team sind online`, teamFast: 'antwortet meist innert Minuten', teamOffline: 'Gerade ist niemand online. Wir antworten dir per E-Mail.', teamOfflineShort: 'Wir antworten per E-Mail', teamHere: 'Für dich da',
      name: 'Name', optional: 'optional', emailField: 'E-Mail', message: 'Nachricht', messageHint: 'Wie können wir helfen?', sendRequest: 'Anfrage senden', sendMail: 'Nachricht senden', sending: 'Wird gesendet …', cancel: 'Abbrechen', chatTab: 'Chat', emailTab: 'E-Mail',
      emailIntro: 'Hinterlass uns eine Nachricht, wir antworten per E-Mail.', stored: d => `Unser Team sieht dieses Gespräch. Es wird bis ${d} Tage nach der letzten Nachricht gespeichert.`, storedEmail: 'Wir speichern deine Nachricht, um sie zu beantworten, und löschen sie nach einiger Zeit.',
      captchaConsent: 'Google reCAPTCHA darf diese Anfrage auf Spam prüfen.', captchaCookie: c => `Erlaube zum Senden die Cookie-Kategorie «${c}» (Spamschutz durch Google reCAPTCHA).`, cookieSettings: 'Cookie-Einstellungen', captchaNote: (p, t) => `Geschützt durch reCAPTCHA. Es gelten die ${p('Datenschutzerklärung')} und ${t('Nutzungsbedingungen')} von Google.`,
      waiting: 'Danke! Wir haben das Team informiert. Gleich ist jemand für dich da.', waitingOffline: 'Danke! Gerade ist niemand online. Wir melden uns so bald wie möglich per E-Mail.', waitingNoEmail: 'Danke! Gerade ist niemand online. Lass diese Seite offen oder komm später zurück. Die Antwort erscheint hier.',
      joined: n => `${n} ist dem Gespräch beigetreten`, joinedAnon: 'Eine Person aus dem Team ist beigetreten', left: n => `${n} hat das Gespräch verlassen`, leftAnon: 'Die Person aus dem Team hat das Gespräch verlassen', closedTeam: 'Das Team hat dieses Gespräch beendet.', closedInactive: 'Dieses Gespräch wurde nach längerer Zeit ohne Nachrichten beendet.', closedYou: 'Du hast dieses Gespräch beendet.', reopened: 'Das Gespräch wurde wieder geöffnet.', requested: 'Du möchtest mit dem Team sprechen', isTyping: n => `${n} schreibt …`, typingNow: 'schreibt …', teamTyping: 'Das Team schreibt …',
      endChat: 'Chat beenden', endConfirm: 'Diesen Chat mit dem Team beenden?', closedNotice: 'Dieses Gespräch ist beendet.', startNew: 'Neues Gespräch beginnen', emailSent: e => `Nachricht gesendet. Wir antworten an ${e}.`, emailSentShort: 'Nachricht gesendet', viaEmail: 'per E-Mail',
      statusWaiting: 'Wartet auf das Team', statusActive: 'Team ist da', statusReplied: 'Team hat geantwortet', statusClosed: 'Beendet', statusSent: 'Gesendet', statusAI: 'KI-Assistent', remove: 'Von diesem Gerät entfernen', removeConfirm: 'Dieses Gespräch von diesem Gerät entfernen?', emptyList: 'Noch keine Gespräche.', notSent: 'Nicht gesendet', previewSent: 'Vorschau: Hier würde dein Team benachrichtigt. Echte Anfragen erscheinen in der Inbox.', homeHint: 'Wie möchtest du uns erreichen?', homeGreeting: 'Hallo! Wie können wir dir helfen?', newMessage: 'Neue Nachricht', aiAnswer: 'KI',
      errors: { network: 'Der Assistent ist gerade nicht erreichbar.', thinking_limit: 'Der Assistent hat zu lange nachgedacht und keine Antwort fertiggestellt. Bitte versuch es erneut oder frag genauer.', refused: 'Dabei kann ich nicht helfen. Frag gerne etwas anderes zu dieser Website.', visitor_busy: 'Bitte warte auf die aktuelle Antwort, bevor du die nächste Frage stellst.', rate_limited: 'Du sendest zu schnell Nachrichten. Bitte warte einen Moment.', site_busy: 'Gerade fragen sehr viele Leute. Bitte versuche es in einer Minute erneut.', queue_full: 'Der Assistent ist gerade sehr ausgelastet. Bitte versuche es in einer Minute erneut.', queue_timeout: 'Der Assistent ist gerade zu ausgelastet. Bitte versuche es gleich noch einmal.', daily_quota: 'Der Assistent hat heute bereits die maximale Anzahl Fragen beantwortet.', model_unavailable: 'Der Assistent ist gerade offline.', model_loading: 'Der Assistent startet gerade. Bitte versuche es in einer Minute erneut.', gateway_unavailable: 'Der Assistent ist gerade offline.', context_full: 'Diese Nachricht passt nicht ins Gedächtnis des Assistenten. Entferne einen Anhang, kürze sie oder beginne ein neues Gespräch.', compact_failed: 'Das Gespräch konnte nicht zusammengefasst werden. Bitte versuch es erneut oder beginne ein neues Gespräch.', answer_timeout: 'Die Antwort hat zu lange gedauert und wurde abgebrochen. Versuche eine kürzere Frage.', model_failed: 'Beim Antworten ist etwas schiefgelaufen. Bitte versuche es erneut.', disabled: 'Der Assistent ist ausgeschaltet.', image_too_large: 'Dieses Bild ist zu gross.', unsupported_image: 'Nur PNG-, JPEG- und WebP-Bilder werden unterstützt.', unsupported_file: 'Anhängen kannst du Screenshots (PNG, JPEG, WebP) und PDFs.', too_many_images: 'Dieses Gespräch enthält bereits die maximale Anzahl Bilder. Beginne ein neues, um weitere zu senden.', too_many_files: 'Pro Nachricht kannst du bis zu vier Dateien anhängen.', pdf_too_large: 'Dieses PDF ist zu gross.', pdf_no_text: 'Dieses PDF enthält keinen lesbaren Text (vielleicht gescannt). Hänge stattdessen Screenshots der Seiten an.', pdf_encrypted: 'Dieses PDF ist passwortgeschützt.', invalid_pdf: 'Dieses PDF konnte nicht gelesen werden.', documents_disabled: 'PDFs werden hier nicht angenommen.', images_disabled: 'Bilder werden hier nicht angenommen.', message_too_long: 'Diese Nachricht ist zu lang.', origin_denied: 'Der Assistent ist auf dieser Website nicht verfügbar.', default: 'Etwas ist schiefgelaufen. Bitte versuche es erneut.',
        too_many_open: 'Du hast bereits offene Gespräche mit dem Team. Führe eines davon weiter.', inbox_full: 'Das Team erhält gerade sehr viele Anfragen. Bitte versuche es später erneut.', captcha_failed: 'Die Spamprüfung ist fehlgeschlagen. Bitte versuche es erneut.', captcha_unavailable: 'Die Spamprüfung ist gerade nicht verfügbar. Bitte versuche es gleich noch einmal.', captcha_consent: 'Bitte erlaube die Spamprüfung, um zu senden.', channel_disabled: 'Diese Kontaktmöglichkeit ist ausgeschaltet.', invalid_email: 'Bitte gib eine gültige E-Mail-Adresse ein.', invalid_name: 'Bitte prüfe deinen Namen.', invalid_message: 'Bitte schreib eine Nachricht.', closed: 'Dieses Gespräch wurde beendet. Beginne ein neues.', not_found: 'Dieses Gespräch ist nicht mehr verfügbar.', conversation_full: 'Dieses Gespräch ist sehr lang. Bitte beginne ein neues.', send_failed: 'Deine Nachricht konnte nicht gesendet werden.' } },
    fr: { open: 'Ouvrir le chat', close: 'Fermer le chat', minimize: 'Réduire', newChat: 'Nouvelle conversation', send: 'Envoyer', stop: 'Arrêter', attach: 'Joindre une capture ou un PDF', placeholder: 'Posez une question…', placeholderTeam: 'Écrivez un message…', online: 'En ligne', busy: 'Très sollicité', starting: 'Démarrage', offline: 'Hors ligne', degraded: 'Ralenti', checking: 'Connexion…', queue: n => n === 1 ? 'Vous êtes le prochain' : `Vous êtes numéro ${n} dans la file`, wait: s => s < 60 ? `environ ${Math.max(5, Math.round(s / 5) * 5)} s` : `environ ${Math.round(s / 60)} min`, thinking: 'Réflexion…', reading: 'Lecture…', readingDocument: 'Lecture de votre document…', searching: 'Recherche sur le site…', readingPages: 'Lecture de la page…', contactIntro: 'Notre équipe vous aide volontiers.', compacting: 'Résumé de la conversation en cours…', compacted: 'Les messages précédents ont été résumés pour que la conversation puisse continuer.', image: 'Image', typing: 'Rédaction…', memory: 'Mémoire', free: 'libre', memoryHelp: p => `Cette conversation occupe ${p} de la mémoire de l’assistant. Quand elle est pleine, l’assistant résume les messages précédents et continue.`, retry: 'Réessayer', reconnect: 'Reconnecter', removeAttachment: 'Retirer la pièce jointe', pages: n => `${n} page${n === 1 ? '' : 's'}`, tokens: n => `${n} tokens`, processing: 'Lecture du fichier…', dropHere: 'Déposez des captures ou des PDF ici', contact: 'Nous contacter', email: 'Nous écrire', poweredBy: 'IA privée par Ligata', poweredByApi: 'IA par Ligata', poweredByTeam: 'Chat par Ligata', notKept: 'plus joint', you: 'Vous', copy: 'Copier', copied: 'Copié', privacy: 'Confidentialité',
      talkToTeam: 'Parler à une personne', conversations: 'Conversations', back: 'Retour', ourTeam: 'Notre équipe', chatWithTeam: n => `Discuter avec ${n}`, chatWithOurTeam: 'Discuter avec notre équipe', leaveMessage: 'Laisser un message', sendEmail: 'Envoyez-nous un e-mail', handoffTitle: 'Voulez-vous parler à notre équipe ?', noThanks: 'Non merci',
      teamOnline: n => n === 1 ? 'Un membre de l’équipe est en ligne' : `${n} membres de l’équipe sont en ligne`, teamFast: 'répond généralement en quelques minutes', teamOffline: 'Personne n’est en ligne pour le moment. Nous répondrons par e-mail.', teamOfflineShort: 'Réponse par e-mail', teamHere: 'À votre écoute',
      name: 'Nom', optional: 'facultatif', emailField: 'E-mail', message: 'Message', messageHint: 'Comment pouvons-nous aider ?', sendRequest: 'Envoyer la demande', sendMail: 'Envoyer le message', sending: 'Envoi…', cancel: 'Annuler', chatTab: 'Chat', emailTab: 'E-mail',
      emailIntro: 'Laissez-nous un message, nous répondrons par e-mail.', stored: d => `Notre équipe voit cette conversation. Elle est conservée jusqu’à ${d} jours après le dernier message.`, storedEmail: 'Nous conservons votre message pour y répondre et le supprimons ensuite.',
      captchaConsent: 'Autoriser Google reCAPTCHA à vérifier cette demande (anti-spam).', captchaCookie: c => `Pour envoyer, autorisez la catégorie de cookies « ${c} » (anti-spam Google reCAPTCHA).`, cookieSettings: 'Paramètres des cookies', captchaNote: (p, t) => `Protégé par reCAPTCHA. La ${p('politique de confidentialité')} et les ${t('conditions d’utilisation')} de Google s’appliquent.`,
      waiting: 'Merci ! L’équipe est prévenue. Quelqu’un vous rejoint ici sous peu.', waitingOffline: 'Merci ! Personne n’est en ligne pour le moment ; nous vous répondrons par e-mail dès que possible.', waitingNoEmail: 'Merci ! Personne n’est en ligne. Gardez cette page ouverte ou revenez plus tard : la réponse s’affichera ici.',
      joined: n => `${n} a rejoint la conversation`, joinedAnon: 'Un membre de l’équipe a rejoint la conversation', left: n => `${n} a quitté la conversation`, leftAnon: 'Le membre de l’équipe a quitté la conversation', closedTeam: 'L’équipe a fermé cette conversation.', closedInactive: 'Cette conversation a été fermée après une période d’inactivité.', closedYou: 'Vous avez terminé cette conversation.', reopened: 'La conversation a été rouverte.', requested: 'Vous avez demandé à parler à l’équipe', isTyping: n => `${n} écrit…`, typingNow: 'écrit…', teamTyping: 'L’équipe écrit…',
      endChat: 'Terminer le chat', endConfirm: 'Terminer ce chat avec l’équipe ?', closedNotice: 'Cette conversation est terminée.', startNew: 'Nouvelle conversation', emailSent: e => `Message envoyé. Nous répondrons à ${e}.`, emailSentShort: 'Message envoyé', viaEmail: 'par e-mail',
      statusWaiting: 'En attente de l’équipe', statusActive: 'L’équipe est là', statusReplied: 'L’équipe a répondu', statusClosed: 'Terminée', statusSent: 'Envoyé', statusAI: 'Assistant IA', remove: 'Retirer de cet appareil', removeConfirm: 'Retirer cette conversation de cet appareil ?', emptyList: 'Aucune conversation pour le moment.', notSent: 'Non envoyé', previewSent: 'Aperçu : votre équipe serait prévenue. Les vraies demandes apparaissent dans l’Inbox.', homeHint: 'Comment souhaitez-vous nous joindre ?', homeGreeting: 'Bonjour ! Comment pouvons-nous vous aider ?', newMessage: 'Nouveau message', aiAnswer: 'IA',
      errors: { network: 'L’assistant est injoignable pour le moment.', thinking_limit: 'L’assistant a réfléchi trop longtemps et n’a pas pu terminer sa réponse. Réessayez ou posez une question plus précise.', refused: 'Je ne peux pas vous aider avec cela. Posez une autre question sur ce site.', context_full: 'Ce message ne tient pas dans la mémoire de l’assistant. Retirez une pièce jointe, raccourcissez-le ou commencez une nouvelle conversation.', compact_failed: 'La conversation n’a pas pu être résumée. Réessayez ou commencez une nouvelle conversation.', too_many_open: 'Vous avez déjà des conversations ouvertes avec l’équipe.', captcha_failed: 'La vérification anti-spam a échoué. Réessayez.', captcha_consent: 'Autorisez la vérification anti-spam pour envoyer.', invalid_email: 'Saisissez une adresse e-mail valide.', invalid_message: 'Écrivez un message.', closed: 'Cette conversation est terminée. Commencez-en une nouvelle.', not_found: 'Cette conversation n’est plus disponible.', default: 'Une erreur est survenue. Réessayez.' } },
    it: { open: 'Apri la chat', close: 'Chiudi la chat', minimize: 'Riduci', newChat: 'Nuova conversazione', send: 'Invia', stop: 'Ferma', attach: 'Allega uno screenshot o un PDF', placeholder: 'Fai una domanda…', placeholderTeam: 'Scrivi un messaggio…', online: 'Online', busy: 'Molto richiesto', starting: 'In avvio', offline: 'Offline', degraded: 'Rallentato', checking: 'Connessione…', queue: n => n === 1 ? 'Sei il prossimo' : `Sei il numero ${n} in coda`, wait: s => s < 60 ? `circa ${Math.max(5, Math.round(s / 5) * 5)} s` : `circa ${Math.round(s / 60)} min`, thinking: 'Sto pensando…', reading: 'Sto leggendo…', readingDocument: 'Sto leggendo il documento…', searching: 'Cerco nel sito…', readingPages: 'Leggo la pagina…', contactIntro: 'Il nostro team ti aiuta volentieri.', compacting: 'Riassumo la conversazione…', compacted: 'I messaggi precedenti sono stati riassunti per poter continuare la conversazione.', image: 'Immagine', typing: 'Sto scrivendo…', memory: 'Memoria', free: 'libera', memoryHelp: p => `Questa conversazione occupa il ${p} della memoria dell’assistente. Quando è piena, l’assistente riassume i messaggi precedenti e continua.`, retry: 'Riprova', reconnect: 'Riconnetti', removeAttachment: 'Rimuovi allegato', pages: n => `${n} pagin${n === 1 ? 'a' : 'e'}`, tokens: n => `${n} token`, processing: 'Lettura del file…', dropHere: 'Trascina qui screenshot o PDF', contact: 'Contattaci', email: 'Scrivici', poweredBy: 'IA privata di Ligata', poweredByApi: 'IA di Ligata', poweredByTeam: 'Chat di Ligata', notKept: 'non più allegato', you: 'Tu', copy: 'Copia', copied: 'Copiato', privacy: 'Privacy',
      talkToTeam: 'Parla con una persona', conversations: 'Conversazioni', back: 'Indietro', ourTeam: 'Il nostro team', chatWithTeam: n => `Chatta con ${n}`, chatWithOurTeam: 'Chatta con il nostro team', leaveMessage: 'Lascia un messaggio', sendEmail: 'Inviaci un’e-mail', handoffTitle: 'Vuoi parlare con il nostro team?', noThanks: 'No, grazie',
      teamOnline: n => n === 1 ? 'Una persona del team è online' : `${n} persone del team sono online`, teamFast: 'di solito risponde in pochi minuti', teamOffline: 'Al momento nessuno è online. Ti risponderemo via e-mail.', teamOfflineShort: 'Rispondiamo via e-mail', teamHere: 'Qui per te',
      name: 'Nome', optional: 'facoltativo', emailField: 'E-mail', message: 'Messaggio', messageHint: 'Come possiamo aiutarti?', sendRequest: 'Invia richiesta', sendMail: 'Invia messaggio', sending: 'Invio…', cancel: 'Annulla', chatTab: 'Chat', emailTab: 'E-mail',
      emailIntro: 'Lasciaci un messaggio, ti risponderemo via e-mail.', stored: d => `Il nostro team vede questa conversazione. Viene conservata fino a ${d} giorni dopo l’ultimo messaggio.`, storedEmail: 'Conserviamo il tuo messaggio per risponderti e lo cancelliamo dopo un po’.',
      captchaConsent: 'Consenti a Google reCAPTCHA di controllare questa richiesta (anti-spam).', captchaCookie: c => `Per inviare, consenti la categoria di cookie «${c}» (anti-spam Google reCAPTCHA).`, cookieSettings: 'Impostazioni cookie', captchaNote: (p, t) => `Protetto da reCAPTCHA. Si applicano l’${p('informativa sulla privacy')} e i ${t('termini di servizio')} di Google.`,
      waiting: 'Grazie! Abbiamo avvisato il team. Qualcuno ti raggiungerà qui a breve.', waitingOffline: 'Grazie! Al momento nessuno è online: ti risponderemo via e-mail il prima possibile.', waitingNoEmail: 'Grazie! Al momento nessuno è online. Tieni aperta questa pagina o torna più tardi: la risposta apparirà qui.',
      joined: n => `${n} si è unito alla conversazione`, joinedAnon: 'Una persona del team si è unita alla conversazione', left: n => `${n} ha lasciato la conversazione`, leftAnon: 'La persona del team ha lasciato la conversazione', closedTeam: 'Il team ha chiuso questa conversazione.', closedInactive: 'Questa conversazione è stata chiusa per inattività.', closedYou: 'Hai terminato questa conversazione.', reopened: 'La conversazione è stata riaperta.', requested: 'Hai chiesto di parlare con il team', isTyping: n => `${n} sta scrivendo…`, typingNow: 'sta scrivendo…', teamTyping: 'Il team sta scrivendo…',
      endChat: 'Termina chat', endConfirm: 'Terminare questa chat con il team?', closedNotice: 'Questa conversazione è terminata.', startNew: 'Nuova conversazione', emailSent: e => `Messaggio inviato. Risponderemo a ${e}.`, emailSentShort: 'Messaggio inviato', viaEmail: 'via e-mail',
      statusWaiting: 'In attesa del team', statusActive: 'Il team è qui', statusReplied: 'Il team ha risposto', statusClosed: 'Chiusa', statusSent: 'Inviato', statusAI: 'Assistente IA', remove: 'Rimuovi da questo dispositivo', removeConfirm: 'Rimuovere questa conversazione da questo dispositivo?', emptyList: 'Ancora nessuna conversazione.', notSent: 'Non inviato', previewSent: 'Anteprima: qui verrebbe avvisato il team. Le richieste reali appaiono nella Inbox.', homeHint: 'Come vuoi contattarci?', homeGreeting: 'Ciao! Come possiamo aiutarti?', newMessage: 'Nuovo messaggio', aiAnswer: 'IA',
      errors: { network: 'L’assistente non è raggiungibile al momento.', thinking_limit: 'L’assistente ha riflettuto troppo a lungo e non è riuscito a completare la risposta. Riprova o fai una domanda più precisa.', refused: 'Non posso aiutarti con questo. Fai un’altra domanda su questo sito.', context_full: 'Questo messaggio non entra nella memoria dell’assistente. Rimuovi un allegato, accorcialo o inizia una nuova conversazione.', compact_failed: 'Non è stato possibile riassumere la conversazione. Riprova o inizia una nuova conversazione.', too_many_open: 'Hai già conversazioni aperte con il team.', captcha_failed: 'Il controllo anti-spam non è riuscito. Riprova.', captcha_consent: 'Consenti il controllo anti-spam per inviare.', invalid_email: 'Inserisci un indirizzo e-mail valido.', invalid_message: 'Scrivi un messaggio.', closed: 'Questa conversazione è terminata. Iniziane una nuova.', not_found: 'Questa conversazione non è più disponibile.', default: 'Qualcosa è andato storto. Riprova.' } },
  };
  // Consent before the AI reads a message (GDPR Art. 6(1)(a)). Provider and country come from the server.
  const consentStrings = {
    en: { consentTitle: 'Before we start', withoutAi: 'Without AI:', privacyAi: 'Answers are generated by an AI and can be wrong. Your messages are not stored.', privacyApi: 'Answers are generated by Claude, an AI by Anthropic, and can be wrong. This website does not store your messages.', consentApi: (n, c) => `This assistant is an AI. To answer, your messages, attached files and the page you are on are sent to ${n}${c}, the provider of the AI model Claude, and processed there on behalf of this website.`,
      consentGpu: (n, c) => `This assistant is an AI. To answer, your messages, attached files and the page you are on are sent to an AI server run by ${n}${c} on behalf of this website. Nothing is stored there.`,
      consentNote: 'Please do not share sensitive personal data. You can withdraw your consent at any time under Conversations.', consentNoteCookies: 'Please do not share sensitive personal data. You can withdraw your consent at any time in the cookie settings.', consentAgree: 'Agree and start', consentCookiebot: c => `To use the AI assistant, allow the “${c}” category in the cookie settings.`,
      consentWithdraw: 'Withdraw consent', consentWithdrawConfirm: 'Withdraw your consent to the AI assistant? Your conversations with the AI are removed from this device.', consentGiven: d => `You agreed to the AI assistant on ${d}.`, consentCookies: 'AI assistant allowed in the cookie settings.',
      privacyPolicy: 'Privacy policy', categories: { preferences: 'Preferences', statistics: 'Statistics', marketing: 'Marketing' }, consentRequired: 'Please agree first so the assistant may read your message.', consentChanged: 'The information has changed. Please read it and agree again.' },
    de: { consentTitle: 'Bevor es losgeht', withoutAi: 'Ohne KI:', privacyAi: 'Antworten werden von einer KI erzeugt und können falsch sein. Deine Nachrichten werden nicht gespeichert.', privacyApi: 'Antworten erzeugt Claude, eine KI von Anthropic. Sie können falsch sein. Diese Website speichert deine Nachrichten nicht.', consentApi: (n, c) => `Dieser Assistent ist eine KI. Damit er antworten kann, werden deine Nachrichten, angehängte Dateien und die aktuelle Seite an ${n}${c} gesendet, den Anbieter des KI-Modells Claude, und dort im Auftrag dieser Website verarbeitet.`,
      consentGpu: (n, c) => `Dieser Assistent ist eine KI. Damit er antworten kann, werden deine Nachrichten, angehängte Dateien und die aktuelle Seite an einen KI-Server von ${n}${c} gesendet, der im Auftrag dieser Website arbeitet. Dort wird nichts gespeichert.`,
      consentNote: 'Bitte teile keine sensiblen persönlichen Daten. Du kannst deine Einwilligung jederzeit unter «Gespräche» widerrufen.', consentNoteCookies: 'Bitte teile keine sensiblen persönlichen Daten. Du kannst deine Einwilligung jederzeit in den Cookie-Einstellungen widerrufen.', consentAgree: 'Zustimmen und starten', consentCookiebot: c => `Um den KI-Assistenten zu nutzen, erlaube in den Cookie-Einstellungen die Kategorie «${c}».`,
      consentWithdraw: 'Einwilligung widerrufen', consentWithdrawConfirm: 'Einwilligung zum KI-Assistenten widerrufen? Deine Gespräche mit der KI werden von diesem Gerät entfernt.', consentGiven: d => `Du hast dem KI-Assistenten am ${d} zugestimmt.`, consentCookies: 'KI-Assistent in den Cookie-Einstellungen erlaubt.',
      privacyPolicy: 'Datenschutzerklärung', categories: { preferences: 'Präferenzen', statistics: 'Statistiken', marketing: 'Marketing' }, consentRequired: 'Bitte stimme zuerst zu, damit der Assistent deine Nachricht lesen darf.', consentChanged: 'Die Angaben haben sich geändert. Bitte lies sie und stimme erneut zu.' },
    fr: { consentTitle: 'Avant de commencer', withoutAi: 'Sans IA :', privacyAi: 'Les réponses sont générées par une IA et peuvent être erronées. Vos messages ne sont pas conservés.', privacyApi: 'Les réponses sont générées par Claude, une IA d’Anthropic, et peuvent être erronées. Ce site ne conserve pas vos messages.', consentApi: (n, c) => `Cet assistant est une IA. Pour répondre, vos messages, les fichiers joints et la page consultée sont envoyés à ${n}${c}, le fournisseur du modèle d’IA Claude, et y sont traités pour le compte de ce site.`,
      consentGpu: (n, c) => `Cet assistant est une IA. Pour répondre, vos messages, les fichiers joints et la page consultée sont envoyés à un serveur d’IA de ${n}${c}, qui les traite pour le compte de ce site. Rien n’y est conservé.`,
      consentNote: 'Ne partagez pas de données personnelles sensibles. Vous pouvez retirer votre consentement à tout moment sous « Conversations ».', consentNoteCookies: 'Ne partagez pas de données personnelles sensibles. Vous pouvez retirer votre consentement à tout moment dans les paramètres des cookies.', consentAgree: 'Accepter et commencer', consentCookiebot: c => `Pour utiliser l’assistant IA, autorisez la catégorie « ${c} » dans les paramètres des cookies.`,
      consentWithdraw: 'Retirer le consentement', consentWithdrawConfirm: 'Retirer votre consentement à l’assistant IA ? Vos conversations avec l’IA seront retirées de cet appareil.', consentGiven: d => `Vous avez accepté l’assistant IA le ${d}.`, consentCookies: 'Assistant IA autorisé dans les paramètres des cookies.',
      privacyPolicy: 'Politique de confidentialité', categories: { preferences: 'Préférences', statistics: 'Statistiques', marketing: 'Marketing' }, consentRequired: 'Veuillez d’abord accepter pour que l’assistant puisse lire votre message.', consentChanged: 'Les informations ont changé. Veuillez les lire et accepter à nouveau.' },
    it: { consentTitle: 'Prima di iniziare', withoutAi: 'Senza IA:', privacyAi: 'Le risposte sono generate da un’IA e possono essere sbagliate. I tuoi messaggi non vengono conservati.', privacyApi: 'Le risposte sono generate da Claude, un’IA di Anthropic, e possono essere sbagliate. Questo sito non conserva i tuoi messaggi.', consentApi: (n, c) => `Questo assistente è un’IA. Per rispondere, i tuoi messaggi, i file allegati e la pagina che stai visitando vengono inviati a ${n}${c}, il fornitore del modello di IA Claude, e trattati per conto di questo sito.`,
      consentGpu: (n, c) => `Questo assistente è un’IA. Per rispondere, i tuoi messaggi, i file allegati e la pagina che stai visitando vengono inviati a un server di IA di ${n}${c}, che li tratta per conto di questo sito. Lì non viene conservato nulla.`,
      consentNote: 'Non condividere dati personali sensibili. Puoi revocare il consenso in qualsiasi momento in «Conversazioni».', consentNoteCookies: 'Non condividere dati personali sensibili. Puoi revocare il consenso in qualsiasi momento nelle impostazioni dei cookie.', consentAgree: 'Accetta e inizia', consentCookiebot: c => `Per usare l’assistente IA, consenti la categoria «${c}» nelle impostazioni dei cookie.`,
      consentWithdraw: 'Revoca il consenso', consentWithdrawConfirm: 'Revocare il consenso all’assistente IA? Le tue conversazioni con l’IA verranno rimosse da questo dispositivo.', consentGiven: d => `Hai accettato l’assistente IA il ${d}.`, consentCookies: 'Assistente IA consentito nelle impostazioni dei cookie.',
      privacyPolicy: 'Informativa sulla privacy', categories: { preferences: 'Preferenze', statistics: 'Statistiche', marketing: 'Marketing' }, consentRequired: 'Accetta prima, così l’assistente può leggere il tuo messaggio.', consentChanged: 'Le informazioni sono cambiate. Leggile e accetta di nuovo.' },
  };
  const languageSetting = settings.language || 'auto';
  const pageLanguage = (document.documentElement.lang || navigator.language || 'en').slice(0, 2).toLowerCase();
  const lang = languageSetting !== 'auto' && strings[languageSetting] ? languageSetting : strings[pageLanguage] ? pageLanguage : 'en';
  const t = Object.assign({}, strings.en, strings[lang]);
  t.errors = Object.assign({}, strings.en.errors, strings[lang].errors);
  Object.assign(t, consentStrings.en, consentStrings[lang]);
  // While the site keeps conversations for its team (settings.history = { days, version }): stated in the consent request, with the right to object.
  const historyStrings = {
    en: { deleteConversation: 'Delete conversation', deleteConfirm: 'Delete this conversation? It is also deleted on this website’s server.',
      historyInfo: d => `This website keeps your conversations with the assistant for ${d} days after the last message, without your name or IP address, so its team can check and improve the answers.`,
      historyObject: 'You can object at any time under Conversations with “Stop keeping”: what was kept is deleted, and the assistant keeps working.', consentContinue: 'Continue',
      keepOn: d => `Your conversations are kept for ${d} days so the team can improve the answers.`, keepOff: d => `Your conversations are not kept. You can let this website keep them for ${d} days to help its team improve the answers.`,
      keepStart: 'Keep them', keepStop: 'Stop keeping', keepStopConfirm: 'Stop keeping your conversations? The conversations kept so far are deleted.',
      privacyAiKept: d => `Answers are generated by an AI and can be wrong. Your conversations are kept for ${d} days.`, privacyApiKept: d => `Answers are generated by Claude, an AI by Anthropic, and can be wrong. This website keeps your conversations for ${d} days.` },
    de: { deleteConversation: 'Gespräch löschen', deleteConfirm: 'Dieses Gespräch löschen? Es wird auch auf dem Server dieser Website gelöscht.',
      historyInfo: d => `Diese Website bewahrt deine Gespräche mit dem Assistenten ${d} Tage nach der letzten Nachricht auf, ohne Namen und IP-Adresse, damit ihr Team die Antworten prüfen und verbessern kann.`,
      historyObject: 'Du kannst jederzeit unter «Gespräche» mit «Nicht mehr aufbewahren» widersprechen: Das Aufbewahrte wird gelöscht, und der Assistent funktioniert weiter.', consentContinue: 'Weiter',
      keepOn: d => `Deine Gespräche werden ${d} Tage aufbewahrt, damit das Team die Antworten verbessern kann.`, keepOff: d => `Deine Gespräche werden nicht aufbewahrt. Du kannst der Website erlauben, sie ${d} Tage aufzubewahren, damit ihr Team die Antworten verbessern kann.`,
      keepStart: 'Aufbewahren', keepStop: 'Nicht mehr aufbewahren', keepStopConfirm: 'Gespräche nicht mehr aufbewahren? Die bisher aufbewahrten Gespräche werden gelöscht.',
      privacyAiKept: d => `Antworten werden von einer KI erzeugt und können falsch sein. Deine Gespräche werden ${d} Tage aufbewahrt.`, privacyApiKept: d => `Antworten erzeugt Claude, eine KI von Anthropic. Sie können falsch sein. Diese Website bewahrt deine Gespräche ${d} Tage auf.` },
    fr: { deleteConversation: 'Supprimer la conversation', deleteConfirm: 'Supprimer cette conversation ? Elle est aussi supprimée du serveur de ce site.',
      historyInfo: d => `Ce site conserve vos conversations avec l’assistant pendant ${d} jours après le dernier message, sans votre nom ni votre adresse IP, pour que son équipe puisse vérifier et améliorer les réponses.`,
      historyObject: 'Vous pouvez vous y opposer à tout moment sous « Conversations » avec « Ne plus conserver » : ce qui a été conservé est supprimé, et l’assistant continue de fonctionner.', consentContinue: 'Continuer',
      keepOn: d => `Vos conversations sont conservées ${d} jours pour que l’équipe puisse améliorer les réponses.`, keepOff: d => `Vos conversations ne sont pas conservées. Vous pouvez permettre à ce site de les conserver ${d} jours pour aider son équipe à améliorer les réponses.`,
      keepStart: 'Les conserver', keepStop: 'Ne plus conserver', keepStopConfirm: 'Ne plus conserver vos conversations ? Les conversations conservées jusqu’ici sont supprimées.',
      privacyAiKept: d => `Les réponses sont générées par une IA et peuvent être erronées. Vos conversations sont conservées ${d} jours.`, privacyApiKept: d => `Les réponses sont générées par Claude, une IA d’Anthropic, et peuvent être erronées. Ce site conserve vos conversations ${d} jours.` },
    it: { deleteConversation: 'Elimina la conversazione', deleteConfirm: 'Eliminare questa conversazione? Viene eliminata anche dal server di questo sito.',
      historyInfo: d => `Questo sito conserva le tue conversazioni con l’assistente per ${d} giorni dopo l’ultimo messaggio, senza nome né indirizzo IP, così il suo team può verificare e migliorare le risposte.`,
      historyObject: 'Puoi opporti in qualsiasi momento in «Conversazioni» con «Non conservare più»: quanto conservato viene eliminato, e l’assistente continua a funzionare.', consentContinue: 'Continua',
      keepOn: d => `Le tue conversazioni vengono conservate per ${d} giorni, così il team può migliorare le risposte.`, keepOff: d => `Le tue conversazioni non vengono conservate. Puoi permettere a questo sito di conservarle per ${d} giorni per aiutare il team a migliorare le risposte.`,
      keepStart: 'Conservale', keepStop: 'Non conservare più', keepStopConfirm: 'Non conservare più le tue conversazioni? Le conversazioni conservate finora vengono eliminate.',
      privacyAiKept: d => `Le risposte sono generate da un’IA e possono essere sbagliate. Le tue conversazioni vengono conservate per ${d} giorni.`, privacyApiKept: d => `Le risposte sono generate da Claude, un’IA di Anthropic, e possono essere sbagliate. Questo sito conserva le tue conversazioni per ${d} giorni.` },
  };
  Object.assign(t, historyStrings.en, historyStrings[lang]);
  const historyDays = () => settings.history ? Math.max(1, +settings.history.days || 30) : 0;
  t.errors.consent_required = t.consentRequired;
  const categoryName = c => t.categories[c] || c;
  // The editor's own notice, or the default in the visitor's language (empty from the server while untouched). Conversations are
  // kept unless the visitor objected, so the notice says so already under the consent request.
  const aiNotice = () => settings.privacyNotice || (historyDays() && !state.historyOff ? (settings.engine === 'api' ? t.privacyApiKept : t.privacyAiKept)(historyDays()) : settings.engine === 'api' ? t.privacyApi : t.privacyAi);
  const errorText = (code, fallback) => t.errors[code] || fallback || t.errors.default;
  const number = n => new Intl.NumberFormat(lang).format(Math.round(n));
  const percent = ratio => new Intl.NumberFormat(lang, { style: 'percent' }).format(ratio);
  const compact = n => n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '')}k` : String(Math.round(n));
  const clock = at => new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(new Date(at));
  const relative = at => {
    const seconds = Math.round((at - Date.now()) / 1000), rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' });
    const abs = Math.abs(seconds);
    return abs < 60 ? rtf.format(0, 'second') : abs < 3600 ? rtf.format(Math.round(seconds / 60), 'minute') : abs < 86400 ? rtf.format(Math.round(seconds / 3600), 'hour') : rtf.format(Math.round(seconds / 86400), 'day');
  };
  const teamName = () => team.teamName || t.ourTeam;
  const chatWith = () => escape(team.teamName ? t.chatWithTeam(team.teamName) : t.chatWithOurTeam);
  const days = () => Math.max(1, Math.min(30, +team.days || 3));

  // ---------- markup helpers ----------
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeHref = href => /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(href) ? href : null;
  function inline(text) {
    const code = [];
    let html = escape(text).replace(/`([^`\n]+)`/g, (_, c) => `\u0000${code.push(c) - 1}\u0000`);
    // Models sometimes write a space inside the parentheses: [Contact]( /contact/).
    html = html.replace(/\[([^\]\n]+)\]\(\s*([^)\s]+)\s*\)/g, (match, label, href) => {
      const url = safeHref(href.replace(/&amp;/g, '&'));
      return url ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
    });
    html = html.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, (m, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>').replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, '$1<em>$2</em>');
    // The code spans were taken from the escaped text: insert them as they are.
    return html.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${code[i] ?? ''}</code>`);
  }
  /** Small, safe Markdown subset: paragraphs, lists, code blocks, bold/italic, links. HTML is always escaped. */
  function markdown(source) {
    const blocks = [];
    const lines = String(source || '').replace(/\r/g, '').split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^```/.test(line)) {
        const body = []; i++;
        while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
        i++; blocks.push(`<pre><code>${escape(body.join('\n'))}</code></pre>`); continue;
      }
      if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
        const ordered = /^\s*\d/.test(line); const items = [];
        while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ''))}</li>`);
        blocks.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`); continue;
      }
      if (/^#{1,6}\s+/.test(line)) { blocks.push(`<p><strong>${inline(line.replace(/^#{1,6}\s+/, ''))}</strong></p>`); i++; continue; }
      if (!line.trim()) { i++; continue; }
      const paragraph = [];
      while (i < lines.length && lines[i].trim() && !/^```|^\s*([-*•]|\d+[.)])\s+|^#{1,6}\s+/.test(lines[i])) paragraph.push(inline(lines[i++]));
      blocks.push(`<p>${paragraph.join('<br>')}</p>`);
    }
    return blocks.join('');
  }
  const plain = text => `<p>${escape(text).replace(/\n/g, '<br>')}</p>`;
  /** Removes the handoff marker, including a half-streamed "[[te" at the end of an unfinished answer. */
  const stripMark = (text, streaming) => {
    let out = String(text || '').split(TEAM_MARK).join('');
    if (streaming) {
      for (let n = TEAM_MARK.length - 1; n > 0; n--) if (out.endsWith(TEAM_MARK.slice(0, n))) { out = out.slice(0, -n); break; }
      // Bold that is still being written shows as bold, not as raw asterisks.
      out = out.trimEnd();
      if ((out.match(/\*\*/g) || []).length % 2) out = out.endsWith('**') ? out.slice(0, -2) : out + '**';
    }
    return out.trimEnd();
  };

  // Tabler Icons 3.35.0 (MIT, https://tabler.io/icons), outline set.
  const icons = {
    chat: 'M8 9h8 M8 13h6 M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-5l-5 3v-3h-2a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3h12z',
    sparkle: 'M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2-2a2 2 0 0 1-2-2a2 2 0 0 1-2 2zm0-12a2 2 0 0 1 2 2a2 2 0 0 1 2-2a2 2 0 0 1-2-2a2 2 0 0 1-2 2zm-7 12a6 6 0 0 1 6-6a6 6 0 0 1-6-6a6 6 0 0 1-6 6a6 6 0 0 1 6 6z',
    help: 'M3 12a9 9 0 1 0 18 0a9 9 0 0 0-18 0 M12 16v.01 M12 13a2 2 0 0 0 .914-3.782a1.98 1.98 0 0 0-2.414 .483',
    wave: 'M8 13v-7.5a1.5 1.5 0 0 1 3 0v6.5 M11 5.5v-2a1.5 1.5 0 1 1 3 0v8.5 M14 5.5a1.5 1.5 0 0 1 3 0v6.5 M17 7.5a1.5 1.5 0 0 1 3 0v8.5a6 6 0 0 1-6 6h-2h.208a6 6 0 0 1-5.012-2.7a69.74 69.74 0 0 1-.196-.3c-.312-.479-1.407-2.388-3.286-5.728a1.5 1.5 0 0 1 .536-2.022a1.867 1.867 0 0 1 2.28 .28l1.47 1.47',
    close: 'M18 6l-12 12 M6 6l12 12',
    minimize: 'M6 9l6 6l6-6',
    send: 'M5 12l14 0 M13 18l6-6 M13 6l6 6',
    stop: 'M5 5m0 2a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2z',
    attach: 'M15 7l-6.5 6.5a1.5 1.5 0 0 0 3 3l6.5-6.5a3 3 0 0 0-6-6l-6.5 6.5a4.5 4.5 0 0 0 9 9l6.5-6.5',
    refresh: 'M20 11a8.1 8.1 0 0 0-15.5-2m-.5-4v4h4 M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4',
    pdf: 'M14 3v4a1 1 0 0 0 1 1h4 M17 21h-10a2 2 0 0 1-2-2v-14a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z M9 9l1 0 M9 13l6 0 M9 17l6 0',
    copy: 'M7 7m0 2.667a2.667 2.667 0 0 1 2.667-2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1-2.667 2.667h-8.666a2.667 2.667 0 0 1-2.667-2.667z M4.012 16.737a2.005 2.005 0 0 1-1.012-1.737v-10c0-1.1 .9-2 2-2h10c.75 0 1.158 .385 1.5 1',
    mail: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-14a2 2 0 0 1-2-2v-10z M3 7l9 6l9-6',
    shield: 'M11.46 20.846a12 12 0 0 1-7.96-14.846a12 12 0 0 0 8.5-3a12 12 0 0 0 8.5 3a12 12 0 0 1-.09 7.06 M15 19l2 2l4-4',
    link: 'M9 15l6-6 M11 6l.463-.536a5 5 0 0 1 7.071 7.072l-.534 .464 M13 18l-.397 .534a5.068 5.068 0 0 1-7.127 0a4.972 4.972 0 0 1 0-7.071l.524-.463',
    person: 'M8 7a4 4 0 1 0 8 0a4 4 0 0 0-8 0 M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2',
    team: 'M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2 M16 3.13a4 4 0 0 1 0 7.75 M21 21v-2a4 4 0 0 0-3-3.85',
    chats: 'M21 14l-3-3h-7a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v10 M14 15v2a1 1 0 0 1-1 1h-7l-3 3v-10a1 1 0 0 1 1-1h2',
    back: 'M15 6l-6 6l6 6',
    trash: 'M4 7l16 0 M10 11l0 6 M14 11l0 6 M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12 M9 7v-3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3',
    check: 'M5 12l5 5l10-10',
    plus: 'M12 5l0 14 M5 12l14 0',
    alert: 'M3 12a9 9 0 1 0 18 0a9 9 0 0 0-18 0 M12 8v4 M12 16h.01',
    door: 'M13 12v.01 M3 21h18 M5 21v-16a2 2 0 0 1 2-2h7.5m2.5 10.5v7.5 M14 7h7m-3-3l3 3l-3 3',
    clock: 'M3 12a9 9 0 1 0 18 0a9 9 0 0 0-18 0 M12 7v5l3 3',
  };
  const svg = (name, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" ${extra}><path d="${icons[name] || icons.chat}"/></svg>`;

  // ---------- styles ----------
  const fonts = { inherit: 'inherit', system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", system-ui, sans-serif', serif: 'ui-serif, "Iowan Old Style", Georgia, serif', mono: 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace' };
  const side = look.position === 'right' ? 'right' : 'left';
  const css = `
  :host{all:initial;position:fixed;${side}:var(--lai-x);bottom:var(--lai-y);z-index:${Number(look.zIndex) || 2147483000};font-family:${fonts[look.font] || 'inherit'};font-size:15px;line-height:1.5;color:var(--lai-text);-webkit-font-smoothing:antialiased;
    --lai-x:${+look.offsetX}px;--lai-y:${+look.offsetY}px;--lai-accent:${look.accent};--lai-on-accent:${look.accentText};--lai-bg:${look.background};--lai-surface:${look.surface};--lai-text:${look.text};--lai-muted:${look.mutedText};
    --lai-user:${look.userBubble};--lai-on-user:${look.userText};--lai-bot:${look.assistantBubble};--lai-on-bot:${look.assistantText};--lai-line:color-mix(in srgb,var(--lai-text) 11%,transparent);--lai-radius:${+look.radius}px;--lai-size:${+look.launcherSize}px;
    --lai-w:${+look.panelWidth}px;--lai-h:${+look.panelHeight}px;--lai-shade:color-mix(in srgb,var(--lai-text) 75%,#0b0d14);--lai-ok:#1f9d55;--lai-warn:#d98b00;--lai-off:#9aa0ad;--lai-danger:#c62f3b;--lai-ease:cubic-bezier(.2,.8,.2,1)}
  ${look.colorScheme === 'dark' ? ':host' : look.colorScheme === 'auto' ? '@media (prefers-color-scheme:dark){:host' : ':host(.never)'}{--lai-bg:#121419;--lai-surface:#1c1f27;--lai-text:#eef0f5;--lai-muted:#a3a9b8;--lai-bot:#1f232c;--lai-on-bot:#eef0f5;--lai-line:rgba(255,255,255,.09);--lai-shade:#05060a}${look.colorScheme === 'auto' ? '}' : ''}
  *,*::before,*::after{box-sizing:border-box}
  button,textarea,input{font:inherit;color:inherit}
  button{cursor:pointer;border:0;background:none;padding:0}
  svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round;flex:none}
  :focus-visible{outline:2px solid var(--lai-accent);outline-offset:2px}
  .sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  .launcher-row{display:flex;align-items:center;gap:12px;flex-direction:${side === 'right' ? 'row-reverse' : 'row'}}
  .launcher{position:relative;width:var(--lai-size);height:var(--lai-size);border-radius:999px;background:var(--lai-accent);color:var(--lai-on-accent);display:grid;place-items:center;
    box-shadow:0 10px 30px -8px color-mix(in srgb,var(--lai-accent) 55%,transparent),0 3px 8px color-mix(in srgb,var(--lai-shade) 18%,transparent);transition:transform .25s var(--lai-ease),box-shadow .25s var(--lai-ease)}
  .launcher:hover{transform:translateY(-2px) scale(1.03)}.launcher:active{transform:scale(.96)}
  .launcher svg{width:calc(var(--lai-size)*.44);height:calc(var(--lai-size)*.44);transition:transform .3s var(--lai-ease),opacity .2s}
  .launcher .when-open{position:absolute;opacity:0;transform:rotate(-90deg) scale(.6)}
  :host([open]) .launcher .when-closed{opacity:0;transform:rotate(90deg) scale(.6)}
  :host([open]) .launcher .when-open{opacity:1;transform:none}
  .launcher img{width:100%;height:100%;border-radius:inherit;object-fit:cover}
  .launcher .dot{position:absolute;top:2px;${side === 'right' ? 'left' : 'right'}:2px;width:13px;height:13px;border-radius:50%;border:2.5px solid var(--lai-accent);background:var(--lai-off);transition:background .3s}
  :host([state=ready]) .launcher .dot{background:var(--lai-ok)}:host([state=busy]) .launcher .dot,:host([state=starting]) .launcher .dot,:host([state=degraded]) .launcher .dot{background:var(--lai-warn)}
  .launcher .badge{position:absolute;top:-4px;${side === 'right' ? 'left' : 'right'}:-4px;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--lai-danger);color:#fff;font-size:12px;font-weight:700;display:none;place-items:center;font-variant-numeric:tabular-nums}
  :host([unread]) .launcher .badge{display:grid}
  .label{background:var(--lai-bg);color:var(--lai-text);padding:9px 15px;border-radius:999px;font-weight:600;font-size:14px;box-shadow:0 6px 24px -6px color-mix(in srgb,var(--lai-shade) 25%,transparent);border:1px solid var(--lai-line);white-space:nowrap;cursor:pointer}
  :host([open]) .label{display:none}
  .teaser{position:absolute;bottom:calc(var(--lai-size) + 14px);${side}:0;width:max-content;max-width:min(290px,calc(100vw - 2*var(--lai-x)));background:var(--lai-bg);color:var(--lai-text);border:1px solid var(--lai-line);border-radius:16px;
    border-${side === 'right' ? 'bottom-right' : 'bottom-left'}-radius:5px;padding:12px 34px 12px 14px;box-shadow:0 14px 40px -12px color-mix(in srgb,var(--lai-shade) 35%,transparent);font-size:14px;cursor:pointer;animation:rise .35s var(--lai-ease)}
  .teaser button{position:absolute;top:6px;right:6px;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;color:var(--lai-muted)}.teaser button svg{width:15px;height:15px}
  .teaser.agent{display:flex;gap:10px;align-items:flex-start}.teaser .who{display:block;font-weight:700;font-size:12.5px;margin:0 0 1px}.teaser .text{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .panel{position:absolute;bottom:calc(var(--lai-size) + 16px);${side}:0;width:min(var(--lai-w),calc(100vw - 2*var(--lai-x)));height:min(var(--lai-h),calc(100vh - var(--lai-size) - var(--lai-y) - 40px));
    background:var(--lai-bg);color:var(--lai-text);border-radius:var(--lai-radius);border:1px solid var(--lai-line);display:flex;flex-direction:column;overflow:hidden;
    box-shadow:0 30px 80px -20px color-mix(in srgb,var(--lai-shade) 45%,transparent),0 8px 24px -8px color-mix(in srgb,var(--lai-shade) 20%,transparent);transform-origin:bottom ${side};visibility:hidden;opacity:0;transform:translateY(12px) scale(.96);
    transition:opacity .22s var(--lai-ease),transform .3s var(--lai-ease),visibility 0s .3s}
  :host([open]) .panel{visibility:visible;opacity:1;transform:none;transition:opacity .22s var(--lai-ease),transform .3s var(--lai-ease)}
  header{position:relative;z-index:4;display:flex;align-items:center;gap:10px;padding:14px 10px 12px 16px;background:linear-gradient(180deg,color-mix(in srgb,var(--lai-accent) 9%,var(--lai-bg)),var(--lai-bg));border-bottom:1px solid var(--lai-line)}
  header .back{margin:0 -4px 0 -8px}
  .avatar{position:relative;width:38px;height:38px;border-radius:50%;background:var(--lai-accent);color:var(--lai-on-accent);display:grid;place-items:center;flex:none;overflow:hidden;font-weight:700;font-size:14px;letter-spacing:.02em}
  .avatar img{width:100%;height:100%;object-fit:cover}.avatar svg{width:20px;height:20px}
  .avatars{display:flex;flex:none}.avatars .avatar{box-shadow:0 0 0 2px var(--lai-bg)}.avatars .avatar+.avatar{margin-left:-12px}
  .face{width:28px;height:28px;border-radius:50%;flex:none;display:grid;place-items:center;overflow:hidden;background:color-mix(in srgb,var(--lai-accent) 16%,var(--lai-bg));color:var(--lai-accent);font-size:11px;font-weight:700}
  .face img{width:100%;height:100%;object-fit:cover}.face svg{width:16px;height:16px}
  .title{flex:1;min-width:0}.title strong{display:block;font-size:15.5px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .status{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--lai-muted);white-space:nowrap;min-width:0}.status i{width:7px;height:7px;border-radius:50%;background:var(--lai-off);flex:none}.status .status-text{min-width:0;overflow:hidden;text-overflow:ellipsis}
  .status[data-tone=ok] i{background:var(--lai-ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--lai-ok) 20%,transparent)}.status[data-tone=warn] i{background:var(--lai-warn)}
  .tool{position:relative;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;color:var(--lai-muted);transition:background .15s,color .15s;flex:none}.tool:hover{background:var(--lai-surface);color:var(--lai-text)}
  .tool .pip{position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;background:var(--lai-danger);box-shadow:0 0 0 2px var(--lai-bg);display:none}.tool.has-unread .pip{display:block}
  .meter{display:flex;align-items:center;gap:10px;padding:7px 16px;font-size:11.5px;color:var(--lai-muted);border-bottom:1px solid var(--lai-line);cursor:help}
  .meter .bar{flex:1;height:4px;border-radius:4px;background:var(--lai-surface);overflow:hidden}.meter .fill{height:100%;width:0;border-radius:inherit;background:var(--lai-accent);transition:width .6s var(--lai-ease),background .3s}
  .meter.warn .fill{background:var(--lai-warn)}.meter.full .fill{background:var(--lai-danger)}.meter-text{white-space:nowrap}.meter b{font-weight:600;color:var(--lai-text);font-variant-numeric:tabular-nums}
  .body{position:relative;flex:1;min-height:0;display:flex;flex-direction:column}
  .log,.list,.home{flex:1;overflow-y:auto;overscroll-behavior:contain}
  .log{padding:18px 14px 8px;display:flex;flex-direction:column;gap:12px;scroll-behavior:smooth}
  .log::-webkit-scrollbar,.list::-webkit-scrollbar{width:8px}.log::-webkit-scrollbar-thumb,.list::-webkit-scrollbar-thumb{background:var(--lai-line);border-radius:8px}
  .msg{display:flex;flex-direction:column;max-width:88%;animation:${look.animations ? 'rise .28s var(--lai-ease)' : 'none'}}
  .msg.user{align-self:flex-end;align-items:flex-end}.msg.bot{align-self:flex-start}.log>.still{animation:none!important}
  .msg.agent{flex-direction:row;align-items:flex-end;gap:8px}.msg.agent .stack{display:flex;flex-direction:column;min-width:0}.msg.agent .face{margin-bottom:2px}.msg.agent.follow .face{visibility:hidden}
  .who{font-size:11.5px;font-weight:600;color:var(--lai-muted);margin:0 0 3px 4px}
  .bubble{padding:10px 14px;border-radius:18px;background:var(--lai-bot);color:var(--lai-on-bot);overflow-wrap:anywhere;font-size:14.5px}
  .msg.user .bubble{background:var(--lai-user);color:var(--lai-on-user);border-bottom-right-radius:6px}.msg.bot .bubble{border-bottom-left-radius:6px}
  .msg.agent .bubble{background:var(--lai-bg);color:var(--lai-text);border:1px solid color-mix(in srgb,var(--lai-accent) 28%,var(--lai-line));border-bottom-left-radius:6px}
  .msg.pending .bubble{opacity:.6}.msg.failed .bubble{opacity:.75;box-shadow:inset 0 0 0 1.5px var(--lai-danger)}
  .bubble p{margin:0}.bubble p+p,.bubble p+ul,.bubble p+ol,.bubble ul+p,.bubble ol+p,.bubble pre+p,.bubble p+pre{margin-top:8px}
  .bubble ul,.bubble ol{margin:4px 0;padding-left:20px}.bubble li+li{margin-top:3px}
  .bubble a{color:inherit;text-decoration:underline;text-underline-offset:2px;text-decoration-thickness:1px}
  .bubble code{font-family:ui-monospace,Menlo,monospace;font-size:.88em;padding:1px 5px;border-radius:5px;background:color-mix(in srgb,currentColor 10%,transparent)}
  .bubble pre{margin:6px 0;padding:10px;border-radius:10px;background:color-mix(in srgb,currentColor 8%,transparent);overflow-x:auto;font-size:13px}.bubble pre code{padding:0;background:none}
  .bubble.streaming>:last-child::after{content:'';display:inline-block;width:7px;height:1em;margin-left:2px;vertical-align:-2px;background:currentColor;border-radius:2px;animation:blink 1s steps(2) infinite}
  .meta{display:flex;gap:6px;align-items:center;margin-top:4px;min-height:22px;font-size:11.5px;color:var(--lai-muted);opacity:0;transition:opacity .2s}
  .msg.bot:hover .meta,.msg.bot:focus-within .meta{opacity:1}
  .meta button{display:inline-flex;align-items:center;gap:4px;padding:2px 6px;border-radius:6px;color:var(--lai-muted)}.meta button:hover{background:var(--lai-surface);color:var(--lai-text)}.meta svg{width:14px;height:14px}
  .stamp{font-size:11px;color:var(--lai-muted);margin:3px 6px 0;display:flex;gap:5px;align-items:center}.stamp svg{width:13px;height:13px;color:var(--lai-danger)}.stamp button{color:var(--lai-danger);font-weight:600;text-decoration:underline;font-size:11px}
  .files{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;justify-content:flex-end}
  .file{display:flex;align-items:center;gap:8px;max-width:240px;padding:6px 10px 6px 6px;border-radius:12px;background:var(--lai-surface);border:1px solid var(--lai-line);font-size:12.5px;color:var(--lai-text)}
  .file img{width:36px;height:36px;border-radius:8px;object-fit:cover;flex:none}.file .icon{width:36px;height:36px;border-radius:8px;display:grid;place-items:center;background:color-mix(in srgb,var(--lai-accent) 12%,transparent);color:var(--lai-accent);flex:none}
  .file span{min-width:0}.file b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.file small{color:var(--lai-muted)}
  .file.gone{opacity:.65}.file .x{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;color:var(--lai-muted);margin-left:auto}.file .x:hover{background:var(--lai-bg);color:var(--lai-danger)}.file .x svg{width:13px;height:13px}
  .file.busy .icon{animation:pulse 1.2s infinite}
  .suggestions{display:flex;flex-wrap:wrap;gap:7px;margin-top:2px}
  .suggestions button{padding:7px 12px;border-radius:999px;border:1px solid color-mix(in srgb,var(--lai-accent) 35%,var(--lai-line));color:var(--lai-accent);font-size:13.5px;background:var(--lai-bg);text-align:left;transition:background .15s}
  .suggestions button:hover{background:color-mix(in srgb,var(--lai-accent) 8%,var(--lai-bg))}
  .event{align-self:center;display:flex;align-items:center;gap:7px;max-width:92%;padding:5px 12px;border-radius:999px;background:var(--lai-surface);color:var(--lai-muted);font-size:12px;text-align:left;line-height:1.35;animation:rise .25s var(--lai-ease)}
  .event svg{width:14px;height:14px}.event .face{width:18px;height:18px;font-size:8.5px}.event time{opacity:.75;font-variant-numeric:tabular-nums;white-space:nowrap}
  .event.good{color:color-mix(in srgb,var(--lai-ok) 70%,var(--lai-text));background:color-mix(in srgb,var(--lai-ok) 10%,var(--lai-bg))}
  .event.note{border-radius:14px;padding:9px 12px;align-self:stretch;max-width:none;justify-content:center}
  .card{align-self:stretch;padding:14px;border-radius:16px;border:1px solid color-mix(in srgb,var(--lai-accent) 25%,var(--lai-line));background:linear-gradient(180deg,color-mix(in srgb,var(--lai-accent) 6%,var(--lai-bg)),var(--lai-bg));animation:rise .3s var(--lai-ease)}
  .card h3{margin:0;font-size:14.5px;line-height:1.35;display:flex;gap:8px;align-items:center}.card h3 svg{color:var(--lai-accent)}
  .card p{margin:6px 0 0;font-size:13px;color:var(--lai-muted)}.card .actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
  .presence{display:inline-flex;align-items:center;gap:6px}.presence i{width:7px;height:7px;border-radius:50%;background:var(--lai-off);flex:none}.presence.on i{background:var(--lai-ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--lai-ok) 20%,transparent)}
  .notice{align-self:stretch;display:flex;gap:10px;align-items:flex-start;padding:11px 13px;border-radius:14px;font-size:13.5px;background:var(--lai-surface);border:1px solid var(--lai-line);animation:rise .25s var(--lai-ease)}
  .notice.error{background:color-mix(in srgb,var(--lai-danger) 7%,var(--lai-bg));border-color:color-mix(in srgb,var(--lai-danger) 25%,transparent)}
  .notice .actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
  .chip{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:var(--lai-accent);color:var(--lai-on-accent);font-size:13px;font-weight:600;text-decoration:none;line-height:1.2;transition:filter .15s,background .15s}
  .chip:hover{filter:brightness(1.07)}.chip.ghost{background:var(--lai-bg);color:var(--lai-text);border:1px solid var(--lai-line)}.chip.ghost:hover{background:var(--lai-surface);filter:none}.chip.quiet{background:transparent;color:var(--lai-muted);padding-left:6px;padding-right:6px;margin-left:auto}.chip.quiet:hover{color:var(--lai-text);filter:none}.chip svg{width:15px;height:15px}
  .waiting{align-self:flex-start;display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:18px;border-bottom-left-radius:6px;background:var(--lai-bot);color:var(--lai-on-bot);font-size:13.5px;max-width:88%}
  .typing-row{align-self:flex-start;display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--lai-muted);animation:rise .2s var(--lai-ease)}.typing-row .dots{padding:9px 12px;border-radius:16px;background:var(--lai-surface)}
  .dots{display:inline-flex;gap:4px}.dots i{width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.35;animation:bounce 1.2s infinite}.dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}
  .waiting .progress{display:inline-block;vertical-align:middle;flex:none;width:72px;height:4px;border-radius:4px;background:color-mix(in srgb,currentColor 15%,transparent);overflow:hidden}.waiting .progress b{display:block;height:100%;background:var(--lai-accent);transition:width .4s}
  .queue-pos{font-variant-numeric:tabular-nums}
  .event.note.summary{color:var(--lai-muted)}
  .list{padding:14px 12px 16px}
  .start{display:grid;gap:8px}.list .start{margin-bottom:18px}
  .option{display:flex;align-items:center;gap:12px;width:100%;padding:12px 14px;border-radius:14px;border:1px solid var(--lai-line);background:var(--lai-bg);text-align:left;transition:border-color .15s,background .15s,transform .15s}
  .option:hover{border-color:color-mix(in srgb,var(--lai-accent) 40%,var(--lai-line));background:color-mix(in srgb,var(--lai-accent) 4%,var(--lai-bg))}.option:active{transform:scale(.99)}.tool:active,.chip:active,.btn:active,.x:active,.del:active{transform:scale(.96)}
  .option .icon{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--lai-accent) 12%,var(--lai-bg));color:var(--lai-accent);flex:none}
  .option.primary{background:var(--lai-accent);color:var(--lai-on-accent);border-color:transparent}.option.primary:hover{filter:brightness(1.06);background:var(--lai-accent)}.option.primary .icon{background:color-mix(in srgb,var(--lai-on-accent) 18%,transparent);color:inherit}.option.primary small{color:inherit;opacity:.85}
  .option b{display:block;font-size:14.5px}.option small{display:block;color:var(--lai-muted);font-size:12.5px;line-height:1.35}
  .section-label{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--lai-muted);margin:4px 4px 8px}
  .item{position:relative;display:flex;align-items:center;gap:12px;width:100%;padding:10px 10px 10px 8px;border-radius:12px;text-align:left;transition:background .15s}
  .item:hover,.item:focus-within{background:var(--lai-surface)}.item.current{background:color-mix(in srgb,var(--lai-accent) 7%,var(--lai-bg))}
  .item .open-item{position:absolute;inset:0;border-radius:inherit}
  .item .face{width:38px;height:38px;font-size:13px}.item .face svg{width:19px;height:19px}
  .item .text{flex:1;min-width:0;pointer-events:none}.item .row{display:flex;gap:8px;align-items:baseline}.item b{flex:1;min-width:0;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.item time{font-size:11.5px;color:var(--lai-muted);white-space:nowrap}
  .item .preview{font-size:12.5px;color:var(--lai-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.item.unread b,.item.unread .preview{color:var(--lai-text);font-weight:700}
  .pill{display:inline-block;padding:1px 7px;border-radius:999px;font-size:10.5px;font-weight:700;background:var(--lai-surface);color:var(--lai-muted);margin-right:5px;vertical-align:1px}
  .item:hover .pill{background:var(--lai-bg)}
  .pill.wait{background:color-mix(in srgb,var(--lai-warn) 15%,var(--lai-bg));color:color-mix(in srgb,var(--lai-warn) 70%,var(--lai-text))}.pill.live{background:color-mix(in srgb,var(--lai-ok) 14%,var(--lai-bg));color:color-mix(in srgb,var(--lai-ok) 70%,var(--lai-text))}.pill.new{background:var(--lai-danger);color:#fff}
  .item .del{position:relative;width:30px;height:30px;border-radius:9px;display:grid;place-items:center;color:var(--lai-muted);opacity:0;transition:opacity .15s,background .15s}.item:hover .del,.item:focus-within .del{opacity:1}.item .del:hover{background:var(--lai-bg);color:var(--lai-danger)}.item .del svg{width:16px;height:16px}
  .empty{padding:24px 12px;text-align:center;color:var(--lai-muted);font-size:13.5px}
  .home{padding:20px 14px;display:flex;flex-direction:column;gap:14px}
  .home .hint{font-size:12.5px;color:var(--lai-muted);margin:4px 2px -4px}
  .composer-wrap{padding:10px 12px 12px;border-top:1px solid var(--lai-line);background:var(--lai-bg)}
  .pending{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}.pending:empty{display:none}
  .composer{display:flex;align-items:flex-end;gap:6px;padding:6px;border-radius:calc(var(--lai-radius)*.8);border:1px solid var(--lai-line);background:var(--lai-surface);transition:border-color .15s,box-shadow .15s}
  .composer:focus-within{border-color:color-mix(in srgb,var(--lai-accent) 60%,transparent);box-shadow:0 0 0 3px color-mix(in srgb,var(--lai-accent) 15%,transparent)}
  .composer textarea{flex:1;resize:none;border:0;outline:0;background:transparent;min-height:36px;max-height:140px;padding:7px 4px;font-size:15px;line-height:1.45}
  .composer textarea::placeholder{color:var(--lai-muted)}.composer textarea:focus-visible{outline:0}
  .icon-btn{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;color:var(--lai-muted);flex:none;transition:background .15s,color .15s}.icon-btn:hover:not(:disabled){background:var(--lai-bg);color:var(--lai-text)}
  .send{background:var(--lai-accent);color:var(--lai-on-accent)}.send:hover:not(:disabled){background:var(--lai-accent);color:var(--lai-on-accent);filter:brightness(1.08)}
  .icon-btn:disabled{opacity:.4;cursor:not-allowed}
  .closed-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 8px 8px 14px;border-radius:14px;background:var(--lai-surface);font-size:13px;color:var(--lai-muted)}.closed-bar .chip{white-space:nowrap;flex:none}
  .agree{margin:0;padding:14px 14px 12px}.agree p{color:var(--lai-text);line-height:1.45}.agree .fine{margin-top:7px;font-size:12px;color:var(--lai-muted)}.agree .fine a{font-weight:600}
  .agree .actions{align-items:center;margin-top:12px}.agree .btn{padding:9px 15px;font-size:13.5px}.agree .btn svg{width:17px;height:17px}.agree .btn:active,.consent-row button:active{transform:scale(.96)}
  .agree .alt{display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px;margin-top:12px;padding-top:10px;border-top:1px solid var(--lai-line);font-size:12px;color:var(--lai-muted)}
  .agree .alt .chip{padding:2px 0;background:none;border:0;border-radius:0;color:var(--lai-text);font-size:12.5px}.agree .alt .chip svg{width:15px;height:15px}.agree .alt .chip:hover{background:none;text-decoration:underline;text-underline-offset:2px}
  .agree-error{margin-top:9px;font-size:12.5px;color:var(--lai-danger)}.agree-error[hidden]{display:none}
  .consent-row{display:flex;align-items:center;gap:8px;margin:16px 4px 0;padding-top:12px;border-top:1px solid var(--lai-line);font-size:12px;line-height:1.4;color:var(--lai-muted)}
  .consent-row svg{width:15px;height:15px}.consent-row button{margin-left:auto;flex:none;font-weight:600;color:var(--lai-text);text-decoration:underline;text-underline-offset:2px}
  .footer{display:flex;justify-content:space-between;gap:10px;margin-top:8px;font-size:11.5px;color:var(--lai-muted);line-height:1.45}
  .footer a{color:inherit}.footer .brand{white-space:nowrap}
  .privacy-link{display:inline-flex;align-items:center;gap:3px;margin-left:2px;white-space:nowrap;text-decoration:none;font-weight:600;color:var(--lai-text)!important;opacity:.72;transition:opacity .15s}
  .privacy-link:hover{opacity:1;text-decoration:underline;text-underline-offset:2px}.privacy-link svg{width:12.5px;height:12.5px}
  .drop{position:absolute;inset:0;display:none;place-items:center;background:color-mix(in srgb,var(--lai-bg) 88%,transparent);border:2px dashed var(--lai-accent);border-radius:var(--lai-radius);color:var(--lai-accent);font-weight:600;z-index:3}
  .panel.dragging .drop{display:grid}
  .sheet{position:absolute;inset:0;z-index:6;display:flex;flex-direction:column;justify-content:flex-end;background:color-mix(in srgb,#0d0f16 28%,transparent);animation:fade .2s var(--lai-ease)}
  .sheet-card{max-height:calc(100% - 14px);overflow-y:auto;overscroll-behavior:contain;background:var(--lai-bg);border-radius:calc(var(--lai-radius)*.9) calc(var(--lai-radius)*.9) 0 0;padding:16px 16px 14px;box-shadow:0 -12px 40px -16px color-mix(in srgb,var(--lai-shade) 40%,transparent);animation:slide .3s var(--lai-ease)}
  .sheet-head{display:flex;gap:10px;align-items:flex-start;margin-bottom:12px}.sheet-head>div{flex:1;min-width:0}.sheet-head .tool{margin:-6px -6px 0 0}
  .sheet h2{margin:0;font-size:17px;line-height:1.3;letter-spacing:-.01em}.sheet .sub{margin:4px 0 0;font-size:12.5px;color:var(--lai-muted)}
  .tabs{display:flex;padding:3px;border-radius:12px;background:var(--lai-surface);margin-bottom:12px}.tabs button{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:7px;border-radius:9px;font-size:13.5px;font-weight:600;color:var(--lai-muted)}
  .tabs button[aria-pressed=true]{background:var(--lai-bg);color:var(--lai-text);box-shadow:0 1px 3px color-mix(in srgb,var(--lai-shade) 12%,transparent)}.tabs svg{width:16px;height:16px}
  .sheet form{display:grid;gap:10px}
  .field{display:grid;gap:5px;font-size:13px;font-weight:600}.field em{font-style:normal;font-weight:400;color:var(--lai-muted)}
  .field input,.field textarea{width:100%;border:1px solid var(--lai-line);border-radius:11px;background:var(--lai-surface);padding:10px 12px;font-size:15px;font-weight:400;line-height:1.4;outline:0;transition:border-color .15s,box-shadow .15s,background .15s}
  .field textarea{resize:vertical;min-height:74px;max-height:200px}
  .field input:focus,.field textarea:focus{border-color:color-mix(in srgb,var(--lai-accent) 60%,transparent);box-shadow:0 0 0 3px color-mix(in srgb,var(--lai-accent) 15%,transparent);background:var(--lai-bg)}
  .field.invalid input,.field.invalid textarea{border-color:var(--lai-danger)}.field .err{font-weight:500;font-size:12px;color:var(--lai-danger)}.field .err:empty{display:none}
  .consent{display:flex;gap:9px;align-items:flex-start;font-size:12.5px;line-height:1.4;color:var(--lai-text);cursor:pointer}.agree .kept{display:flex;gap:8px;align-items:flex-start;margin-top:10px}.agree .kept svg{width:16px;height:16px;flex:none;margin-top:2px;color:var(--lai-muted)}.agree .object{margin-top:6px;font-size:12.5px}.consent input{margin:2px 0 0;width:16px;height:16px;accent-color:var(--lai-accent);flex:none}
  .fine{margin:0;font-size:11.5px;line-height:1.45;color:var(--lai-muted)}.fine a{color:inherit}
  .sheet-error{display:none;gap:8px;align-items:flex-start;padding:9px 11px;border-radius:11px;font-size:13px;background:color-mix(in srgb,var(--lai-danger) 8%,var(--lai-bg));color:var(--lai-text)}.sheet-error.on{display:flex}.sheet-error svg{color:var(--lai-danger);width:18px;height:18px}.sheet-error a{color:inherit;font-weight:600}
  .sheet-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:2px}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:10px 16px;border-radius:12px;font-weight:600;font-size:14px;line-height:1.2;transition:filter .15s,background .15s}
  .btn.primary{background:var(--lai-accent);color:var(--lai-on-accent)}.btn.primary:hover:not(:disabled){filter:brightness(1.07)}.btn.ghost{color:var(--lai-muted)}.btn.ghost:hover{background:var(--lai-surface);color:var(--lai-text)}
  .btn:disabled{opacity:.7;cursor:progress}.btn svg{width:17px;height:17px}
  .spinner{width:15px;height:15px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;animation:spin .7s linear infinite}
  .hidden{display:none!important}
  @keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  @keyframes slide{from{transform:translateY(24px);opacity:.4}to{transform:none;opacity:1}}@keyframes fade{from{opacity:0}to{opacity:1}}
  @keyframes bounce{0%,60%,100%{transform:none;opacity:.35}30%{transform:translateY(-4px);opacity:1}}
  @keyframes blink{to{opacity:0}}@keyframes pulse{50%{opacity:.5}}@keyframes spin{to{transform:rotate(360deg)}}
  @media (max-width:520px){
    :host([open]){inset:0;${side}:0;bottom:0}
    :host([open]) .launcher-row{display:none}
    .panel{position:fixed;inset:0;width:100%;height:100%;height:100dvh;border-radius:0;border:0;bottom:0}
    header{padding-top:max(14px,env(safe-area-inset-top))}.composer-wrap{padding-bottom:max(12px,env(safe-area-inset-bottom))}
    textarea,.field input,.field textarea{font-size:16px}.item .del{opacity:1}
  }
  ${look.animations ? '' : '*{animation:none!important;transition:none!important}'}
  @media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}`;

  // ---------- state and storage ----------
  const host = document.createElement('div');
  host.id = 'ligata-ai';
  host.setAttribute('state', 'checking');
  const root = host.attachShadow({ mode: 'open' });
  const storageKey = 'ligata-ai:v2:' + location.host;
  const newId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const blank = kind => ({ id: newId(), kind, title: '', created: Date.now(), updated: Date.now(), messages: [], context: { used: 0, limit: settings.contextLimit || 0 }, team: null, unread: 0 });
  const state = {
    open: false, view: 'chat', status: 'checking', queue: null, pending: [], busy: false, controller: null, conversations: [], activeId: null, kept: [], historyOff: false, answering: null,
    baseTokens: settings.baseTokens || 0, contextLimit: settings.contextLimit || 0, reserveTokens: settings.reserveTokens || 0, lastConfig: 0, teaserShown: false, teamOnline: 0, sheet: null, answerUnread: false,
  };
  // The backoffice preview keeps its conversations in the editor's page memory (it reloads on every settings change).
  const previewStore = preview && window.parent !== window ? window.parent : null;
  function load() {
    try {
      let saved = previewStore ? previewStore.__ligataAIPreviewState : JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (!saved && !previewStore) { // 0.1 kept one conversation per tab
        const old = JSON.parse(sessionStorage.getItem('ligata-ai:' + location.host) || 'null');
        if (old?.messages?.length) saved = { conversations: [{ ...blank('ai'), title: String(old.messages.find(m => m.role === 'user')?.content || '').slice(0, 60), messages: old.messages, context: old.context || { used: 0, limit: 0 } }], open: !!old.open };
        sessionStorage.removeItem('ligata-ai:' + location.host);
      }
      if (!saved || !Array.isArray(saved.conversations)) return;
      // Conversations are forgotten after the same number of days the site closes inactive team chats.
      const cutoff = Date.now() - days() * 86400000;
      state.conversations = saved.conversations.filter(c => c && Array.isArray(c.messages) && (c.updated || 0) > cutoff).sort((a, b) => b.updated - a.updated).slice(0, 12);
      state.activeId = state.conversations.some(c => c.id === saved.activeId) ? saved.activeId : state.conversations[0]?.id || null;
      state.open = !!saved.open; state.view = saved.view === 'list' ? 'list' : 'chat';
      // Keys of kept conversations stay until the server can no longer hold them (at most a year), even after the conversation left the list.
      state.kept = (Array.isArray(saved.kept) ? saved.kept : []).filter(k => k && typeof k.key === 'string' && k.at > Date.now() - 400 * 86400000);
      for (const c of saved.conversations) if (c?.history && !state.kept.some(k => k.key === c.history)) state.kept.push({ key: c.history, at: c.updated || Date.now() });
      state.historyOff = !!saved.historyOff;
    } catch { /* storage unavailable: keep conversations in memory only */ }
  }
  let persistTimer = 0;
  function persist(now) {
    clearTimeout(persistTimer);
    if (!now) { persistTimer = setTimeout(() => persist(true), 300); return; }
    // Attachments are never kept: only their names, marked as gone.
    const conversations = state.conversations.slice(0, 12).map(c => ({ ...c, messages: c.messages.slice(-200).map(m => ({ ...m, files: m.files ? m.files.map(f => ({ kind: f.kind, name: f.name, pages: f.pages, gone: true })) : undefined, pending: undefined })) }));
    const data = { conversations, activeId: state.activeId, open: state.open, view: state.view, kept: state.kept, historyOff: state.historyOff || undefined };
    if (previewStore) { previewStore.__ligataAIPreviewState = data; return; }
    // Visitors who never write anything leave nothing on their device.
    const keep = conversations.some(c => c.messages.length || c.team) || state.kept.length > 0 || state.historyOff;
    try { if (keep) localStorage.setItem(storageKey, JSON.stringify(data)); else localStorage.removeItem(storageKey); } catch { }
  }
  const current = () => state.conversations.find(c => c.id === state.activeId) || null;
  const isTeamChat = c => !!(c?.team && c.team.kind === 'chat');
  const isOpenTeam = c => isTeamChat(c) && c.team.state !== 'closed' && !c.team.gone;
  function touch(c) { c.updated = Date.now(); state.conversations.sort((a, b) => b.updated - a.updated); }
  function startConversation(kind) {
    const c = blank(kind);
    state.conversations.unshift(c);
    // Keep at most 12; drop the oldest finished ones first, never an open team chat.
    while (state.conversations.length > 12) {
      const victim = [...state.conversations].reverse().find(x => !isOpenTeam(x)) || state.conversations.at(-1);
      state.conversations.splice(state.conversations.indexOf(victim), 1);
    }
    state.activeId = c.id;
    return c;
  }

  // ---------- history ----------
  // The site keeps conversations for its team unless the visitor objects (state.historyOff; legitimate interest). With consent, the
  // consent request states the period and its version includes it, so every visitor agrees again when the period changes
  // (consent.history = the period they were told). A site that asks no consent tells visitors under the input. Each kept conversation has
  // a random key; the server stores only its hash, so the key proves that a deletion comes from this browser. Keys stay in
  // state.kept until the server can no longer hold the conversation, also when the conversation has left the list, so "Stop keeping"
  // and a withdrawal always reach every copy. Deletions that do not reach the server are retried on the next page.
  const forgetKey = 'ligata-ai:forget:' + location.host;
  const historyActive = () => !!historyDays() && !preview && (consentConfig ? !!consent && consent.history === settings.history.version : !state.historyOff);
  function historyKey(c) {
    if (!historyActive()) return undefined;
    if (!c.history) {
      const bytes = crypto.getRandomValues(new Uint8Array(24));
      c.history = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    state.kept = [...state.kept.filter(k => k.key !== c.history), { key: c.history, at: Date.now() }].slice(-200);
    return c.history;
  }
  function sendForget(keys) {
    if (!keys.length || previewStore || preview) return;
    const batch = keys.slice(0, 20);
    request('history/delete', { method: 'POST', body: JSON.stringify({ keys: batch }) }).then(response => {
      if (!response.ok) return;
      try {
        const left = (JSON.parse(localStorage.getItem(forgetKey) || '[]') || []).filter(k => !batch.includes(k));
        if (left.length) localStorage.setItem(forgetKey, JSON.stringify(left)); else localStorage.removeItem(forgetKey);
      } catch { }
      if (keys.length > 20) sendForget(keys.slice(20));
    }, () => { /* retried on the next page */ });
  }
  /** Deletes the server's copies of these conversations (keys). */
  function forgetKeys(keys) {
    keys = [...new Set(keys.filter(Boolean))];
    state.kept = state.kept.filter(k => !keys.includes(k.key));
    if (!keys.length || previewStore || preview) return;
    try { localStorage.setItem(forgetKey, JSON.stringify([...new Set([...(JSON.parse(localStorage.getItem(forgetKey) || '[]') || []), ...keys])].slice(-300))); } catch { }
    sendForget(keys);
  }
  /** Every copy this browser knows of: listed conversations and those that left the list but may still be kept. */
  function forgetAllHistory() {
    forgetKeys([...state.conversations.map(c => c.history), ...state.kept.map(k => k.key)]);
    for (const c of state.conversations) delete c.history;
    state.kept = [];
  }
  function retryForget() { try { const keys = JSON.parse(localStorage.getItem(forgetKey) || '[]'); if (Array.isArray(keys)) sendForget(keys.filter(k => typeof k === 'string')); } catch { } }
  /** The visitor objects ("Stop keeping", which deletes what was kept) or takes the objection back. */
  async function chooseHistory(keep) {
    if (!keep) {
      forgetAllHistory();
      if (consentConfig && consent?.id && consent.id !== 'preview' && !previewStore) request('consent/history', { method: 'POST', body: JSON.stringify({ id: consent.id, version: null }) }).catch(() => { });
      if (consent) saveConsent({ ...consent, history: null });
      state.historyOff = true;
    } else if (!consentConfig) state.historyOff = false;
    else {
      if (!consent && cookiebotMode() && cookiebotAllows()) { state.historyOff = false; await recordConsent('cookiebot'); persist(true); return; }
      if (!consent) return;
      if (consent.id === 'preview' || previewStore) { saveConsent({ ...consent, history: settings.history.version }); return; }
      const response = await request('consent/history', { method: 'POST', body: JSON.stringify({ id: consent.id, version: settings.history.version }) });
      if (response.status === 409) { await refreshConfig(true); return; }
      if (response.status === 403) { await consentLost(); return; }
      if (response.ok) saveConsent({ ...consent, history: settings.history.version });
      state.historyOff = false;
    }
    persist(true);
  }
  function historyRow() {
    // Before the consent the request states the period; with Cookiebot allowing, a visitor who objected can take it back here.
    if (!historyDays() || !F.ai || (consentConfig && !consent && !(cookiebotMode() && cookiebotAllows() && state.historyOff))) return '';
    const on = historyActive();
    return `<div class="consent-row">${svg('archive')}<span>${escape(on ? t.keepOn(historyDays()) : t.keepOff(historyDays()))}</span><button type="button" data-keep-history="${on ? 'stop' : 'start'}">${on ? t.keepStop : t.keepStart}</button></div>`;
  }

  // ---------- consent ----------
  // The AI reads nothing before the visitor agreed (settings.consent is null when the site asks no consent).
  // explicit: the button in the chat; cookiebot: the configured Cookiebot category (explicit when Cookiebot is missing).
  // The server records each consent (random id, no IP, no content) and checks the id with every question and file.
  let consentConfig = settings.consent || null;
  const consentKey = 'ligata-ai:consent:' + location.host;
  let consent = null; // { id, version, expires, at, source }
  const cookiebotMode = () => consentConfig?.mode === 'cookiebot' && !!window.Cookiebot;
  const cookiebotAllows = () => window.Cookiebot?.consent?.[consentConfig?.category] === true;
  // A consent given while conversations were kept still covers the assistant once the site stopped keeping them ("….h30").
  const covers = (given, current) => given === current || (!!given && !current.includes('.h') && given.startsWith(current + '.h'));
  // The consent request states how long conversations are kept; with Cookiebot, the chat states it once per period (Continue).
  const historyNotice = () => !!historyDays() && !state.historyOff;
  function sendWithdrawal(id) {
    request('consent/withdraw', { method: 'POST', body: JSON.stringify({ id }) }).then(response => {
      if (!response.ok) return;
      try { if (JSON.parse(localStorage.getItem(consentKey) || 'null')?.withdraw === id) localStorage.removeItem(consentKey); } catch { }
    }, () => { /* retried on the next page */ });
  }
  function loadConsent() {
    try {
      const saved = previewStore ? previewStore.__ligataAIPreviewConsent : JSON.parse(localStorage.getItem(consentKey) || 'null');
      if (saved?.withdraw) { sendWithdrawal(saved.withdraw); return; } // a withdrawal that did not reach the server yet
      if (!consentConfig || !saved) return;
      const valid = Date.parse(saved.expires) > Date.now();
      if (valid && covers(saved.version, consentConfig.version)) consent = saved;
      else if (valid && !previewStore && !preview) recheckConsent(saved);
      else forgetConsent(); // expired: ask again
    } catch { /* storage unavailable: ask in every page view */ }
  }
  /**
   * A consent to another version than this page knows: the page may be older than the consent (a cached page, another tab that
   * agreed after the period changed), so the current settings decide. Otherwise the recipient, "Ask all visitors again" or the
   * period of the history changed: ask again.
   */
  async function recheckConsent(saved) {
    if (!await refreshConfig(true) || consent) return; // unreachable: kept, nobody can ask now anyway
    if (consentConfig && covers(saved.version, consentConfig.version)) consent = saved;
    else {
      try { if (JSON.parse(localStorage.getItem(consentKey) || 'null')?.version !== saved.version) return; } catch { return; }
      state.consentNotice = t.consentChanged;
      forgetConsent();
    }
    if (state.open) { if (!state.busy) render(); else updateComposer(); }
  }
  function saveConsent(value) {
    consent = value;
    if (previewStore) { previewStore.__ligataAIPreviewConsent = value; return; }
    try { localStorage.setItem(consentKey, JSON.stringify(value)); } catch { }
  }
  function forgetConsent() {
    consent = null;
    if (previewStore) { previewStore.__ligataAIPreviewConsent = null; return; }
    try { localStorage.removeItem(consentKey); } catch { }
  }
  /** Withdrawal: the server records it, the browser forgets the consent and the AI conversations. */
  function withdrawConsent() {
    const id = consent?.id;
    forgetConsent();
    if (id && id !== 'preview' && !previewStore) {
      try { localStorage.setItem(consentKey, JSON.stringify({ withdraw: id })); } catch { }
      sendWithdrawal(id);
    }
    if (state.busy) state.controller?.abort();
    forgetAllHistory();
    for (const c of state.conversations.filter(x => !x.team)) { loops.get(c.id)?.abort(); loops.delete(c.id); }
    state.conversations = state.conversations.filter(c => c.team);
    if (!current()) state.activeId = null;
    state.pending = []; state.queuedAsk = '';
    persist(true);
  }
  /** The AI may read this visitor's messages (a Cookiebot consent is recorded on the server with the first question). */
  function aiAllowed() {
    if (!consentConfig) return true;
    return cookiebotMode() ? cookiebotAllows() && (!!consent || !historyNotice()) : !!consent;
  }
  /** Records the consent; with conversations kept, also the period the request stated (none after an objection). */
  async function recordConsent(source) {
    const history = historyNotice() ? settings.history.version : undefined;
    if (previewStore || preview) { saveConsent({ id: 'preview', version: consentConfig.version, expires: new Date(Date.now() + 86400000).toISOString(), at: Date.now(), source, history: history || null }); return; }
    const response = await request('consent', { method: 'POST', body: JSON.stringify({ version: consentConfig.version, source, language: lang, history }) });
    const result = await response.json().catch(() => ({}));
    if (response.status === 409) { await refreshConfig(true); throw Object.assign(new Error(), { code: 'consent_changed' }); }
    if (!response.ok || !result.id) throw Object.assign(new Error(), { code: result.error?.code || 'network' });
    saveConsent({ id: result.id, version: result.version, expires: result.expires, at: Date.now(), source, history: result.history || null });
  }
  /** Before a question or file. False: no consent (the chat shows why). */
  async function ensureConsent() {
    if (!consentConfig || consent) return aiAllowed();
    if (!cookiebotMode() || !aiAllowed()) return false;
    if (state.consenting) return false;
    state.consenting = true;
    try { await recordConsent('cookiebot'); return true; } finally { state.consenting = false; }
  }
  /** The server refused a consent id (withdrawn elsewhere, expired, or the text changed): ask again. */
  async function consentLost() {
    forgetConsent();
    state.consentNotice = t.consentChanged;
    await refreshConfig(true);
    if (!state.busy) render(); else updateComposer();
  }
  const regionName = code => { try { return /^[a-z]{2}$/i.test(code) ? new Intl.DisplayNames([lang], { type: 'region' }).of(code.toUpperCase()) : code; } catch { return code; } };
  function consentCard() {
    const provider = consentConfig.provider || {};
    const country = provider.country ? ` (${regionName(provider.country)})` : '';
    const intro = consentConfig.text ? inline(consentConfig.text) : escape(provider.kind === 'anthropic' ? t.consentApi(provider.name || 'Anthropic', country) : t.consentGpu(provider.name || 'Ligata', country));
    const privacyLink = settings.privacyUrl && safeHref(settings.privacyUrl) ? ` <a href="${escape(settings.privacyUrl)}" target="_blank" rel="noopener">${t.privacyPolicy}</a>` : '';
    const viaCookiebot = cookiebotMode();
    const allowed = viaCookiebot && cookiebotAllows(); // Cookiebot covers the AI; only the period is left to confirm
    const others = contactActions(true);
    // The period conversations are kept for, and the right to object, separately from the rest (Art. 21(4) GDPR).
    const kept = historyDays() ? state.historyOff ? `<p class="kept">${svg('archive')}<span>${escape(t.keepOff(historyDays()))}</span></p>`
      : `<p class="kept">${svg('archive')}<span>${escape(t.historyInfo(historyDays()))}</span></p><p class="object">${escape(t.historyObject)}</p>` : '';
    return `<h3>${svg('shield')}<span id="lai-consent-title">${t.consentTitle}</span></h3>
      <p>${intro}</p>
      ${kept}
      <p class="fine">${escape(viaCookiebot ? t.consentNoteCookies : t.consentNote)}${privacyLink}</p>
      ${viaCookiebot && !allowed ? `<p class="fine">${escape(t.consentCookiebot(categoryName(consentConfig.category)))}</p>` : ''}
      <div class="agree-error" role="alert" ${state.consentNotice ? '' : 'hidden'}>${escape(state.consentNotice || '')}</div>
      <div class="actions">${viaCookiebot && !allowed ? `<button type="button" class="btn primary" data-cookie-settings>${t.cookieSettings}</button>` : `<button type="button" class="btn primary" data-agree>${svg('check')}${viaCookiebot ? t.consentContinue : t.consentAgree}</button>`}</div>
      ${others ? `<div class="alt"><span>${t.withoutAi}</span>${others}</div>` : ''}`;
  }
  async function agree(button) {
    button.disabled = true;
    try { await recordConsent(cookiebotMode() ? 'cookiebot' : 'chat'); }
    catch (error) {
      state.consentNotice = error.code === 'consent_changed' ? t.consentChanged : errorText(error.code);
      updateComposer();
      const again = root.querySelector('[data-agree]'); if (again) again.disabled = false;
      return;
    }
    state.consentNotice = '';
    render();
    if (state.queuedAsk) { input.value = state.queuedAsk; state.queuedAsk = ''; autosize(); updateComposer(); }
    input.focus({ preventScroll: true });
  }
  function consentRow() {
    if (!consentConfig || !F.ai) return '';
    if (cookiebotMode()) return cookiebotAllows() ? `<div class="consent-row">${svg('shield')}<span>${escape(t.consentCookies)}</span><button type="button" data-cookie-settings>${t.cookieSettings}</button></div>` : '';
    if (!consent) return '';
    const day = new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(new Date(consent.at || Date.now()));
    return `<div class="consent-row">${svg('shield')}<span>${escape(t.consentGiven(day))}</span><button type="button" data-withdraw-consent>${t.consentWithdraw}</button></div>`;
  }

  // ---------- skeleton ----------
  const name = settings.name || 'Assistant';
  const botAvatar = settings.avatarUrl ? `<img src="${escape(settings.avatarUrl)}" alt="">` : look.launcherIcon !== 'avatar' ? svg(look.launcherIcon) : escape(name.slice(0, 1));
  root.innerHTML = `<style>${css}</style>
    <div class="panel" role="dialog" aria-modal="false" aria-label="${escape(name)}">
      <header>
        <button class="tool back hidden" data-action="back" title="${t.back}" aria-label="${t.back}">${svg('back')}</button>
        <div class="who-box"></div>
        <div class="title"><strong class="title-text"></strong><span class="status"><i></i><span class="status-text">${t.checking}</span></span></div>
        <button class="tool person hidden" data-action="team" title="${t.talkToTeam}" aria-label="${t.talkToTeam}">${svg('person')}</button>
        <button class="tool chats" data-action="list" title="${t.conversations}" aria-label="${t.conversations}">${svg('chats')}<span class="pip"></span></button>
        <button class="tool" data-action="close" title="${t.minimize}" aria-label="${t.minimize}">${svg('minimize')}</button>
      </header>
      <div class="meter hidden" role="meter" aria-label="${t.memory}" aria-valuemin="0" aria-valuemax="100"><span>${t.memory}</span><div class="bar"><div class="fill"></div></div><span class="meter-text"></span><span class="sr"></span></div>
      <div class="body">
        <div class="log" role="log" aria-live="polite" aria-relevant="additions"></div>
        <div class="list hidden" role="region" aria-label="${t.conversations}"></div>
        <div class="home hidden"></div>
        <div class="composer-wrap">
          <form class="composer-form" novalidate>
            <div class="pending"></div>
            <div class="composer">
              <button type="button" class="icon-btn attach" title="${t.attach}" aria-label="${t.attach}">${svg('attach')}</button>
              <input type="file" class="sr" tabindex="-1" multiple accept="${[settings.allowImages ? 'image/png,image/jpeg,image/webp' : '', settings.allowPdfs ? 'application/pdf,.pdf' : ''].filter(Boolean).join(',')}">
              <label class="sr" for="lai-input">${t.placeholder}</label>
              <textarea id="lai-input" rows="1" maxlength="${limits.maxMessageCharacters}"></textarea>
              <button type="submit" class="icon-btn send" title="${t.send}" aria-label="${t.send}">${svg('send')}</button>
            </div>
          </form>
          <div class="card agree hidden" role="region" aria-labelledby="lai-consent-title"></div>
          <div class="closed-bar hidden"><span></span><button type="button" class="chip" data-action="new">${svg('plus')}${t.newChat}</button></div>
          <div class="footer"><span class="privacy"><span class="privacy-text">${escape(F.ai ? aiNotice() : settings.privacyNotice || '')}</span>${settings.privacyUrl ? ` <a class="privacy-link" href="${escape(safeHref(settings.privacyUrl) || '#')}" target="_blank" rel="noopener">${svg('shield')}<span>${t.privacy}</span></a>` : ''}</span>${look.showBranding ? `<span class="brand">${F.ai ? (settings.engine === 'api' ? t.poweredByApi : t.poweredBy) : t.poweredByTeam}</span>` : ''}</div>
        </div>
      </div>
      <div class="drop">${t.dropHere}</div>
    </div>
    <div class="launcher-row">
      <button class="launcher" aria-expanded="false" aria-label="${t.open}">
        ${look.launcherIcon === 'avatar' && settings.avatarUrl ? `<span class="when-closed" style="display:contents"><img src="${escape(settings.avatarUrl)}" alt=""></span>` : svg(look.launcherIcon, 'class="when-closed"')}
        ${svg('close', 'class="when-open"')}<span class="dot"></span><span class="badge">1</span>
      </button>
      ${look.launcherLabel ? `<span class="label" role="presentation">${escape(look.launcherLabel)}</span>` : ''}
    </div>`;
  const $ = selector => root.querySelector(selector);
  const panel = $('.panel'), log = $('.log'), list = $('.list'), home = $('.home'), input = $('textarea'), form = $('.composer-form'), fileInput = $('input[type=file]'), launcher = $('.launcher'), sendButton = $('.send'), pendingList = $('.pending'), body = $('.body');

  // ---------- faces ----------
  const avatarUrl = agent => agent?.photo && agent.id ? `${api}/agents/${encodeURIComponent(agent.id)}/avatar?v=${encodeURIComponent(agent.v || '')}` : null;
  function face(agent, cls = 'face') {
    const url = avatarUrl(agent);
    const fallback = agent?.initials ? escape(agent.initials) : svg('team');
    return `<span class="${cls}">${url ? `<img src="${escape(url)}" alt="" data-fallback="${escape(agent?.initials || '')}">` : fallback}</span>`;
  }
  // Broken avatar images (photo removed meanwhile) fall back to initials.
  root.addEventListener('error', event => { const img = event.target; if (img?.dataset?.fallback !== undefined) img.replaceWith(document.createTextNode(img.dataset.fallback)); }, true);
  const agentName = agent => agent?.name || teamName();

  // ---------- header and status ----------
  function aiStatus() {
    return { ready: [t.online, 'ok'], busy: [t.busy, 'warn'], starting: [t.starting, 'warn'], degraded: [t.degraded, 'warn'], offline: [t.offline, ''], disabled: [t.offline, ''], checking: [t.checking, ''] }[state.status] || [t.offline, ''];
  }
  const teamStatus = () => state.teamOnline > 0 ? [t.teamOnline(state.teamOnline), 'ok'] : [t.teamOfflineShort, ''];
  /** The AI's status, always marked as an AI (AI Act Art. 50): the name and every text are the site's to choose. */
  const aiHeader = () => { const [text, tone] = aiStatus(); return [`${t.statusAI} · ${text}`, tone]; };
  function renderHeader() {
    const c = current();
    const inList = state.view === 'list', inHome = state.view === 'home';
    let avatarHtml, title, status;
    if (inList) { avatarHtml = `<div class="avatar">${svg('chats')}</div>`; title = t.conversations; status = F.ai ? aiStatus() : teamStatus(); }
    else if (inHome || !c) { avatarHtml = `<div class="avatar">${F.ai ? botAvatar : svg('team')}</div>`; title = F.ai ? name : teamName(); status = F.ai ? aiHeader() : teamStatus(); }
    else if (c.team) {
      const agents = c.team.agents || [];
      if (c.team.kind === 'email') { avatarHtml = `<div class="avatar">${svg('mail')}</div>`; title = teamName(); status = [t.statusSent, 'ok']; }
      else if (agents.length && c.team.state !== 'closed') {
        avatarHtml = `<div class="avatars">${agents.slice(0, 3).map(a => face(a, 'avatar')).join('')}</div>`;
        title = agents.some(a => a.name) ? agents.map(agentName).filter((v, i, all) => all.indexOf(v) === i).join(', ') : teamName();
        status = c.team.typing?.length ? [t.typingNow, 'ok'] : [agents.some(a => a.name) ? `${t.teamHere} · ${teamName()}` : t.teamHere, 'ok'];
      } else {
        avatarHtml = `<div class="avatar">${svg('team')}</div>`; title = teamName();
        status = c.team.state === 'closed' || c.team.gone ? [t.statusClosed, ''] : state.teamOnline > 0 ? [t.teamOnline(state.teamOnline), 'ok'] : [t.teamOfflineShort, ''];
      }
    } else { avatarHtml = `<div class="avatar">${botAvatar}</div>`; title = name; status = aiHeader(); }
    $('.who-box').innerHTML = avatarHtml;
    $('.title-text').textContent = title;
    $('.status-text').textContent = status[0];
    $('.status').dataset.tone = status[1];
    $('.back').classList.toggle('hidden', !(inList && current()) && !(inHome && state.conversations.length));
    $('.person').classList.toggle('hidden', !(F.chat || F.email) || team.button === false || inList || inHome || !!c?.team || !F.ai);
    const otherUnread = state.conversations.some(x => x.unread && (x.id !== state.activeId || inList));
    $('.chats').classList.toggle('has-unread', otherUnread);
    $('.chats').classList.toggle('hidden', inList);
  }

  function setStatus(status, queue) {
    state.status = status; state.queue = queue || null;
    host.setAttribute('state', F.ai ? status : state.teamOnline > 0 ? 'ready' : 'away');
    renderHeader();
    updateComposer();
  }

  function updateMeter() {
    const c = current();
    const show = look.showContextMeter && F.ai && state.view === 'chat' && c && !c.team && c.kind === 'ai' && aiAllowed();
    $('.meter').classList.toggle('hidden', !show);
    if (!show) return;
    const pendingTokens = state.pending.reduce((n, f) => n + (f.tokens || 0), 0) + estimate(input.value);
    const { limit, used, room } = memory(c, pendingTokens);
    if (!limit) return;
    // Full means "summarized before the next answer": the bar reaches the end where the summary starts.
    const ratio = Math.min(1, used / room);
    const meter = $('.meter');
    $('.fill').style.width = `${Math.max(2, ratio * 100)}%`;
    // Visitors see how full the memory is; the backoffice preview also shows the tokens.
    $('.meter-text').innerHTML = preview ? `<b>${compact(used)}</b> / ${compact(limit)}` : `<b>${percent(ratio)}</b>`;
    meter.classList.toggle('warn', ratio > .75 && ratio <= .92); meter.classList.toggle('full', ratio > .92);
    meter.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    const help = t.memoryHelp(percent(ratio)) + (preview ? ` (${number(used)} / ${number(limit)} tokens)` : '');
    meter.title = help;
    $('.meter .sr').textContent = help;
  }

  const scrollDown = force => { if (force || log.scrollHeight - log.scrollTop - log.clientHeight < 160) log.scrollTop = log.scrollHeight; };

  // ---------- messages ----------
  function fileChip(file, removable) {
    const thumb = file.kind === 'image' && file.preview ? `<img src="${file.preview}" alt="">` : `<span class="icon">${svg(file.kind === 'image' ? 'attach' : 'pdf')}</span>`;
    const detail = file.gone ? t.notKept : file.error ? escape(file.error) : file.busy ? t.processing : file.kind === 'document' ? t.pages(file.pages || 1) + (preview ? ` · ${t.tokens(compact(file.tokens || 0))}` : '') : preview ? t.tokens(compact(file.tokens || 280)) : t.image;
    return `<div class="file ${file.gone ? 'gone' : ''} ${file.busy ? 'busy' : ''}">${thumb}<span><b>${escape(file.name)}</b><small>${detail}</small></span>${removable ? `<button type="button" class="x" data-remove="${file.id}" aria-label="${t.removeAttachment}">${svg('close')}</button>` : ''}</div>`;
  }

  function eventText(m) {
    const n = m.agent?.name;
    switch (m.event) {
      case 'join': return [n ? t.joined(n) : t.joinedAnon, 'good', m.agent];
      case 'leave': return [n ? t.left(n) : t.leftAnon, '', m.agent];
      case 'close': return [m.reason === 'inactive' ? t.closedInactive : m.reason === 'visitor' ? t.closedYou : t.closedTeam, '', null];
      case 'reopen': return [t.reopened, '', null];
      case 'request': return [t.requested, '', null];
      case 'waiting': return [m.content, 'good note', null];
      case 'email-sent': return [t.emailSent(m.content), 'good note', null];
      case 'preview': return [t.previewSent, 'note', null];
      case 'compacted': return [t.compacted, 'note summary', null];
      default: return [m.content || '', '', null];
    }
  }

  function messageNode(message, previous) {
    const node = document.createElement('div');
    if (message.role === 'system') {
      const [text, tone, agent] = eventText(message);
      node.className = `event ${tone}`;
      node.innerHTML = `${agent ? face(agent) : svg(tone.includes('good') ? 'check' : message.event === 'close' ? 'door' : message.event === 'request' ? 'person' : message.event === 'compacted' ? 'sparkle' : 'team')}<span>${escape(text)}</span>${message.at && !tone.includes('note') ? `<time>${clock(message.at)}</time>` : ''}`;
      return node;
    }
    if (message.role === 'user') {
      node.className = `msg user ${message.pending ? 'pending' : ''} ${message.failed ? 'failed' : ''}`;
      node.innerHTML = `${message.files?.length ? `<div class="files">${message.files.map(f => fileChip(f, false)).join('')}</div>` : ''}${message.content ? `<div class="bubble">${plain(message.content)}</div>` : ''}${message.failed ? `<div class="stamp">${svg('alert')}${t.notSent} · <button type="button" data-resend="${escape(message.clientId || '')}">${t.retry}</button></div>` : ''}`;
      return node;
    }
    if (message.role === 'agent') {
      const follow = previous?.role === 'agent' && (previous.agent?.id || previous.agent?.name || '') === (message.agent?.id || message.agent?.name || '');
      node.className = `msg bot agent ${follow ? 'follow' : ''}`;
      node.innerHTML = `${face(message.agent)}<div class="stack">${follow ? '' : `<span class="who">${escape(agentName(message.agent))}${message.via === 'email' ? ` · ${t.viaEmail}` : ''}</span>`}<div class="bubble">${plain(message.content)}</div></div>`;
      return node;
    }
    node.className = 'msg bot';
    if (message.at) node.dataset.at = message.at;
    node.innerHTML = `<div class="bubble">${markdown(stripMark(message.content))}</div><div class="meta"><button type="button" data-copy>${svg('copy')}<span>${t.copy}</span></button></div>`;
    node.querySelector('[data-copy]').addEventListener('click', event => {
      const label = event.currentTarget.querySelector('span');
      navigator.clipboard?.writeText(stripMark(message.content)).then(() => { label.textContent = t.copied; setTimeout(() => { label.textContent = t.copy; }, 1500); }).catch(() => {});
    });
    return node;
  }

  /** A way to reach a person when the AI cannot answer: live chat or the email form, otherwise the contact email or page. */
  const canHandOff = () => F.chat || F.email || !!settings.fallbackEmail || !!(settings.fallbackUrl && safeHref(settings.fallbackUrl));

  /** "Talk to our team?" under an answer the AI could not give. */
  function handoffCard(c) {
    const node = document.createElement('div');
    node.className = 'card handoff';
    const online = state.teamOnline > 0;
    const channel = F.chat || F.email;
    node.innerHTML = `<h3>${svg('team')}${t.handoffTitle}</h3>
      <p><span class="presence ${online && F.chat ? 'on' : ''}"><i></i><span class="presence-text">${F.chat ? (online ? `${t.teamOnline(state.teamOnline)} · ${t.teamFast}` : t.teamOffline) : F.email ? escape(contact.intro || t.emailIntro) : t.contactIntro}</span></span></p>
      <div class="actions">${channel ? `${F.chat ? `<button type="button" class="chip" data-open-sheet="chat">${svg('chat')}${online ? chatWith() : t.leaveMessage}</button>` : ''}${F.email ? `<button type="button" class="chip ${F.chat ? 'ghost' : ''}" data-open-sheet="email">${svg('mail')}${t.sendEmail}</button>` : ''}` : contactActions()}<button type="button" class="chip quiet" data-dismiss-handoff>${t.noThanks}</button></div>`;
    node.querySelector('[data-dismiss-handoff]').addEventListener('click', () => { c.handoffDismissed = true; node.remove(); persist(); });
    return node;
  }

  function typingRow(c) {
    const names = c.team?.typing || [];
    if (!names.length || !isOpenTeam(c)) return null;
    const agent = (c.team.agents || []).find(a => a.name && names.includes(a.name)) || c.team.agents?.[0];
    const node = document.createElement('div');
    node.className = 'typing-row';
    node.innerHTML = `${face(agent)}<span class="dots"><i></i><i></i><i></i></span><span>${escape(names[0] ? t.isTyping(names[0]) : t.teamTyping)}</span>`;
    return node;
  }

  function renderLog() {
    const c = current();
    log.innerHTML = '';

    if (!c) return;
    if (c.kind === 'ai') {
      if (settings.greeting) { const node = messageNode({ role: 'assistant', content: settings.greeting }); node.querySelector('.meta').remove(); log.append(node); }
      if (!c.messages.length && settings.suggestions?.length && F.ai && aiAllowed()) {
        const suggestions = document.createElement('div');
        suggestions.className = 'suggestions';
        suggestions.innerHTML = settings.suggestions.map(s => `<button type="button">${escape(s)}</button>`).join('');
        suggestions.addEventListener('click', event => { const button = event.target.closest('button'); if (button) send(button.textContent); });
        log.append(suggestions);
      }
    }
    let previous = null;
    for (const message of c.messages) { log.append(messageNode(message, previous)); previous = message; }
    const last = c.messages.at(-1);
    if (last?.role === 'assistant' && last.handoff && !c.team && !c.handoffDismissed && canHandOff() && team.suggest !== false) log.append(handoffCard(c));
    const typing = typingRow(c);
    if (typing) log.append(typing);
    // An answer still on its way: its place in line, "Thinking…" or "Reading…" stay visible.
    if (state.waitingRow && state.answering === c) log.append(state.waitingRow);
    if (c.kind === 'ai' && !c.team && ['offline', 'disabled'].includes(state.status) && F.ai) showOffline();
    // Only new messages animate in; a full redraw (switching conversations) appears at once.
    for (const child of log.children) child.classList.add('still');
    scrollDown(true);
  }

  function appendMessage(c, message) {
    if (c.id !== state.activeId || state.view !== 'chat') return;
    log.querySelector('.typing-row')?.remove();
    const previous = c.messages[c.messages.indexOf(message) - 1];
    log.append(messageNode(message, previous));
    const typing = typingRow(c);
    if (typing) log.append(typing);
    scrollDown(message.role === 'user');
  }

  function notice(html, kind = '') {
    log.querySelectorAll('.notice.transient').forEach(n => n.remove());
    const node = document.createElement('div');
    node.className = `notice transient ${kind}`;
    node.innerHTML = html;
    log.append(node);
    scrollDown(true);
    return node;
  }

  /** Ways to reach a person: the team channels when enabled, otherwise the configured email/contact page. */
  function contactActions(quiet) {
    const actions = [];
    const strong = quiet ? 'ghost' : '';
    if (F.chat) actions.push(`<button type="button" class="chip ${strong}" data-open-sheet="chat">${svg('chat')}${chatWith()}</button>`);
    if (F.email) actions.push(`<button type="button" class="chip ${F.chat || quiet ? 'ghost' : ''}" data-open-sheet="email">${svg('mail')}${t.sendEmail}</button>`);
    if (!actions.length && settings.fallbackEmail) actions.push(`<a class="chip ${strong}" href="mailto:${escape(settings.fallbackEmail)}">${svg('mail')}${t.email}</a>`);
    if (!F.chat && settings.fallbackUrl && safeHref(settings.fallbackUrl)) actions.push(`<a class="chip ghost" href="${escape(settings.fallbackUrl)}">${svg('link')}${t.contact}</a>`);
    return actions.join('');
  }

  function showOffline() {
    const node = notice(`<div><div>${escape(state.status === 'disabled' ? t.errors.disabled : settings.fallbackMessage || t.errors.model_unavailable)}</div><div class="actions">${contactActions()}<button type="button" class="chip ghost" data-reconnect>${svg('refresh')}${t.reconnect}</button></div></div>`);
    node.dataset.offline = '';
    node.querySelector('[data-reconnect]').addEventListener('click', () => refreshConfig(true));
  }

  function showError(code, message, retry) {
    const offline = ['network', 'gateway_unavailable', 'model_unavailable'].includes(code);
    const node = notice(`<div><div>${escape(errorText(code, message))}</div><div class="actions">${code === 'context_full' ? `<button type="button" class="chip" data-new>${svg('plus')}${t.newChat}</button>` : ''}${retry ? `<button type="button" class="chip ${code === 'context_full' ? 'ghost' : ''}" data-retry>${svg('refresh')}${t.retry}</button>` : ''}${offline ? contactActions() : ''}</div></div>`, 'error');
    node.querySelector('[data-retry]')?.addEventListener('click', () => { node.remove(); retry(); });
    node.querySelector('[data-new]')?.addEventListener('click', () => newConversation());
  }

  // ---------- list and home ----------
  function itemPill(c) {
    if (!c.team) return '';
    if (c.team.kind === 'email') return `<span class="pill">${t.statusSent}</span>`;
    if (c.team.state === 'closed' || c.team.gone) return `<span class="pill">${t.statusClosed}</span>`;
    if (c.unread) return `<span class="pill new">${t.statusReplied}</span>`;
    if (c.team.agents?.length) return `<span class="pill live">${t.statusActive}</span>`;
    return `<span class="pill wait">${t.statusWaiting}</span>`;
  }
  function itemPreview(c) {
    const m = [...c.messages].reverse().find(x => x.role !== 'system') || c.messages.at(-1);
    if (!m) return '';
    if (m.role === 'system') return eventText(m)[0];
    const who = m.role === 'user' ? `${t.you}: ` : m.role === 'agent' ? `${agentName(m.agent)}: ` : '';
    const text = stripMark(m.content || (m.files?.length ? m.files.map(f => f.name).join(', ') : ''))
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
    return who + text;
  }
  function itemFace(c) {
    if (!c.team) return `<span class="face">${svg('sparkle')}</span>`;
    if (c.team.kind === 'email') return `<span class="face">${svg('mail')}</span>`;
    const agent = c.team.agents?.[0] || [...c.messages].reverse().find(m => m.role === 'agent')?.agent;
    return agent ? face(agent) : `<span class="face">${svg('team')}</span>`;
  }

  function startOptions() {
    const online = state.teamOnline > 0;
    const options = [];
    if (F.ai) options.push(`<button type="button" class="option primary" data-action="new"><span class="icon">${svg('plus')}</span><span><b>${t.newChat}</b><small>${escape(name)}</small></span></button>`);
    if (F.chat) options.push(`<button type="button" class="option ${!F.ai ? 'primary' : ''}" data-open-sheet="chat"><span class="icon">${svg('chat')}</span><span><b>${online ? chatWith() : t.leaveMessage}</b><small><span class="presence ${online ? 'on' : ''}"><i></i>${online ? `${t.teamOnline(state.teamOnline)} · ${t.teamFast}` : t.teamOffline}</span></small></span></button>`);
    if (F.email) options.push(`<button type="button" class="option ${!F.ai && !F.chat ? 'primary' : ''}" data-open-sheet="email"><span class="icon">${svg('mail')}</span><span><b>${escape(contact.title || t.sendEmail)}</b><small>${escape(contact.intro || t.emailIntro)}</small></span></button>`);
    return options.join('');
  }

  function renderList() {
    const items = state.conversations.filter(c => c.messages.length || c.team);
    list.innerHTML = `<div class="start">${startOptions()}</div>
      ${items.length ? `<div class="section-label">${t.conversations}</div>` : `<div class="empty">${t.emptyList}</div>`}
      ${items.map(c => `<div class="item ${c.unread ? 'unread' : ''} ${c.id === state.activeId ? 'current' : ''}">
          <button type="button" class="open-item" data-open="${c.id}" aria-label="${escape(c.title || t.newChat)}"></button>
          ${itemFace(c)}<div class="text"><div class="row"><b>${escape(c.title || (c.team?.kind === 'email' ? t.sendEmail : t.newChat))}</b><time>${relative(c.updated)}</time></div><div class="preview">${itemPill(c)}${escape(itemPreview(c))}</div></div>
          <button type="button" class="del" data-remove-conversation="${c.id}" title="${isOpenTeam(c) ? t.endChat : c.history ? t.deleteConversation : t.remove}" aria-label="${isOpenTeam(c) ? t.endChat : c.history ? t.deleteConversation : t.remove}">${svg(isOpenTeam(c) ? 'door' : 'trash')}</button></div>`).join('')}
      ${consentRow()}${historyRow()}`;
  }

  function renderHome() {
    home.innerHTML = `<div class="msg bot"><div class="bubble">${markdown(settings.greeting || t.homeGreeting)}</div></div><div class="hint">${t.homeHint}</div><div class="start">${startOptions()}</div>`;
  }

  function render() {
    if (state.view === 'chat' && !current()) { if (F.ai) startConversation('ai'); else state.view = 'home'; }
    log.classList.toggle('hidden', state.view !== 'chat');
    list.classList.toggle('hidden', state.view !== 'list');
    home.classList.toggle('hidden', state.view !== 'home');
    if (state.view === 'chat') renderLog();
    if (state.view === 'list') renderList();
    if (state.view === 'home') renderHome();
    renderHeader(); updateComposer(); updateMeter(); updateBadge();
  }

  function updateComposer() {
    const c = current();
    const chat = state.view === 'chat' && !!c;
    const teamChat = isTeamChat(c);
    const closed = chat && !!c.team && (c.team.state === 'closed' || !!c.team.gone || c.team.kind === 'email');
    const aiOff = chat && !c.team && !F.ai;
    const needsConsent = chat && !c.team && F.ai && !aiAllowed();
    form.classList.toggle('hidden', !chat || closed || aiOff || needsConsent);
    const card = $('.agree');
    card.classList.toggle('hidden', !needsConsent);
    if (needsConsent) { const html = consentCard(); if (card.dataset.html !== html) { card.innerHTML = html; card.dataset.html = html; } }
    $('.closed-bar').classList.toggle('hidden', !(chat && closed));
    // Team conversations are stored (that is their purpose); the AI notice may say the opposite.
    $('.privacy-text').textContent = chat && c.team ? (c.team.kind === 'email' ? t.storedEmail : team.privacyNotice || t.stored(days())) : F.ai ? aiNotice() : settings.privacyNotice || (F.chat ? team.privacyNotice || t.stored(days()) : t.storedEmail);
    if (chat && closed) $('.closed-bar span').textContent = c.team.kind === 'email' ? t.emailSentShort : t.closedNotice;
    const unavailable = !teamChat && ['offline', 'disabled'].includes(state.status) && !preview;
    const working = state.pending.some(f => f.busy);
    input.disabled = unavailable;
    input.placeholder = teamChat ? t.placeholderTeam : settings.inputPlaceholder || t.placeholder;
    const busy = state.busy && !teamChat;
    sendButton.disabled = !busy && (unavailable || working || (!input.value.trim() && !state.pending.length));
    sendButton.innerHTML = busy ? svg('stop') : svg('send');
    sendButton.title = sendButton.ariaLabel = busy ? t.stop : t.send;
    const attach = $('.attach');
    attach.classList.toggle('hidden', teamChat || !(settings.allowImages || settings.allowPdfs));
    attach.disabled = unavailable || state.busy;
    pendingList.innerHTML = teamChat ? '' : state.pending.map(f => fileChip(f, true)).join('');
  }

  let titleBase = null;
  function updateBadge() {
    const count = state.conversations.reduce((n, c) => n + (c.unread || 0), 0) + (state.answerUnread ? 1 : 0);
    host.toggleAttribute('unread', count > 0 && !state.open);
    $('.badge').textContent = count > 9 ? '9+' : String(count || 1);
    if (!document.hidden && titleBase) { document.title = titleBase; titleBase = null; }
  }

  function show(view, id) {
    if (id) state.activeId = id;
    state.view = view;
    const c = current();
    if (view === 'chat' && c) { c.unread = 0; if (c.team && !isOpenTeam(c)) refreshOnce(c); }
    closeSheet(); render(); persist(); syncLoops();
    if (view === 'chat') setTimeout(() => { if (!matchMedia('(max-width:520px)').matches && !form.classList.contains('hidden')) input.focus({ preventScroll: true }); }, 30);
  }

  function newConversation() {
    if (state.busy) state.controller?.abort();
    if (!F.ai) { show('home'); return; }
    const c = current();
    if (!(c && c.kind === 'ai' && !c.team && !c.messages.length)) startConversation('ai');
    state.pending = [];
    show('chat');
  }

  // In the backoffice preview the widget runs in a same-origin iframe and borrows the editor's login.
  async function request(path, options = {}) {
    const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(preview && window.parent !== window && window.parent.__ligataAIPreviewAuth ? await window.parent.__ligataAIPreviewAuth() : {}) };
    return fetch(`${api}/${path}`, { cache: 'no-store', credentials: preview ? 'same-origin' : 'omit', ...options, headers });
  }
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  // ---------- availability ----------
  /** True when the current settings arrived. */
  async function refreshConfig(force) {
    if (!force && Date.now() - state.lastConfig < 20000) return false;
    state.lastConfig = Date.now();
    let fresh = false;
    try {
      const response = await request('config', { signal: AbortSignal.timeout(10000) });
      if (response.status === 429) { updateMeter(); return false; } // throttled: keep the last known state, a busy network is not an outage
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      if (data.settings) {
        state.contextLimit = data.settings.contextLimit || state.contextLimit;
        state.baseTokens = data.settings.baseTokens || state.baseTokens;
        state.reserveTokens = data.settings.reserveTokens || state.reserveTokens;
        Object.assign(limits, data.settings.limits || {});
        if (!preview && 'history' in data.settings) settings.history = data.settings.history || null;
        if (!preview && 'consent' in data.settings && JSON.stringify(data.settings.consent || null) !== JSON.stringify(consentConfig)) {
          consentConfig = data.settings.consent || null;
          // Another recipient, "Ask all visitors again" or another period of the history: agree again before the next question.
          if (consent && !(consentConfig && covers(consent.version, consentConfig.version))) { forgetConsent(); state.consentNotice = t.consentChanged; if (state.view === 'chat' && !state.busy) updateComposer(); }
        }
      }
      fresh = !!data.settings;
      state.teamOnline = data.team?.online || 0;
      setStatus(data.state === 'disabled' && preview ? 'ready' : data.state, data.queue);
    } catch { setStatus('offline'); }
    // Only the offline notice depends on availability; never re-render the log, an answer may be streaming.
    const c = current();
    const offline = F.ai && ['offline', 'disabled'].includes(state.status) && c && !c.team && state.view === 'chat';
    const shown = log.querySelector('.notice[data-offline]');
    if (state.open && offline && !shown && !state.busy && !log.querySelector('.notice.error')) showOffline();
    if (!offline && shown) shown.remove();
    log.querySelectorAll('.card.handoff .presence').forEach(p => p.classList.toggle('on', state.teamOnline > 0 && F.chat));
    if (state.view !== 'chat') render();
    updateMeter();
    return fresh;
  }

  // ---------- attachments (AI conversations) ----------
  const readAsDataUrl = blob => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });

  /** Screenshots are downscaled in the browser and re-encoded as JPEG: smaller uploads, same vision tokens. */
  async function prepareImage(file) {
    if (file.size > 12 * 1024 * 1024) throw Object.assign(new Error(), { code: 'image_too_large' });
    const bitmap = await createImageBitmap(file).catch(() => { throw Object.assign(new Error(), { code: 'unsupported_image' }); });
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    let blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .9));
    if (!blob || blob.size > limits.maxImageBytes) blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .7));
    if (!blob || blob.size > limits.maxImageBytes) throw Object.assign(new Error(), { code: 'image_too_large' });
    const dataUrl = await readAsDataUrl(blob);
    const thumb = document.createElement('canvas');
    const t2 = Math.min(1, 96 / Math.max(canvas.width, canvas.height));
    thumb.width = Math.round(canvas.width * t2); thumb.height = Math.round(canvas.height * t2);
    thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height);
    return { data: dataUrl.split(',')[1], preview: thumb.toDataURL('image/jpeg', .7), tokens: limits.imageTokens || 280 };
  }

  async function addFiles(files) {
    if (isTeamChat(current()) || !F.ai || !files.length) return;
    try { if (!await ensureConsent()) { updateComposer(); return; } } catch (error) { showError(error.code === 'consent_changed' ? 'consent_required' : error.code || 'network'); return; }
    for (const file of files) {
      const isImage = /^image\/(png|jpeg|webp)$/.test(file.type);
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      const item = { id: Math.random().toString(36).slice(2), name: file.name || (isImage ? 'screenshot.png' : 'document.pdf'), kind: isImage ? 'image' : 'document', busy: true };
      const fail = code => { state.pending = state.pending.filter(p => p !== item); updateComposer(); showError(code); };
      if ((!isImage || !settings.allowImages) && (!isPdf || !settings.allowPdfs)) { showError(isImage ? 'images_disabled' : isPdf ? 'documents_disabled' : 'unsupported_file'); continue; }
      if (state.pending.length >= limits.maxAttachments) { showError('too_many_files'); break; }
      const c = current();
      if (isImage && (c?.messages || []).concat([{ files: state.pending }]).flatMap(m => m.files || []).filter(f => f.kind === 'image' && !f.gone).length >= limits.maxImages) { showError('too_many_images'); break; }
      state.pending.push(item); updateComposer();
      try {
        if (isImage) Object.assign(item, await prepareImage(file));
        else {
          if (file.size > limits.maxPdfBytes) { fail('pdf_too_large'); continue; }
          const data = (await readAsDataUrl(file)).split(',')[1];
          const response = await request('attachments', { method: 'POST', body: JSON.stringify({ name: item.name, data, consent: consent?.id }) });
          const result = await response.json().catch(() => ({}));
          if (result.error?.code === 'consent_required') { state.pending = state.pending.filter(x => x !== item); await consentLost(); return; }
          if (!response.ok) { fail(result.error?.code || 'invalid_pdf'); continue; }
          Object.assign(item, { text: result.text, pages: result.pages, tokens: result.tokens || Math.ceil(result.text.length / 3.5) });
        }
        item.busy = false;
      } catch (error) { fail(error.code || (isImage ? 'unsupported_image' : 'network')); continue; }
      updateComposer();
    }
    // Enter was pressed while a file was still being read: send now instead of dropping the message.
    if (state.sendWhenReady && !state.pending.some(f => f.busy)) { state.sendWhenReady = false; if (input.value.trim() || state.pending.length) send(); }
  }

  // ---------- AI conversation ----------
  // ---------- memory ----------
  // The conversation, the next question and the longest possible answer (or a summary) must fit into the
  // assistant's memory. When they would not, the earlier messages are summarized first and only the summary
  // and the latest exchange are sent from then on. The visitor still sees every message.
  const estimate = text => Math.ceil(String(text || '').length / 3.5);
  const messageTokens = m => estimate(m.content) + (m.files || []).filter(f => !f.gone).reduce((n, f) => n + (f.tokens || (f.kind === 'image' ? limits.imageTokens || 280 : estimate(f.text))), 0);
  const live = c => c.messages.filter(m => (m.role === 'user' || m.role === 'assistant') && !m.summarized);
  function memory(c, extra = 0) {
    const limit = c.context?.limit || state.contextLimit || 0;
    const reserve = Math.min(state.reserveTokens || 2048, limit / 2);
    return { limit, used: Math.max(c.context?.used || 0, state.baseTokens) + extra, room: Math.max(1, limit - reserve) };
  }
  // Server-side limit on messages per request (ChatRelay.MaxMessages is 120).
  const MAX_LIVE = 100;
  function needsSummary(c, force) {
    const earlier = live(c).length - 1; // without the new question
    if (earlier < 2) return false;      // nothing to summarize yet
    if (force || earlier >= MAX_LIVE) return true;
    const { limit, used, room } = memory(c, messageTokens(c.messages.at(-1)));
    return limit > 0 && used > room;
  }

  /** Reads a server-sent event stream: onEvent(name, data) for every event. */
  async function events(response, onEvent) {
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const name = /^event: (.*)$/m.exec(block)?.[1];
        const raw = /^data: (.*)$/m.exec(block)?.[1];
        if (name && raw) onEvent(name, JSON.parse(raw));
      }
    }
  }

  const post = (body, signal) => request(preview ? 'preview' : 'chat', { method: 'POST', signal, body: JSON.stringify(preview ? { chat: body, settings: window.parent.__ligataAIPreviewSettings?.() } : body) });
  const streaming = response => response.ok && response.body && (response.headers.get('content-type') || '').includes('event-stream');

  /**
   * Summarizes the conversation before the new question (the last message). Keeps the latest exchange word for
   * word when it is short. Returns null when done, otherwise the error ({code, message}).
   */
  async function summarize(c, signal) {
    const row = document.createElement('div');
    row.className = 'waiting compacting';
    row.innerHTML = `<span class="dots"><i></i><i></i><i></i></span><span class="wait-text">${t.compacting}</span><span class="progress"><b style="width:3%"></b></span>`;
    log.append(row); scrollDown(true);
    const bar = row.querySelector('.progress b');
    // Reading the conversation is quick when it is still cached; writing the summary takes most of the time.
    const show = value => { bar.style.width = `${Math.round(Math.min(97, value))}%`; };
    let text = '', problem = null;
    try {
      const response = await post({ ...payload(c, true), compact: true }, signal);
      if (!streaming(response)) problem = (await response.json().catch(() => ({}))).error || { code: 'compact_failed' };
      else await events(response, (name, data) => {
        if (name === 'queued' && look.showQueuePosition) row.querySelector('.wait-text').innerHTML = `${escape(t.compacting)} <span class="queue-pos">${t.queue(data.position)}</span> · ${t.wait(data.estimatedWaitSeconds || 10)}`;
        else if (name === 'started') row.querySelector('.wait-text').textContent = t.compacting;
        if (name === 'progress') show(3 + 27 * data.processed / data.total);
        else if (name === 'delta') { text += data.text; show(30 + 67 * text.length / 2400); }
        else if (name === 'error') problem = data;
      });
    } catch { problem = { code: signal.aborted ? 'cancelled' : 'network' }; }
    row.remove();
    text = stripMark(text).trim();
    if (problem || !text) return problem || { code: 'compact_failed' };
    const question = c.messages.at(-1);
    const earlier = live(c).filter(m => m !== question);
    const tail = earlier.slice(-2);
    const keep = tail.length === 2 && tail[0].role === 'user' && tail.reduce((n, m) => n + messageTokens(m), 0) <= memory(c).limit * 0.1 ? tail : [];
    for (const m of earlier) if (!keep.includes(m)) m.summarized = true;
    c.summary = text.slice(0, 30000);
    c.messages.splice(c.messages.indexOf(keep[0] || question), 0, { role: 'system', event: 'compacted', at: Date.now() });
    c.context.used = state.baseTokens + estimate(c.summary) + keep.reduce((n, m) => n + messageTokens(m), 0);
    if (c.id === state.activeId) renderLog();
    persist(true);
    return null;
  }

  function payload(c, withoutLast = false) {
    const messages = live(c);
    if (withoutLast) messages.pop();
    return {
      pageTitle: document.title.slice(0, 150), pagePath: location.pathname.slice(0, 300), consent: consent?.id, summary: c.summary || undefined,
      history: historyKey(c), turn: messages.at(-1)?.role === 'user' && messages.at(-1).at ? String(messages.at(-1).at) : undefined, language: lang,
      messages: messages.map(m => ({
        role: m.role, content: m.role === 'assistant' ? stripMark(m.content) : m.content,
        // What the assistant looked up before this answer: the server looks it up again, so the model keeps the results.
        lookups: m.lookups?.length ? m.lookups : undefined,
        attachments: (m.files || []).filter(f => !f.gone).map(f => f.kind === 'image' ? { type: 'image', name: f.name, data: f.data } : { type: 'document', name: f.name, text: f.text }),
      })),
    };
  }

  const titleOf = text => { const line = String(text || '').replace(/\s+/g, ' ').trim(); return line.length > 60 ? line.slice(0, 57).trimEnd() + '…' : line; };

  async function send(text, isRetry, summarizeFirst) {
    if (isTeamChat(current())) return sendTeam(text);
    if (state.busy || !F.ai) return;
    try { if (!await ensureConsent()) { updateComposer(); return; } }
    catch (error) { showError(error.code === 'consent_changed' ? 'consent_required' : error.code || 'network'); return; }
    if (state.busy) return;
    const c = current() || startConversation('ai');
    text = (text ?? input.value).trim();
    if (!isRetry) {
      if (!text && !state.pending.length) return;
      if (state.pending.some(f => f.busy)) { state.sendWhenReady = true; return; }
      c.messages.push({ role: 'user', content: text, files: state.pending.map(({ busy, ...f }) => f), at: Date.now() });
      if (!c.title) c.title = titleOf(text || state.pending[0]?.name);
      state.pending = []; input.value = ''; autosize();
      log.querySelector('.suggestions')?.remove();
      log.querySelector('.card.handoff')?.remove();
      touch(c);
      log.append(messageNode(c.messages.at(-1)));
    }
    log.querySelectorAll('.notice.transient').forEach(n => n.remove());
    state.busy = true; updateComposer(); scrollDown(true);
    const controller = state.controller = new AbortController();
    if (needsSummary(c, summarizeFirst)) {
      const problem = await summarize(c, controller.signal);
      if (problem) {
        state.busy = false; state.controller = null; updateComposer(); persist(true);
        if (problem.code === 'cancelled' || controller.signal.aborted) return;
        if (problem.code === 'consent_required') {
          const last = c.messages.at(-1);
          if (last?.role === 'user') { c.messages.pop(); input.value = last.content || ''; state.pending = (last.files || []).filter(f => !f.gone); autosize(); persist(true); if (c.id === state.activeId) renderLog(); }
          await consentLost();
          return;
        }
        showError(problem.code === 'context_full' ? 'compact_failed' : problem.code || 'compact_failed', problem.message, () => send('', true));
        return;
      }
      updateMeter();
    }
    const waiting = document.createElement('div');
    waiting.className = 'waiting';
    waiting.innerHTML = `<span class="dots"><i></i><i></i><i></i></span><span class="wait-text"></span>`;
    log.append(waiting); scrollDown(true);
    state.waitingRow = waiting;
    const waitText = waiting.querySelector('.wait-text');
    let answer = null, bubble = null, answerText = '', frame = 0, again = false;
    // Try again resends the question, without the part of the answer that broke off.
    const retry = () => { if (answer && c.messages.at(-1) === answer) { c.messages.pop(); if (c.id === state.activeId) renderLog(); } send('', true); };
    const lookups = [];
    // The log may have been redrawn meanwhile: write into the bubble that is on screen.
    const visible = () => {
      if (bubble && !bubble.isConnected && answer && c.id === state.activeId) {
        const shown = log.querySelector(`.msg.bot[data-at="${answer.at}"] .bubble`);
        if (shown) { bubble = shown; bubble.classList.add('streaming'); }
      }
      return bubble;
    };
    const paint = () => { frame = 0; if (visible()) { bubble.innerHTML = markdown(stripMark(answerText, true)) || '<p></p>'; scrollDown(); } };
    let ended = false;
    const finish = () => {
      if (ended) return; ended = true; state.busy = false; state.controller = null; state.answering = null; state.waitingRow = null; waiting.remove(); visible(); bubble?.classList.remove('streaming');
      if (answer) {
        answer.handoff = answerText.includes(TEAM_MARK); answer.content = answerText;
        if (lookups.length) answer.lookups = lookups;
        if (bubble) bubble.innerHTML = markdown(stripMark(answerText)) || '<p></p>';
        if (answer.handoff && canHandOff() && team.suggest !== false && c.id === state.activeId && !c.team) { log.append(handoffCard(c)); scrollDown(true); }
      }
      touch(c); updateComposer(); persist(true); renderHeader();
    };
    state.answering = c;
    try {
      const body = payload(c);
      persist(true);
      const response = await post(body, controller.signal);
      if (!streaming(response)) {
        const result = await response.json().catch(() => ({}));
        finish();
        if (result.error?.code === 'consent_required') {
          // The question waits in the input until the visitor agreed again.
          const last = c.messages.at(-1);
          if (last?.role === 'user') { c.messages.pop(); input.value = last.content || ''; state.pending = (last.files || []).filter(f => !f.gone); autosize(); persist(true); }
          await consentLost();
          return;
        }
        if (result.error?.code === 'context_full') {
          c.context.used = result.error.promptTokens || c.context.limit; updateMeter();
          // The estimate was too low: summarize the earlier messages and ask again, once.
          if (!summarizeFirst && needsSummary(c, true)) return send('', true, true);
        }
        if (['gateway_unavailable', 'model_unavailable', 'not_configured', 'invalid_key', 'disabled'].includes(result.error?.code)) setStatus(result.error.code === 'disabled' ? 'disabled' : 'offline');
        showError(result.error?.code || 'network', result.error?.message, ['context_full', 'disabled', 'daily_quota', 'origin_denied', 'message_too_long'].includes(result.error?.code) ? null : () => send('', true));
        return;
      }
      await events(response, (eventName, data) => {
        if (eventName === 'queued') {
          if (look.showQueuePosition) waitText.innerHTML = `<span class="queue-pos">${t.queue(data.position)}</span> · ${t.wait(data.estimatedWaitSeconds || 10)}`;
        } else if (eventName === 'started') {
          waitText.textContent = '';
          if (data.contextTokens) c.context.limit = data.contextTokens;
          c.context.used = data.promptTokens || c.context.used; updateMeter();
        } else if (eventName === 'progress') {
          // A long conversation or document takes a moment to read: say so, like "Thinking…".
          waitText.textContent = c.messages.at(-1)?.files?.some(f => f.kind === 'document' && !f.gone) ? t.readingDocument : t.reading;
        } else if (eventName === 'thinking') {
          waitText.textContent = t.thinking;
        } else if (eventName === 'lookup') {
          // The assistant looks something up on the website before it answers (kept with the answer, see payload).
          if (data.calls?.length) lookups.push(data.calls);
          waitText.textContent = data.calls?.some(call => call.name === 'read_pages') ? t.readingPages : t.searching;
        } else if (eventName === 'delta') {
          if (!answer) {
            waiting.remove(); state.waitingRow = null;
            answer = { role: 'assistant', content: '', at: Date.now() };
            c.messages.push(answer);
            const node = messageNode(answer);
            bubble = node.querySelector('.bubble'); bubble.classList.add('streaming');
            if (c.id === state.activeId) log.append(node);
          }
          answerText += data.text; answer.content = answerText;
          if (!frame) frame = requestAnimationFrame(paint);
        } else if (eventName === 'done') {
          c.context = { used: data.context.used, limit: data.context.limit };
          if (!state.open) { state.answerUnread = true; updateBadge(); }
        } else if (eventName === 'error') {
          finish();
          if (answer && !answerText) c.messages.pop();
          // What the assistant looked up made the conversation too long: summarize the earlier messages and ask again, once.
          if (data.code === 'context_full' && !answerText && !summarizeFirst) {
            c.context.used = data.promptTokens || c.context.limit; updateMeter();
            if (needsSummary(c, true)) { again = true; return; }
          }
          showError(data.code, data.message, ['context_full', 'refused'].includes(data.code) ? null : retry);
        }
      });
      if (frame) { cancelAnimationFrame(frame); paint(); }
      if (again) return send('', true, true);
      if (!answer && !ended) { finish(); showError('model_failed', null, retry); return; }
      finish();
    } catch (error) {
      if (frame) { cancelAnimationFrame(frame); paint(); }
      const stopped = controller.signal.aborted;
      finish();
      if (stopped) { if (answer && !answerText) c.messages.pop(); return; }
      setStatus('offline');
      showError('network', null, retry);
    }
  }

  // ---------- spam protection ----------
  let captchaScript = null;
  function captchaAllowed() {
    if (!captcha) return true;
    if (captcha.consentMode === 'cookiebot') return window.Cookiebot?.consent?.[captcha.cookiebotCategory] === true;
    return !!root.querySelector('.sheet [name=consent]')?.checked;
  }
  /** Google loads only now, on submit, after consent. Its floating badge is replaced by the notice in the form. */
  async function captchaToken() {
    if (!captcha) return null;
    if (!captchaAllowed()) throw Object.assign(new Error(), { code: 'captcha_consent' });
    if (!document.getElementById('ligata-ai-captcha-style')) {
      const style = document.createElement('style'); style.id = 'ligata-ai-captcha-style'; style.textContent = '.grecaptcha-badge{visibility:hidden!important}'; document.head.append(style);
    }
    captchaScript ||= new Promise((resolve, reject) => {
      if (window.grecaptcha?.execute) { resolve(); return; }
      const tag = document.createElement('script');
      tag.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(captcha.siteKey)}`;
      tag.async = true; tag.onload = () => resolve(); tag.onerror = () => { captchaScript = null; reject(Object.assign(new Error(), { code: 'captcha_unavailable' })); };
      document.head.append(tag);
    });
    await captchaScript;
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Object.assign(new Error(), { code: 'captcha_unavailable' })), 10000);
      window.grecaptcha.ready(() => window.grecaptcha.execute(captcha.siteKey, { action: 'ligata_ai_contact' }).then(token => { clearTimeout(timer); resolve(token); }, () => { clearTimeout(timer); reject(Object.assign(new Error(), { code: 'captcha_unavailable' })); }));
    });
  }

  // ---------- request sheet (team chat or email) ----------
  function closeSheet() { root.querySelector('.sheet')?.remove(); state.sheet = null; }

  function lastQuestion() {
    const c = current();
    if (!c || c.team) return '';
    return [...c.messages].reverse().find(m => m.role === 'user' && m.content)?.content || '';
  }

  function openSheet(kind, prefill) {
    if (kind === 'chat' && !F.chat) kind = 'email';
    if (kind === 'email' && !F.email) kind = 'chat';
    if (!F.chat && !F.email) return;
    const previous = state.sheet;
    const values = previous ? { name: previous.form.name?.value, email: previous.form.email?.value, message: previous.form.message.value } : { message: prefill ?? lastQuestion() };
    closeSheet();
    const online = state.teamOnline > 0;
    const chat = kind === 'chat';
    const nameMode = chat ? team.nameField || 'optional' : contact.nameField || 'optional';
    const emailMode = !chat ? 'required' : !online && team.emailWhenOffline !== false && team.emailField !== 'hidden' ? 'required' : team.emailField || 'optional';
    const label = (text, mode) => `${text}${mode === 'optional' ? ` <em>(${t.optional})</em>` : ''}`;
    const intro = chat ? (online ? `${t.teamOnline(state.teamOnline)} · ${t.teamFast}` : team.offlineMessage || t.teamOffline) : contact.intro || t.emailIntro;
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.innerHTML = `<div class="sheet-card" role="dialog" aria-modal="true" aria-labelledby="lai-sheet-title">
      <div class="sheet-head"><div><h2 id="lai-sheet-title">${chat ? chatWith() : escape(contact.title || t.sendEmail)}</h2><p class="sub">${chat ? `<span class="presence ${online ? 'on' : ''}"><i></i>${escape(intro)}</span>` : escape(intro)}</p></div><button type="button" class="tool" data-sheet-close aria-label="${t.close}">${svg('close')}</button></div>
      ${F.chat && F.email ? `<div class="tabs" role="group"><button type="button" aria-pressed="${chat}" data-sheet-kind="chat">${svg('chat')}${t.chatTab}</button><button type="button" aria-pressed="${!chat}" data-sheet-kind="email">${svg('mail')}${t.emailTab}</button></div>` : ''}
      <form novalidate>
        ${nameMode !== 'hidden' ? `<label class="field"><span>${label(t.name, nameMode)}</span><input name="name" autocomplete="name" maxlength="100" ${nameMode === 'required' ? 'required' : ''}><span class="err"></span></label>` : ''}
        ${emailMode !== 'hidden' ? `<label class="field"><span>${label(t.emailField, emailMode)}</span><input name="email" type="email" autocomplete="email" inputmode="email" maxlength="200" ${emailMode === 'required' ? 'required' : ''}><span class="err"></span></label>` : ''}
        <label class="field"><span>${t.message}</span><textarea name="message" rows="3" maxlength="${MAX_TEAM_TEXT}" placeholder="${escape(t.messageHint)}" required></textarea><span class="err"></span></label>
        ${captcha ? (captcha.consentMode === 'cookiebot'
          ? `<p class="fine captcha-cookie ${captchaAllowed() ? 'hidden' : ''}">${escape(t.captchaCookie(categoryName(captcha.cookiebotCategory)))} <a href="#" data-cookie-settings>${t.cookieSettings}</a></p>`
          : `<label class="consent"><input type="checkbox" name="consent"><span>${t.captchaConsent}</span></label>`) : ''}
        <p class="fine">${escape(chat ? team.privacyNotice || t.stored(days()) : t.storedEmail)}${captcha ? ` ${t.captchaNote(label => `<a href="https://policies.google.com/privacy" target="_blank" rel="noopener">${label}</a>`, label => `<a href="https://policies.google.com/terms" target="_blank" rel="noopener">${label}</a>`)}` : ''}${settings.privacyUrl ? ` <a class="privacy-link" href="${escape(safeHref(settings.privacyUrl) || '#')}" target="_blank" rel="noopener">${svg('shield')}<span>${t.privacy}</span></a>` : ''}</p>
        <div class="sheet-error" role="alert">${svg('alert')}<span></span></div>
        <div class="sheet-actions"><button type="button" class="btn ghost" data-sheet-close>${t.cancel}</button><button type="submit" class="btn primary">${svg(chat ? 'send' : 'mail')}<span>${chat ? t.sendRequest : t.sendMail}</span></button></div>
      </form></div>`;
    panel.append(sheet);
    const formEl = sheet.querySelector('form');
    state.sheet = { kind, form: formEl };
    if (formEl.name) formEl.name.value = values.name || '';
    if (formEl.email) formEl.email.value = values.email || '';
    formEl.message.value = values.message || '';
    sheet.addEventListener('click', event => {
      if (event.target === sheet || event.target.closest('[data-sheet-close]')) { closeSheet(); if (!form.classList.contains('hidden')) input.focus({ preventScroll: true }); }
      const switchTo = event.target.closest('[data-sheet-kind]')?.dataset.sheetKind;
      if (switchTo && switchTo !== kind) openSheet(switchTo);
      if (event.target.closest('[data-cookie-settings]')) { event.preventDefault(); window.Cookiebot?.renew?.(); }
    });
    formEl.addEventListener('submit', event => { event.preventDefault(); submitSheet(kind, formEl); });
    formEl.addEventListener('input', event => event.target.closest('.field')?.classList.remove('invalid'));
    setTimeout(() => (formEl.querySelector('input:not([type=checkbox])') || formEl.message).focus({ preventScroll: true }), 60);
  }

  function sheetError(formEl, text) {
    const box = formEl.querySelector('.sheet-error');
    box.querySelector('span').textContent = text || '';
    box.classList.toggle('on', !!text);
  }

  async function submitSheet(kind, formEl) {
    const fields = { name: formEl.name?.value.trim() || '', email: formEl.email?.value.trim() || '', message: formEl.message.value.trim() };
    let valid = true;
    const invalid = (field, text) => { valid = false; const box = formEl[field]?.closest('.field'); if (box) { box.classList.add('invalid'); box.querySelector('.err').textContent = text; } };
    formEl.querySelectorAll('.field').forEach(f => { f.classList.remove('invalid'); f.querySelector('.err').textContent = ''; });
    if (formEl.name?.required && !fields.name) invalid('name', t.errors.invalid_name);
    if (formEl.email && ((formEl.email.required && !fields.email) || (fields.email && !/^[^@\s<>",;:]+@[^@\s<>",;:]+\.[^@\s<>",;:]+$/.test(fields.email)))) invalid('email', t.errors.invalid_email);
    if (!fields.message) invalid('message', t.errors.invalid_message);
    sheetError(formEl, '');
    if (!valid) { formEl.querySelector('.invalid input,.invalid textarea')?.focus(); return; }
    const submit = formEl.querySelector('[type=submit]');
    const label = submit.innerHTML;
    submit.disabled = true; submit.innerHTML = `<span class="spinner"></span><span>${t.sending}</span>`;
    unlockAudio();
    try {
      if (preview) { previewRequest(fields); return; }
      const recaptchaToken = await captchaToken();
      const source = current();
      const history = source && !source.team && source.kind === 'ai' ? source.messages.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role, content: (m.role === 'assistant' ? stripMark(m.content) : m.content) + (m.files?.length ? `\n[${m.files.map(f => f.name).join(', ')}]` : '') })).filter(m => m.content.trim()) : [];
      const response = await request('conversations', { method: 'POST', body: JSON.stringify({ kind, ...fields, history, historyKey: source && !source.team ? source.history : undefined, pageTitle: document.title.slice(0, 150), pagePath: location.pathname.slice(0, 300), language: lang, recaptchaToken, clientId: newId() }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(), { code: result.error?.code || 'default', message: result.error?.message });
      accepted(kind, fields, result, source);
    } catch (error) {
      if (!formEl.isConnected) return;
      sheetError(formEl, errorText(error.code || 'network', error.message));
      if (error.code === 'too_many_open') {
        const box = formEl.querySelector('.sheet-error span');
        box.insertAdjacentHTML('beforeend', ` <a href="#" data-show-list>${t.conversations}</a>`);
        box.querySelector('[data-show-list]').addEventListener('click', e => { e.preventDefault(); show('list'); });
      }
    } finally { if (formEl.isConnected) { submit.disabled = false; submit.innerHTML = label; } }
  }

  function accepted(kind, fields, result, source) {
    const view = result.conversation;
    const teamInfo = { id: view.id, token: result.token, kind: view.kind, seq: 0, version: result.version, state: view.state, agents: view.agents || [], typing: [], email: fields.email };
    if (kind === 'chat') {
      // Continue in the same thread when it was an AI conversation: the history stays above.
      const c = source && !source.team && source.kind === 'ai' ? source : startConversation('team');
      c.team = teamInfo;
      if (!c.title) c.title = titleOf(fields.message);
      applyView(c, view, result.version, true);
      const online = (typeof view.online === 'number' ? view.online : state.teamOnline) > 0;
      c.messages.push({ role: 'system', event: 'waiting', content: online ? team.waitingMessage || t.waiting : fields.email ? team.offlineMessage || t.waitingOffline : t.waitingNoEmail, at: Date.now() });
      state.activeId = c.id;
      touch(c);
      show('chat');
    } else {
      const c = startConversation('email');
      c.team = { ...teamInfo, seq: view.seq };
      c.title = titleOf(fields.message);
      c.messages.push({ role: 'user', content: fields.message, at: Date.now() }, { role: 'system', event: 'email-sent', content: fields.email, at: Date.now() });
      // From an AI chat the visitor stays where they were, with a confirmation in that thread.
      if (source && !source.team && source.kind === 'ai' && source.messages.length) {
        source.messages.push({ role: 'system', event: 'email-sent', content: fields.email, at: Date.now() });
        source.handoffDismissed = true;
        state.activeId = source.id;
      }
      show('chat');
    }
    persist(true);
  }

  function previewRequest(fields) {
    const c = current() && !current().team ? current() : startConversation('ai');
    c.messages.push({ role: 'user', content: fields.message, at: Date.now() }, { role: 'system', event: 'preview', at: Date.now() });
    c.handoffDismissed = true;
    show('chat');
  }

  // ---------- live chat with the team ----------
  function handleEvent(c, ev, initial) {
    const at = Date.parse(ev.at) || Date.now();
    if (c.messages.some(m => m.seq === ev.seq)) return null; // already shown (a response can overlap the next one)
    if (ev.kind === 'message' && ev.author === 'visitor') {
      const mine = ev.clientId && c.messages.find(m => m.role === 'user' && m.clientId === ev.clientId);
      if (mine) { mine.pending = false; mine.failed = false; mine.seq = ev.seq; return null; }
      // The request repeats the question asked the AI just before: show it once.
      const asked = initial && [...c.messages].reverse().find(m => m.role === 'user');
      if (asked && !asked.seq && asked.content.trim() === String(ev.text || '').trim()) { asked.seq = ev.seq; return null; }
      const message = { role: 'user', content: ev.text, at, seq: ev.seq, clientId: ev.clientId || undefined };
      c.messages.push(message); return message;
    }
    if ((ev.kind === 'message' || ev.kind === 'email') && ev.author === 'agent') {
      const message = { role: 'agent', content: ev.text, agent: ev.agent || null, via: ev.kind === 'email' ? 'email' : undefined, at, seq: ev.seq };
      c.messages.push(message);
      if (!initial) incoming(c, message);
      return message;
    }
    if (['join', 'leave', 'close', 'reopen', 'request'].includes(ev.kind)) {
      const message = { role: 'system', event: ev.kind, agent: ev.agent || null, at, seq: ev.seq, reason: ev.kind === 'close' ? (ev.author === 'visitor' ? 'visitor' : ev.author === 'system' ? 'inactive' : 'team') : undefined };
      c.messages.push(message); return message;
    }
    return null;
  }

  function applyView(c, view, version, initial) {
    if (!c.team || !view) return;
    const before = JSON.stringify([c.team.state, c.team.agents, c.team.typing]);
    c.team.version = version;
    c.team.state = view.state;
    c.team.agents = view.agents || [];
    c.team.typing = view.typing || [];
    if (typeof view.online === 'number') state.teamOnline = view.online;
    const added = [];
    for (const ev of view.events || []) {
      if (ev.seq <= (c.team.seq || 0)) continue;
      const message = handleEvent(c, ev, initial);
      if (message) added.push(message);
    }
    c.team.seq = Math.max(c.team.seq || 0, view.seq || 0, ...(view.events || []).map(e => e.seq));
    const changed = added.length || before !== JSON.stringify([c.team.state, c.team.agents, c.team.typing]);
    if (!changed) return;
    if (added.length) touch(c);
    if (c.id === state.activeId && state.view === 'chat') {
      if (initial || c.team.state === 'closed') renderLog();
      else {
        log.querySelector('.typing-row')?.remove();
        added.forEach(m => appendMessage(c, m));
        if (!added.length) { const typing = typingRow(c); if (typing) { log.append(typing); scrollDown(); } }
      }
      updateComposer();
      if (c.team.state === 'closed') scrollDown(true); // the closed bar replaced the composer: keep the last event in view
    } else if (state.view === 'list') renderList();
    renderHeader();
    persist();
  }

  // An agent reply while the visitor is elsewhere: unread count, teaser, chime, tab title.
  function incoming(c, message) {
    const visible = state.open && c.id === state.activeId && state.view === 'chat' && !document.hidden;
    if (visible) return;
    c.unread = (c.unread || 0) + 1;
    ding();
    if (document.hidden) { titleBase ||= document.title; document.title = `(${state.conversations.reduce((n, x) => n + (x.unread || 0), 0)}) ${t.newMessage} · ${titleBase}`; }
    if (!state.open) showAgentTeaser(c, message);
    updateBadge(); renderHeader();
  }

  function showAgentTeaser(c, message) {
    root.querySelector('.teaser')?.remove();
    const teaser = document.createElement('div');
    teaser.className = 'teaser agent';
    teaser.innerHTML = `${face(message.agent)}<span><span class="who">${escape(agentName(message.agent))}</span><span class="text">${escape(message.content)}</span></span><button type="button" aria-label="${t.close}">${svg('close')}</button>`;
    teaser.addEventListener('click', event => { teaser.remove(); if (!event.target.closest('button')) { state.activeId = c.id; state.view = 'chat'; open(true); } });
    $('.launcher-row').append(teaser);
  }

  // One long poll for the conversation in focus; other open team chats are checked every minute.
  const loops = new Map();
  let hiddenSince = 0;
  function focusConversation() {
    const open = state.conversations.filter(isOpenTeam);
    const c = current();
    return open.includes(c) ? c : open.sort((a, b) => b.updated - a.updated)[0] || null;
  }
  function syncLoops() {
    if (preview) return;
    const focus = hiddenSince && Date.now() - hiddenSince > 15 * 60000 ? null : focusConversation();
    for (const [id, loop] of loops) if (id !== focus?.id) { loop.abort(); loops.delete(id); }
    if (focus && !loops.has(focus.id)) poll(focus);
  }
  async function poll(c) {
    const controller = new AbortController();
    loops.set(c.id, controller);
    let delay = 0;
    while (!controller.signal.aborted && isOpenTeam(c) && state.conversations.includes(c)) {
      if (hiddenSince && Date.now() - hiddenSince > 15 * 60000) break; // resumes when the tab is visible again
      try {
        const wait = c.team.version !== undefined && c.team.version !== null;
        const response = await request(`conversations/${encodeURIComponent(c.team.id)}/poll`, { method: 'POST', signal: controller.signal, body: JSON.stringify({ token: c.team.token, after: c.team.seq || 0, version: wait ? c.team.version : -1, wait }) });
        if (response.status === 404) { gone(c); break; }
        if (response.status === 429) { await sleep(5000); continue; }
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json();
        applyView(c, data.conversation, data.version);
        delay = 0;
      } catch {
        if (controller.signal.aborted) break;
        delay = Math.min(30000, (delay || 1000) * 2);
        await sleep(delay);
      }
    }
    if (loops.get(c.id) === controller) loops.delete(c.id);
  }
  async function refreshOnce(c) {
    if (preview || !c.team || c.team.gone) return;
    try {
      const response = await request(`conversations/${encodeURIComponent(c.team.id)}/poll`, { method: 'POST', body: JSON.stringify({ token: c.team.token, after: c.team.seq || 0, version: -1, wait: false }) });
      if (response.status === 404) { gone(c); return; }
      if (response.ok) { const data = await response.json(); applyView(c, data.conversation, data.version); }
    } catch { }
  }
  setInterval(() => { if (!document.hidden) state.conversations.filter(c => isOpenTeam(c) && !loops.has(c.id)).forEach(refreshOnce); }, 60000);
  function gone(c) {
    if (!c.team) return;
    c.team.gone = true; c.team.state = 'closed';
    if (c.id === state.activeId) render(); else renderHeader();
    persist();
  }

  async function sendTeam(text, retryOf) {
    const c = current();
    if (!isOpenTeam(c)) return;
    const content = (retryOf?.content ?? text ?? input.value).trim();
    if (!content) return;
    if (content.length > MAX_TEAM_TEXT) { showError('message_too_long'); return; }
    unlockAudio();
    let message = retryOf;
    if (!message) {
      message = { role: 'user', content, at: Date.now(), clientId: newId(), pending: true };
      c.messages.push(message);
      input.value = ''; autosize(); updateComposer();
      typingSignal(false);
      touch(c);
      appendMessage(c, message);
    } else { message.failed = false; message.pending = true; renderLog(); }
    persist();
    if (preview) { message.pending = false; renderLog(); return; }
    try {
      const response = await request(`conversations/${encodeURIComponent(c.team.id)}/messages`, { method: 'POST', body: JSON.stringify({ token: c.team.token, text: content, clientId: message.clientId }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (result.error?.code === 'closed') c.team.state = 'closed';
        if (result.error?.code === 'not_found') gone(c);
        throw Object.assign(new Error(), { code: result.error?.code || 'send_failed' });
      }
      message.pending = false; message.seq = result.seq;
    } catch (error) {
      message.pending = false; message.failed = true;
      if (c.id === state.activeId) { renderLog(); updateComposer(); }
      if (!['closed', 'not_found'].includes(error.code)) showError(error.code || 'send_failed');
      persist();
      return;
    }
    if (c.id === state.activeId) log.querySelectorAll('.msg.pending').forEach(node => node.classList.remove('pending'));
    persist();
  }

  let typingSent = 0, typingActive = false;
  function typingSignal(active) {
    const c = current();
    if (!isOpenTeam(c) || preview) return;
    if (active && typingActive && Date.now() - typingSent < 3000) return;
    if (!active && !typingActive) return;
    typingActive = active; typingSent = Date.now();
    request(`conversations/${encodeURIComponent(c.team.id)}/typing`, { method: 'POST', body: JSON.stringify({ token: c.team.token, active }) }).catch(() => {});
  }

  async function endTeamChat(c) {
    if (!isOpenTeam(c)) return true;
    if (!confirm(t.endConfirm)) return false;
    try { await request(`conversations/${encodeURIComponent(c.team.id)}/close`, { method: 'POST', body: JSON.stringify({ token: c.team.token }) }); } catch { }
    c.team.state = 'closed';
    return true;
  }

  // ---------- sound ----------
  let audio = null;
  function unlockAudio() { if (look.sound === false || audio) return; try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { } }
  function ding() {
    if (look.sound === false || !audio) return;
    try {
      if (audio.state === 'suspended') audio.resume();
      const now = audio.currentTime;
      [880, 1318].forEach((frequency, i) => {
        const osc = audio.createOscillator(), gain = audio.createGain(), start = now + i * .13;
        osc.type = 'sine'; osc.frequency.value = frequency;
        gain.gain.setValueAtTime(.0001, start); gain.gain.exponentialRampToValueAtTime(.07, start + .02); gain.gain.exponentialRampToValueAtTime(.0001, start + .4);
        osc.connect(gain).connect(audio.destination); osc.start(start); osc.stop(start + .45);
      });
    } catch { }
  }

  // ---------- open / close ----------
  function open(value) {
    state.open = value;
    host.toggleAttribute('open', value);
    launcher.setAttribute('aria-expanded', String(value));
    launcher.setAttribute('aria-label', value ? t.close : t.open);
    root.querySelector('.teaser')?.remove();
    if (value) {
      state.answerUnread = false;
      const c = current();
      if (c && state.view === 'chat') c.unread = 0;
      render();
      refreshConfig(true);
      syncLoops();
      setTimeout(() => { if (state.view === 'chat' && !form.classList.contains('hidden') && (!matchMedia('(max-width:520px)').matches || current()?.messages.length)) input.focus({ preventScroll: true }); }, 50);
      if (matchMedia('(max-width:520px)').matches) document.documentElement.style.setProperty('overflow', 'hidden');
    } else {
      closeSheet();
      document.documentElement.style.removeProperty('overflow');
      updateBadge();
    }
    persist();
  }

  function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; }

  launcher.addEventListener('click', () => open(!state.open));
  $('.label')?.addEventListener('click', () => open(true));
  root.addEventListener('click', async event => {
    const agreeButton = event.target.closest('[data-agree]');
    if (agreeButton) { agree(agreeButton); return; }
    if (event.target.closest('[data-cookie-settings]') && !event.target.closest('.sheet')) { event.preventDefault(); window.Cookiebot?.renew?.(); return; }
    if (event.target.closest('[data-withdraw-consent]')) {
      if (confirm(t.consentWithdrawConfirm)) { withdrawConsent(); state.view = 'chat'; render(); }
      return;
    }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'close') { open(false); launcher.focus(); }
    if (action === 'new') newConversation();
    if (action === 'list') show('list');
    if (action === 'back') show(current() || F.ai ? 'chat' : 'home');
    if (action === 'team') openSheet(F.chat ? 'chat' : 'email');
    const sheetKind = event.target.closest('[data-open-sheet]')?.dataset.openSheet;
    if (sheetKind) {
      // From the list or home: requests start fresh; from a chat they carry the AI conversation along.
      if (state.view !== 'chat') { if (F.ai && (!current() || current().team || current().messages.length)) startConversation('ai'); if (F.ai) { state.view = 'chat'; render(); } }
      openSheet(sheetKind, state.view === 'chat' && current() && !current().team ? undefined : '');
    }
    const openId = event.target.closest('[data-open]')?.dataset.open;
    if (openId) show('chat', openId);
    const removeId = event.target.closest('[data-remove-conversation]')?.dataset.removeConversation;
    if (removeId) {
      const c = state.conversations.find(x => x.id === removeId);
      if (c && isOpenTeam(c)) { if (await endTeamChat(c)) { renderList(); persist(true); syncLoops(); } }
      else if (c && confirm(c.history ? t.deleteConfirm : t.removeConfirm)) {
        if (state.answering === c) state.controller?.abort();
        forgetKeys([c.history]);
        loops.get(c.id)?.abort(); loops.delete(c.id);
        state.conversations = state.conversations.filter(x => x !== c);
        if (state.activeId === removeId) state.activeId = state.conversations[0]?.id || null;
        renderList(); renderHeader(); updateBadge(); persist(true); syncLoops();
      }
    }
    const keepChoice = event.target.closest('[data-keep-history]')?.dataset.keepHistory;
    if (keepChoice && (keepChoice === 'start' || confirm(t.keepStopConfirm))) { await chooseHistory(keepChoice === 'start'); renderList(); updateComposer(); }
    const resend = event.target.closest('[data-resend]')?.dataset.resend;
    if (resend) { const m = current()?.messages.find(x => x.clientId === resend); if (m) sendTeam(null, m); }
    const remove = event.target.closest('[data-remove]')?.dataset.remove;
    if (remove) { state.pending = state.pending.filter(f => f.id !== remove); updateComposer(); }
  });
  form.addEventListener('submit', event => { event.preventDefault(); if (state.busy && !isTeamChat(current())) state.controller?.abort(); else send(); });
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!state.busy || isTeamChat(current())) send(); } });
  input.addEventListener('input', () => { autosize(); updateComposer(); if (isTeamChat(current())) typingSignal(!!input.value.trim()); });
  input.addEventListener('blur', () => typingSignal(false));
  input.addEventListener('paste', event => { const files = [...(event.clipboardData?.files || [])]; if (files.length && !isTeamChat(current())) { event.preventDefault(); addFiles(files); } });
  $('.attach').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { addFiles([...fileInput.files]); fileInput.value = ''; });
  panel.addEventListener('dragover', event => { if ([...event.dataTransfer.types].includes('Files') && F.ai && !isTeamChat(current()) && state.view === 'chat') { event.preventDefault(); panel.classList.add('dragging'); } });
  panel.addEventListener('dragleave', event => { if (!panel.contains(event.relatedTarget)) panel.classList.remove('dragging'); });
  panel.addEventListener('drop', event => { event.preventDefault(); panel.classList.remove('dragging'); addFiles([...event.dataTransfer.files]); });
  root.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !state.open) return;
    if (state.sheet) { closeSheet(); if (!form.classList.contains('hidden')) input.focus({ preventScroll: true }); return; }
    open(false); launcher.focus();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenSince = Date.now(); return; }
    hiddenSince = 0;
    syncLoops();
    if (titleBase) { document.title = titleBase; titleBase = null; }
    const c = current();
    if (state.open && c && state.view === 'chat' && c.unread) { c.unread = 0; updateBadge(); renderHeader(); persist(); }
    if (state.open) refreshConfig(false);
  });
  if (captcha?.consentMode === 'cookiebot')
    for (const eventName of ['CookiebotOnAccept', 'CookiebotOnDecline', 'CookiebotOnConsentReady']) window.addEventListener(eventName, () => root.querySelector('.captcha-cookie')?.classList.toggle('hidden', captchaAllowed()));
  function cookiebotChanged() {
    if (consentConfig?.mode !== 'cookiebot' || !window.Cookiebot) return;
    if (consent && !cookiebotAllows()) withdrawConsent();
    if (!state.busy) render(); else updateComposer();
  }
  for (const eventName of ['CookiebotOnAccept', 'CookiebotOnDecline', 'CookiebotOnConsentReady', 'CookiebotOnLoad']) window.addEventListener(eventName, cookiebotChanged);
  // Another tab of this site agreed, withdrew, deleted or wrote: follow it, so this tab never writes back what is gone.
  window.addEventListener('storage', event => {
    if (previewStore || preview) return;
    if (event.key === consentKey) { consent = null; loadConsent(); }
    if (event.key === storageKey && !state.busy) { load(); syncLoops(); }
    if (event.key === consentKey || (event.key === storageKey && !state.busy)) { if (state.open) render(); else updateBadge(); }
  });
  setInterval(() => { if (state.open && !state.busy && !document.hidden) refreshConfig(['offline', 'starting', 'busy'].includes(state.status)); }, 30000);

  // ---------- start ----------
  load();
  loadConsent();
  retryForget();
  const mount = () => {
    document.body.append(host);
    setStatus('checking');
    if (!F.ai && !state.conversations.length) state.view = 'home';
    render();
    if (state.open || script.dataset.open === 'true') open(true);
    else setTimeout(() => refreshConfig(true), 1500); // status dot without delaying the page
    syncLoops();
    const teaserText = look.teaser;
    if (teaserText && !state.open && !state.conversations.some(c => c.messages.length)) {
      setTimeout(() => {
        if (state.open || state.teaserShown || root.querySelector('.teaser')) return;
        state.teaserShown = true;
        const teaser = document.createElement('div');
        teaser.className = 'teaser';
        teaser.innerHTML = `${escape(teaserText)}<button type="button" aria-label="${t.close}">${svg('close')}</button>`;
        teaser.addEventListener('click', event => { if (event.target.closest('button')) teaser.remove(); else open(true); });
        $('.launcher-row').append(teaser);
      }, Math.max(0, +look.teaserDelaySeconds) * 1000);
    }
  };
  window.LigataAI = {
    open: () => open(true), close: () => open(false), toggle: () => open(!state.open), reset: () => newConversation(),
    ask: text => { if (!F.ai) return; open(true); if (current()?.team) startConversation('ai'); show('chat'); if (!aiAllowed()) { state.queuedAsk = String(text || ''); return; } send(text); },
    contact: kind => { open(true); if (F.ai) { if (!current() || current().team) startConversation('ai'); show('chat'); } openSheet(kind === 'email' ? 'email' : 'chat', ''); },
  };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
