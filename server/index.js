// 무의존성 HTTP 서버: REST API + 정적 파일 서빙
import { createServer } from 'node:http';
// .env 자동 로드 (있을 때만)
try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch { /* .env 없음 */ }
import { readFile, stat } from 'node:fs/promises';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getForests, getRegions, search, SECTION } from './forestClient.js';
import { listWatches, addWatch, updateWatch, removeWatch, getWatch } from './store.js';
import { startWatcher, runOnce } from './watcher.js';
import { recentEvents } from './notify.js';
import { isConfigured as openApiReady, getReservations } from './openApiClient.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 3000);

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
  let rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = normalize(join(PUBLIC, rel));
  if (!filePath.startsWith(PUBLIC)) return json(res, 403, { error: 'forbidden' });
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
        const section = q.get('section') === '02' ? SECTION.CAMP : SECTION.HOUSE;
        const results = await search({
          arcd: q.get('arcd') || '',
          insttId: q.get('insttId') || '',
          beginDate: begin,
          endDate: end,
          section,
          availableOnly: q.get('availableOnly') === 'true',
        });
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
