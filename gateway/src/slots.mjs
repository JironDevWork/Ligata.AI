// Prompt-cache affinity across websites.
//
// llama-server runs a few slots over ONE unified KV pool in VRAM (the full context window). Each
// website is pinned to a slot, so its processed instructions + knowledge stay cached and the next
// visitor's first word comes in well under a second instead of re-reading the knowledge. Because the
// slots share the pool, cached prefixes of idle sites are erased (least recently used first) when a
// request needs the room, and idle caches are capped because attention spans every occupied cell.
export class SlotManager {
  constructor({ count = 1, contextTokens = 0, maxIdleTokens = 65536, reserve = 2048, log = () => {} } = {}) {
    Object.assign(this, { contextTokens, maxIdleTokens, reserve, log, clock: 0 });
    this.resize(count);
  }

  resize(count) {
    if (this.slots?.length === count) return;
    this.slots = Array.from({ length: Math.max(1, count) }, (_, id) => ({ id, site: null, tokens: 0, used: 0 }));
  }

  reset() { for (const slot of this.slots) Object.assign(slot, { site: null, tokens: 0, used: 0 }); }

  /**
   * Chooses the slot for a site and frees room in the shared pool. `erase(id)` clears a slot's cache in
   * llama-server. Returns the slot id to pass as id_slot.
   */
  async assign(site, needed, erase) {
    const slot = this.slots.find(s => s.site === site) || this.slots.find(s => !s.site) || [...this.slots].sort((a, b) => a.used - b.used)[0];
    if (this.slots.length > 1) {
      const idle = this.slots.filter(s => s !== slot && s.tokens > 0).sort((a, b) => a.used - b.used);
      let cached = idle.reduce((n, s) => n + s.tokens, 0);
      for (const other of idle) {
        if (cached + needed + this.reserve <= this.contextTokens && cached <= this.maxIdleTokens) break;
        try { await erase(other.id); } catch { /* llama-server down: the request will fail on its own */ }
        this.log('slot_erased', { slot: other.id, tokens: other.tokens, forNeeded: needed });
        cached -= other.tokens;
        Object.assign(other, { site: null, tokens: 0 });
      }
    }
    if (slot.site !== site) Object.assign(slot, { site, tokens: 0 }); // llama-server overwrites a foreign prefix
    slot.used = ++this.clock; slot.at = Date.now(); // a counter orders uses within the same millisecond
    return slot.id;
  }

  record(id, tokens) {
    const slot = this.slots[id];
    if (slot) slot.tokens = tokens;
  }

  snapshot() { return this.slots.map(({ id, site, tokens, used }) => ({ id, site, tokens, idleSeconds: used ? Math.round((Date.now() - this.slots[id].at) / 1000) : null })); }
}
