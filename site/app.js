const $ = (id) => document.getElementById(id);
const RESERVE_URL = 'https://www.foresttrip.go.kr/rep/or/fcfsRsrvtMain.do?hmpgId=FRIP&menuId=001001';
const dashed = (v) => (v && v.length === 8 ? `${v.slice(4, 6)}/${v.slice(6)}` : v);
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const toDate = (v) => new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6));
const wday = (v) => WD[toDate(v).getDay()];

let DATA = null;
let selectedDate = null;

// 상단(제목 아래) 최근 갱신 시각 표시
function setUpdated() {
  const el = $('updated');
  if (el && DATA) el.innerHTML = `최근 갱신: <b>${new Date(DATA.generatedAt).toLocaleString('ko-KR')}</b>`;
}

async function init() {
  try {
    const res = await fetch('./data/availability.json?_=' + Date.now());
    if (!res.ok) throw new Error('데이터가 아직 없습니다 (첫 갱신 전).');
    DATA = await res.json();
  } catch (e) {
    $('meta').textContent = e.message;
    return;
  }

  const opt = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; return o; };
  $('region').appendChild(opt('', '전체 지역'));
  DATA.regions.forEach((r) => $('region').appendChild(opt(r.arcd, r.name)));
  (DATA.sections || []).forEach((s) => $('section').appendChild(opt(s.code, s.name)));

  setUpdated();

  // '찾기' 버튼: 선택한 지역·시설로 달력/목록 갱신
  $('findBtn').addEventListener('click', () => { renderCalendar(); if (selectedDate) doSearch(); });
  $('availableOnly').addEventListener('change', () => { renderCalendar(); if (selectedDate) doSearch(); });
  setupAdmin();

  // 기본 선택일: 오늘 이후의 첫 데이터 날짜
  const today = new Date(); today.setHours(0, 0, 0, 0);
  selectedDate = (DATA.dates || []).find((d) => toDate(d) >= today) || (DATA.dates || [])[0] || null;
  renderCalendar();
  if (selectedDate) doSearch();
  else $('meta').textContent = '표시할 날짜가 없습니다.';
}

// 특정 날짜의 (현재 지역·시설 필터 기준) 예약가능 시설 수
function availCountFor(date) {
  const section = $('section').value;
  const arcd = $('region').value;
  let snaps = DATA.snapshots.filter((s) => s.section === section && s.beginDate === date);
  if (arcd) snaps = snaps.filter((s) => s.arcd === arcd);
  let n = 0;
  for (const s of snaps) for (const r of s.results) if ((r.availableCount ?? 0) > 0) n++;
  return n;
}

function heatClass(n) {
  if (!n) return 'heat-0';
  if (n <= 2) return 'heat-1';
  if (n <= 5) return 'heat-2';
  if (n <= 10) return 'heat-3';
  if (n <= 20) return 'heat-4';
  return 'heat-5';
}

