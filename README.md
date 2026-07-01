# 🌲 campseek

**숲나들e(산림청 자연휴양림)** 의 **숲속의 집·야영장 빈자리**를 조회하고, 원하는 조건에
빈자리가 생기면 알림을 보내주는 웹 앱입니다. 취소표(빈자리) 잡기에 유용합니다.

- 전국 자연휴양림(국립/공립/사립) 실시간 빈자리 조회
- 지역 / 휴양림 / 날짜 / 시설종류(숲속의 집·야영장) 필터
- 조건 감시 → 빈자리 발생 시 텔레그램·웹훅·콘솔 알림
- **의존성 0개** (Node 내장 모듈만 사용)

---

## 빠른 시작

```bash
cd campseek
cp .env.example .env      # (선택) 알림/설정 조정
npm start                 # → http://localhost:3000
```

브라우저에서 `http://localhost:3000` 접속 → 시설종류·지역·날짜 선택 후 **조회**.
원하는 조건에서 **🔔 이 조건 감시**를 누르면 백그라운드로 빈자리를 감시합니다.

> Node.js 20 이상 필요 (권장 20.6+, `.env` 자동 로드 및 내장 fetch 사용).

---

## 동작 방식 (데이터 소스)

| 소스 | 용도 | 상태 |
|---|---|---|
| **숲나들e 내부 조회 API** (`foresttrip.go.kr`) | 전국 147개 휴양림 실시간 빈자리 | ✅ 기본 사용 |
| **공공데이터포털 OpenAPI** (국립 예약정보) | 국립 휴양림 교차검증 | ⚙️ 선택(키 필요) |

내부적으로 사용하는 숲나들e 엔드포인트:

- `GET /rep/or/selectSiDoList.do` — 시도 목록
- `GET /rep/cm/remmnAreaOrRcfclList.do` — 전국 휴양림 마스터(국립/공립/사립)
- `POST /rep/or/innerFcfsRcrfrDtlDetls.do?_csrf=…` — 빈자리 검색
  - 파라미터: `srchInsttArcd`(지역), `srchInsttId`(휴양림), `srchRsrvtBgDt`/`srchRsrvtEdDt`(입·퇴실),
    `houseCampSctin`(`01`=숲속의집 / `02`=야영장), `rsrvtPssblYn`(예약가능만)
  - 세션 쿠키 + CSRF 토큰을 자동 획득/갱신하며 호출

응답에서 `예약가능 객실 수`, `[객실]/[야영장]` 수, 국립/공립/사립, 좌표·전화를 파싱합니다.

---

## 알림 설정 (선택)

`.env` 에 채널을 설정하면 감시 중 빈자리 발생 시 해당 채널로 전송됩니다.
아무것도 설정하지 않으면 콘솔 로그 + 웹 UI "최근 알림"에만 표시됩니다.

**텔레그램**
```
TELEGRAM_BOT_TOKEN=123456:ABC-...   # @BotFather 로 생성
TELEGRAM_CHAT_ID=123456789          # 본인 chat id
```

**웹훅 (Slack/Discord 등)**
```
NOTIFY_WEBHOOK_URL=https://hooks.slack.com/services/...
```

**감시 주기**
```
WATCH_INTERVAL_MS=300000    # 5분(기본). 너무 짧게 두지 말 것.
WATCH_RENOTIFY_MS=3600000   # 재알림 최소 간격 1시간(기본)
```

---

## 공식 OpenAPI 연동 (선택, 국립 교차검증)

1. [data.go.kr 국립자연휴양림 예약정보](https://www.data.go.kr/data/15134227/openapi.do) 활용신청 → `serviceKey` 발급
2. 승인 후 상세페이지의 **요청주소(전체 URL)** 확인
3. `.env` 설정
   ```
   FOREST_OPENAPI_KEY=디코딩된_serviceKey
   FOREST_OPENAPI_URL=승인상세페이지의_전체_요청주소
   ```
4. `GET /api/openapi/reservations` 로 조회 가능

이 API는 "예약된 건(확정/대기/취소)"을 주므로 빈자리를 직접 주지 않고, 국립만 대상입니다.
그래서 **주 데이터는 숲나들e 내부 조회**를 사용하고 이 API는 보조로만 씁니다.

---

## REST API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/regions` | 시도 목록 |
| GET | `/api/forests` | 전국 휴양림 마스터 |
| GET | `/api/search?arcd=&insttId=&begin=YYYYMMDD&end=YYYYMMDD&section=01\|02&availableOnly=` | 빈자리 검색 |
| GET | `/api/watches` · POST · PATCH `/:id` · DELETE `/:id` | 감시 CRUD |
| POST | `/api/watches/run` | 감시 즉시 실행 |
| GET | `/api/events` | 최근 알림 이벤트 |
| GET | `/api/openapi/reservations` | (옵션) 공식 OpenAPI |

CLI로 클라이언트만 점검: `npm run forests`

---

## 프로젝트 구조

```
campseek/
├─ server/
│  ├─ index.js          # HTTP 서버 + REST API
│  ├─ forestClient.js   # 숲나들e 내부 API 클라이언트 + HTML 파서
│  ├─ openApiClient.js  # (옵션) 공식 OpenAPI
│  ├─ store.js          # 감시 저장(JSON)
│  ├─ watcher.js        # 감시 폴링 루프
│  └─ notify.js         # 알림 채널
├─ public/              # 웹 UI (index.html/app.js/style.css)
├─ data/watches.json    # 감시 데이터(자동 생성)
└─ .env.example
```

---

## 주의 / 면책

- 숲나들e 내부 엔드포인트는 **공식 공개 API가 아닙니다.** 사이트 개편 시 동작이 바뀔 수 있습니다.
- **개인 용도**로 합리적인 주기(기본 5분)로만 사용하세요. 과도한 요청은 차단·법적 문제가 될 수 있습니다.
- 실제 예약·결제는 [숲나들e](https://www.foresttrip.go.kr) 에서 진행됩니다(실명인증 필요).
- 예약 오픈 시간대에는 NetFUNNEL(대기열)이 걸릴 수 있습니다.
