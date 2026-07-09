// 로컬(한국) 실행: 설정된 조건을 조회해
//  1) 대시보드용 스냅샷(site/data/availability.json) 생성 — 지역/시설/날짜 필터용
//  2) alerts 목록 조건에 빈자리가 뜨면 텔레그램/웹훅 알림
//
// GitHub 러너는 숲나들e에 차단되므로 반드시 한국 접속 가능한 머신에서 실행합니다.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { search, getRegions, getForests, SECTION } from '../server/forestClient.js';
import { getCaravanForests } from '../server/caravan.js';
import {
  SOOPERANG_CATALOG, getFacilityAvailability,
  monthUrl as spMonthUrl, reserveUrl as spReserveUrl, homeUrl as spHomeUrl,
} from '../server/sooperangClient.js';
import { notifyAvailability } from '../server/notify.js';
import { infoPageUrl } from '../server/forestFee.js';

// .env 로드 (알림 설정: launchd/cron 환경에서도 동작하도록)
try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch { /* .env 없음 */ }

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'site', 'data');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 로컬 날짜 기준 YYYYMMDD (toISOString은 UTC라 -9h 밀림 → 사용 금지)
const ymd = (d) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const sectionNm = (s) =>
  s === '04' ? '숲이랑' : s === '03' ? '카라반' : s === '02' ? '야영장' : '숲속의 집';

// 오늘부터 이번달+다음달의 주말(토·일 각 1박) 입실일 목록 생성
//  - 토요일 입실(토→일), 일요일 입실(일→월) 모두 포함
function weekends2months() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endMonth = now.getMonth() + 2; // 이번달 + 다음달
  const end = new Date(now.getFullYear(), endMonth, 0); // 다음달 말일
  const out = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day === 6 || day === 0) { // 토요일 또는 일요일 입실
      const bg = new Date(d);
      const ed = new Date(d); ed.setDate(ed.getDate() + 1);
      out.push({ beginDate: ymd(bg), endDate: ymd(ed) });
    }
  }
  return out;
}

// 오늘부터 이번달+다음달의 모든 날짜(주중·주말) 입실일(1박) 목록 생성
function allDays2months() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth() + 2, 0); // 다음달 말일
  const out = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const bg = new Date(d);
    const ed = new Date(d); ed.setDate(ed.getDate() + 1);
    out.push({ beginDate: ymd(bg), endDate: ymd(ed) });
  }
  return out;
}

function resolveDates(cfg) {
  const dash = cfg.dashboard || {};
  if (dash.dates === 'all-2months') return allDays2months();
  if (dash.dates === 'weekends-2months') return weekends2months();
  return dash.dates || [];
}

// 숲나들e 검색 결과 1건 → 대시보드 표시용 레코드
function mapForest(r, section) {
  const homeUrl = r.url && /^https?:\/\//.test(r.url)
    ? r.url.replace(/^http:/, 'https:')
    : (/^\d+$/.test(r.insttId) ? `https://www.foresttrip.go.kr/${r.insttId}` : '');
  return {
    insttId: r.insttId, name: r.name, type: r.type,
    availableCount: r.availableCount,
    total: section === '02' ? r.totalCampsites : r.totalRooms,
    tel: r.tel,
    url: homeUrl,
    infoUrl: infoPageUrl(r.insttId, section) || homeUrl,
  };
}

