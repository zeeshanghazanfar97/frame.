#!/usr/bin/env bash
set -Eeuo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
env_file="${project_dir}/.env"
use_auth=false
build_image=true
check_only=false
wait_timeout=120

usage() {
  cat <<'USAGE'
Usage: scripts/deploy.sh [options]

Build and deploy Frame on the current Docker host using its existing Traefik stack.

  --env-file PATH      Read settings from PATH (default: .env, then .env.example)
  --auth               Enable the authentik@file middleware overlay
  --no-build           Deploy an existing FRAME_IMAGE without rebuilding
  --wait-timeout N     Container health timeout in seconds (default: 120)
  --check              Validate configuration without building or deploying
  -h, --help           Show this help
USAGE
}

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

while (($#)); do
  case "$1" in
    --env-file)
      (($# >= 2)) || fail '--env-file requires a path.'
      env_file="$2"; shift 2 ;;
    --auth) use_auth=true; shift ;;
    --no-build) build_image=false; shift ;;
    --check) check_only=true; shift ;;
    --wait-timeout)
      (($# >= 2)) || fail '--wait-timeout requires a number.'
      [[ "$2" =~ ^[1-9][0-9]*$ ]] || fail '--wait-timeout must be a positive integer.'
      wait_timeout="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown option: $1. Use --help." ;;
  esac
done

command -v docker >/dev/null 2>&1 || fail 'Docker is required.'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2.20+ is required.'
if [[ "$env_file" == "${project_dir}/.env" && ! -f "$env_file" ]]; then
  env_file="${project_dir}/.env.example"
fi
[[ -f "$env_file" ]] || fail "Settings file not found: $env_file"

compose=(docker compose --project-directory "$project_dir" --env-file "$env_file" -f "${project_dir}/compose.yaml")
if $use_auth; then compose+=(-f "${project_dir}/compose.auth.yaml"); fi

"${compose[@]}" config --quiet
# Read Compose's resolved interpolation values, without executing .env as shell code.
settings="$("${compose[@]}" config --environment)"
domain=frame.zeeit.dev
network=traefik-public
while IFS='=' read -r setting value; do
  case "$setting" in
    APP_DOMAIN) domain="$value" ;;
    TRAEFIK_NETWORK) network="$value" ;;
  esac
done <<< "$settings"
[[ -n "$domain" && -n "$network" ]] || fail 'APP_DOMAIN and TRAEFIK_NETWORK must not be empty.'
[[ "$domain" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || fail 'APP_DOMAIN must be a hostname without a scheme, port, or path.'

if $check_only; then
  printf 'Configuration valid: https://%s (network: %s)\n' "$domain" "$network"
  exit 0
fi

docker info >/dev/null 2>&1 || fail 'Docker is not reachable. Start Docker or select the correct Docker context.'
docker network inspect "$network" >/dev/null 2>&1 || fail "External network '$network' is missing. Start the existing Traefik stack first."
if $build_image; then "${compose[@]}" build --pull frame; fi
if ! "${compose[@]}" up --detach --no-build --wait --wait-timeout "$wait_timeout" frame; then
  "${compose[@]}" logs --tail 60 frame >&2 || true
  fail 'Deployment did not become healthy. See the container logs above.'
fi
"${compose[@]}" ps frame
printf '\nContainer is healthy. Traefik URL: https://%s\n' "$domain"
printf 'DNS, the websecure entrypoint, and the certificate resolver must already be configured in Traefik.\n'
