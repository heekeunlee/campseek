// 숲나들e(foresttrip.go.kr) 비공식 내부 API 클라이언트
// - 세션 쿠키 + CSRF 토큰을 자동으로 획득/갱신
// - 전국 휴양림 마스터 목록, 시도 목록, 빈자리 검색 제공
//
// 주의: 공식 공개 API가 아니라 사이트가 내부적으로 사용하는 엔드포인트입니다.
// 사이트 구조가 바뀌면 깨질 수 있으며, 과도한 요청은 삼가세요(호출 간 간격 준수).

const BASE = 'https://www.foresttrip.go.kr';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const SESSION_PAGE = `${BASE}/rep/or/fcfsRsrvtMain.do?hmpgId=FRIP&menuId=001001`;

// 시설 구분 코드
export const SECTION = {
  HOUSE: '01', // 숲속의 집 (숙박)
  CAMP: '02', // 야영장
};

// 휴양림 운영주체 코드
export const INSTT_TYPE = {
  '01': '국립',
  '02': '공립',
  '04': '사립',
};

// ---- 세션 관리 -----------------------------------------------------------

let session = null; // { cookie, csrf, ts }
const SESSION_TTL = 20 * 60 * 1000; // 20분

function parseSetCookie(headers) {
  // Node fetch: getSetCookie() 지원
  const raw =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : headers.get('set-cookie')
      ? [headers.get('set-cookie')]
      : [];
  const jar = {};
  for (const line of raw) {
    const [pair] = line.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function ensureSession(force = false) {
  if (!force && session && Date.now() - session.ts < SESSION_TTL) return session;
  const res = await fetch(SESSION_PAGE, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
  });
  if (!res.ok) throw new Error(`세션 페이지 로드 실패: HTTP ${res.status}`);
  const cookie = parseSetCookie(res.headers);
  const html = await res.text();
  const m = html.match(/_csrf['"]?\s*[:=]\s*['"]?([0-9a-f]{8}-[0-9a-f-]{20,})/i);
  if (!m) throw new Error('CSRF 토큰을 찾지 못했습니다.');
  session = { cookie, csrf: m[1], ts: Date.now() };
  return session;
}

async function api(path, { method = 'GET', json, params, retry = true } = {}) {
  const s = await ensureSession();
  const url = new URL(BASE + path);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (method !== 'GET') url.searchParams.set('_csrf', s.csrf);

  const res = await fetch(url, {
    method,
    headers: {
      'User-Agent': UA,
      'X-Ajax-call': 'true',
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: s.cookie,
      Referer: SESSION_PAGE,
      ...(json ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}),
    },
    body: json ? JSON.stringify(json) : undefined,
  });

  // 세션 만료(302/401/403) 시 1회 재시도
  if ((res.status === 302 || res.status === 401 || res.status === 403) && retry) {
    await ensureSession(true);
    return api(path, { method, json, params, retry: false });
  }
  if (!res.ok) throw new Error(`API ${path} 실패: HTTP ${res.status}`);
  return res;
}

// ---- 마스터 데이터 -------------------------------------------------------

let forestCache = null; // { ts, list }
const FOREST_TTL = 6 * 60 * 60 * 1000; // 6시간

/** 시도(지역) 목록 */
export async function getRegions() {
  const res = await api('/rep/or/selectSiDoList.do');
  const rows = await res.json();
  return rows.map((r) => ({ arcd: r.arcd, name: (r.codeNm || '').trim() }));
}

/** 전국 자연휴양림 마스터 목록 (국립/공립/사립 147개) */
export async function getForests() {
  if (forestCache && Date.now() - forestCache.ts < FOREST_TTL) return forestCache.list;
  const res = await api('/rep/cm/remmnAreaOrRcfclList.do');
  const rows = await res.json();
  const list = rows
    .filter((r) => r.insttId) // lvl1(지역 헤더) 제외
    .map((r) => ({
      insttId: r.insttId,
      arcd: r.arcd,
      name: (r.codeDc || r.codeNm || '').trim(),
      type: (r.insttTpCdNm || '').trim(), // 국립/공립/사립
      regionCode: r.detailCode,
    }));
  forestCache = { ts: Date.now(), list };
  return list;
}

// ---- 빈자리 검색 ---------------------------------------------------------

/**
 * 빈자리 검색.
 * @param {object} opts
 * @param {string} [opts.arcd]      지역코드 (getRegions)
 * @param {string} [opts.insttId]   특정 휴양림 (getForests). 없으면 지역 전체
 * @param {string} opts.beginDate   입실일 YYYYMMDD
 * @param {string} opts.endDate     퇴실일 YYYYMMDD
 * @param {string} [opts.section]   SECTION.HOUSE(숲속의집) | SECTION.CAMP(야영장)
 * @param {boolean}[opts.availableOnly] 예약가능 시설만
 * @returns {Promise<Array>} 휴양림별 빈자리 요약
 */
export async function search({
  arcd = '',
  insttId = '',
  beginDate,
  endDate,
  section = SECTION.HOUSE,
  availableOnly = false,
} = {}) {
  if (!beginDate || !endDate) throw new Error('beginDate/endDate(YYYYMMDD)가 필요합니다.');
  const body = {
    srchInsttArcd: arcd,
    srchInsttId: insttId,
    srchRsrvtBgDt: beginDate,
    srchRsrvtEdDt: endDate,
    houseCampSctin: section,
    rsrvtPssblYn: availableOnly ? 'Y' : 'N',
    srtngOrdr: 'rsrvtPssbl',
  };
  const res = await api('/rep/or/innerFcfsRcrfrDtlDetls.do', { method: 'POST', json: body });
  const html = await res.text();
  return parseSearchResult(html, { section, beginDate, endDate });
}

/** innerFcfsRcrfrDtlDetls.do 가 반환하는 HTML 조각을 구조화 */
export function parseSearchResult(html, meta = {}) {
  const results = [];

  // 각 휴양림의 구조화 메타는 arrInstt.push({...}) 블록에 담겨 있다.
  const pushRe = /insttItems\.arrInstt\.push\(\{([\s\S]*?)\}\)/g;
  const metaById = new Map();
  const order = [];
  let pm;
  while ((pm = pushRe.exec(html))) {
    const block = pm[1];
    const g = (key) => {
      const mm = block.match(new RegExp(`${key}\\s*:\\s*"([^"]*)"`));
      return mm ? mm[1] : '';
    };
    const insttId = g('insttId');
    if (!insttId) continue;
    const rec = {
      insttId,
      name: g('insttNm'),
      road: g('roadNm'),
      tel: g('insttTlno'),
      url: g('url'),
      lat: parseFloat(g('insttLttd')) || null,
      lng: parseFloat(g('insttLngtd')) || null,
    };
    metaById.set(insttId, rec);
    order.push(insttId);
  }

  // 각 rc_item 블록에서 상태/예약가능 객실 수/시설 수 추출
  const itemRe = /<div class="rc_item">([\s\S]*?)(?=<div class="rc_item">|insttItems\.arrInstt\.push|$)/g;
  const items = [];
  let im;
  while ((im = itemRe.exec(html))) items.push(im[1]);

  const text = (s) =>
    s
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    const t = text(raw);
    const nameM = raw.match(/<b>\[([^\]]+)\]([^<]+)<\/b>/);
    const type = nameM ? nameM[1].trim() : '';
    const name = nameM ? nameM[2].trim() : '';
    const roomCntM = t.match(/예약가능 객실 수\s*:\s*([\d,]+)/);
    const availCount = roomCntM ? parseInt(roomCntM[1].replace(/,/g, ''), 10) : null;
    const facM = t.match(/\[객실\]\s*([\d,]+)개\s*\/\s*\[야영장\]\s*([\d,]+)개/);
    const rooms = facM ? parseInt(facM[1].replace(/,/g, ''), 10) : null;
    const campsites = facM ? parseInt(facM[2].replace(/,/g, ''), 10) : null;
    const bookable = /예약가능/.test(t) && !/\[예약불가\]/.test(raw);

    const id = order[i];
    const m = (id && metaById.get(id)) || {};
    results.push({
      insttId: id || m.insttId || '',
      name: m.name || name,
      type: type || m.type || '',
      road: m.road || '',
      tel: m.tel || '',
      lat: m.lat ?? null,
      lng: m.lng ?? null,
      availableCount: availCount, // 예약가능 객실/사이트 수
      totalRooms: rooms,
      totalCampsites: campsites,
      bookable: availCount != null ? availCount > 0 : bookable,
      section: meta.section || null,
      beginDate: meta.beginDate || null,
      endDate: meta.endDate || null,
      reserveUrl: `${BASE}/rep/or/fcfsRsrvtMain.do?hmpgId=FRIP&menuId=001001`,
    });
  }
  return results;
}

// CLI: node server/forestClient.js  → 마스터 목록 + 샘플 검색 확인
if (import.meta.url === `file://${process.argv[1]}`) {
  const run = async () => {
    const forests = await getForests();
    console.log(`휴양림 마스터: ${forests.length}개`);
    console.log(forests.slice(0, 3));
    const d = new Date();
    d.setDate(d.getDate() + 16);
    const bg = d.toISOString().slice(0, 10).replace(/-/g, '');
    d.setDate(d.getDate() + 1);
    const ed = d.toISOString().slice(0, 10).replace(/-/g, '');
    console.log(`\n샘플 검색: 강원(arcd=2) 숲속의집 ${bg}~${ed}`);
    const r = await search({ arcd: '2', beginDate: bg, endDate: ed, section: SECTION.HOUSE });
    console.log(`결과 ${r.length}건`);
    console.table(
      r.slice(0, 8).map((x) => ({
        휴양림: x.name,
        구분: x.type,
        예약가능객실: x.availableCount,
        객실: x.totalRooms,
        예약가능: x.bookable,
      }))
    );
  };
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
