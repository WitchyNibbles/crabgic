#!/usr/bin/env bash
# roadmap/19-jira-datacenter-adapter.md §Exit criteria: "DC 10.3 and 11.3
# container recipes boot and pass a smoke test in CI, reusable unmodified
# by 23's disposable-environment tooling." A boot/health-probe smoke test
# ONLY — it brings up the named edition's recipe, polls `/status` until
# Jira reports RUNNING (or the timeout elapses), then tears the stack
# down. It never proceeds past the first-run setup wizard and never
# requires a Jira license/secret that doesn't exist in this repo's CI —
# per this phase's own constraint ("do not require secrets that don't
# exist").
#
# Usage: ./smoke-test.sh <10.3|11.3>
set -euo pipefail

EDITION="${1:?usage: smoke-test.sh <10.3|11.3>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${HERE}/${EDITION}/docker-compose.yml"
MAX_WAIT_SECONDS=600
POLL_INTERVAL_SECONDS=10

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "::error::no docker-compose.yml for edition '${EDITION}' at ${COMPOSE_FILE}" >&2
  exit 1
fi

cleanup() {
  echo "Tearing down Jira Data Center ${EDITION} smoke-test stack..."
  docker compose -f "${COMPOSE_FILE}" down -v || true
}
trap cleanup EXIT

echo "Booting Jira Data Center ${EDITION}..."
docker compose -f "${COMPOSE_FILE}" up -d

elapsed=0
until curl -fsS "http://localhost:8080/status" 2>/dev/null | grep -q '"state":"RUNNING"'; do
  if [[ "${elapsed}" -ge "${MAX_WAIT_SECONDS}" ]]; then
    echo "::error::Jira Data Center ${EDITION} did not reach RUNNING within ${MAX_WAIT_SECONDS}s" >&2
    docker compose -f "${COMPOSE_FILE}" logs --tail=200 || true
    exit 1
  fi
  sleep "${POLL_INTERVAL_SECONDS}"
  elapsed=$((elapsed + POLL_INTERVAL_SECONDS))
done

echo "Jira Data Center ${EDITION} reached RUNNING after ~${elapsed}s — smoke test passed."
