// 로컬(한국) 실행: 설정된 조건을 조회해
//  1) 대시보드용 스냅샷(site/data/availability.json) 생성 — 지역/시설/날짜 필터용
//  2) alerts 목록 조건에 빈자리가 뜨면 텔레그램/웹훅 알림
//
// GitHub 러너는 숲나들e에 차단되므로 반드시 한국 접속 가능한 머신에서 실행합니다.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { search, getRegions, SECTION } from '../server/forestClient.js';
import { notifyAvailability } from '../server/notify.js';
import { getNationalFee, infoPageUrl } from '../server/nationalFee.js';

// .env 로드 (알림 설정: launchd/cron 환경에서도 동작하도록)
try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch { /* .env 없음 */ }

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'site', 'data');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 로컬 날짜 기준 YYYYMMDD (toISOString은 UTC라 -9h 밀림 → 사용 금지)
const ymd = (d) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const sectionNm = (s) => (s === '02' ? '야영장' : '숲속의 집');

// 오늘부터 이번달+다음달의 토→일(1박) 주말 목록 생성
function weekends2months() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endMonth = now.getMonth() + 2; // 이번달 + 다음달
  const end = new Date(now.getFullYear(), endMonth, 0); // 다음달 말일
  const out = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 6) { // 토요일
      const sat = new Date(d);
      const sun = new Date(d); sun.setDate(sun.getDate() + 1);
      out.push({ beginDate: ymd(sat), endDate: ymd(sun) });
    }
  }
  return out;
}

function buildDashboardQueries(cfg) {
  const dash = cfg.dashboard || {};
  const regions = dash.regions || [];
  const sections = dash.sections || ['01'];
  const dates = dash.dates === 'weekends-2months' ? weekends2months() : (dash.dates || []);
  const queries = [];
  for (const arcd of regions)
    for (const section of sections)
      for (const { beginDate, endDate } of dates)
        queries.push({ arcd, section, beginDate, endDate });
  return queries;
}

async function run() {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'config', 'watches.json'), 'utf8'));
  const regions = await getRegions();
  const regionName = Object.fromEntries(regions.map((r) => [r.arcd, r.name.trim()]));

  const queries = buildDashboardQueries(cfg);
  console.log(`[snapshot] 대시보드 조회 ${queries.length}건 시작`);
  const snapshots = [];
  const dateSet = new Set();

  for (const q of queries) {
    dateSet.add(q.beginDate);
    try {
      const results = await search({
        arcd: q.arcd, insttId: '', beginDate: q.beginDate, endDate: q.endDate,
        section: q.section === '02' ? SECTION.CAMP : SECTION.HOUSE,
      });
      const hits = results.filter((r) => (r.availableCount ?? 0) > 0);
      const sorted = results.sort((a, b) => (b.availableCount || 0) - (a.availableCount || 0));
      const mapped = [];
      for (const r of sorted) {
        // 공식 홈페이지: 사이트 제공 url 우선(공립/사립 전용도메인), 없으면 국립 단축링크
        const homeUrl = r.url && /^https?:\/\//.test(r.url)
          ? r.url.replace(/^http:/, 'https:')
          : (/^\d+$/.test(r.insttId) ? `https://www.foresttrip.go.kr/${r.insttId}` : '');
        // 국립(숫자 id): 로그인 없이 인원 페이지 + 대표 요금대 확보
        const fee = await getNationalFee(r.insttId); // 비국립/실패 시 null
        const priceRange = fee ? (q.section === '02' ? fee.camp : fee.house) : null;
        const infoUrl = infoPageUrl(r.insttId, q.section) || homeUrl;
        mapped.push({
          insttId: r.insttId, name: r.name, type: r.type,
          availableCount: r.availableCount,
          total: q.section === '02' ? r.totalCampsites : r.totalRooms,
          tel: r.tel,
          url: homeUrl,       // 공식 홈페이지
          infoUrl,            // 인원(몇인실) 안내 페이지 (국립=섹션별, 그 외=홈페이지)
          priceRange,         // 국립 대표 요금대 {min,max} | null
        });
      }
      snapshots.push({
        arcd: q.arcd,
        regionName: regionName[q.arcd] || q.arcd,
        section: q.section,
        sectionName: sectionNm(q.section),
        beginDate: q.beginDate,
        endDate: q.endDate,
        availableCount: hits.reduce((s, h) => s + (h.availableCount || 0), 0),
        results: mapped,
      });
    } catch (e) {
      const detail = e.cause ? ` (${e.cause.code || e.cause.message})` : '';
      console.error(`[snapshot] ${regionName[q.arcd]}/${sectionNm(q.section)}/${q.beginDate} 실패:${e.message}${detail}`);
      snapshots.push({ arcd: q.arcd, regionName: regionName[q.arcd], section: q.section,
        sectionName: sectionNm(q.section), beginDate: q.beginDate, endDate: q.endDate,
        error: e.message + detail, results: [] });
    }
    await sleep(1200);
  }

  // alerts: 특정 조건 빈자리 알림
  for (const a of cfg.alerts || []) {
    if (!a.beginDate || !a.endDate) continue;
    try {
      const results = await search({
        arcd: a.arcd || '', insttId: a.insttId || '', beginDate: a.beginDate, endDate: a.endDate,
        section: a.section === '02' ? SECTION.CAMP : SECTION.HOUSE,
      });
      const scoped = a.insttId ? results.filter((r) => r.insttId === a.insttId) : results;
      const hits = scoped.filter((r) => (r.availableCount ?? 0) > 0);
      if (hits.length) await notifyAvailability(a, hits);
      console.log(`[alert] ${a.label || a.insttId}: 예약가능 ${hits.length}곳`);
    } catch (e) {
      console.error(`[alert] ${a.label} 실패:`, e.message);
    }
    await sleep(1200);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    regions: [...new Set(snapshots.map((s) => s.arcd))].map((arcd) => ({ arcd, name: regionName[arcd] || arcd })),
    dates: [...dateSet].sort(),
    sections: (cfg.dashboard?.sections || ['01']).map((s) => ({ code: s, name: sectionNm(s) })),
    snapshots,
  };
  writeFileSync(join(OUT_DIR, 'availability.json'), JSON.stringify(payload));
  console.log(`[snapshot] availability.json 작성 완료 (${snapshots.length} 스냅샷)`);
}

run().catch((e) => { console.error(e); process.exit(1); });
