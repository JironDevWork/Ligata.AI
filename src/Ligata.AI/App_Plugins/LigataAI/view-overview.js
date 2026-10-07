import { html, nothing } from '@umbraco-cms/backoffice/external/lit';
import { icon, number, compact } from './ui.js?v=0.3.0';

export const overviewView = {
  budgetCard(title = 'Context budget', compactView = false) {
    const p = this.budgetParts;
    const pct = v => `${Math.max(0, Math.min(100, (v / p.limit) * 100))}%`;
    const b = this.settings.behaviour;
    return html`<section class="card budget">
      <header><div><h2>${title}</h2><p class="muted">How one conversation's ${number(p.limit)} tokens are shared${this.modelContext ? html` (model maximum ${compact(this.modelContext)})` : nothing}.${p.estimated ? ' Some numbers are estimates until the AI counts them.' : ''}</p></div></header>
      <div class="stack" role="img" aria-label="Context budget">
        <i class="instructions" style="width:${pct(p.instructions)}"></i><i class="knowledge" style="width:${pct(p.knowledge)}"></i>
        ${p.over ? html`<i class="over" style="width:${pct(p.instructions + p.knowledge + p.answer - p.limit)}"></i>` : html`<i class="chat" style="width:${pct(p.chat)}"></i><i class="answer" style="width:${pct(p.answer)}"></i>`}
      </div>
      <div class="legend">
        <div><i style="background:var(--c-instructions)"></i><span><b>${number(p.instructions)}</b><small>Instructions & guardrails</small></span></div>
        <div><i style="background:var(--c-knowledge)"></i><span><b>${number(p.knowledge)} <small>/ ${number(b.knowledgeBudget)}</small></b><small>Knowledge (budget)</small></span></div>
        <div><i style="background:var(--c-chat)"></i><span><b>${number(p.chat)}</b><small>Free for the conversation & attachments</small></span></div>
        <div><i style="background:var(--c-answer)"></i><span><b>${number(p.answer)}</b><small>Reserved for one answer</small></span></div>
      </div>
      ${p.over ? html`<div class="notice error">${icon('warn')}<div>Instructions, knowledge and the answer reserve exceed the conversation limit. Switch knowledge off or raise the limit under Behaviour.</div></div>` : nothing}
      ${!compactView && p.chat < 4096 && !p.over ? html`<small class="muted">Less than 4,096 tokens remain for the conversation. Visitors may hit the limit after a few questions or one attachment.</small>` : nothing}
      ${!compactView ? html`<small class="muted">${this.api()
        ? 'Tip: instructions and knowledge are cached by Anthropic for a few minutes, so further questions read them at a tenth of the price. A lean knowledge base keeps every answer cheaper and faster.'
        : `Tip: the first question after a change processes everything once (roughly ${Math.max(1, Math.round((p.instructions + p.knowledge) / 900))} s on the shared GPU). Follow-up questions reuse that work and start almost instantly.`}</small>` : nothing}
    </section>`;
  },

  teamCard() {
    const i = this.inbox, c = i?.counts || {};
    const go = () => window.history.pushState(null, '', '/umbraco/section/ai-assistant/dashboard/inbox');
    return html`<section class="card team-card">
      <header><div><h2>Team inbox</h2><p class="muted">Visitors who asked for a person, and email messages.</p></div><button class="btn small primary" @click=${go}>${icon('inbox')}Open inbox</button></header>
      <div class="stats">
        <div class="stat"><b class=${c.needsReply ? 'bad' : ''}>${c.needsReply ?? '—'}</b><small>Need a reply</small></div>
        <div class="stat"><b>${c.active ?? '—'}</b><small>Active chats</small></div>
        <div class="stat"><b>${i ? i.online : '—'}</b><small>Team members online</small></div>
      </div>
    </section>`;
  },

  overviewView() {
    const s = this.status;
    const ready = s?.ok && s.status.state === 'ready';
    const hasKey = this.connection?.keySource && !['none', 'unreadable'].includes(this.connection.keySource);
    const enabledKnowledge = this.knowledge.filter(k => k.enabled).length;
    const l = this.licensedFeatures(), e = this.effectiveFeatures(), recipients = this.settings.notifications.recipients.filter(x => x.trim()).length;
    const k = this.connection?.claude;
    const aiSteps = !e.assistant ? [] : this.api() ? [
      { done: !!k?.configured, label: 'Add your Anthropic API key', detail: k?.configured ? 'Set in the site configuration. It never leaves this server except to Anthropic.' : 'Add LigataAI:Claude:ApiKey to appsettings, or the environment variable LigataAI__Claude__ApiKey.', tab: 'connection' },
      { done: ready, label: 'Claude answers', detail: ready ? `${s.status.model} · up to ${compact(s.status.contextTokens)} tokens per question · reads screenshots` : s?.message || 'Waiting for status…', tab: 'connection' },
      { done: !!this.settings.behaviour.siteName && !!this.settings.behaviour.instructions, label: 'Describe your business', detail: 'Website name and instructions under Behaviour.', tab: 'behaviour' },
      { done: enabledKnowledge > 0, label: 'Add knowledge', detail: enabledKnowledge ? `${enabledKnowledge} source${enabledKnowledge === 1 ? '' : 's'} active` : 'Upload documents or import your website pages.', tab: 'knowledge' },
    ] : [
      { done: hasKey, label: 'Connect to the Ligata AI gateway', detail: hasKey ? `Key ${this.connection.keyHint || ''} (${this.connection.keySource === 'configuration' ? 'from configuration' : 'stored encrypted'})` : 'Paste the API key under Connection.', tab: 'connection' },
      { done: ready, label: 'AI gateway answers', detail: ready ? `${s.status.model || 'Model'} · ${compact(s.status.contextTokens)} tokens context${s.status.vision ? ' · reads screenshots' : ''}` : s?.message || 'Waiting for status…', tab: 'connection' },
      { done: !!this.settings.behaviour.siteName && !!this.settings.behaviour.instructions, label: 'Describe your business', detail: 'Website name and instructions under Behaviour.', tab: 'behaviour' },
      { done: enabledKnowledge > 0, label: 'Add knowledge', detail: enabledKnowledge ? `${enabledKnowledge} source${enabledKnowledge === 1 ? '' : 's'} active` : 'Upload documents or import your website pages.', tab: 'knowledge' },
    ];
    const teamSteps = !(l.liveChat || l.email) ? [] : [
      { done: (e.liveChat || e.email) && (!l.email || recipients > 0), label: 'Set up your team', detail: e.liveChat || e.email ? `${[e.liveChat && 'Live chat', e.email && 'email form'].filter(Boolean).join(' and ')} on${l.email ? (recipients ? ` · notifications to ${recipients} address${recipients === 1 ? '' : 'es'}` : ' · add team email addresses for notifications') : ''}` : 'Switch on live chat or the email form, so visitors can reach a person.', tab: 'team' },
    ];
    const steps = [...aiSteps, ...teamSteps,
      { done: this.settings.enabled, label: 'Show it on the website', detail: this.settings.enabled ? `Mode: ${({ all: 'every page', include: 'selected pages', exclude: 'all but excluded pages', manual: 'manual placement' })[this.settings.display.mode]}` : 'Use the switch at the top when you are happy with the preview.', tab: null },
    ];
    return html`<div class="split">
      <div class="grid">
        <section class="card">
          <header><div><h2>Getting started</h2><p class="muted">${steps.filter(x => x.done).length} of ${steps.length} done</p></div></header>
          <ul class="checklist">${steps.map(step => html`<li class=${step.done ? 'done' : ''}><span class="mark">${step.done ? icon('check') : nothing}</span><div class="grow"><strong>${step.label}</strong><br><small>${step.detail}</small></div>${step.tab && !step.done ? html`<button class="btn small" @click=${() => { this.tab = step.tab; }}>Open</button>` : nothing}</li>`)}</ul>
        </section>
        ${l.liveChat || l.email ? this.teamCard() : nothing}
        ${e.assistant ? this.budgetCard() : nothing}
        ${e.assistant && this.api() ? html`<section class="card">
          <header><div><h2>Claude API</h2><p class="muted">Answers come from Anthropic, straight from this website's server. Several visitors are answered at the same time.</p></div><button class="btn small" @click=${() => this.refreshStatus()}>${icon('refresh')}Refresh</button></header>
          ${s?.ok ? this.claudeStatus(s) : html`<div class="notice ${s ? 'error' : ''}">${icon('info')}<div>${s ? s.message : 'Checking…'}</div></div>`}
        </section>` : e.assistant ? html`<section class="card">
          <header><div><h2>Shared AI server</h2><p class="muted">All Ligata websites share one GPU and answer one question at a time, in order.</p></div><button class="btn small" @click=${() => this.refreshStatus()}>${icon('refresh')}Refresh</button></header>
          ${s?.ok ? html`<dl class="facts">
            <dt>Model</dt><dd>${s.status.model || '—'} <span class="pill ${ready ? 'ok' : 'warn'}"><i></i>${s.status.state}</span></dd>
            <dt>Context window</dt><dd>${number(s.status.contextTokens)} tokens</dd>
            <dt>Queue</dt><dd>${s.status.queueRunning ? 'Answering' : 'Idle'}${s.status.queueWaiting ? ` · ${s.status.queueWaiting} waiting (≈ ${s.status.estimatedWaitSeconds} s)` : ''}</dd>
            <dt>GPU memory</dt><dd>${s.status.gpuHealthy ? 'Healthy (everything in VRAM)' : 'Warning: VRAM overflowing into system RAM'}</dd>
            <dt>Your usage today</dt><dd>${number(s.status.usage?.requests)} of ${number(s.status.limits?.requestsPerDay)} questions</dd>
          </dl>` : html`<div class="notice ${s ? 'error' : ''}">${icon('info')}<div>${s ? s.message : 'Checking…'}</div></div>`}
        </section>` : nothing}
      </div>
      ${this.previewPane()}
    </div>`;
  },
};
