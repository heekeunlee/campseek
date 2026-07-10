// 무의존성 HTTP 서버: REST API + 정적 파일 서빙
import { createServer } from 'node:http';
// .env 자동 로드 (있을 때만)
try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch { /* .env 없음 */ }
import { readFile, stat } from 'node:fs/promises';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { getForests, getRegions, search, SECTION } from './forestClient.js';
import { getCaravanForests } from './caravan.js';
import {
  SOOPERANG_CATALOG, getFacilityAvailability,
  monthUrl as spMonthUrl, reserveUrl as spReserveUrl, homeUrl as spHomeUrl,
} from './sooperangClient.js';
import { listWatches, addWatch, updateWatch, removeWatch, getWatch } from './store.js';
import { startWatcher, runOnce } from './watcher.js';
import { recentEvents } from './notify.js';
import { isConfigured as openApiReady, getReservations } from './openApiClient.js';
import { infoPageUrl } from './forestFee.js';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// 물놀이(계곡·해변·물놀이장) 가능 휴양림 맵 { insttId: 사유 }
let WATER_MAP = {};
try { WATER_MAP = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'waterMap.json'), 'utf8')); } catch { /* 없으면 미표시 */ }
const addWater = (rows) => { for (const r of rows) if (WATER_MAP[r.insttId]) r.w = WATER_MAP[r.insttId]; return rows; };
const PUBLIC = join(ROOT, 'public');
const BOARD = join(ROOT, 'site'); // 버튼 조회형 대시보드 (gh-pages와 동일)
const PORT = Number(process.env.PORT || 3000);

// 실시간 전체 업데이트(publish.sh) 실행 상태
const refresh = { running: false, startedAt: null, finishedAt: null, ok: null, message: '' };

