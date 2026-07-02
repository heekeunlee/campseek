const $ = (id) => document.getElementById(id);
const RESERVE_URL = 'https://www.foresttrip.go.kr/rep/or/fcfsRsrvtMain.do?hmpgId=FRIP&menuId=001001';
const dashed = (v) => (v && v.length === 8 ? `${v.slice(4, 6)}/${v.slice(6)}` : v);
const wday = (v) => ['일', '월', '화', '수', '목', '금', '토'][new Date(+v.slice(0,4), +v.slice(4,6)-1, +v.slice(6)).getDay()];

let DATA = null;

async function init() {
  try {
    const res = await fetch('./data/availability.json?_=' + Date.now());
    if (!res.ok) throw new Error('데이터가 아직 없습니다 (첫 갱신 전).');
    DATA = await res.json();
  } catch (e) {
    $('meta').textContent = e.message;
    return;
  }

  // 셀렉트 채우기
  const opt = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; return o; };
  $('region').appendChild(opt('', '전체 지역'));
  DATA.regions.forEach((r) => $('region').appendChild(opt(r.arcd, r.name)));
  (DATA.sections || []).forEach((s) => $('section').appendChild(opt(s.code, s.name)));
  (DATA.dates || []).forEach((d) => $('date').appendChild(opt(d, `${dashed(d)}(${wday(d)}) 1박`)));

  $('foot').innerHTML =
    `최근 갱신: <b>${new Date(DATA.generatedAt).toLocaleString('ko-KR')}</b> · ` + $('foot').innerHTML;

  $('searchBtn').addEventListener('click', doSearch);
  $('refreshBtn').addEventListener('click', doRefresh);
  $('meta').textContent = '지역·시설·날짜를 고르고 [조회]를 누르세요.';
}

// 데이터 다시 불러와 현재 선택 조건으로 재렌더
async function reloadData(keepView) {
  const res = await fetch('./data/availability.json?_=' + Date.now());
  if (!res.ok) throw new Error('데이터 로드 실패');
  DATA = await res.json();
  if (keepView && $('date').value) doSearch();
}

// "🔄 지금 업데이트": 로컬 서버(한국)면 실시간 재조회+배포, 정적 사이트면 최신 스냅샷 재로드
let polling = null;
async function doRefresh() {
  const btn = $('refreshBtn');
  const msg = $('refreshMsg');
  btn.disabled = true;
  msg.textContent = '요청 중…';
  try {
    const r = await fetch('/api/refresh', { method: 'POST' });
    if (!r.ok && r.status !== 409) throw new Error('server ' + r.status);
    // 로컬 서버 존재 → 실시간 조회 진행. 상태 폴링.
    msg.textContent = '⏳ 실시간 조회 중… (전 지역/주말, 수 분 소요)';
    clearInterval(polling);
    polling = setInterval(async () => {
      try {
        const s = await (await fetch('/api/refresh')).json();
        if (s.running) {
          msg.textContent = '⏳ 실시간 조회 중… ' + (s.message || '');
        } else {
          clearInterval(polling);
          btn.disabled = false;
          msg.textContent = (s.ok ? '✅ 업데이트 완료' : '⚠ ' + (s.message || '실패')) +
            (s.generatedAt ? ' · ' + new Date(s.generatedAt).toLocaleString('ko-KR') : '');
          await reloadData(true);
        }
      } catch {
        clearInterval(polling); btn.disabled = false;
      }
    }, 3000);
  } catch {
    // 정적 gh-pages: 서버가 없음 → 최신 스냅샷만 다시 불러옴
    try {
      await reloadData(true);
      msg.textContent = 'ℹ 공개 사이트에서는 실시간 조회가 불가합니다. 최신 스냅샷을 불러왔습니다' +
        (DATA?.generatedAt ? ' (' + new Date(DATA.generatedAt).toLocaleString('ko-KR') + ')' : '') +
        '. 실시간 갱신은 로컬 실행(README) 후 이용하세요.';
    } catch (e) {
      msg.textContent = '새로고침 실패: ' + e.message;
    }
    btn.disabled = false;
  }
}

