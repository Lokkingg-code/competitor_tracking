#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/competitor-tracking"
ENV_FILE="$ENV_DIR/searxng.env"
COMPOSE_FILE="$ROOT/ops/searxng/compose.yaml"
ACTION="${1:-up}"

if [[ ! -f "$ENV_FILE" ]]; then
  mkdir -p "$ENV_DIR"
  umask 077
  printf 'SEARXNG_SECRET=%s\nSEARXNG_VERSION=latest\n' "$(openssl rand -hex 32)" > "$ENV_FILE"
  printf 'Created local SearXNG settings at %s\n' "$ENV_FILE"
fi

case "$ACTION" in
  up)
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d
    printf 'SearXNG is local-only at http://127.0.0.1:8080\n'
    printf 'JSON API test: curl -sS "http://127.0.0.1:8080/search?q=aviation&format=json"\n'
    ;;
  down)
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down
    ;;
  logs)
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs -f searxng
    ;;
  *)
    printf 'Usage: %s [up|down|logs]\n' "$0" >&2
    exit 2
    ;;
esac
