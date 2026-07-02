// 국립자연휴양림 대표 요금대(best-effort) — 로그인 없이 접근 가능한 '이용요금' 페이지를 파싱.
// 국립 개별 홈페이지 메뉴는 표준화되어 있어 hmpgId(=숫자 insttId)로 동일 URL 사용 가능.
//   숙박(숲속의집/휴양관/연립동): /pot/rm/ug/selectFcltUseGdncView.do?...menuId=004002005 의 '숙박시설' 표
//   야영: 같은 페이지의 '야영 시설' 표
// 값은 파일 캐시(data/fee-cache.json)에 저장(요금은 자주 안 바뀜, TTL 30일).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
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
  } catch { /* 캐시 저장 실패 무시 */ }
}

function pricesIn(text) {
  return [...text.matchAll(/([0-9]{2,3},[0-9]{3})/g)]
    .map((m) => parseInt(m[1].replace(/,/g, ''), 10))
    .filter((n) => n >= 1000);
}
function range(arr) {
  return arr.length ? { min: Math.min(...arr), max: Math.max(...arr) } : null;
}

/** 국립 요금 페이지 파싱 → { house:{min,max}|null, camp:{min,max}|null } */
export async function getNationalFee(insttId) {
  if (!/^\d+$/.test(insttId)) return null; // 국립(숫자 hmpgId)만
  const c = loadCache();
  const hit = c[insttId];
  if (hit && Date.now() - hit.at < TTL) return hit.fee;

  try {
    const url = `${BASE}/pot/rm/ug/selectFcltUseGdncView.do?hmpgId=${insttId}&menuId=004002005&ruleId=205`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = (await res.text())
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ');

    // '야영' 경계로 숙박/야영 구간 분리
    const campIdx = (() => {
      for (const m of ['야영 시설', '야영시 이용요금', '야영장 이용요금', '야영시설']) {
        const p = text.indexOf(m);
        if (p >= 0) return p;
      }
      return -1;
    })();
    // 야영 구간 끝(부대/기타 요금 제외)
    const tailIdx = (() => {
      for (const m of ['부대시설', '기타시설', '기타 시설', '캠프파이어', '프로그램', '주차']) {
        const p = campIdx >= 0 ? text.indexOf(m, campIdx + 1) : -1;
        if (p >= 0) return p;
      }
      return text.length;
    })();

    const houseText = campIdx >= 0 ? text.slice(0, campIdx) : text;
    const campText = campIdx >= 0 ? text.slice(campIdx, tailIdx) : '';
    const fee = { house: range(pricesIn(houseText)), camp: range(pricesIn(campText)) };
    c[insttId] = { at: Date.now(), fee };
    saveCache();
    return fee;
  } catch {
    // 실패 시 짧게 캐싱(재시도 폭주 방지)해 null 반환
    c[insttId] = { at: Date.now() - TTL + 60 * 60 * 1000, fee: null };
    saveCache();
    return null;
  }
}

/** 국립 시설(인원) 안내 페이지 URL — 로그인 없이 몇인실 확인 */
export function infoPageUrl(insttId, section) {
  if (!/^\d+$/.test(insttId)) return null;
  return section === '02'
    ? `${BASE}/pot/rm/fa/selectCmpgrArmpListView.do?hmpgId=${insttId}&menuId=002002002`
    : `${BASE}/pot/rm/fa/selectFcltsArmpListView.do?hmpgId=${insttId}&menuId=002002001`;
}
