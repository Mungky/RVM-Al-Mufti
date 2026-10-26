#!/usr/bin/env bash
set -euo pipefail
rvm_bundle_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v python3 >/dev/null 2>&1; then
  echo 'Installer memerlukan Python 3. Pada Ubuntu/Debian: sudo apt install python3' >&2
  exit 1
fi
exec python3 "$rvm_bundle_dir/scripts/install_linux.py" "$rvm_bundle_dir" "$@"
