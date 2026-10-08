// One global FIFO queue for every site. Up to `parallel` jobs run on the GPU at the same time, as long as their
// tokens (prompt plus longest answer) fit into the shared KV pool together; otherwise the next job waits.
// A visitor (per site) can have only one job queued or running, a site has a queue cap,
// and the whole queue has a cap, so one busy site cannot starve the others for long.

export class QueueError extends Error {
  constructor(code, message, status = 429, retryAfter = 30) {
    super(message);
    this.code = code; this.status = status; this.retryAfter = retryAfter;
  }
}

export class Scheduler {
  constructor({ maxLength, maxPerKey, maxWaitSeconds, parallel = 1, capacity = Infinity }) {
    Object.assign(this, { maxLength, maxPerKey, maxWaitSeconds, parallel, capacity });
    this.waiting = [];
    this.active = [];
    this.durations = [];   // recent job durations (ms) for wait estimates
    this.completed = 0;
  }

  get length() { return this.waiting.length + this.active.length; }

  /** Tokens the running jobs may take at most. */
  reserved() { return this.active.reduce((n, job) => n + job.tokens, 0); }

  /** llama-server's slots and pool can change when it restarts with another profile. */
  configure({ parallel, capacity }) {
    const changed = parallel !== this.parallel || capacity !== this.capacity;
    Object.assign(this, { parallel: Math.max(1, parallel), capacity });
    if (changed) this.pump();
  }

  averageSeconds() {
    if (!this.durations.length) return 20;
    return this.durations.reduce((a, b) => a + b, 0) / this.durations.length / 1000;
  }

  /**
   * Seconds until a job at this waiting position (1 = next) starts. Each running answer frees its place after about
   * one average answer; the next in line takes the place that frees first and holds it for an average answer.
   */
  estimate(position) {
    const average = this.averageSeconds(), now = Date.now();
    const places = [...Array(Math.max(0, this.parallel - this.active.length)).fill(0), ...this.active.map(job => Math.max(average - (now - job.startedAt) / 1000, 3))];
    let start = 0;
    for (let i = 0; i < position; i++) {
      places.sort((a, b) => a - b);
      start = places.shift();
      places.push(start + average);
    }
    return Math.round(start);
  }

  /**
   * Adds a job. `run(signal)` does the GPU work; `onUpdate({position, estimate})` is called whenever
   * the job's place changes (position 0 = running). `tokens` is the most it can take of the shared pool.
   * Returns a promise for run()'s result.
   */
  enqueue({ keyId, visitor, maxQueued = this.maxPerKey, tokens = 0, run, onUpdate = () => {}, signal }) {
    const owner = `${keyId}:${visitor || 'anonymous'}`;
    const all = [...this.waiting, ...this.active];
    if (visitor && all.some(job => job.owner === owner)) throw new QueueError('visitor_busy', 'This visitor already has a question in progress. Wait for the answer, then ask again.', 429, 10);
    if (all.filter(job => job.keyId === keyId).length >= Math.min(maxQueued, this.maxPerKey)) throw new QueueError('site_busy', 'This website has too many questions waiting. Try again in a minute.', 503, 30);
    if (this.length >= this.maxLength) throw new QueueError('queue_full', 'The assistant is very busy right now. Try again in a minute.', 503, 45);

    return new Promise((resolve, reject) => {
      const job = { keyId, owner, tokens, run, onUpdate, resolve, reject, controller: new AbortController(), queuedAt: Date.now(), startedAt: 0 };
      const cancel = () => this.cancel(job, new QueueError('cancelled', 'The request was cancelled.', 499, 0));
      if (signal) { if (signal.aborted) return reject(new QueueError('cancelled', 'The request was cancelled.', 499, 0)); signal.addEventListener('abort', cancel, { once: true }); }
      job.detach = () => signal?.removeEventListener('abort', cancel);
      job.timeout = setTimeout(() => this.cancel(job, new QueueError('queue_timeout', 'The assistant is too busy to answer right now. Please try again shortly.', 503, 60)), this.maxWaitSeconds * 1000);
      this.waiting.push(job);
      this.pump(); // starts at once when there is room, so an idle queue never reports a wait
      this.notify();
    });
  }

  cancel(job, error) {
    const index = this.waiting.indexOf(job);
    if (index >= 0) {
      this.waiting.splice(index, 1);
      clearTimeout(job.timeout); job.detach();
      job.reject(error);
      this.notify();
      this.pump(); // a big job at the head may have held back smaller ones
    } else if (this.active.includes(job)) {
      job.controller.abort(error); // run() sees the abort and stops the upstream request
    }
  }

  notify() {
    for (const job of this.active) job.onUpdate({ position: 0, estimate: 0 });
    this.waiting.forEach((job, i) => job.onUpdate({ position: i + 1, estimate: this.estimate(i + 1) }));
  }

  /** Starts waiting jobs in arrival order while there is a free place and room in the pool. */
  pump() {
    let started = false;
    while (this.waiting.length && this.active.length < this.parallel) {
      const job = this.waiting[0];
      // The head waits for room instead of letting smaller jobs pass, so a long conversation is never starved.
      if (this.active.length && this.reserved() + job.tokens > this.capacity) break;
      this.waiting.shift();
      this.start(job);
      started = true;
    }
    if (started) this.notify();
  }

  async start(job) {
    clearTimeout(job.timeout);
    job.startedAt = Date.now();
    this.active.push(job);
    try { job.resolve(await job.run(job.controller.signal)); }
    catch (error) { job.reject(error); }
    finally {
      job.detach();
      this.durations.push(Date.now() - job.startedAt);
      if (this.durations.length > 20) this.durations.shift();
      this.completed++;
      this.active.splice(this.active.indexOf(job), 1);
      queueMicrotask(() => { this.pump(); this.notify(); });
    }
  }

  snapshot() {
    return {
      running: this.active.length > 0, active: this.active.length, parallel: this.parallel, waiting: this.waiting.length, completed: this.completed,
      averageSeconds: Math.round(this.averageSeconds() * 10) / 10,
      estimatedWaitSeconds: this.waiting.length || this.active.length >= this.parallel ? this.estimate(this.waiting.length + 1) : 0,
    };
  }
}
