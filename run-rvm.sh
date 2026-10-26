#!/usr/bin/env bash
set -euo pipefail
rvm_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd -- "$rvm_dir"
# Pick up newly granted serial permissions without requiring a desktop logout.
if command -v sg >/dev/null 2>&1 && [[ " $(id -Gn) " != *" dialout "* && " $(id -Gn "$(id -un)") " == *" dialout "* ]]; then
  rvm_group_command="$(printf '%q ' "$rvm_dir/run-rvm.sh" "$@")"
  exec sg dialout -c "$rvm_group_command"
fi
if [[ "${1:-}" != '--preview' && "${1:-}" != '--source' && -x release/linux-unpacked/rvm-al-mufti ]]; then
  exec release/linux-unpacked/rvm-al-mufti "$@"
fi
if [[ "${1:-}" == '--source' ]]; then shift; fi
if ! command -v node >/dev/null 2>&1; then
  rvm_runtime="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
  if [[ -x "$rvm_runtime/node" ]]; then export PATH="$rvm_runtime:$PATH"; else echo 'Node.js 22.12+ diperlukan. Install Node.js lalu jalankan kembali.'; exit 1; fi
fi
if [[ ! -d node_modules ]]; then
  echo 'Dependency belum terpasang. Jalankan npm install atau pnpm install dahulu.'
  exit 1
fi
if [[ "${1:-}" == '--preview' ]]; then exec node node_modules/vite/bin/vite.js --host 127.0.0.1; fi
if [[ ! -x node_modules/electron/dist/electron ]]; then node node_modules/electron/install.js; fi
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build
exec node_modules/electron/dist/electron . "$@"
