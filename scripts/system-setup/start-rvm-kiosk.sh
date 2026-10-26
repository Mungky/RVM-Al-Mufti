#!/usr/bin/env bash
set -euo pipefail
rvm_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
rvm_state="${XDG_STATE_HOME:-$HOME/.local/state}/rvm-al-mufti"
mkdir -p -- "$rvm_state"
exec >>"$rvm_state/startup.log" 2>&1
printf '\n[%s] Starting RVM fullscreen from %s\n' "$(date --iso-8601=seconds)" "$rvm_root"
# Block sleep while the kiosk runs; normal shutdown and the physical power button remain available.
exec /usr/bin/systemd-inhibit --what=sleep --mode=block --who='RVM Al-Mufti' \
  --why='RVM sedang beroperasi sebagai kiosk' "$rvm_root/run-rvm.sh" --kiosk
