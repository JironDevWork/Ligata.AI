import { html, nothing } from '@umbraco-cms/backoffice/external/lit';
import { icon, number, compact } from './ui.js?v=0.4.3';

export const insightsView = {
  duration(ms) {
    const minutes = ms / 60000;
    return minutes < 1 ? `${Math.round(ms / 1000)} s` : minutes < 90 ? `${Math.round(minutes)} min` : `${(minutes / 60).toFixed(1)} h`;
  },

  insightsView() {
    const rows = this.stats || [];
    const sum = key => rows.reduce((n, r) => n + (r[key] || 0), 0);
    const answered = sum('answered');
    const days = [];
    for (let i = this.statsDays - 1; i >= 0; i--) {
      const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      days.push(rows.find(r => r.day === day) || { day, answered: 0, failed: 0, busy: 0, offline: 0 });
    }
    const peak = Math.max(1, ...days.map(d => d.answered + d.failed + d.busy + d.offline));
    const averageSeconds = answered ? sum('answerMs') / answered / 1000 : 0;
    return html`<div class="grid">
      <section class="card">
        <header><div><h2>Usage</h2><p class="muted">Anonymous daily counters. No questions, answers or visitor data are stored.</p></div>
          <div class="segmented">${[7, 30, 90].map(d => html`<button type="button" aria-pressed=${String(this.statsDays === d)} @click=${() => { this.statsDays = d; this.run(() => this.loadStats()); }}>${d} days</button>`)}</div></header>
        <div class="stats">
          <div class="stat"><b>${number(sum('conversations'))}</b><small>Conversations</small></div>
          <div class="stat"><b>${number(sum('questions'))}</b><small>Questions</small></div>
          <div class="stat"><b>${number(answered)}</b><small>Answered</small></div>
          <div class="stat"><b>${averageSeconds ? averageSeconds.toFixed(1) + ' s' : '-'}</b><small>Average answer time (incl. waiting)</small></div>
          <div class="stat"><b>${number(sum('attachments'))}</b><small>Attachments</small></div>
          <div class="stat"><b>${number(sum('busy'))}</b><small>Turned away (busy)</small></div>
          <div class="stat"><b>${number(sum('offline'))}</b><small>While offline</small></div>
          <div class="stat"><b>${number(sum('failed'))}</b><small>Failed</small></div>
          <div class="stat"><b>${compact(sum('promptTokens') + sum('completionTokens'))}</b><small>Tokens processed</small></div>
        </div>
      </section>
      ${this.licensedFeatures().liveChat || this.licensedFeatures().email ? html`<section class="card">
        <header><div><h2>Team</h2><p class="muted">Requests for a person and how quickly your team answered.</p></div></header>
        <div class="stats">
          <div class="stat"><b>${number(sum('chatRequests'))}</b><small>Chat requests</small></div>
          <div class="stat"><b>${number(sum('emailRequests'))}</b><small>Email messages</small></div>
          <div class="stat"><b>${number(sum('agentReplies'))}</b><small>Team replies</small></div>
          <div class="stat"><b>${sum('responses') ? this.duration(sum('firstResponseMs') / sum('responses')) : '-'}</b><small>Average first response</small></div>
          ${this.licensedFeatures().assistant ? html`<div class="stat"><b>${number(sum('suggested'))}</b><small>AI could not answer (offered the team)</small></div>` : nothing}
        </div>
        ${this.licensedFeatures().assistant && sum('suggested') > 5 ? html`<small class="muted">Questions the AI could not answer are a good hint for missing knowledge. Only the count is kept, never the question.</small>` : nothing}
      </section>` : nothing}
      <section class="card">
        <header><div><h2>Per day</h2></div><div class="row"><span class="pill" style="color:var(--c-chat)"><i></i>Answered</span><span class="pill" style="color:var(--c-answer)"><i></i>Busy / offline</span><span class="pill bad"><i></i>Failed</span></div></header>
        ${rows.length ? html`<div class="chart" role="img" aria-label="Questions per day">${days.map(d => html`<div title="${d.day}: ${d.answered} answered, ${d.busy + d.offline} busy/offline, ${d.failed} failed">
          <i class="answered" style="height:${d.answered / peak * 100}%"></i><i class="busy" style="height:${(d.busy + d.offline) / peak * 100}%"></i><i class="failed" style="height:${d.failed / peak * 100}%"></i></div>`)}</div>
          <div class="row"><small class="grow">${days[0].day}</small><small>${days.at(-1).day}</small></div>`
        : html`<div class="empty">${icon('chart')}<p>No questions yet in this period.</p></div>`}
        ${sum('busy') > sum('questions') * 0.1 && sum('questions') > 20 ? html`<div class="notice warning">${icon('warn')}<div>More than 10% of questions were turned away because the AI was busy or the daily limit was reached. ${this.api() ? 'Raise LigataAI:Claude:MaxConcurrent or QuestionsPerDay in the site configuration.' : 'Ask the gateway operator about capacity or a higher queue limit.'}</div></div>` : nothing}
      </section>
    </div>`;
  },
};
