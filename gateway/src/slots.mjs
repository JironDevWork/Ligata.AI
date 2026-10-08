// Prompt-cache affinity across websites and conversations.
//
// With split slots (model profile unified: false) every slot owns ctx / slots of the KV pool: caches never compete
// and nothing is erased. The rest of this note is about a shared pool (-kvu).
//
// llama-server runs a few slots over ONE unified KV pool in VRAM (the full context window). Each answer runs in
// its own slot; several answers can run at once. A slot keeps what it processed last, so the next question of the
// same conversation, or of the same website, starts in well under a second instead of re-reading the knowledge.
// Slots do not share a cache: two visitors of one site at the same time each need their own copy. Because the
// slots share the pool, cached prefixes of idle slots are erased (least recently used first) when a request needs
// the room, and idle caches are capped because attention spans every occupied cell.
export class SlotManager {
  constructor({ count = 1, contextTokens = 0, maxIdleTokens = 65536, reserve = 2048, shared = true, log = () => {} } = {}) {
    Object.assign(this, { contextTokens, maxIdleTokens, reserve, shared, log, clock: 0 });
    this.resize(count);
  }

  resize(count) {
    if (this.slots?.length === Math.max(1, count)) return;
    this.slots = Array.from({ length: Math.max(1, count) }, (_, id) => ({ id, site: null, visitor: null, tokens: 0, used: 0, busy: false, reserved: 0 }));
  }

  /** llama-server came back: its caches are gone, but answers still running keep their slots until they release them. */
  reset() { for (const slot of this.slots) Object.assign(slot, { site: null, visitor: null, tokens: 0, used: 0 }); }

  /**
   * Chooses a free slot for a request and frees room in the shared pool: the slot of the same conversation, else
   * one warm with the site's knowledge, else an empty one, else the least recently used. `needed` is the prompt
   * plus the longest answer. `erase(id)` clears a slot's cache in llama-server. Returns the slot id for id_slot.
   */
  async assign(site, needed, erase, visitor = null) {
    const free = this.slots.filter(s => !s.busy);
    if (!free.length) throw new Error('No free slot: the scheduler runs at most one answer per slot.');
    const recent = list => [...list].sort((a, b) => b.used - a.used)[0];
    const slot = (visitor && free.find(s => s.site === site && s.visitor === visitor))
      || recent(free.filter(s => s.site === site))
      || free.find(s => !s.site)
      || [...free].sort((a, b) => a.used - b.used)[0];
    // Taken before the first await, so an answer starting at the same moment cannot get it too.
    slot.busy = true; slot.reserved = needed;
    // Split slots (no -kvu) each own their part of the pool: nothing to make room for.
    if (this.shared && this.slots.length > 1) {
      const running = this.slots.filter(s => s.busy && s !== slot).reduce((n, s) => n + s.reserved, 0);
      const idle = free.filter(s => s !== slot && s.tokens > 0).sort((a, b) => a.used - b.used);
      let cached = idle.reduce((n, s) => n + s.tokens, 0);
      for (const other of idle) {
        if (running + cached + needed + this.reserve <= this.contextTokens && cached <= this.maxIdleTokens) break;
        try { await erase(other.id); } catch { /* llama-server down: the request will fail on its own */ }
        this.log('slot_erased', { slot: other.id, tokens: other.tokens, forNeeded: needed });
        cached -= other.tokens;
        Object.assign(other, { site: null, visitor: null, tokens: 0 });
      }
    }
    if (slot.site !== site) Object.assign(slot, { site, tokens: 0 }); // llama-server overwrites a foreign prefix
    slot.visitor = visitor;
    slot.used = ++this.clock; slot.at = Date.now(); // a counter orders uses within the same millisecond
    return slot.id;
  }

  record(id, tokens) {
    const slot = this.slots[id];
    if (slot) slot.tokens = tokens;
  }

  /** The answer in this slot is finished: its cache stays for the next question. */
  release(id) {
    const slot = this.slots[id];
    if (slot) Object.assign(slot, { busy: false, reserved: 0, at: Date.now() });
  }

  snapshot() { return this.slots.map(({ id, site, tokens, used, busy }) => ({ id, site, tokens, busy, idleSeconds: used && !busy ? Math.round((Date.now() - this.slots[id].at) / 1000) : null })); }
}
