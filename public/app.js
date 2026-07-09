const $ = (id) => document.getElementById(id);
const api = async (url, opts) => {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  return r.json();
};
const ymd = (v) => (v || '').replaceAll('-', ''); // yyyy-mm-dd → yyyymmdd
const dashed = (v) => (v && v.length === 8 ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : v);
const sectionNm = (s) =>
  s === '04' ? '숲체원' : s === '03' ? '카라반' : s === '02' ? '야영장' : '숲속의 집';

let FORESTS = [];

// ---- 초기 로드 ----
async function init() {
  // 기본 날짜: 다음 주말
  const t = new Date();
  const toNextSat = (6 - t.getDay() + 7) % 7 || 7;
  const sat = new Date(t); sat.setDate(t.getDate() + toNextSat);
  const sun = new Date(sat); sun.setDate(sat.getDate() + 1);
  $('begin').value = sat.toISOString().slice(0, 10);
  $('end').value = sun.toISOString().slice(0, 10);

  try {
    const [regions, forests] = await Promise.all([api('/api/regions'), api('/api/forests')]);
    FORESTS = forests;
    for (const r of regions) {
      const o = document.createElement('option');
      o.value = r.arcd; o.textContent = r.name;
      $('region').appendChild(o);
    }
  } catch (e) {
    $('searchMeta').textContent = '초기 데이터 로드 실패: ' + e.message;
  }

  $('region').addEventListener('change', fillForests);
  $('searchForm').addEventListener('submit', (e) => { e.preventDefault(); doSearch(); });
  $('watchBtn').addEventListener('click', addWatch);
  $('runBtn').addEventListener('click', async () => { await api('/api/watches/run', { method: 'POST' }); loadWatches(); loadEvents(); });

  loadWatches();
  loadEvents();
  setInterval(() => { loadWatches(); loadEvents(); }, 30000);
}

function fillForests() {
  const arcd = $('region').value;
  const sel = $('forest');
  sel.innerHTML = '<option value="">지역 내 전체</option>';
  FORESTS.filter((f) => !arcd || f.arcd === arcd).forEach((f) => {
    const o = document.createElement('option');
    o.value = f.insttId; o.textContent = `${f.name} [${f.type}]`;
    sel.appendChild(o);
  });
}

// ---- 검색 ----
async function doSearch() {
  const params = new URLSearchParams({
    arcd: $('region').value,
    insttId: $('forest').value,
    begin: ymd($('begin').value),
    end: ymd($('end').value),
    section: $('section').value,
    availableOnly: $('availableOnly').checked,
  });
  $('searchMeta').textContent = '조회 중…';
  $('results').innerHTML = '';
  try {
    const { count, results } = await api('/api/search?' + params);
    const withRoom = results.filter((r) => (r.availableCount ?? 0) > 0).length;
    $('searchMeta').textContent = `${sectionNm($('section').value)} · ${count}개 시설 · 예약가능 ${withRoom}곳`;
    renderResults(results);
  } catch (e) {
    $('searchMeta').textContent = '조회 실패: ' + e.message;
  }
}

