// 최종 '물놀이 가능' 맵 생성 → config/waterMap.json (커밋되는 정적 자료)
// 판정 근거:
//  AUTO — 숲나들e 각 휴양림 CMS(소개/부대시설/레포츠/시설물)가 스스로 광고하는 물놀이 요소
//    · 시설(수영장·물놀이장·워터 등) / 강한 해변(해수욕·해변·백사장·바닷가) / 계곡·물놀이·개울
//    · 호수·저수지·수변(단순 조망/산책)과 '바다'(전망·비유 오탐 많음)는 자동 제외
//  MANUAL — 자동 스캔이 놓친 확인된 명소(섬 해변, 유명 계곡 등). 개별 검증 완료.
import fs from 'fs';

// 원자료: 우선 커밋본(config), 없으면 수집 임시본(/tmp)
const rawPath = fs.existsSync('config/water-signals.json') ? 'config/water-signals.json' : '/tmp/water-signals.json';
const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
const STRONG_BEACH = new Set(['해수욕', '해변', '백사장', '바닷가']);

const map = {};
for (const r of Object.values(raw)) {
  const facil = r.facil || [];
  const beach = (r.beach || []).filter((k) => STRONG_BEACH.has(k));
  const valley = r.valley || [];
  let reason = '';
  if (facil.length) reason = facil.slice(0, 3).join('·');           // 예: 수영장·물놀이장
  else if (beach.length) reason = '해변 인근';
  else if (valley.length) reason = valley.includes('물놀이') ? '계곡 물놀이' : '계곡';
  if (reason) map[r.insttId] = reason;
}

// 개별 검증한 수동 보정 (자동 스캔 누락/오탐 교정)
const MANUAL_ADD = {
  ID02030086: '해변 인근(안면도)',   // 안면도 - 꽃지·밧개 해변
  ID02030100: '해변 인근(강릉 안인)', // 임해 - 동해 바닷가
  ID02030071: '해변 인근(석모도)',   // 석모도 - 민머루해변
  ID02030127: '해변 인근(덕적도)',   // 덕적도 - 서포리해변
  '0201': '해변 인근(진도)',         // 진도
  ID02030021: '해변 인근(완도)',     // 완도
  '0301': '해변 인근(신시도)',       // 신시도(고군산군도)
  ID02030041: '계곡 물놀이(선암계곡)', // 소선암 - 선암계곡 (웹 확인)
};
const MANUAL_REMOVE = []; // 필요시 오탐 제거용

for (const [id, reason] of Object.entries(MANUAL_ADD)) map[id] = reason;
for (const id of MANUAL_REMOVE) delete map[id];

fs.mkdirSync('config', { recursive: true });
fs.writeFileSync('config/waterMap.json', JSON.stringify(map, null, 1));

// 요약
const forests = JSON.parse(fs.readFileSync('/tmp/forests-master.json', 'utf8'));
const nameById = Object.fromEntries(forests.map((f) => [f.insttId, f.name]));
console.log(`물놀이 가능 표시: ${Object.keys(map).length} / ${forests.length} 곳`);
const byReason = {};
for (const rsn of Object.values(map)) {
  const k = rsn.startsWith('해변') ? '해변' : rsn.startsWith('계곡') ? '계곡/물놀이' : '시설';
  byReason[k] = (byReason[k] || 0) + 1;
}
console.log('유형별:', JSON.stringify(byReason));
