// 휴양림별 '물놀이 가능' 신호 수집기.
// 소스: 숲나들e 중앙 CMS(hmpgId=insttId)의 콘텐츠 페이지
//   - 부대시설(selectIncdnArmpListView) / 레포츠시설(selectLeportsArmpListView)
//   - 시설물안내(selectFcltsArmpListView) / 자연휴양림 소개(selectRcrfrIntrdDtlView)
//   - main.do 히어로 부제(테마 문구)
// 시설 목록/소개 텍스트에서 물놀이 신호를 뽑되, '금지/불가' 문맥은 부정 처리.
import fs from 'fs';

const BASE = 'https://www.foresttrip.go.kr';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36';

const forests = JSON.parse(fs.readFileSync('/tmp/forests-master.json', 'utf8')); // [{insttId,name,type,arcd}]

// 시설(강한 신호): 인공 물놀이 시설
const FACIL = ['물놀이장', '물놀이터', '유아물놀이', '물놀이시설', '수영장', '워터파크', '워터', '풀장', '자연풀장', '물썰매장'];
// 자연/주변(문맥 신호)
const NATURE = ['계곡', '물놀이', '개울', '시냇물', '실개천', '해수욕', '해변', '백사장', '호수', '저수지', '수변', '바닷가'];
const NEG = ['금지', '불가', '자제', '위험', '익사', '삼가', '엄금'];

async function fetchText(url, ms = 15000) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(ms) });
    if (!r.ok) return '';
    return await r.text();
  } catch { return ''; }
}

function stripToContent(html) {
  let t = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ');
  // 히어로 부제(테마 문구): body 클래스나 특정 영역 대신, 페이지 타이틀 앞 수식어를 잡기 위해 원문 유지
  t = t.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');
  // 전역 UI/추천검색어/푸터 잡음 제거
  t = t.replace(/추천검색어[\s\S]{0,80}?통합검색/g, ' ');
  return t;
}

function heroSubtitle(html) {
  // <title> 앞 또는 페이지 상단의 수식 문구 (예: "여름철 해변 휴양까지 즐길 수 있는 ...휴양림")
  const m = html.match(/<meta property="og:title" content="([^"]*)"/);
  return m ? m[1] : '';
}

// 신호 판정: 텍스트에서 키워드 주변 12자에 부정어가 없으면 긍정
function scan(text) {
  const found = { facil: [], nature: [], negated: [] };
  const check = (kw, bucket) => {
    let i = 0;
    while ((i = text.indexOf(kw, i)) !== -1) {
      const ctx = text.slice(i, i + kw.length + 12);
      if (NEG.some((n) => ctx.includes(n))) { if (!found.negated.includes(kw)) found.negated.push(kw); }
      else if (!found[bucket].includes(kw)) found[bucket].push(kw);
      i += kw.length;
    }
  };
  for (const k of FACIL) check(k, 'facil');
  for (const k of NATURE) check(k, 'nature');
  return found;
}

async function menuUrls(hmpgId) {
  const raw = await fetchText(`${BASE}/com/sub/selectMenuList.do?hmpgId=${hmpgId}`);
  let list = [];
  try { list = JSON.parse(raw).menuList || []; } catch { return []; }
  const want = ['selectIncdnArmpListView', 'selectLeportsArmpListView', 'selectFcltsArmpListView', 'selectRcrfrIntrdDtlView'];
  const urls = [];
  const seen = new Set();
  for (const m of list) {
    const u = m.menuUrl || '';
    for (const w of want) {
      if (u.includes(w) && !seen.has(u)) { seen.add(u); urls.push(u); }
    }
  }
  return urls;
}

async function one(f) {
  const hmpgId = f.insttId;
  const urls = await menuUrls(hmpgId);
  let combined = '';
  let hero = '';
  // main.do 부제(테마)
  const mainHtml = await fetchText(`${BASE}/indvz/main.do?hmpgId=${hmpgId}`);
  hero = heroSubtitle(mainHtml);
  for (const u of urls) {
    const html = await fetchText(BASE + (u.startsWith('/') ? u : '/' + u));
    combined += ' ' + stripToContent(html);
  }
  const sig = scan(combined + ' ' + hero);
  const water = sig.facil.length > 0 || sig.nature.length > 0;
  return { insttId: hmpgId, name: f.name, type: f.type, arcd: f.arcd, hero: hero.trim(), water, facil: sig.facil, nature: sig.nature, negated: sig.negated, pages: urls.length };
}

const out = {};
const CONC = 8;
let idx = 0;
async function worker() {
  while (idx < forests.length) {
    const i = idx++;
    const f = forests[i];
    try { out[f.insttId] = await one(f); }
    catch (e) { out[f.insttId] = { insttId: f.insttId, name: f.name, error: e.message }; }
    if (i % 15 === 0) process.stderr.write(`${i}/${forests.length}\n`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
fs.writeFileSync('/tmp/water-signals.json', JSON.stringify(out, null, 1));

const arr = Object.values(out);
const yes = arr.filter((r) => r.water);
console.log(`총 ${arr.length} · 물놀이 신호 있음 ${yes.length} · 없음 ${arr.length - yes.length}`);
const dist = {};
for (const r of arr) for (const k of [...(r.facil || []), ...(r.nature || [])]) dist[k] = (dist[k] || 0) + 1;
console.log('신호분포:', JSON.stringify(dist));
console.log('부정처리 예:', arr.filter((r) => (r.negated || []).length && !r.water).slice(0, 8).map((r) => r.name + '(' + r.negated.join(',') + ')'));
