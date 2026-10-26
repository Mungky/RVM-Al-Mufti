#!/usr/bin/env bash
# Optional compiler installation. The display app runs without this toolchain.
set -euo pipefail
rvm_install_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
rvm_tools_dir="$rvm_install_dir/.tools"
if [[ "${1:-}" == '--help' ]]; then
  echo 'setup-esp-tools.sh: pasang Arduino CLI, ESP32 core dan library untuk Admin → Script.'
  echo 'setup-esp-tools.sh --check: periksa toolchain yang sudah terpasang.'
  exit 0
fi
if [[ "${1:-}" == '--check' ]]; then
  [[ -x "$rvm_tools_dir/arduino-cli" && -f "$rvm_tools_dir/arduino-cli.yaml" && -x "$rvm_tools_dir/venv/bin/python" ]] || { echo 'Toolchain belum lengkap.' >&2; exit 1; }
  "$rvm_tools_dir/venv/bin/python" -c 'import esptool, serial'
  "$rvm_tools_dir/arduino-cli" --config-file "$rvm_tools_dir/arduino-cli.yaml" core list
  "$rvm_tools_dir/arduino-cli" --config-file "$rvm_tools_dir/arduino-cli.yaml" lib list
  exit 0
fi
[[ $# -eq 0 ]] || { echo 'Argumen tidak dikenal. Gunakan --help.' >&2; exit 1; }
[[ "$(uname -s)" == 'Linux' && "$(uname -m)" == 'x86_64' ]] || { echo 'Toolchain ini untuk Linux x86_64.' >&2; exit 1; }
[[ "$(id -u)" != 0 ]] || { echo 'Jalankan sebagai pengguna biasa, tanpa sudo.' >&2; exit 1; }
for rvm_dependency in python3 curl tar sha256sum; do
  command -v "$rvm_dependency" >/dev/null 2>&1 || { echo "Perlu $rvm_dependency. Ubuntu/Debian: sudo apt install python3 python3-venv curl" >&2; exit 1; }
done
mkdir -p "$rvm_tools_dir"
if [[ ! -x "$rvm_tools_dir/arduino-cli" ]]; then
  rvm_download_dir="$(mktemp -d)"
  trap 'rm -rf -- "$rvm_download_dir"' EXIT
  rvm_cli_archive="$rvm_download_dir/arduino-cli.tar.gz"
  echo 'Mengunduh Arduino CLI 1.5.1…'
  curl --fail --location --retry 2 -o "$rvm_cli_archive" 'https://downloads.arduino.cc/arduino-cli/arduino-cli_1.5.1_Linux_64bit.tar.gz'
  printf '%s  %s\n' '28a8e119c498a25607821c36cb2dc49e8463941b261a0d99091baa7bc692dd2b' "$rvm_cli_archive" | sha256sum --check --status
  tar -xzf "$rvm_cli_archive" -C "$rvm_download_dir" arduino-cli
  install -m 755 "$rvm_download_dir/arduino-cli" "$rvm_tools_dir/arduino-cli"
fi
if [[ ! -x "$rvm_tools_dir/venv/bin/python" ]]; then
  python3 -m venv "$rvm_tools_dir/venv" || { echo 'Perlu paket python3-venv dari OS.' >&2; exit 1; }
fi
"$rvm_tools_dir/venv/bin/python" -m pip install 'esptool==5.4.0' 'pyserial==3.5'
python3 - "$rvm_tools_dir" <<'PY'
import json,sys
from pathlib import Path
root=Path(sys.argv[1]).resolve()
config={
 'board_manager':{'additional_urls':['https://espressif.github.io/arduino-esp32/package_esp32_index.json']},
 'directories':{'data':str(root/'arduino-data'),'downloads':str(root/'arduino-downloads'),'user':str(root/'arduino-user')},
 'updater':{'enable_notification':False},
}
(root/'arduino-cli.yaml').write_text(json.dumps(config,indent=2)+'\n')
PY
export PATH="$rvm_tools_dir/venv/bin:$PATH"
rvm_cli=("$rvm_tools_dir/arduino-cli" --config-file "$rvm_tools_dir/arduino-cli.yaml")
"${rvm_cli[@]}" core update-index
"${rvm_cli[@]}" core install 'esp32:esp32@2.0.17'
"${rvm_cli[@]}" lib install 'ArduinoJson@6.21.5' 'MFRC522@1.4.12' 'HX711 Arduino Library@0.7.5'
echo 'Toolchain siap. Buka ulang halaman Admin → Script untuk Compile/Upload.'
echo 'Compiler hanya berjalan saat digunakan; sediakan ruang disk beberapa GB untuk toolchain dan build.'
