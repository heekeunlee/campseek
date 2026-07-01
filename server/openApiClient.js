// [옵션] 공공데이터포털 공식 OpenAPI 연동
//   산림청_국립자연휴양림 예약정보  (data.go.kr/data/15134227)
//
// 이 API는 "예약된 건"(확정/대기/취소)을 실시간 제공합니다. 국립 휴양림만 대상이며,
// 빈자리를 직접 주지 않으므로 내부 클라이언트(forestClient.js) 결과의 교차검증용으로 씁니다.
//
// 사용 전 준비:
//   1) data.go.kr 에서 "국립자연휴양림 예약정보" 활용신청 → 인증키(serviceKey) 발급
//   2) 승인 후 상세페이지의 "요청주소"(엔드포인트)와 오퍼레이션명을 확인
//   3) .env 에 아래 값 설정
//        FOREST_OPENAPI_KEY=<발급받은 serviceKey(디코딩된 값)>
//        FOREST_OPENAPI_URL=<상세페이지의 전체 요청 URL>   (예: https://apis.data.go.kr/1400000/.../....)
//
// 엔드포인트/파라미터는 데이터셋마다 다를 수 있어 URL을 통째로 주입받도록 설계했습니다.

const KEY = process.env.FOREST_OPENAPI_KEY;
const URL_BASE = process.env.FOREST_OPENAPI_URL;

export function isConfigured() {
  return Boolean(KEY && URL_BASE);
}

/**
 * 국립자연휴양림 예약정보 조회.
 * @param {object} opts
 * @param {number} [opts.pageNo=1]
 * @param {number} [opts.numOfRows=100]
 * @param {object} [opts.extra] 데이터셋별 추가 파라미터 (예: { insttNm, lodgDe })
 * @returns {Promise<{items:Array, raw:string}>}
 */
export async function getReservations({ pageNo = 1, numOfRows = 100, extra = {} } = {}) {
  if (!isConfigured())
    throw new Error('OpenAPI 미설정: FOREST_OPENAPI_KEY / FOREST_OPENAPI_URL 를 .env 에 설정하세요.');
  const url = new URL(URL_BASE);
  url.searchParams.set('serviceKey', KEY);
  url.searchParams.set('pageNo', String(pageNo));
  url.searchParams.set('numOfRows', String(numOfRows));
  url.searchParams.set('type', 'json'); // 지원 시 JSON, 아니면 XML로 응답
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`OpenAPI 요청 실패: HTTP ${res.status}`);
  const text = await res.text();

  // JSON 우선, 실패 시 XML 아이템을 러프하게 파싱
  try {
    const j = JSON.parse(text);
    const items = j?.response?.body?.items?.item ?? j?.items ?? [];
    return { items: Array.isArray(items) ? items : [items].filter(Boolean), raw: text };
  } catch {
    const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
      const rec = {};
      for (const f of m[1].matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)) rec[f[1]] = f[2].trim();
      return rec;
    });
    return { items, raw: text };
  }
}
