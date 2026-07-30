// worker/orchestrator/capacity.js
//
// Dinamikus párhuzamossági fék. A MAX_PARALLEL a felső korlát, de ha a gép
// terhelt (magas load vagy kevés szabad RAM), akkor átmenetileg kevesebb új
// munkát veszünk fel. Így nem fullad be a VPS, és nem ragadnak be futások.

import os from "node:os";

const MAX_PARALLEL = Number(process.env.MAX_PARALLEL || 24);
const MIN_PARALLEL = Number(process.env.MIN_PARALLEL || 1);
// Terhelés/mag arány, ami felett nem indítunk újat.
const LOAD_PER_CPU_LIMIT = Number(process.env.LOAD_PER_CPU_LIMIT || 2);
// Ennyi szabad RAM (MB) kell legalább egy új böngészős munkához.
const MEM_PER_JOB_MB = Number(process.env.MEM_PER_JOB_MB || 800);
// Ennyi százalék RAM felett egyáltalán nem indítunk újat.
const MEM_HARD_LIMIT_PCT = Number(process.env.MEM_HARD_LIMIT_PCT || 90);

export function currentLimit(inflight) {
  const cpus = os.cpus().length || 1;
  const [load1] = os.loadavg();
  const freeMb = os.freemem() / 1048576;
  const memPct = ((os.totalmem() - os.freemem()) / os.totalmem()) * 100;

  let limit = MAX_PARALLEL;
  const reasons = [];

  if (memPct >= MEM_HARD_LIMIT_PCT) {
    limit = Math.min(limit, inflight);
    reasons.push(`RAM ${memPct.toFixed(0)}%`);
  } else {
    const byMem = inflight + Math.floor(freeMb / MEM_PER_JOB_MB);
    if (byMem < limit) {
      limit = Math.max(MIN_PARALLEL, byMem);
      reasons.push(`szabad RAM ${Math.round(freeMb)} MB`);
    }
  }

  if (load1 / cpus > LOAD_PER_CPU_LIMIT) {
    limit = Math.max(MIN_PARALLEL, Math.min(limit, inflight));
    reasons.push(`load ${load1.toFixed(2)} / ${cpus} mag`);
  }

  return { limit: Math.max(MIN_PARALLEL, Math.min(MAX_PARALLEL, limit)), reasons, cpus, load1, memPct };
}

export const HARD_MAX = MAX_PARALLEL;
