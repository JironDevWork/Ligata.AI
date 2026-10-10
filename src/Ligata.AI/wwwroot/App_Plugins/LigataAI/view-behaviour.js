import { html, nothing } from '@umbraco-cms/backoffice/external/lit';
import { number, compact, icon } from './ui.js?v=0.13.2';

const efforts = [['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max']];
const effortHelp = {
  off: 'Answers straight away, without thinking. Fastest and cheapest; fine for simple questions.',
  low: 'Thinks only when a question needs it. Fast and inexpensive. Recommended for most websites.',
  medium: 'Thinks more often and longer. Better for questions that combine several pages; answers start a little later.',
  high: 'Careful answers for complex questions and strict instructions. Noticeably slower and uses more tokens.',
  xhigh: 'Thinks much longer. Rarely better for website questions: visitors wait longer and every answer costs more.',
  max: 'As much thinking as Claude can do. Only for very complex questions: the slowest and most expensive.',
};

const reaches = [['highlight', 'Highlight only'], ['scroll', 'Scroll and highlight'], ['pages', 'Open pages too']];
const reachHelp = {
  highlight: 'Points at things on the page the visitor is on, where they are: nothing moves. Something further down is highlighted once the visitor scrolls to it.',
  scroll: 'Also scrolls the page the visitor is on to the right spot. Other pages are linked in the answer.',
  pages: 'Also opens another page of your website, then scrolls to the spot and highlights it. Only pages the assistant can look up, never addresses from page texts.',
};
const askHelp = {
  always: 'Recommended. A card under the answer offers “Show me” or “Take me there”. Highlighting what is already on screen needs no question.',
  pages: 'Scrolls on the same page right away and asks before another page opens.',
  never: 'Goes ahead right after the answer. Another page opens after a short countdown the visitor can cancel.',
};
const styleHelp = {
  ring: 'A coloured ring around the spot that pulses briefly.',
  spotlight: 'Dims the rest of the page so the spot stands out.',
  marker: 'Colours the spot like a highlighter pen.',
};

