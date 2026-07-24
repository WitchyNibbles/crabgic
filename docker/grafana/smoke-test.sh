#!/usr/bin/env bash
# roadmap/23-release-hardening.md §In scope: "Grafana OSS/Enterprise
# 11.6/12.4/13.1 containers". A boot/health-probe smoke test ONLY — brings
# up the named version+edition's recipe, polls `/api/health` until Grafana
# reports `"database":"ok"` (or the timeout elapses), then tears the stack
# down (`down -v`, guaranteed via a `trap ... EXIT`, mirroring
# docker/jira-datacenter/smoke-test.sh's own pattern). No Grafana license is
# required for either edition to reach this healthy state — see README.md's
# honesty note on OSS-vs-Enterprise licensing.
#
# Usage: ./smoke-test.sh <11.6|12.4|13.1> [oss|enterprise]   (default: oss)
set -euo pipefail

VERSION="${1:?usage: smoke-test.sh <11.6|12.4|13.1> [oss|enterprise]}"
EDITION="${2:-oss}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${EDITION}" in
  oss)
    COMPOSE_FILE="${HERE}/${VERSION}/docker-compose.yml"
    ;;
  enterprise)
    COMPOSE_FILE="${HERE}/${VERSION}/docker-compose.enterprise.yml"
    ;;
  *)
    echo "::error::edition must be 'oss' or 'enterprise', got '${EDITION}'" >&2
    exit 1
    ;;
esac

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "::error::no docker-compose file for version '${VERSION}' edition '${EDITION}' at ${COMPOSE_FILE}" >&2
  exit 1
fi

# Must match the host port this version+edition's compose file publishes
# (see docker-compose*.yml's own `ports:` mapping and README.md's port table).
HOST_PORT="$(grep -m1 -oE '"[0-9]+:3000"' "${COMPOSE_FILE}" | grep -oE '^"[0-9]+' | tr -d '"')"
if [[ -z "${HOST_PORT}" ]]; then
  echo "::error::could not determine host port from ${COMPOSE_FILE}" >&2
  exit 1
fi

MAX_WAIT_SECONDS=180
POLL_INTERVAL_SECONDS=5

cleanup() {
  echo "Tearing down Grafana ${EDITION} ${VERSION} smoke-test stack..."
  docker compose -f "${COMPOSE_FILE}" down -v || true
}
trap cleanup EXIT

echo "Booting Grafana ${EDITION} ${VERSION}..."
docker compose -f "${COMPOSE_FILE}" up -d

elapsed=0
until curl -fsS "http://localhost:${HOST_PORT}/api/health" 2>/dev/null | grep -q '"database"[[:space:]]*:[[:space:]]*"ok"'; do
  if [[ "${elapsed}" -ge "${MAX_WAIT_SECONDS}" ]]; then
    echo "::error::Grafana ${EDITION} ${VERSION} did not reach a healthy /api/health within ${MAX_WAIT_SECONDS}s" >&2
    docker compose -f "${COMPOSE_FILE}" logs --tail=200 || true
    exit 1
  fi
  sleep "${POLL_INTERVAL_SECONDS}"
  elapsed=$((elapsed + POLL_INTERVAL_SECONDS))
done

echo "Grafana ${EDITION} ${VERSION} reached a healthy /api/health after ~${elapsed}s — smoke test passed."
