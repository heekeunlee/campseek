#!/usr/bin/env bash
# 로컬(한국) 실행용: 숲나들e 조회+알림 → 대시보드 데이터를 main 에 커밋/푸시.
# GitHub 러너는 숲나들e에 차단되므로 조회는 반드시 이 머신(한국 접속 가능)에서 실행합니다.
# 푸시되면 GitHub Actions(pages.yml)가 정적 대시보드를 Pages 로 배포합니다.
# launchd/cron 으로 주기 실행하거나 수동 실행하세요.
set -euo pipefail
cd "$(dirname "$0")/.."

DATA="site/data/availability.json"
log() { echo "[$(date '+%F %T')] $*"; }

# 1) 조회 + 알림 + 데이터 생성
log "snapshot 실행"
node scripts/snapshot.js

# 2) 의미있는 변경(빈자리 현황)만 커밋 — generatedAt 타임스탬프만 바뀐 경우는 스킵
prev="$(git show HEAD:$DATA 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(JSON.stringify(j.snapshots.map(x=>[x.label,x.availableCount,(x.results||[]).map(r=>[r.insttId,r.availableCount])])))}catch{console.log("")}})' || echo "")"
curr="$(node -e 'const j=require("./'"$DATA"'");console.log(JSON.stringify(j.snapshots.map(x=>[x.label,x.availableCount,(x.results||[]).map(r=>[r.insttId,r.availableCount])])))')"

if [ "$prev" = "$curr" ]; then
  log "빈자리 현황 변화 없음 — 커밋 생략"
  exit 0
fi

git add "$DATA"
git commit -q -m "chore(data): 빈자리 현황 갱신 $(date -u +%FT%TZ)"
git push -q origin main
log "main 푸시 완료 → Pages 배포 트리거"
