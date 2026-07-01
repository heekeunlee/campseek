// 감시 루프: 활성 watch를 주기적으로 조회하고, 빈자리가 새로 생기면 알림.
import { listWatches, updateWatch } from './store.js';
import { search } from './forestClient.js';
import { notifyAvailability } from './notify.js';

const INTERVAL_MS = Number(process.env.WATCH_INTERVAL_MS || 5 * 60 * 1000); // 기본 5분
const RENOTIFY_MS = Number(process.env.WATCH_RENOTIFY_MS || 60 * 60 * 1000); // 재알림 최소간격 1시간
const GAP_MS = 1500; // 개별 조회 간 간격(서버 부하 배려)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let timer = null;
let running = false;

function isExpired(w) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return w.endDate < today;
}

async function checkWatch(w) {
  const results = await search({
    arcd: w.arcd,
    insttId: w.insttId,
    beginDate: w.beginDate,
    endDate: w.endDate,
    section: w.section,
    availableOnly: false,
  });
  const scoped = w.insttId ? results.filter((r) => r.insttId === w.insttId) : results;
  const hits = scoped.filter((r) => (r.availableCount ?? 0) > 0);
  const totalAvail = hits.reduce((s, h) => s + (h.availableCount || 0), 0);

  const patch = { lastCheckedAt: new Date().toISOString(), lastAvailableCount: totalAvail };

  // 새 빈자리(직전 조회 대비 증가) 또는 재알림 간격 경과 시 알림
  const prev = w.lastAvailableCount ?? 0;
  const dueRenotify =
    !w.lastNotifiedAt || Date.now() - new Date(w.lastNotifiedAt).getTime() > RENOTIFY_MS;
  if (hits.length > 0 && (totalAvail > prev || dueRenotify)) {
    await notifyAvailability(w, hits);
    patch.lastNotifiedAt = new Date().toISOString();
  }
  updateWatch(w.id, patch);
  return { watch: w.id, totalAvail, hits: hits.length };
}

export async function runOnce() {
  const active = listWatches().filter((w) => w.active && !isExpired(w));
  const out = [];
  for (const w of active) {
    try {
      out.push(await checkWatch(w));
    } catch (e) {
      console.error(`[watcher] ${w.id} 조회 실패:`, e.message);
    }
    await sleep(GAP_MS);
  }
  // 만료된 감시는 자동 비활성화
  for (const w of listWatches()) {
    if (w.active && isExpired(w)) updateWatch(w.id, { active: false });
  }
  return out;
}

export function startWatcher() {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runOnce();
      if (r.length) console.log(`[watcher] ${r.length}개 감시 조회 완료`);
    } catch (e) {
      console.error('[watcher] tick 오류:', e.message);
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, INTERVAL_MS);
  tick(); // 시작 시 즉시 1회
  console.log(`[watcher] 시작 (주기 ${INTERVAL_MS / 1000}s)`);
}

export function stopWatcher() {
  if (timer) clearInterval(timer);
  timer = null;
}