// 카라반 스냅샷: 카라반 보유 휴양림을 (지역, 날짜)별로 묶어 개별 조회.
// availableCount는 카라반 상품분류만 집계되며, 숙박·야영 양쪽 카라반이 있으면 합산한다.
//
// 부하 최적화(가지치기): 카라반은 숙박/야영의 부분집합이므로, 해당 휴양림·날짜의
// 상위(숙박/야영) 빈자리가 0이면 카라반도 0 → 개별 조회를 건너뛴다.
// availByDay[section][beginDate][insttId] = 상위 빈자리 수 (전국 일괄조회에서 수집).
async function caravanSnapshots(cfg, dates, regionName, availByDay = { '01': {}, '02': {} }) {
  const dash = cfg.dashboard || {};
  const wantRegions = new Set(dash.regions || []);
  const forests = (await getCaravanForests()).filter((f) => wantRegions.has(f.arcd));
  const byArcd = {};
  for (const f of forests) (byArcd[f.arcd] ||= []).push(f);

  const snaps = [];
  for (const [arcd, list] of Object.entries(byArcd)) {
    for (const { beginDate, endDate } of dates) {
      const results = [];
      for (const f of list) {
        let avail = 0, name = f.name, type = '', tel = '', url = '';
        for (const [sect, codes, key] of [
          ['02', f.camp, 'campClssc'],
          ['01', f.house, 'houseClssc'],
        ]) {
          if (!codes.length) continue;
          // 상위(숙박/야영) 빈자리가 0이면 카라반 조회 생략
          const parent = availByDay[sect]?.[beginDate];
          if (parent && !(parent[f.insttId] > 0)) continue;
          try {
            const rs = await search({
              arcd, insttId: f.insttId, beginDate, endDate,
              section: sect === '02' ? SECTION.CAMP : SECTION.HOUSE,
              [key]: codes,
            });
            const rec = rs.find((r) => r.insttId === f.insttId) || rs[0];
            if (rec) {
              avail += rec.availableCount || 0;
              name = rec.name || name; type = rec.type || type;
              tel = rec.tel || tel; url = rec.url || url;
            }
          } catch (e) {
            console.error(`[caravan] ${f.name}/${sect}/${beginDate} 실패: ${e.message}`);
          }
          await sleep(1000);
        }
        const homeUrl = url && /^https?:\/\//.test(url)
          ? url.replace(/^http:/, 'https:')
          : (/^\d+$/.test(f.insttId) ? `https://www.foresttrip.go.kr/${f.insttId}` : '');
        // 카라반이 야영에 있으면 야영 인원안내, 아니면 숙박 인원안내 페이지
        const infoUrl = infoPageUrl(f.insttId, f.camp.length ? '02' : '01') || homeUrl;
        results.push({
          insttId: f.insttId, name, type,
          availableCount: avail, total: null, tel, url: homeUrl, infoUrl,
        });
      }
      results.sort((a, b) => (b.availableCount || 0) - (a.availableCount || 0));
      snaps.push({
        arcd, regionName: regionName[arcd] || arcd,
        section: '03', sectionName: '카라반',
        beginDate, endDate,
        availableCount: results.reduce((s, r) => s + (r.availableCount > 0 ? r.availableCount : 0), 0),
        results,
      });
    }
  }
  return snaps;
}

// 숲이랑(산림복지시설: 숲체원·산림치유원) 스냅샷.
// 시설별 월별예약조회를 1회씩 조회(예약가능 창 ~1개월)하고, (지역, 날짜)별로 묶는다.
async function sooperangSnapshots(cfg, dates, regionName) {
  const wantRegions = new Set(cfg.dashboard?.regions || []);
  const cat = SOOPERANG_CATALOG.filter((f) => f.lodging && wantRegions.has(f.arcd));

  // 시설별 예약가능 현황 1회씩 수집
  const avail = {};
  for (const f of cat) {
    try { avail[f.insttId] = await getFacilityAvailability(f.insttId); }
    catch (e) { console.error(`[sooperang] ${f.name} 실패: ${e.message}`); avail[f.insttId] = null; }
    await sleep(1000);
  }

  const byArcd = {};
  for (const f of cat) (byArcd[f.arcd] ||= []).push(f);

  const snaps = [];
  for (const [arcd, list] of Object.entries(byArcd)) {
    for (const { beginDate, endDate } of dates) {
      const results = [];
      for (const f of list) {
        const a = avail[f.insttId];
        if (!a || a.totalRooms === 0) continue;
        const day = a.byDay[beginDate];
        // 창(약 1개월) 밖이면 아직 예약 미오픈 → null(‘—’), 안이면 가능 객실 수
        const availableCount = day ? day.avail : (a.windowMax && beginDate > a.windowMax ? null : 0);
        results.push({
          insttId: f.insttId, name: f.name, type: f.type || '국립',
          availableCount, total: a.totalRooms, tel: '',
          url: spHomeUrl(f.insttId),
          infoUrl: spMonthUrl(f.insttId),   // 월별예약조회(빈자리 달력)
          reserveUrl: spReserveUrl(f.insttId), // 숙박예약(로그인 필요)
        });
      }
      if (!results.length) continue;
      results.sort((a, b) => (b.availableCount || 0) - (a.availableCount || 0));
      snaps.push({
        arcd, regionName: regionName[arcd] || arcd,
        section: '04', sectionName: '숲이랑',
        beginDate, endDate,
        availableCount: results.reduce((s, r) => s + (r.availableCount > 0 ? r.availableCount : 0), 0),
        results,
      });
    }
  }
  return snaps;
}

