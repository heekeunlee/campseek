const dashed = (v) => (v && v.length === 8 ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : v);
const RESERVE_URL = 'https://www.foresttrip.go.kr/rep/or/fcfsRsrvtMain.do?hmpgId=FRIP&menuId=001001';

async function load() {
  try {
    const res = await fetch('./data/availability.json?_=' + Date.now());
    if (!res.ok) throw new Error('데이터 없음 (아직 첫 갱신 전일 수 있어요)');
    const { generatedAt, snapshots } = await res.json();
    document.getElementById('meta').textContent =
      '최근 갱신: ' + new Date(generatedAt).toLocaleString('ko-KR');
    render(snapshots);
  } catch (e) {
    document.getElementById('meta').textContent = e.message;
  }
}

function render(snapshots) {
  const board = document.getElementById('board');
  if (!snapshots.length) { board.innerHTML = '<p class="meta">감시 조건이 없습니다.</p>'; return; }
  board.innerHTML = snapshots.map((s) => {
    const has = (s.availableCount || 0) > 0;
    const head = `<div class="card">
      <div class="ch">
        <h2>${s.label || '(무제목)'} <span class="tag">${s.sectionName}</span></h2>
        <span class="status ${has ? 'ok' : 'no'}">${has ? '예약가능 ' + s.availableCount : '빈자리 없음'}</span>
      </div>
      <p class="meta">${dashed(s.beginDate)} ~ ${dashed(s.endDate)}${s.error ? ' · ⚠ ' + s.error : ''}</p>`;
    const rows = (s.results || []).map((r) => {
      const rh = (r.availableCount ?? 0) > 0;
      return `<tr class="${rh ? 'has' : ''}">
        <td>${r.name} <span class="badge ${r.type}">${r.type}</span></td>
        <td class="${rh ? 'avail-ok' : 'avail-no'}">${r.availableCount == null ? '—' : (rh ? '가능 ' + r.availableCount : '마감')}</td>
        <td>${r.total ?? '—'}</td>
        <td>${r.tel || ''}</td>
      </tr>`;
    }).join('');
    const table = rows
      ? `<table><thead><tr><th>휴양림</th><th>빈자리</th><th>총수</th><th>전화</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="meta">결과 없음</p>';
    return head + table + `<a class="book" href="${RESERVE_URL}" target="_blank" rel="noopener">숲나들e에서 예약 ↗</a></div>`;
  }).join('');
}

load();
setInterval(load, 60000);
