// 숲체원/산림치유원(숲이랑) 9곳의 물놀이 신호 수집.
// sooperang.go.kr CMS: main.do + /pot/cn/selectCntnsView.do?cntnsSeq=N(소개·시설안내) + 주변관광.
import fs from 'fs';

const BASE = 'https://sooperang.go.kr';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36';

const LODGING = [
  ['FA00001', '국립횡성숲체원'], ['FA00002', '국립장성숲체원'], ['FA00003', '국립칠곡숲체원'],
  ['FA00004', '국립청도숲체원'], ['FA00005', '국립대전숲체원'], ['FA00006', '국립춘천숲체원'],
  ['FA00007', '국립나주숲체원'], ['FT00001', '국립산림치유원'], ['FT00012', '국립진안고원산림치유원'],
];

const FACIL = ['물놀이장', '물놀이터', '유아물놀이', '물놀이시설', '수영장', '워터파크', '워터', '풀장', '자연풀장', '물썰매장'];
const BEACH = ['해수욕', '해변', '백사장', '바닷가'];
const VALLEY = ['계곡', '물놀이', '개울', '시냇물', '실개천'];
const NEG = ['금지', '불가', '자제', '위험', '익사', '삼가', '엄금'];

async function fetchText(url, ms = 15000) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(ms) });
    if (!r.ok) return '';
    return await r.text();
  } catch { return ''; }
}
const strip = (h) => {
  let t = h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ');
  t = t.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
  t = t.replace(/추천검색어[\s\S]{0,80}?통합검색/g, ' ');
  return t.replace(/\s+/g, ' ');
};

function scan(text) {
  const out = { facil: [], beach: [], valley: [], negated: [] };
  const check = (kw, bucket) => {
    let i = 0;
    while ((i = text.indexOf(kw, i)) !== -1) {
      const ctx = text.slice(i, i + kw.length + 12);
      if (NEG.some((n) => ctx.includes(n))) { if (!out.negated.includes(kw)) out.negated.push(kw); }
      else if (!out[bucket].includes(kw)) out[bucket].push(kw);
      i += kw.length;
    }
  };
  for (const k of FACIL) check(k, 'facil');
  for (const k of BEACH) check(k, 'beach');
  for (const k of VALLEY) check(k, 'valley');
  return out;
}

async function one(id, name) {
  const mainHtml = await fetchText(`${BASE}/indvz/main.do?hmpgId=${id}`);
  // 콘텐츠 페이지(cntnsSeq) 및 주변관광 링크 수집
  const seqs = [...new Set([...mainHtml.matchAll(/selectCntnsView\.do\?hmpgId=[^&"']+&(?:amp;)?cntnsSeq=(\d+)/g)].map((m) => m[1]))];
  let combined = strip(mainHtml);
  for (const s of seqs.slice(0, 40)) {
    combined += ' ' + strip(await fetchText(`${BASE}/pot/cn/selectCntnsView.do?hmpgId=${id}&cntnsSeq=${s}`));
  }
  // 주변관광(가까운 물놀이 명소)
  const sght = mainHtml.match(/selectSghtngList\.do\?hmpgId=[^&"']+&(?:amp;)?searchAreaCode=\d+/);
  if (sght) combined += ' ' + strip(await fetchText(BASE + '/' + sght[0].replace(/&amp;/g, '&').replace(/^\//, '')));
  const sig = scan(combined);
  const water = sig.facil.length || sig.beach.length || sig.valley.length;
  let reason = '';
  if (sig.facil.length) reason = sig.facil.slice(0, 3).join('·');
  else if (sig.beach.length) reason = '해변 인근';
  else if (sig.valley.length) reason = sig.valley.includes('물놀이') ? '계곡 물놀이' : '계곡';
  return { id, name, water: !!water, reason, cntns: seqs.length, ...sig };
}

const results = [];
for (const [id, name] of LODGING) {
  results.push(await one(id, name));
}
for (const r of results) {
  console.log(`${r.water ? '🏞️' : '  '} ${r.id} ${r.name} | ${r.reason || '-'} | facil:${r.facil} beach:${r.beach} valley:${r.valley} neg:${r.negated} (cntns ${r.cntns})`);
}
fs.writeFileSync('/tmp/sooperang-water.json', JSON.stringify(results, null, 1));
