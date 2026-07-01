// GitHub Actions(cron)에서 실행: 설정된 감시 조건을 조회해
//  1) Pages 대시보드용 JSON(site/data/availability.json) 생성
//  2) 빈자리(availableCount>0) 발생 시 텔레그램/웹훅 알림 발송
//
// 서버 없이 GitHub 안에서만 도는 방식. (CORS 무관 — 러너에서 직접 호출)
import { readFileSync, mkdirSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { search, SECTION } from '../server/forestClient.js';
import { notifyAvailability } from '../server/notify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SITE = join(ROOT, 'site');
const OUT_DIR = join(SITE, 'data');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadWatches() {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'config', 'watches.json'), 'utf8'));
  return (cfg.watches || []).filter((w) => w.beginDate && w.endDate);
}

async function run() {
  const watches = loadWatches();
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const snapshots = [];

  for (const w of watches) {
    if (w.endDate < today) continue; // 지난 날짜 건너뜀
    const section = w.section === '02' ? SECTION.CAMP : SECTION.HOUSE;
    try {
      const results = await search({
        arcd: w.arcd || '',
        insttId: w.insttId || '',
        beginDate: w.beginDate,
        endDate: w.endDate,
        section,
      });
      const scoped = w.insttId ? results.filter((r) => r.insttId === w.insttId) : results;
      const hits = scoped.filter((r) => (r.availableCount ?? 0) > 0);
      console.log(`[snapshot] ${w.label}: ${scoped.length}개 시설, 예약가능 ${hits.length}곳`);
      if (hits.length > 0) await notifyAvailability(w, hits);
      snapshots.push({
        ...w,
        sectionName: w.section === '02' ? '야영장' : '숲속의 집',
        checkedAt: new Date().toISOString(),
        availableCount: hits.reduce((s, h) => s + (h.availableCount || 0), 0),
        results: scoped
          .sort((a, b) => (b.availableCount || 0) - (a.availableCount || 0))
          .map((r) => ({
            insttId: r.insttId,
            name: r.name,
            type: r.type,
            availableCount: r.availableCount,
            total: w.section === '02' ? r.totalCampsites : r.totalRooms,
            tel: r.tel,
            bookable: r.bookable,
          })),
      });
    } catch (e) {
      const detail = e.cause ? ` (cause: ${e.cause.code || e.cause.message})` : '';
      console.error(`[snapshot] ${w.label} 실패:`, e.message + detail);
      snapshots.push({ ...w, error: e.message + detail, checkedAt: new Date().toISOString(), results: [] });
    }
    await sleep(1500);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    join(OUT_DIR, 'availability.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), snapshots }, null, 2)
  );
  console.log(`[snapshot] site/data/availability.json 작성 완료 (${snapshots.length}건)`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
