import { execFile } from 'node:child_process';
import path from 'node:path';
import { gatewayRoot } from './config.mjs';

// Samples where llama-server's memory lives (RAM working set, VRAM, GPU-shared RAM).
// llama.cpp legitimately pins some host memory (staging and draft buffers), so "spilling" means GPU-shared
// RAM grew clearly beyond what this llama-server process used right after it loaded.
export class MemoryMonitor {
  constructor({ intervalSeconds = 30, spillThresholdMB = 700, log = () => {} } = {}) {
    Object.assign(this, { intervalSeconds, spillThresholdMB, log });
    this.latest = null;
    this.history = [];
    this.script = path.join(gatewayRoot, '..', 'model', 'check-memory.ps1');
  }

  sample() {
    if (process.platform !== 'win32') return Promise.resolve(null);
    return new Promise(resolve => {
      execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', this.script, '-Json'], { timeout: 20000, windowsHide: true }, (error, stdout) => {
        try {
          const data = JSON.parse(String(stdout).trim());
          if (data.running) {
            // Baseline: the highest of the first three samples of this process (loading, then idle).
            if (this.baseline?.pid !== data.pid) this.baseline = { pid: data.pid, samples: 0, sharedRamMB: 0 };
            if (this.baseline.samples < 3) { this.baseline.samples++; this.baseline.sharedRamMB = Math.max(this.baseline.sharedRamMB, data.sharedRamMB); }
            data.baselineSharedMB = this.baseline.sharedRamMB;
            data.spilling = this.baseline.samples >= 3 && data.sharedRamMB > this.baseline.sharedRamMB + this.spillThresholdMB;
          }
          data.at = new Date().toISOString();
          resolve(data);
        } catch { resolve({ running: false, at: new Date().toISOString() }); }
      });
    });
  }

  start() {
    const tick = async () => {
      const data = await this.sample();
      if (!data) return;
      if (data.spilling && !this.latest?.spilling) this.log('memory_spill', data);
      this.latest = data;
      this.history.push({ at: data.at, ws: data.workingSetMB, vram: data.processVramMB, shared: data.sharedRamMB });
      if (this.history.length > 2880) this.history.shift(); // one day at 30 s
    };
    tick();
    this.timer = setInterval(tick, this.intervalSeconds * 1000);
    this.timer.unref();
  }

  stop() { clearInterval(this.timer); }
}
