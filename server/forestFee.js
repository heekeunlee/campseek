// 휴양림 대표 요금대(best-effort) — 로그인 없이 접근 가능한 '이용요금' 페이지 파싱.
// 개별 홈페이지 메뉴가 표준화되어 hmpgId(=insttId)로 동일 URL 사용:
//   이용요금:   /pot/rm/ug/selectFcltUseGdncView.do?hmpgId={id}&menuId=004002005&ruleId=205
//   숙박 인원:  /pot/rm/fa/selectFcltsArmpListView.do?hmpgId={id}&menuId=002002001
//   야영 인원:  /pot/rm/fa/selectCmpgrArmpListView.do?hmpgId={id}&menuId=002002002
//
// 정확도:
//   - 국립: 요금표가 표준(숙박/야영 분리) → 섹션별 요금대 정확
//   - 공립/사립: 에디터 표(비표준)/이미지 → 전체 범위 '참고값'만, 이미지 페이지는 null
// 값은 파일 캐시(data/fee-cache.json)에 저장(TTL 30일).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://www.foresttrip.go.kr';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(__dirname, '..', 'data', 'fee-cache.json');
const TTL = 30 * 24 * 60 * 60 * 1000;

let cache = null;
function loadCache() {
  if (cache) return cache;
  try { cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8')); } catch { cache = {}; }
  return cache;
}
function saveCache() {
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch { /* 무시 */ }
}

const grabPrices = (t) =>
  [...t.matchAll(/([0-9]{2,3},[0-9]{3})/g)]
    .map((m) => parseInt(m[1].replace(/,/g, ''), 10))
    .filter((n) => n >= 1000 && n <= 2000000);
const range = (arr) => (arr.length ? { min: Math.min(...arr), max: Math.max(...arr) } : null);
const strip = (s) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

/**
 * 이용요금 페이지 파싱.
 * @returns {Promise<{house,camp,overall}|null>} 각 {min,max}|null
 */
export async function getForestFee(insttId) {
  if (!insttId) return null;
  const c = loadCache();
  const hit = c[insttId];
  if (hit && Date.now() - hit.at < TTL) return hit.fee;

  try {
    const url = `${BASE}/pot/rm/ug/selectFcltUseGdncView.do?hmpgId=${insttId}&menuId=004002005&ruleId=205`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();

    const houseP = [];
    const campP = [];
    const allP = [];
    const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((m) => m[0]);
    for (const tb of tables) {
      const txt = strip(tb);
      const p = grabPrices(txt);
      if (!p.length) continue;
      allP.push(...p);
      const isCamp = /야영/.test(txt);
      const isHouse = /숙박|객실|숲속|휴양관|연립|산림문화|호텔|콘도/.test(txt);
      if (isHouse && !isCamp) houseP.push(...p);
      else if (isCamp && !isHouse) campP.push(...p);
    }
    if (!allP.length) allP.push(...grabPrices(strip(html))); // 표가 없으면 본문 전체
    const fee = { house: range(houseP), camp: range(campP), overall: range(allP) };
    c[insttId] = { at: Date.now(), fee };
    saveCache();
    return fee;
  } catch {
    c[insttId] = { at: Date.now() - TTL + 60 * 60 * 1000, fee: null }; // 실패 1시간 캐싱
    saveCache();
    return null;
  }
}

/** 시설(인원) 안내 페이지 URL — 로그인 없이 몇인실 확인 (모든 휴양림 표준 메뉴) */
export function infoPageUrl(insttId, section) {
  if (!insttId) return null;
  return section === '02'
    ? `${BASE}/pot/rm/fa/selectCmpgrArmpListView.do?hmpgId=${insttId}&menuId=002002002`
    : `${BASE}/pot/rm/fa/selectFcltsArmpListView.do?hmpgId=${insttId}&menuId=002002001`;
}
