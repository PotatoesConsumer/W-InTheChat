/**
 * Peak GPU memory while the service runs, for the study's session logs (proposal:
 * "log ... peak GPU memory"). nvidia-smi reports memory.used every second; reset() starts
 * a new peak (each session half), peak() reads it. Without nvidia-smi, peak() is null.
 */

import { spawn } from "node:child_process";

export function watchGpuMemory({ everyMs = 1000 } = {}) {
  let peak = null;
  let total = null;
  let proc = null;
  try {
    proc = spawn("nvidia-smi", [
      "--query-gpu=memory.used,memory.total",
      "--format=csv,noheader,nounits",
      "-lms",
      String(everyMs),
    ]);
    proc.on("error", () => (proc = null));
    let buffer = "";
    proc.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        const [used, all] = line.split(",").map((v) => Number(v.trim()));
        if (!Number.isFinite(used)) continue;
        peak = Math.max(peak ?? 0, used);
        total = all;
      }
    });
  } catch {
    proc = null;
  }
  return {
    reset() {
      peak = null;
    },
    /** @returns {{peakMiB: number, totalMiB: number} | null} */
    peak: () => (peak === null ? null : { peakMiB: peak, totalMiB: total }),
    stop() {
      proc?.kill();
    },
  };
}