export const behaviourView = {
  /** Showing the way: what the assistant may do on the page, when it asks, and how the highlight looks (tried out in the preview). */
  guideCard() {
    const g = this.settings.guide;
    const reach = v => { this.set('guide.reach', v); if (v !== 'pages' && this.settings.guide.ask === 'pages') this.set('guide.ask', 'never'); };
    const asks = g.reach === 'pages' ? [['always', 'Before scrolling or opening a page'], ['pages', 'Only before opening a page'], ['never', 'Never']] : [['always', 'Before scrolling'], ['never', 'Never']];
    return html`<section class="card">
      <header><div><h2>Showing the way</h2><p class="muted">When visitors ask where something is, the assistant can show them: it opens the page, scrolls to the spot and highlights it. It never clicks, fills in or sends anything on your website.</p></div></header>
      ${this.toggle('guide.enabled', 'Show visitors where things are', 'On phones the chat steps aside while the spot is shown, with a bar to come back to the conversation.')}
      ${g.enabled ? html`<div class="section">
          <div class="control"><span>What it may do</span><div class="segmented" role="group" aria-label="What it may do">${reaches.map(([v, l]) => html`<button type="button" aria-pressed=${String(g.reach === v)} @click=${() => reach(v)}>${l}</button>`)}</div><small>${reachHelp[g.reach]}</small>${this.fieldError('guide.reach')}</div>
          ${g.reach === 'highlight' ? nothing : this.segmented('guide.ask', 'Ask the visitor first', asks, askHelp[g.ask])}
        </div>
        <div class="grid two section">
          ${this.segmented('guide.style', 'Highlight', [['ring', 'Ring'], ['spotlight', 'Spotlight'], ['marker', 'Marker']], styleHelp[g.style])}
          ${this.range('guide.seconds', 'Highlight for', 2, 15, 1, v => `${v} s`)}
        </div>
        <div class="section row">
          <label class="color"><input type="color" .value=${g.color || this.settings.appearance.accent} @input=${e => this.set('guide.color', e.target.value)}><span>Highlight colour<code>${g.color || 'The accent colour'}</code></span></label>
          ${g.color ? html`<button type="button" class="btn small" @click=${() => this.set('guide.color', '')}>Use the accent colour</button>` : nothing}
          <span class="grow"></span>
          <button type="button" class="btn small" @click=${() => this.previewGuide()}>${icon('pin')}Try it in the preview</button>
        </div>${this.fieldError('guide.color')}` : nothing}
    </section>`;
  },

  /** Highlights the heading of the preview page with the settings shown. The preview reloads after a change: wait for its assistant. */
  previewGuide() {
    clearInterval(this.guideTimer);
    const started = Date.now();
    setTimeout(() => {
      this.guideTimer = setInterval(() => {
        const frame = this.shadowRoot?.querySelector('.preview iframe')?.contentWindow;
        if (frame?.LigataAI?.show && frame.document.readyState === 'complete') { clearInterval(this.guideTimer); frame.LigataAI.show({ selector: 'h1', label: 'Example' }); }
        else if (Date.now() - started > 5000) clearInterval(this.guideTimer);
      }, 100);
    }, 400);
  },

  /** Gemma on the GPU thinks or does not; Claude has effort levels. With both engines set up, the other engine's setting is one click away. */
  thinkingControls() {
    const gpu = this.toggle('behaviour.thinking', 'Think before answering', 'More careful answers for complex questions, but noticeably slower for everyone sharing the GPU.');
    const claude = this.segmented('behaviour.effort', 'Thinking effort', efforts, effortHelp[this.settings.behaviour.effort] || '');
    if (!this.bothEngines()) return this.api() ? claude : gpu;
    return html`${this.api() ? claude : gpu}
      <details class="other-engine"><summary>${this.api() ? 'When the Ligata GPU answers' : 'When Claude answers'}</summary><div class="section" style="margin-top:6px">${this.api() ? gpu : claude}</div></details>`;
  },

  behaviourView() {
    const b = this.settings.behaviour;
    const maxContext = this.modelContext || 262144;
    const display = this.settings.display;
    return html`<div class="split">
      <div class="grid">
        <section class="card">
          <header><div><h2>Identity</h2><p class="muted">How the assistant introduces itself.</p></div></header>
          <div class="grid two">
            ${this.text('identity.name', 'Assistant name', { max: 40 })}
            ${this.text('behaviour.siteName', 'Business / website name', { max: 120, placeholder: 'e.g. Ligata', help: 'Used in the instructions so the assistant knows who it speaks for.' })}
            ${this.text('identity.avatarUrl', 'Avatar image URL', { placeholder: '/media/…/avatar.png', help: 'Optional. A square image from your media library or an https URL.' })}
            ${this.select('identity.language', 'Interface language', [['auto', 'Automatic (page or browser)'], ['en', 'English'], ['de', 'Deutsch'], ['fr', 'Français'], ['it', 'Italiano']], 'The assistant always answers in the visitor’s language; this sets buttons and messages.')}
          </div>
          <div class="section">
            ${this.text('identity.greeting', 'Greeting', { rows: 2, max: 600 })}
            ${this.list('identity.suggestions', 'Suggested questions', { max: 6, placeholder: 'e.g. What does a website cost?', help: 'Shown as buttons before the first question.' })}
            ${this.text('identity.inputPlaceholder', 'Input placeholder', { max: 80, placeholder: 'Ask a question…' })}
          </div>
        </section>

        ${this.licensedFeatures().assistant ? html`<section class="card">
          <header><div><h2>Instructions</h2><p class="muted">Tell the assistant about your business and how to behave. Ligata adds safety guardrails automatically.</p></div>${this.budget ? html`<span class="pill info" title="Instructions incl. guardrails">${number(this.budget.instructionTokens)} tokens${this.budget.estimated ? ' (est.)' : ''}</span>` : nothing}</header>
          ${this.text('behaviour.instructions', 'Your instructions', { rows: 12, max: 20000, placeholder: 'Example:\nWe are a web studio in Zurich. We build Umbraco websites for SMEs.\n- Recommend booking a free 30-minute call for project questions.\n- Prices start at CHF 4,800; never quote a final price.\n- Opening hours: Mon-Fri 8-17.' })}
          <div class="grid two section">
            ${this.segmented('behaviour.tone', 'Tone', [['friendly', 'Friendly'], ['professional', 'Professional'], ['concise', 'Concise'], ['playful', 'Playful']])}
            ${this.segmented('behaviour.answerLength', 'Answer length', [['short', 'Short'], ['balanced', 'Balanced'], ['detailed', 'Detailed']])}
          </div>
          <div class="section">
            ${this.toggle('behaviour.stayOnTopic', 'Stay on topic', 'Politely declines requests unrelated to your website (homework, coding, …). Recommended.')}
            ${this.toggle('behaviour.includePageContext', 'Know the current page', 'The assistant is told which page the visitor is on.')}
            ${this.toggle('behaviour.useMarkdown', 'Formatted answers', 'Lists, bold text and links.')}
          </div>
          <div class="section">${this.thinkingControls()}</div>
        </section>` : nothing}

        ${this.licensedFeatures().assistant ? this.guideCard() : nothing}

        ${this.licensedFeatures().assistant ? html`<section class="card">
          <header><div><h2>Memory & limits</h2><p class="muted">Bigger limits allow longer chats and documents, but the first answer takes longer.</p></div></header>
          <div class="grid">
            ${this.range('behaviour.contextLimit', 'Conversation limit', 8192, maxContext, 4096, v => `${compact(v)} tokens`, `Everything the assistant keeps in mind at once: instructions, knowledge, the chat and attachments. ${this.api() ? `${this.engineName()} is limited to ${compact(maxContext)} per question (LigataAI:Claude:MaxContextTokens).` : `The AI server allows up to ${compact(maxContext)}.`}`)}
            ${this.range('behaviour.knowledgeBudget', 'Knowledge budget', 0, Math.max(0, b.contextLimit - b.maxAnswerTokens - 2048), 1024, v => `${compact(v)} tokens`, 'The most your enabled knowledge may use. Keeping it lean keeps answers fast.')}
            ${this.range('behaviour.maxAnswerTokens', 'Longest answer', 256, 4096, 128, v => `${number(v)} tokens`, '≈ 0.75 words per token.')}
            ${this.api() ? nothing : this.range('behaviour.temperature', 'Creativity', 0, 1.2, 0.05, v => (+v).toFixed(2), 'Lower is more factual and consistent; higher is more varied.')}
          </div>
          <div class="section">
            ${this.toggle('behaviour.allowImages', 'Visitors can attach screenshots', 'PNG, JPEG or WebP. Images are processed in memory and never stored.')}
            ${this.toggle('behaviour.allowPdfs', 'Visitors can attach PDFs', 'Text is extracted in memory for the conversation and never stored.')}
          </div>
          <div class="section">${this.budgetCard('Context budget', true)}</div>
        </section>` : nothing}

        <section class="card">
          <header><div><h2>When the assistant can’t help</h2><p class="muted">${this.licensedFeatures().liveChat || this.licensedFeatures().email ? 'Used when live chat and the email form are off: shown when the AI is offline and suggested inside answers.' : 'Shown when the AI is offline or busy, and suggested inside answers.'}</p></div></header>
          <div class="grid two">
            ${this.text('identity.fallbackEmail', 'Contact email', { type: 'email', placeholder: 'info@example.ch' })}
            ${this.text('identity.fallbackUrl', 'Contact page', { placeholder: '/kontakt/' })}
          </div>
          <div class="section">${this.text('identity.fallbackMessage', 'Offline message', { rows: 2, max: 400 })}</div>
        </section>

        <section class="card muted-card">
          <header><div><h2>Privacy</h2><p class="muted">The privacy notice, the link to your privacy policy, visitor consent and a ready-made text for your privacy policy are under Privacy.</p></div><button type="button" class="btn small" @click=${() => { this.tab = 'privacy'; this.refreshPrivacy(); this.loadPolicy(); }}>Open</button></header>
        </section>

        <section class="card">
          <header><div><h2>Where it appears</h2></div></header>
          ${this.segmented('display.mode', 'Show the assistant', [['all', 'Every page'], ['include', 'Only on…'], ['exclude', 'Everywhere except…'], ['manual', 'Manual placement']])}
          ${display.mode === 'include' || display.mode === 'exclude' ? html`<div class="section">${this.list('display.paths', display.mode === 'include' ? 'Pages (path prefixes)' : 'Hidden on (path prefixes)', { max: 50, placeholder: '/kontakt/', help: 'A path includes all pages below it. Use / for the homepage and everything.' })}</div>` : nothing}
          ${display.mode === 'manual' ? html`<div class="section"><small>Add this to a template where the bubble should load:</small><pre class="code">@await Component.InvokeAsync("LigataAssistant")</pre></div>` : nothing}
        </section>
      </div>
      ${this.previewPane()}
    </div>`;
  },
};
