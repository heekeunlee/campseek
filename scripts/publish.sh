#!/usr/bin/env bash
# 로컬(한국) 실행용: 숲나들e 조회+알림 → 대시보드 데이터를 gh-pages 브랜치로 배포.
# GitHub 러너는 숲나들e에 차단되므로 조회는 반드시 이 머신(한국 접속 가능)에서 실행합니다.
# launchd/cron 으로 주기 실행하거나 수동으로 실행하세요.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"
WT="$REPO/.ghpages"           # gh-pages 브랜치 작업트리 (gitignore됨)
BRANCH="gh-pages"

log() { echo "[$(date '+%F %T')] $*"; }

# 1) 조회 + 알림 + 데이터 생성 (site/data/availability.json)
log "snapshot 실행"
node scripts/snapshot.js

# 2) gh-pages 작업트리 준비
if ! git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  log "gh-pages 브랜치가 없습니다. 먼저 초기화하세요 (README 참고)."
  exit 1
fi
if [ ! -d "$WT/.git" ] && ! git worktree list | grep -q "$WT"; then
  git worktree add "$WT" "$BRANCH" >/dev/null
fi

# 3) 정적 파일 + 데이터 동기화
cp site/index.html site/app.js site/style.css "$WT/"
mkdir -p "$WT/data"
cp site/data/availability.json "$WT/data/"
touch "$WT/.nojekyll"

# 4) 커밋 & 푸시 (변경 있을 때만)
cd "$WT"
git add -A
if git diff --cached --quiet; then
  log "변경 없음"
else
  git commit -q -m "chore(data): $(date -u +%FT%TZ)"
  git push -q origin "$BRANCH"
  log "gh-pages 푸시 완료"
fi