function renderResults(results) {
  if (!results.length) { $('results').innerHTML = '<p class="meta">결과가 없습니다.</p>'; return; }
  const rows = results.map((r) => {
    const has = (r.availableCount ?? 0) > 0;
    const cnt = r.availableCount == null
      ? '—'
      : `<span class="${has ? 'avail-ok' : 'avail-no'}">${has ? '예약가능 ' + r.availableCount : '마감'}</span>`;
    const bd = r.bd
      ? `<div class="bd"><span class="${r.bd.dc > 0 ? 'bd-ok' : 'bd-no'}">독채 ${r.bd.dc}</span> · ` +
        `<span class="${r.bd.hy > 0 ? 'bd-ok' : 'bd-no'}">휴양관 ${r.bd.hy}</span> · ` +
        `<span class="${r.bd.yl > 0 ? 'bd-ok' : 'bd-no'}">연립동 ${r.bd.yl}</span></div>`
      : '';
    const sv = $('section').value;
    const fac = sv === '03'
      ? '—'
      : sv === '02'
      ? (r.totalCampsites != null ? r.totalCampsites + '개' : '—')
      : (r.totalRooms != null ? r.totalRooms + '개' : '—');
    const info = r.infoUrl || (r.url && /^https?:\/\//.test(r.url)
      ? r.url.replace(/^http:/, 'https:')
      : (/^\d+$/.test(r.insttId) ? `https://www.foresttrip.go.kr/${r.insttId}` : r.reserveUrl));
    return `<tr class="${has ? 'has-room' : ''}">
      <td>${r.name || ''} <span class="badge ${r.type}">${r.type || ''}</span></td>
      <td>${cnt}${bd}</td>
      <td>${fac}</td>
      <td><a class="book" href="${info}" target="_blank" rel="noopener" title="몇인실 등 인원 정보 페이지">인원정보 ↗</a></td>
      <td><a class="book" href="${r.reserveUrl}" target="_blank" rel="noopener">예약↗</a></td>
    </tr>`;
  }).join('');
  const facHead = $('section').value === '03' ? '카라반 수' : $('section').value === '02' ? '야영장 수' : '객실 수';
  $('results').innerHTML = `<table>
    <thead><tr><th>휴양림</th><th>빈자리</th><th>${facHead}</th><th>인원정보</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

// ---- 감시 ----
async function addWatch() {
  const begin = ymd($('begin').value), end = ymd($('end').value);
  if (!begin || !end) { alert('날짜를 선택하세요.'); return; }
  const forest = FORESTS.find((f) => f.insttId === $('forest').value);
  const region = $('region').options[$('region').selectedIndex]?.text;
  const label = forest ? forest.name : (region && $('region').value ? region.trim() : '전체');
  try {
    await api('/api/watches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        arcd: $('region').value, insttId: $('forest').value, label,
        beginDate: begin, endDate: end, section: $('section').value,
      }),
    });
    loadWatches();
  } catch (e) { alert('감시 등록 실패: ' + e.message); }
}

async function loadWatches() {
  try {
    const ws = await api('/api/watches');
    if (!ws.length) { $('watches').innerHTML = '<p class="meta">등록된 감시가 없습니다.</p>'; return; }
    $('watches').innerHTML = ws.map((w) => {
      const last = w.lastCheckedAt ? new Date(w.lastCheckedAt).toLocaleString('ko-KR') : '아직 없음';
      const avail = w.lastAvailableCount == null ? '' :
        ` · <span class="${w.lastAvailableCount > 0 ? 'avail-ok' : 'avail-no'}">최근 빈자리 ${w.lastAvailableCount}</span>`;
      return `<div class="watch-item">
        <div class="info">
          <b>${w.label || '전체'}</b> <span class="pill ${w.active ? 'on' : 'off'}">${w.active ? '감시중' : '중지'}</span><br>
          <small>${sectionNm(w.section)} · ${dashed(w.beginDate)} ~ ${dashed(w.endDate)} · 최근확인 ${last}${avail}</small>
        </div>
        <div>
          <button class="tiny mini" data-toggle="${w.id}" data-active="${w.active}">${w.active ? '중지' : '재개'}</button>
          <button class="tiny danger" data-del="${w.id}">삭제</button>
        </div>
      </div>`;
    }).join('');
    $('watches').querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => { await api('/api/watches/' + b.dataset.del, { method: 'DELETE' }); loadWatches(); }));
    $('watches').querySelectorAll('[data-toggle]').forEach((b) =>
      b.addEventListener('click', async () => {
        await api('/api/watches/' + b.dataset.toggle, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: b.dataset.active !== 'true' }),
        });
        loadWatches();
      }));
  } catch (e) { $('watches').innerHTML = '<p class="meta">감시 로드 실패: ' + e.message + '</p>'; }
}

async function loadEvents() {
  try {
    const evs = await api('/api/events');
    if (!evs.length) { $('events').innerHTML = '<p class="meta">아직 알림이 없습니다.</p>'; return; }
    $('events').innerHTML = evs.map((e) => `<div class="event-item">
      <div class="title">${e.title}</div>
      <small class="meta">${new Date(e.at).toLocaleString('ko-KR')}</small>
    </div>`).join('');
  } catch { /* noop */ }
}

init();
