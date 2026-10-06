// One global FIFO queue for every site. Exactly one job runs on the GPU at a time.
// A visitor (per site) can have only one job queued or running, a site has a queue cap,
// and the whole queue has a cap, so one busy site cannot starve the others for long.

export class QueueError extends Error {
  constructor(code, message, status = 429, retryAfter = 30) {
    super(message);
    this.code = code; this.status = status; this.retryAfter = retryAfter;
  }
}

export class Scheduler {
  constructor({ maxLength, maxPerKey, maxWaitSeconds }) {
    Object.assign(this, { maxLength, maxPerKey, maxWaitSeconds });
    this.waiting = [];
    this.active = null;
    this.durations = [];   // recent job durations (ms) for wait estimates
    this.completed = 0;
  }

  get length() { return this.waiting.length + (this.active ? 1 : 0); }

  averageSeconds() {
    if (!this.durations.length) return 20;
    return this.durations.reduce((a, b) => a + b, 0) / this.durations.length / 1000;
  }

  /** Seconds until a job at this waiting position (1 = next) starts. */
  estimate(position) {
    const average = this.averageSeconds();
    const remainingActive = this.active ? Math.max(average - (Date.now() - this.active.startedAt) / 1000, 3) : 0;
    return Math.round(remainingActive + (position - 1) * average);
  }

  /**
   * Adds a job. `run(signal)` does the GPU work; `onUpdate({position, estimate})` is called whenever
   * the job's place changes (position 0 = running). Returns a promise for run()'s result.
   */
  enqueue({ keyId, visitor, maxQueued = this.maxPerKey, run, onUpdate = () => {}, signal }) {
    const owner = `${keyId}:${visitor || 'anonymous'}`;
    const all = [...this.waiting, ...(this.active ? [this.active] : [])];
    if (visitor && all.some(job => job.owner === owner)) throw new QueueError('visitor_busy', 'This visitor already has a question in progress. Wait for the answer, then ask again.', 429, 10);
    if (all.filter(job => job.keyId === keyId).length >= Math.min(maxQueued, this.maxPerKey)) throw new QueueError('site_busy', 'This website has too many questions waiting. Try again in a minute.', 503, 30);
    if (this.length >= this.maxLength) throw new QueueError('queue_full', 'The assistant is very busy right now. Try again in a minute.', 503, 45);

    return new Promise((resolve, reject) => {
      const job = { keyId, owner, run, onUpdate, resolve, reject, controller: new AbortController(), queuedAt: Date.now(), startedAt: 0 };
      const cancel = () => this.cancel(job, new QueueError('cancelled', 'The request was cancelled.', 499, 0));
      if (signal) { if (signal.aborted) return reject(new QueueError('cancelled', 'The request was cancelled.', 499, 0)); signal.addEventListener('abort', cancel, { once: true }); }
      job.detach = () => signal?.removeEventListener('abort', cancel);
      job.timeout = setTimeout(() => this.cancel(job, new QueueError('queue_timeout', 'The assistant is too busy to answer right now. Please try again shortly.', 503, 60)), this.maxWaitSeconds * 1000);
      this.waiting.push(job);
      this.pump(); // starts at once when idle, so an idle queue never reports a wait
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
    } else if (this.active === job) {
      job.controller.abort(error); // run() sees the abort and stops the upstream request
    }
  }

  notify() {
    if (this.active) this.active.onUpdate({ position: 0, estimate: 0 });
    this.waiting.forEach((job, i) => job.onUpdate({ position: i + 1, estimate: this.estimate(i + 1) }));
  }

  async pump() {
    if (this.active || !this.waiting.length) return;
    const job = this.active = this.waiting.shift();
    clearTimeout(job.timeout);
    job.startedAt = Date.now();
    this.notify();
    try { job.resolve(await job.run(job.controller.signal)); }
    catch (error) { job.reject(error); }
    finally {
      job.detach();
      this.durations.push(Date.now() - job.startedAt);
      if (this.durations.length > 20) this.durations.shift();
      this.completed++;
      this.active = null;
      this.notify();
      queueMicrotask(() => this.pump());
    }
  }

  snapshot() {
    return {
      running: !!this.active, waiting: this.waiting.length, completed: this.completed,
      averageSeconds: Math.round(this.averageSeconds() * 10) / 10,
      estimatedWaitSeconds: this.waiting.length || this.active ? this.estimate(this.waiting.length + 1) : 0,
    };
  }
}
