#!/usr/bin/env bash
# Run one local check at a time in a resource-limited user scope.
set -euo pipefail

if (( $# == 0 )); then
  printf 'Usage: %s command [arguments...]\n' "$0" >&2
  exit 2
fi

for tool in systemd-run flock awk; do
  command -v "$tool" >/dev/null || { printf 'Required tool unavailable: %s\n' "$tool" >&2; exit 2; }
done

case "$(basename "$1")" in
  docker|podman)
    printf 'Containers do not inherit this scope. Configure container limits separately.\n' >&2
    exit 2
    ;;
esac

cache="${XDG_CACHE_HOME:-$HOME/.cache}"
mkdir -p "$cache"
exec 9>"$cache/pi-local-check.lock"
flock -n 9 || { printf 'Another limited check is running; nothing started.\n' >&2; exit 1; }

# Keep 4 GiB available. Reserve 256 MiB / 25% CPU within the 1 GiB / one-CPU
# job budget for a separately limited disposable database when a test needs it.
awk '/^MemAvailable:/ { found=1; if ($2 < 4194304) exit 1 } END { if (!found) exit 1 }' /proc/meminfo || {
  printf 'Less than 4 GiB available RAM; nothing started.\n' >&2
  exit 1
}

# No fallback to an unrestricted process if the scope cannot be created.
systemd-run --user --scope --quiet \
  -p MemoryMax=768M -p MemorySwapMax=0 -p CPUQuota=75% -p TasksMax=128 \
  -- "$@"