async function run() {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'config', 'watches.json'), 'utf8'));
  const regions = await getRegions();
  const regionName = Object.fromEntries(regions.map((r) => [r.arcd, r.name.trim()]));

  // insttId → 지역코드 매핑 (전국 일괄조회 결과를 지역별로 재분류하기 위함)
  const forests = await getForests();
  const arcdByInstt = Object.fromEntries(forests.map((f) => [f.insttId, f.arcd]));

  const dates = resolveDates(cfg);
  const wantRegions = (cfg.dashboard?.regions || []);
  const wantRegionSet = new Set(wantRegions);
  const sections = (cfg.dashboard?.sections || ['01']).filter((s) => s === '01' || s === '02');
  console.log(`[snapshot] 대시보드 조회: ${dates.length}일 × 섹션 ${sections.length}개 (전국 일괄) 시작`);
  const snapshots = [];
  const dateSet = new Set();
  // 카라반 가지치기용: availByDay[section][beginDate][insttId] = 상위 빈자리 수
  const availByDay = { '01': {}, '02': {} };

  for (const { beginDate, endDate } of dates) {
    dateSet.add(beginDate);
    for (const section of sections) {
      const secObj = section === '02' ? SECTION.CAMP : SECTION.HOUSE;
      let results;
      try {
        results = await search({ arcd: '', insttId: '', beginDate, endDate, section: secObj });
      } catch (e) {
        const detail = e.cause ? ` (${e.cause.code || e.cause.message})` : '';
        console.error(`[snapshot] 전국/${sectionNm(section)}/${beginDate} 실패:${e.message}${detail}`);
        await sleep(1200);
        continue;
      }
      // 가지치기용 빈자리 맵 기록
      const rec = (availByDay[section][beginDate] = {});
      for (const r of results) rec[r.insttId] = r.availableCount || 0;
      // 지역별로 재분류
      const byArcd = {};
      for (const r of results) {
        const arcd = arcdByInstt[r.insttId];
        if (!arcd || !wantRegionSet.has(arcd)) continue;
        (byArcd[arcd] ||= []).push(r);
      }
      for (const [arcd, list] of Object.entries(byArcd)) {
        const mapped = list
          .sort((a, b) => (b.availableCount || 0) - (a.availableCount || 0))
          .map((r) => mapForest(r, section));
        snapshots.push({
          arcd, regionName: regionName[arcd] || arcd,
          section, sectionName: sectionNm(section),
          beginDate, endDate,
          availableCount: mapped.reduce((s, r) => s + (r.availableCount > 0 ? r.availableCount : 0), 0),
          results: mapped,
        });
      }
      await sleep(1000);
    }
  }

  // 카라반 스냅샷 (설정에 '03' 포함 시)
  if ((cfg.dashboard?.sections || []).includes('03')) {
    try {
      const cSnaps = await caravanSnapshots(cfg, dates, regionName, availByDay);
      for (const s of cSnaps) { dateSet.add(s.beginDate); snapshots.push(s); }
      console.log(`[snapshot] 카라반 스냅샷 ${cSnaps.length}건 추가`);
    } catch (e) {
      console.error(`[snapshot] 카라반 조회 실패: ${e.message}`);
    }
  }

  // 숲이랑 스냅샷 (설정에 '04' 포함 시)
  if ((cfg.dashboard?.sections || []).includes('04')) {
    try {
      const sSnaps = await sooperangSnapshots(cfg, dates, regionName);
      for (const s of sSnaps) { dateSet.add(s.beginDate); snapshots.push(s); }
      console.log(`[snapshot] 숲이랑 스냅샷 ${sSnaps.length}건 추가`);
    } catch (e) {
      console.error(`[snapshot] 숲이랑 조회 실패: ${e.message}`);
    }
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