function runRefresh() {
  if (refresh.running) return false;
  refresh.running = true;
  refresh.startedAt = new Date().toISOString();
  refresh.finishedAt = null;
  refresh.ok = null;
  refresh.message = '실시간 조회 중…';
  const child = spawn('bash', [join(ROOT, 'scripts', 'publish.sh')], { cwd: ROOT, env: process.env });
  let tail = '';
  const grab = (d) => { tail = (tail + d.toString()).slice(-2000); };
  child.stdout.on('data', grab);
  child.stderr.on('data', grab);
  child.on('close', (code) => {
    refresh.running = false;
    refresh.finishedAt = new Date().toISOString();
    refresh.ok = code === 0;
    const last = tail.trim().split('\n').slice(-3).join(' | ');
    refresh.message = code === 0 ? `완료: ${last}` : `실패(code ${code}): ${last}`;
  });
  child.on('error', (e) => {
    refresh.running = false;
    refresh.finishedAt = new Date().toISOString();
    refresh.ok = false;
    refresh.message = '실행 오류: ' + e.message;
  });
  return true;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

function validDate(d) {
  return typeof d === 'string' && /^\d{8}$/.test(d);
}

async function serveStatic(req, res, pathname) {
  // /board* → site/ 대시보드, 그 외 → public/ (실시간 검색 UI)
  let base = PUBLIC;
  let rel = pathname;
  if (pathname === '/board' || pathname.startsWith('/board/')) {
    base = BOARD;
    rel = pathname.slice('/board'.length) || '/';
  }
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = normalize(join(base, rel));
  if (!filePath.startsWith(base)) return json(res, 403, { error: 'forbidden' });
  try {
    const s = await stat(filePath);
    if (!s.isFile()) throw new Error('not file');
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    json(res, 404, { error: 'not found' });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    // ---- API ----
    if (p.startsWith('/api/')) {
      // 마스터 데이터
      if (p === '/api/forests' && req.method === 'GET') {
        return json(res, 200, await getForests());
      }
      if (p === '/api/regions' && req.method === 'GET') {
        return json(res, 200, await getRegions());
      }

      // 빈자리 검색: /api/search?arcd=&insttId=&begin=YYYYMMDD&end=YYYYMMDD&section=01|02&availableOnly=
      if (p === '/api/search' && req.method === 'GET') {
        const q = url.searchParams;
        const begin = q.get('begin');
        const end = q.get('end');
        if (!validDate(begin) || !validDate(end))
          return json(res, 400, { error: 'begin/end must be YYYYMMDD' });

        // 숲이랑(04): 산림복지시설(숲체원·산림치유원) 숙박 빈자리
        if (q.get('section') === '04') {
          const arcd = q.get('arcd') || '';
          const cat = SOOPERANG_CATALOG.filter((f) => f.lodging && (!arcd || f.arcd === arcd));
          const results = [];
          for (const f of cat) {
            let a = null;
            try { a = await getFacilityAvailability(f.insttId); } catch { /* skip */ }
            if (!a || a.totalRooms === 0) continue;
            const day = a.byDay[begin];
            const availableCount = day ? day.avail : (a.windowMax && begin > a.windowMax ? null : 0);
            results.push({
              insttId: f.insttId, name: f.name, type: f.type,
              availableCount, totalRooms: a.totalRooms, totalCampsites: null, tel: '',
              url: spHomeUrl(f.insttId), infoUrl: spMonthUrl(f.insttId), reserveUrl: spReserveUrl(f.insttId),
            });
          }
          const filtered = q.get('availableOnly') === 'true'
            ? results.filter((r) => (r.availableCount ?? 0) > 0) : results;
          filtered.sort((a, b) => (b.availableCount || 0) - (a.availableCount || 0));
          return json(res, 200, { count: filtered.length, results: addWater(filtered) });
        }

        // 카라반(03): 휴양림별 상품분류 필터로 개별 조회
        if (q.get('section') === '03') {
          const arcd = q.get('arcd') || '';
          const insttId = q.get('insttId') || '';
          let cf = await getCaravanForests();
          if (insttId) cf = cf.filter((f) => f.insttId === insttId);
          else if (arcd) cf = cf.filter((f) => f.arcd === arcd);
          const results = [];
          for (const f of cf) {
            let avail = 0, name = f.name, type = '', tel = '', url = '';
            for (const [sect, codes, key] of [
              ['02', f.camp, 'campClssc'],
              ['01', f.house, 'houseClssc'],
            ]) {
              if (!codes.length) continue;
              const rs = await search({
                arcd: f.arcd, insttId: f.insttId, beginDate: begin, endDate: end,
                section: sect === '02' ? SECTION.CAMP : SECTION.HOUSE, [key]: codes,
              });
              const rec = rs.find((r) => r.insttId === f.insttId) || rs[0];
              if (rec) {
                avail += rec.availableCount || 0;
                name = rec.name || name; type = rec.type || type;
                tel = rec.tel || tel; url = rec.url || url;
              }
            }
            results.push({
              insttId: f.insttId, name, type,
              availableCount: avail, totalRooms: null, totalCampsites: null, tel, url,
              infoUrl: infoPageUrl(f.insttId, f.camp.length ? '02' : '01') || url || null,
              reserveUrl: 'https://www.foresttrip.go.kr/rep/or/fcfsRsrvtMain.do?hmpgId=FRIP&menuId=001001',
            });
          }
          const filtered = q.get('availableOnly') === 'true'
            ? results.filter((r) => (r.availableCount ?? 0) > 0) : results;
          filtered.sort((a, b) => (b.availableCount || 0) - (a.availableCount || 0));
          return json(res, 200, { count: filtered.length, results: addWater(filtered) });
        }

        const section = q.get('section') === '02' ? SECTION.CAMP : SECTION.HOUSE;
        const results = await search({
          arcd: q.get('arcd') || '',
          insttId: q.get('insttId') || '',
          beginDate: begin,
          endDate: end,
          section,
          availableOnly: q.get('availableOnly') === 'true',
        });
        // 섹션별 인원(몇인실) 안내 페이지 링크 보강
        const sectCode = q.get('section') === '02' ? '02' : '01';
        for (const r of results) {
          r.infoUrl = infoPageUrl(r.insttId, sectCode) || r.url || null;
        }
        // 숙박(01): 세부유형(독채/휴양관/연립동) 빈자리 분해
        if (sectCode === '01') {
          const arcd = q.get('arcd') || '', insttId = q.get('insttId') || '';
          const bd = {};
          for (const [k, codes] of [['dc', ['01001']], ['hy', ['01002']], ['yl', ['01003']]]) {
            const rs = await search({ arcd, insttId, beginDate: begin, endDate: end, section: SECTION.HOUSE, houseClssc: codes });
            for (const x of rs) (bd[x.insttId] ||= { dc: 0, hy: 0, yl: 0 })[k] = x.availableCount || 0;
          }
          for (const r of results) if (bd[r.insttId]) r.bd = bd[r.insttId];
        }
        addWater(results);
        return json(res, 200, { count: results.length, results });
      }

      // 감시 CRUD
      if (p === '/api/watches' && req.method === 'GET') {
        return json(res, 200, listWatches());
      }
      if (p === '/api/watches' && req.method === 'POST') {
        const b = await readBody(req);
        if (!validDate(b.beginDate) || !validDate(b.endDate))
          return json(res, 400, { error: 'beginDate/endDate must be YYYYMMDD' });
        if (b.endDate < b.beginDate)
          return json(res, 400, { error: 'endDate must be >= beginDate' });
        return json(res, 201, addWatch(b));
      }
      const wm = p.match(/^\/api\/watches\/([^/]+)$/);
      if (wm) {
        const id = wm[1];
        if (req.method === 'PATCH') {
          const b = await readBody(req);
          const w = updateWatch(id, b);
          return w ? json(res, 200, w) : json(res, 404, { error: 'not found' });
        }
        if (req.method === 'DELETE') {
          return removeWatch(id)
            ? json(res, 200, { ok: true })
            : json(res, 404, { error: 'not found' });
        }
      }

      // 감시 즉시 실행 (수동 트리거)
      if (p === '/api/watches/run' && req.method === 'POST') {
        return json(res, 200, { checked: await runOnce() });
      }

      // 최근 알림 이벤트
      if (p === '/api/events' && req.method === 'GET') {
        return json(res, 200, recentEvents());
      }

      // 실시간 전체 업데이트: 숲나들e를 지금 조회 → 스냅샷 갱신 → gh-pages 배포
      if (p === '/api/refresh' && req.method === 'POST') {
        const started = runRefresh();
        return json(res, started ? 202 : 409, {
          started,
          running: refresh.running,
          message: started ? '실시간 업데이트 시작' : '이미 실행 중',
        });
      }
      if (p === '/api/refresh' && req.method === 'GET') {
        let generatedAt = null;
        try {
          const j = JSON.parse(await readFile(join(BOARD, 'data', 'availability.json'), 'utf8'));
          generatedAt = j.generatedAt;
        } catch { /* 없음 */ }
        return json(res, 200, { ...refresh, generatedAt });
      }

      // [옵션] 공식 OpenAPI: 국립자연휴양림 예약정보 (교차검증용)
      if (p === '/api/openapi/reservations' && req.method === 'GET') {
        if (!openApiReady())
          return json(res, 501, { error: 'OpenAPI 미설정 (.env: FOREST_OPENAPI_KEY/URL)' });
        const q = url.searchParams;
        const data = await getReservations({
          pageNo: Number(q.get('pageNo') || 1),
          numOfRows: Number(q.get('numOfRows') || 100),
        });
        return json(res, 200, { count: data.items.length, items: data.items });
      }

      return json(res, 404, { error: 'unknown api' });
    }

    // ---- 정적 파일 ----
    if (req.method === 'GET') return serveStatic(req, res, p);
    json(res, 405, { error: 'method not allowed' });
  } catch (e) {
    console.error('[server] 오류:', e);
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n🌲 campseek 실행 중 → http://localhost:${PORT}`);
  if (process.env.WATCH_DISABLED !== 'true') startWatcher();
  else console.log('[watcher] WATCH_DISABLED=true → 감시 비활성');
});
