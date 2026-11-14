#!/usr/bin/env bash
# Deploys one commit of main on the production server. Called by the GitHub Actions "deploy" job over SSH;
# the deploy key's authorized_keys entry forces this script, and the commit SHA arrives in SSH_ORIGINAL_COMMAND:
#
#   command="/opt/leadpilot/scripts/deploy.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA... github-deploy
#
# By hand, on the server:   scripts/deploy.sh "$(git rev-parse origin/main)"
#
# Steps: check the SHA is on origin/main -> back up the database -> check out the commit -> rebuild and restart the
# stack (migrations run first through the `migrate` service) -> wait until every service is healthy.
# Expects the server's .env to set COMPOSE_FILE and COMPOSE_PROFILES (docs/deployment.md, "CI/CD").
set -euo pipefail

HEALTH_TIMEOUT_SECONDS="${DEPLOY_HEALTH_TIMEOUT:-300}"

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
fail() { log "ERROR: $*"; exit 1; }

show_diagnostics() {
  log "Deploy failed. Service status and recent logs:"
  docker compose ps --all || true
  docker compose logs --no-color --tail 100 migrate web || true
}

# Returns 0 once every container of the project is healthy (or running without a health check,
# or a one-shot that exited with 0). Returns 1 while something is starting, 2 when something has failed.
check_services() {
  local id state health exit_code name status=0
  for id in $(docker compose ps --all --quiet); do
    read -r name state health exit_code < <(docker inspect --format \
      '{{.Name}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.State.ExitCode}}' "$id")
    case "$state/$health" in
      running/healthy | running/none) ;;
      running/starting) status=1 ;;
      exited/*) [ "$exit_code" = 0 ] || { log "$name exited with code $exit_code"; return 2; } ;;
      restarting/* | */unhealthy) log "$name is $state ($health)"; return 2 ;;
      *) status=1 ;; # created, still starting
    esac
  done
  return "$status"
}

main() {
  local sha="${1:-${SSH_ORIGINAL_COMMAND:-}}"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || fail "expected a full 40-character commit SHA, got '${sha:0:60}'"

  local tool
  for tool in git docker flock; do command -v "$tool" > /dev/null || fail "$tool is not installed"; done

  cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.."
  [ -f .env ] || fail ".env not found in $(pwd)"

  # One deploy at a time, including manual runs.
  exec 9> .deploy.lock
  flock --nonblock 9 || fail "another deploy is running"

  log "Fetching origin/main"
  git fetch --quiet origin main
  git cat-file -e "$sha^{commit}" 2> /dev/null || fail "commit $sha not found on the remote"
  git merge-base --is-ancestor "$sha" origin/main || fail "commit $sha is not on origin/main"
  [ -z "$(git status --porcelain --untracked-files=no)" ] || fail "tracked files were changed on the server; refusing to overwrite them"

  if docker compose ps --status running --services | grep -qx postgres; then
    log "Backing up the database"
    scripts/backup-db.sh
  else
    log "Postgres is not running (first deploy?); skipping the backup"
  fi

  log "Checking out $sha (was $(git rev-parse HEAD))"
  git checkout --quiet --detach "$sha"

  log "Building and starting the stack"
  docker compose up --detach --build --remove-orphans || { show_diagnostics; exit 1; }

  log "Waiting up to ${HEALTH_TIMEOUT_SECONDS}s for all services to become healthy"
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS)) result
  while :; do
    result=0
    check_services || result=$?
    [ "$result" = 0 ] && break
    if [ "$result" = 2 ] || [ "$SECONDS" -ge "$deadline" ]; then
      show_diagnostics
      exit 1
    fi
    sleep 5
  done

  echo "$sha" > .deployed-sha
  docker image prune --force > /dev/null
  log "Deployed $sha"
}

# Everything runs inside main(), which bash reads completely before starting, so checking out a new version of this
# file during the deploy cannot change the steps of the run in progress.
main "$@"
