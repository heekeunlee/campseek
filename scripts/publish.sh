#!/usr/bin/env bash
# 로컬(한국) 실행용: 숲나들e 조회+알림 → 대시보드 데이터를 main 에 커밋/푸시.
# GitHub 러너는 숲나들e에 차단되므로 조회는 반드시 이 머신(한국 접속 가능)에서 실행합니다.
# 푸시되면 GitHub Actions(pages.yml)가 정적 대시보드를 Pages 로 배포합니다.
# launchd/cron 으로 주기 실행하거나 수동 실행하세요.
set -euo pipefail
cd "$(dirname "$0")/.."

DATA="site/data/availability.json"
LOCK="data/.publish.lock"
log() { echo "[$(date '+%F %T')] $*"; }

# 동시 실행 방지(launchd + 수동/버튼). mkdir 은 원자적.
mkdir -p data
if ! mkdir "$LOCK" 2>/dev/null; then
  log "다른 실행이 진행 중 — 건너뜀"
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

# 1) 조회 + 알림 + 데이터 생성
log "snapshot 실행"
node scripts/snapshot.js

pushed=0

# 2) 코드/설정 변경 자동 커밋 (데이터 파일은 제외 — 별도 처리)
#    소스 디렉터리만 스테이징 → 저장소 루트의 임시 파일(pg.html 등)은 건드리지 않음.
git add -A -- server scripts site config public README.md .github deploy 2>/dev/null || true
git reset -q -- "$DATA" 2>/dev/null || true
if ! git diff --cached --quiet; then
  git commit -q -m "chore(app): 앱/스크립트 갱신 $(date -u +%FT%TZ)"
  log "코드/설정 변경 커밋"
  pushed=1
fi

# 3) 빈자리 데이터: 의미있는 변경만 커밋 — generatedAt 타임스탬프만 바뀐 경우는 스킵
prev="$(git show HEAD:$DATA 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(JSON.stringify(j.snapshots.map(x=>[x.label,x.availableCount,(x.results||[]).map(r=>[r.insttId,r.availableCount])])))}catch{console.log("")}})' || echo "")"
curr="$(node -e 'const j=require("./'"$DATA"'");console.log(JSON.stringify(j.snapshots.map(x=>[x.label,x.availableCount,(x.results||[]).map(r=>[r.insttId,r.availableCount])])))')"

if [ "$prev" != "$curr" ]; then
  git add -f "$DATA"
  git commit -q -m "chore(data): 빈자리 현황 갱신 $(date -u +%FT%TZ)"
  log "빈자리 데이터 커밋"
  pushed=1
else
  log "빈자리 현황 변화 없음 — 데이터 커밋 생략"
fi

# 4) 변경이 있으면 한 번에 푸시
if [ "$pushed" = 1 ]; then
  git push -q origin main
  log "main 푸시 완료 → Pages 배포 트리거"
else
  log "변경 없음 — 푸시 생략"
fi
