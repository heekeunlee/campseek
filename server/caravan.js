// 카라반 보유 휴양림 지도(map) — 어떤 휴양림의 어떤 상품분류가 '카라반'인지 캐시.
//
// 카라반은 숲나들e에서 별도 구분코드가 아니라 휴양림별 상품분류(goodsClssc)이며,
// 이름에 '카라반/캐라반'이 포함되고 숙박(01)·야영(02) 양쪽에 걸쳐 존재한다.
// codeId는 휴양림마다 의미가 달라(예: 02008이 어떤 곳은 카라반, 어떤 곳은 캠핑하우스)
// 전국 일괄 필터가 불가능 → 휴양림별로 카라반 분류 코드를 미리 수집해 둔다.
//
// 분류 구성은 거의 바뀌지 않으므로 data/caravan-map.json에 캐시(TTL 7일)한다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getForests, getGoodsClssc } from './forestClient.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAP_FILE = join(__dirname, '..', 'data', 'caravan-map.json');
const TTL = 7 * 24 * 60 * 60 * 1000; // 7일
const CARAVAN_RE = /카라반|캐라반/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 카라반(상품분류)이 있는 휴양림 목록.
 * @returns {Promise<Array<{insttId,arcd,name,house:string[],camp:string[]}>>}
 */
export async function getCaravanForests({ force = false, sleepMs = 350 } = {}) {
  if (!force) {
    try {
      const c = JSON.parse(readFileSync(MAP_FILE, 'utf8'));
      if (c && Date.now() - c.at < TTL && Array.isArray(c.list)) return c.list;
    } catch { /* 캐시 없음/만료 → 재생성 */ }
  }
  const forests = await getForests();
  const list = [];
  for (const f of forests) {
    let g;
    try { g = await getGoodsClssc(f.insttId); } catch { g = { house: [], camp: [] }; }
    const house = g.house.filter((x) => CARAVAN_RE.test(x.codeNm)).map((x) => x.codeId);
    const camp = g.camp.filter((x) => CARAVAN_RE.test(x.codeNm)).map((x) => x.codeId);
    if (house.length || camp.length) {
      list.push({ insttId: f.insttId, arcd: f.arcd, name: f.name, house, camp });
    }
    await sleep(sleepMs);
  }
  try {
    mkdirSync(dirname(MAP_FILE), { recursive: true });
    writeFileSync(MAP_FILE, JSON.stringify({ at: Date.now(), list }));
  } catch { /* 캐시 쓰기 실패는 무시 */ }
  return list;
}

// CLI: node server/caravan.js  → 카라반 지도 강제 재생성
if (import.meta.url === `file://${process.argv[1]}`) {
  getCaravanForests({ force: true })
    .then((l) => {
      console.log(`카라반 보유 휴양림: ${l.length}곳`);
      l.forEach((x) => console.log(x.arcd, x.name, 'H:' + x.house.join(','), 'C:' + x.camp.join(',')));
    })
    .catch((e) => { console.error(e); process.exit(1); });
}