function doSearch() {
  if (!DATA) return;
  const arcd = $('region').value;
  const section = $('section').value;
  const date = $('date').value;
  const onlyAvail = $('availableOnly').checked;

  // 조건에 맞는 스냅샷 선택 (지역 전체면 모든 지역 합침)
  let snaps = DATA.snapshots.filter((s) => s.section === section && s.beginDate === date);
  if (arcd) snaps = snaps.filter((s) => s.arcd === arcd);
  if (!snaps.length) { $('meta').textContent = '해당 조건의 데이터가 없습니다.'; $('results').innerHTML = ''; return; }

  // 결과 합치기 (지역명 부여)
  let rows = [];
  for (const s of snaps) for (const r of s.results) rows.push({ ...r, regionName: s.regionName });
  if (onlyAvail) rows = rows.filter((r) => (r.availableCount ?? 0) > 0);
  rows.sort((a, b) => (b.availableCount || 0) - (a.availableCount || 0));

  const secNm = (DATA.sections.find((x) => x.code === section) || {}).name || '';
  const availN = rows.filter((r) => (r.availableCount ?? 0) > 0).length;
  $('meta').textContent = `${secNm} · ${dashed(date)}(${wday(date)}) · ${rows.length}개 시설 · 예약가능 ${availN}곳`;

  if (!rows.length) { $('results').innerHTML = '<p class="meta">조건에 맞는 시설이 없습니다.</p>'; return; }
  const facHead = section === '02' ? '야영장 수' : '객실 수';
  $('results').innerHTML = `<table>
    <thead><tr><th>휴양림</th><th>지역</th><th>빈자리</th><th>${facHead}</th>
      <th>대표요금<sup title="이용요금 페이지 기준. 국립=정확, 공립/사립=참고">*</sup></th>
      <th>인원·요금</th><th></th></tr></thead>
    <tbody>${rows.map(rowHtml).join('')}</tbody></table>
    <p class="meta">* 대표요금: 국립=이용요금표(비수기주중~성수기주말, 규모별 상이), <b>공립/사립='참고'(전체 범위·부정확할 수 있음)</b>. 이미지 요금표는 표시 안 됨. 정확한 값은 인원·요금 링크에서 확인.</p>`;
}

function won(pr, approx) {
  if (!pr || pr.min == null) return '<span style="color:#aaa">—</span>';
  const f = (n) => (Math.round(n / 1000) / 10).toString().replace(/\.0$/, '');
  const val = pr.min === pr.max ? `${f(pr.min)}만원` : `${f(pr.min)}~${f(pr.max)}만원`;
  return approx ? `${val} <span class="approx" title="공립/사립 또는 전체범위 — 참고용">참고</span>` : val;
}

function rowHtml(r) {
  const has = (r.availableCount ?? 0) > 0;
  const cnt = r.availableCount == null ? '—'
    : `<span class="${has ? 'avail-ok' : 'avail-no'}">${has ? '가능 ' + r.availableCount : '마감'}</span>`;
  const info = r.infoUrl || r.url || RESERVE_URL;
  return `<tr class="${has ? 'has-room' : ''}">
    <td>${r.name} <span class="badge ${r.type}">${r.type}</span></td>
    <td>${(r.regionName || '').replace(/^\s*/, '')}</td>
    <td>${cnt}</td>
    <td>${r.total ?? '—'}</td>
    <td>${won(r.priceRange, r.priceApprox)}</td>
    <td><a class="book" href="${info}" target="_blank" rel="noopener" title="몇인실 등 인원 정보 페이지">인원·요금 ↗</a></td>
    <td><a class="book" href="${RESERVE_URL}" target="_blank" rel="noopener">예약↗</a></td>
  </tr>`;
}

init();