function renderCalendar() {
  const dates = DATA.dates || [];
  if (!dates.length) { $('calendar').innerHTML = ''; return; }
  const dateSet = new Set(dates);
  const first = toDate(dates[0]);
  const last = toDate(dates[dates.length - 1]);

  // 월 단위로 렌더 (첫 날짜의 달 ~ 마지막 날짜의 달)
  const months = [];
  let cur = new Date(first.getFullYear(), first.getMonth(), 1);
  const end = new Date(last.getFullYear(), last.getMonth(), 1);
  while (cur <= end) { months.push(new Date(cur)); cur.setMonth(cur.getMonth() + 1); }

  const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  let html = '';
  for (const m of months) {
    const y = m.getFullYear(), mon = m.getMonth();
    const daysInMonth = new Date(y, mon + 1, 0).getDate();
    const firstDow = new Date(y, mon, 1).getDay();
    html += `<div class="cal-month">
      <div class="cal-title">${y}. ${mon + 1}</div>
      <div class="cal-grid">
        ${WD.map((w, i) => `<div class="cal-dow ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</div>`).join('')}
        ${Array(firstDow).fill('<div class="cal-cell empty"></div>').join('')}`;
    for (let d = 1; d <= daysInMonth; d++) {
      const key = ymd(new Date(y, mon, d));
      const dow = new Date(y, mon, d).getDay();
      const dowCls = dow === 0 ? 'sun' : dow === 6 ? 'sat' : '';
      if (!dateSet.has(key)) {
        html += `<div class="cal-cell out"><span class="dnum ${dowCls}">${d}</span></div>`;
        continue;
      }
      const n = availCountFor(key);
      const sel = key === selectedDate ? ' selected' : '';
      html += `<button type="button" class="cal-cell day ${heatClass(n)}${sel}" data-date="${key}">
        <span class="dnum ${dowCls}">${d}</span>
        <span class="dcount">${n || ''}</span>
      </button>`;
    }
    html += `</div></div>`;
  }
  $('calendar').innerHTML = html;
  $('calendar').querySelectorAll('.cal-cell.day').forEach((b) =>
    b.addEventListener('click', () => { selectedDate = b.dataset.date; renderCalendar(); doSearch(); }));
}

async function reloadData(keepView) {
  const res = await fetch('./data/availability.json?_=' + Date.now());
  if (!res.ok) throw new Error('데이터 로드 실패');
  DATA = await res.json();
  setUpdated();
  const gen = $('adminGen'); if (gen) gen.textContent = new Date(DATA.generatedAt).toLocaleString('ko-KR');
  renderCalendar();
  if (keepView && selectedDate) doSearch();
}

// ---- 관리자 모드 (제목 5연속 클릭 → PIN → 패널) ----
const ADMIN_PIN = '0001';
function setupAdmin() {
  const title = $('title');
  if (!title) return;
  let clicks = 0, timer = null;
  title.style.cursor = 'default';
  title.addEventListener('click', () => {
    clicks++;
    clearTimeout(timer);
    timer = setTimeout(() => { clicks = 0; }, 1500); // 1.5초 내 5연속
    if (clicks >= 5) { clicks = 0; openAdmin(); }
  });
  $('adminClose').addEventListener('click', closeAdmin);
  $('adminModal').addEventListener('click', (e) => { if (e.target === $('adminModal')) closeAdmin(); });
  $('pinSubmit').addEventListener('click', checkPin);
  $('pinInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') checkPin(); });
  $('adminRefresh').addEventListener('click', doRefresh);
}
function openAdmin() {
  $('adminPanel').hidden = true;
  $('adminPin').hidden = false;
  $('pinInput').value = '';
  $('pinMsg').textContent = '';
  $('adminModal').hidden = false;
  setTimeout(() => $('pinInput').focus(), 50);
}
function closeAdmin() { $('adminModal').hidden = true; }
function checkPin() {
  if ($('pinInput').value === ADMIN_PIN) {
    $('adminPin').hidden = true;
    $('adminPanel').hidden = false;
    $('adminGen').textContent = DATA ? new Date(DATA.generatedAt).toLocaleString('ko-KR') : '-';
    $('adminMsg').textContent = '';
  } else {
    $('pinMsg').textContent = '❌ PIN이 올바르지 않습니다.';
    $('pinInput').value = '';
    $('pinInput').focus();
  }
}

let polling = null;
async function doRefresh() {
  const btn = $('adminRefresh');
  const msg = $('adminMsg');
  btn.disabled = true;
  msg.textContent = '요청 중…';
  try {
    const r = await fetch('/api/refresh', { method: 'POST' });
    if (!r.ok && r.status !== 409) throw new Error('server ' + r.status);
    msg.textContent = '⏳ 실시간 조회 중… (전 지역·주중포함, 수 분 소요)';
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
  if (!DATA || !selectedDate) return;
  const arcd = $('region').value;
  const section = $('section').value;
  const date = selectedDate;
  const onlyAvail = $('availableOnly').checked;

  let snaps = DATA.snapshots.filter((s) => s.section === section && s.beginDate === date);
  if (arcd) snaps = snaps.filter((s) => s.arcd === arcd);

  const secNm = (DATA.sections.find((x) => x.code === section) || {}).name || '';
  if (!snaps.length) {
    $('meta').textContent = `${secNm} · ${dashed(date)}(${wday(date)}) · 해당 조건의 데이터가 없습니다.`;
    $('results').innerHTML = '';
    return;
  }

  let rows = [];
  for (const s of snaps) for (const r of s.results) rows.push({ ...r, regionName: s.regionName });
  if (onlyAvail) rows = rows.filter((r) => (r.availableCount ?? 0) > 0);
  rows.sort((a, b) => (b.availableCount || 0) - (a.availableCount || 0));

  const availN = rows.filter((r) => (r.availableCount ?? 0) > 0).length;
  $('meta').textContent = `${secNm} · ${dashed(date)}(${wday(date)}) 1박 · ${rows.length}개 시설 · 예약가능 ${availN}곳`;

  if (!rows.length) { $('results').innerHTML = '<p class="meta">조건에 맞는 시설이 없습니다.</p>'; return; }
  const facHead = section === '03' ? '카라반 수' : section === '02' ? '야영장 수' : '객실 수';
  $('results').innerHTML = `<table>
    <thead><tr><th>휴양림</th><th>지역</th><th>빈자리</th><th>${facHead}</th>
      <th>인원정보</th><th></th></tr></thead>
    <tbody>${rows.map(rowHtml).join('')}</tbody></table>`;
}

function rowHtml(r) {
  const has = (r.availableCount ?? 0) > 0;
  const cnt = r.availableCount == null ? '—'
    : `<span class="${has ? 'avail-ok' : 'avail-no'}">${has ? '가능 ' + r.availableCount : '마감'}</span>`;
  // 숙박 세부유형(독채/휴양관/연립동) — 빈자리가 있는 유형만 강조
  let bd = '';
  if (r.bd) {
    const seg = (label, n) => `<span class="${n > 0 ? 'bd-ok' : 'bd-no'}">${label} ${n}</span>`;
    bd = `<div class="bd">${seg('독채', r.bd.dc)} · ${seg('휴양관', r.bd.hy)} · ${seg('연립동', r.bd.yl)}</div>`;
  }
  const info = r.infoUrl || r.url || RESERVE_URL;
  return `<tr class="${has ? 'has' : ''}">
    <td>${r.name} <span class="badge ${r.type}">${r.type}</span></td>
    <td>${(r.regionName || '').replace(/^\s*/, '')}</td>
    <td>${cnt}${bd}</td>
    <td>${r.total ?? '—'}</td>
    <td><a class="book" href="${info}" target="_blank" rel="noopener" title="몇인실·빈자리 등 정보 페이지">인원정보 ↗</a></td>
    <td><a class="book" href="${r.reserveUrl || RESERVE_URL}" target="_blank" rel="noopener">예약↗</a></td>
  </tr>`;
}

init();
