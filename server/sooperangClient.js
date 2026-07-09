// 숲이랑(sooperang.go.kr) — 한국산림복지진흥원(산림청 산하) 산림복지시설 빈자리 조회.
// 숲나들e(자연휴양림)와는 별개 시스템으로, 국립숲체원·국립산림치유원 등의 숙박(숲속의 집 유사)을 다룬다.
//
// 방식: 시설별 '월별예약조회' 페이지에 임베드된 gsrmList(JSON: 객실×일자, rsrvtYn=="Y"=예약가능)를 파싱.
//   - 페이지 전체는 최대 24MB지만 gsrmList는 앞쪽 ~1MB 구간에 있어, 스트리밍으로 거기까지만 읽고 끊는다.
//   - 예약가능 날짜창은 약 1개월 롤링(그 이후는 예약 미오픈) — windowMax로 구분.
//   - 예약 신청/상세는 로그인 필요 → 여기서는 '조회(빈자리 수)'만 제공.
//
// 주의: 공식 공개 API가 아니라 사이트 내부 렌더링을 파싱합니다. 과도한 요청은 삼가세요.

const BASE = 'https://sooperang.go.kr';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 산림복지시설 카탈로그 — 지역코드(arcd)는 숲나들e와 동일 체계.
// lodging=true 인 시설만 숙박(빈자리) 조회 대상(치유의숲은 당일 프로그램 위주라 제외).
export const SOOPERANG_CATALOG = [
  { insttId: 'FA00001', name: '국립횡성숲체원', arcd: '2', type: '숲체원', lodging: true },
  { insttId: 'FA00002', name: '국립장성숲체원', arcd: '6', type: '숲체원', lodging: true },
  { insttId: 'FA00003', name: '국립칠곡숲체원', arcd: '7', type: '숲체원', lodging: true },
  { insttId: 'FA00004', name: '국립청도숲체원', arcd: '7', type: '숲체원', lodging: true },
  { insttId: 'FA00005', name: '국립대전숲체원', arcd: '4', type: '숲체원', lodging: true },
  { insttId: 'FA00006', name: '국립춘천숲체원', arcd: '2', type: '숲체원', lodging: true },
  { insttId: 'FA00007', name: '국립나주숲체원', arcd: '6', type: '숲체원', lodging: true },
  { insttId: 'FT00001', name: '국립산림치유원', arcd: '7', type: '치유원', lodging: true },
  { insttId: 'FT00012', name: '국립진안고원산림치유원', arcd: '5', type: '치유원', lodging: true },
  { insttId: 'FT00002', name: '국립양평치유의숲', arcd: '1', type: '치유의숲', lodging: false },
  { insttId: 'FT00003', name: '국립대관령치유의숲', arcd: '2', type: '치유의숲', lodging: false },
  { insttId: 'FT00004', name: '국립대운산치유의숲', arcd: '8', type: '치유의숲', lodging: false },
  { insttId: 'FT00005', name: '국립김천치유의숲', arcd: '7', type: '치유의숲', lodging: false },
  { insttId: 'FT00006', name: '국립제천치유의숲', arcd: '3', type: '치유의숲', lodging: false },
  { insttId: 'FT00007', name: '국립예산치유의숲', arcd: '4', type: '치유의숲', lodging: false },
  { insttId: 'FT00008', name: '국립곡성치유의숲', arcd: '6', type: '치유의숲', lodging: false },
  { insttId: 'FT00009', name: '국립화순치유의숲', arcd: '6', type: '치유의숲', lodging: false },
  { insttId: 'FT00010', name: '국립부산승학산치유의숲', arcd: '8', type: '치유의숲', lodging: false },
  { insttId: 'FT00011', name: '국립고창치유의숲', arcd: '5', type: '치유의숲', lodging: false },
  { insttId: 'FT00013', name: '국립익산치유의숲', arcd: '5', type: '치유의숲', lodging: false },
];

// 시설 상세/예약 링크 (로그인 없이 접근: 월별예약조회 = 빈자리 달력)
export const monthUrl = (hmpgId) => `${BASE}/rep/ari/selectMonthRsrvtSearch.do?hmpgId=${hmpgId}`;
export const reserveUrl = (hmpgId) => `${BASE}/rep/ari/selectGnrlRsrvtList.do?hmpgId=${hmpgId}`;
export const homeUrl = (hmpgId) => `${BASE}/indvz/main.do?hmpgId=${hmpgId}`;

const GSRM_MARKER = "var gsrmList = JSON.parse('";

// 월별예약조회 페이지를 스트리밍하며 gsrmList 구간까지만 읽어 파싱.
async function fetchGsrmList(hmpgId) {
  const res = await fetch(monthUrl(hmpgId), {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  const endMarker = "');";
  while (true) {
    const { done, value } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: true });
    const gi = buf.indexOf(GSRM_MARKER);
    if (gi >= 0 && buf.indexOf(endMarker, gi + GSRM_MARKER.length) >= 0) {
      try { await reader.cancel(); } catch { /* 무시 */ }
      break;
    }
    if (done) break;
    if (buf.length > 5_000_000) { // 안전장치: 여기까지 없으면 포기
      try { await reader.cancel(); } catch { /* 무시 */ }
      break;
    }
  }
  const gi = buf.indexOf(GSRM_MARKER);
  if (gi < 0) return [];
  const start = gi + GSRM_MARKER.length;
  const end = buf.indexOf(endMarker, start);
  if (end < 0) return [];
  const raw = buf.slice(start, end).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  try { return JSON.parse(raw); } catch { return []; }
}

/**
 * 한 시설의 날짜별 숙박 예약가능 현황.
 * @returns {Promise<{totalRooms:number, byDay:Record<string,{avail:number,total:number}>, windowMax:string|null}>}
 */
export async function getFacilityAvailability(hmpgId) {
  const arr = await fetchGsrmList(hmpgId);
  const byDay = {};
  const rooms = new Set();
  for (const e of arr) {
    if (!e || !e.dayStr) continue;
    rooms.add(e.gsrmNm);
    const d = (byDay[e.dayStr] ||= { avail: 0, total: 0 });
    d.total++;
    if (e.rsrvtYn === 'Y') d.avail++;
  }
  const days = Object.keys(byDay).sort();
  return { totalRooms: rooms.size, byDay, windowMax: days[days.length - 1] || null };
}

// CLI: node server/sooperangClient.js [hmpgId...]  → 숙박 시설 현황 확인
if (import.meta.url === `file://${process.argv[1]}`) {
  const ids = process.argv.slice(2);
  const targets = ids.length
    ? SOOPERANG_CATALOG.filter((f) => ids.includes(f.insttId))
    : SOOPERANG_CATALOG.filter((f) => f.lodging);
  const run = async () => {
    for (const f of targets) {
      try {
        const a = await getFacilityAvailability(f.insttId);
        const near = Object.entries(a.byDay).filter(([, v]) => v.avail > 0).slice(0, 5)
          .map(([d, v]) => `${d}:${v.avail}`).join(' ');
        console.log(`${f.insttId} ${f.name} (${f.type}) 객실=${a.totalRooms} 창~${a.windowMax} 가능예시[${near}]`);
      } catch (e) {
        console.log(`${f.insttId} ${f.name} 실패: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  };
  run().catch((e) => { console.error(e); process.exit(1); });
}
