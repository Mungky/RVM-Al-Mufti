#!/usr/bin/env python3
"""Install the prebuilt app and per-user desktop/autostart files; no root required."""
import argparse
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile


def key_value(value):
    return str(value).replace('\\', '\\\\').replace('\n', '\\n').replace('\r', '\\r')


def exec_arg(value):
    # Desktop Exec has both key-value escaping and argument quoting; no shell runs.
    quoted = str(value).replace('\\', '\\\\').replace('"', '\\"').replace('`', '\\`').replace('$', '\\$').replace('%', '%%')
    return '"' + key_value(quoted) + '"'


def desktop_entry(destination, kiosk=False):
    launcher = destination / 'run-rvm.sh'
    return '\n'.join([
        '[Desktop Entry]', 'Type=Application', 'Name=RVM Al-Mufti',
        'Comment=Display layar sentuh Reverse Vending Machine',
        'Exec=' + exec_arg(launcher) + (' --kiosk' if kiosk else ''),
        'TryExec=' + key_value(launcher),
        'Icon=' + key_value(destination / 'icon.png'),
        'Path=' + key_value(destination),
        'Terminal=false', 'Categories=Utility;', 'StartupNotify=false',
        'X-GNOME-Autostart-enabled=true', '',
    ])


def ensure_closed(destination):
    executable = str(destination / 'release/linux-unpacked/rvm-al-mufti').encode()
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            if (entry / 'cmdline').read_bytes().split(b'\0')[0] == executable:
                raise RuntimeError('Tutup aplikasi RVM yang terpasang sebelum memperbarui instalasi.')
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            continue


def main():
    parser = argparse.ArgumentParser(description='Install RVM Linux 64-bit untuk pengguna saat ini.')
    parser.add_argument('bundle', type=Path)
    parser.add_argument('--dest', type=Path, default=Path.home() / '.local/opt/rvm-al-mufti')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--autostart', dest='autostart', action='store_true', help='Mulai fullscreen setelah login desktop.')
    mode.add_argument('--no-autostart', dest='autostart', action='store_false', help='Nonaktifkan startup RVM.')
    parser.set_defaults(autostart=None)
    args = parser.parse_args()
    if platform.system() != 'Linux' or platform.machine() not in ('x86_64', 'amd64'):
        raise RuntimeError('Paket ini untuk Linux PC Intel/AMD 64-bit (x86_64).')
    if os.geteuid() == 0:
        raise RuntimeError('Jalankan installer sebagai pengguna biasa, tanpa sudo.')
    source, destination = args.bundle.resolve(), args.dest.expanduser().resolve()
    if any(c in str(destination) for c in '\n\r\0') or destination in (Path('/'), Path.home()):
        raise RuntimeError('Folder tujuan tidak valid.')
    if source == destination or source in destination.parents or destination in source.parents:
        raise RuntimeError('Folder instalasi harus terpisah dari folder sumber paket.')
    binary_source = source / 'release/linux-unpacked'
    if not (binary_source / 'rvm-al-mufti').is_file():
        raise RuntimeError('Paket aplikasi belum ditemukan. Build distribusi dahulu.')
    if destination.exists() and not (destination / '.rvm-install.json').is_file():
        raise RuntimeError('Folder tujuan sudah ada dan bukan instalasi RVM. Pilih --dest lain.')
    ensure_closed(destination)
    data_home = Path(os.environ.get('XDG_DATA_HOME', str(Path.home() / '.local/share')))
    config_home = Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config')))
    applications, autostart = data_home / 'applications', config_home / 'autostart'
    applications.mkdir(parents=True, exist_ok=True)
    autostart.mkdir(parents=True, exist_ok=True)
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.rvm-install-', dir=destination.parent))
    previous = None
    try:
        print('Menyalin aplikasi prebuilt…', flush=True)
        shutil.copytree(binary_source, stage / 'release/linux-unpacked', symlinks=True)
        for filename in ['run-rvm.sh', 'setup-esp-tools.sh', 'install-linux.sh']:
            shutil.copy2(source / filename, stage / filename)
            (stage / filename).chmod(0o755)
        (stage / 'scripts').mkdir()
        shutil.copy2(source / 'scripts/install_linux.py', stage / 'scripts/install_linux.py')
        (stage / 'docs').mkdir()
        shutil.copy2(source / 'docs/INSTALL-LINUX.md', stage / 'docs/INSTALL-LINUX.md')
        icon = source / 'icon.png' if (source / 'icon.png').is_file() else source / 'public/icon.png'
        shutil.copy2(icon, stage / 'icon.png')
        (stage / '.rvm-install.json').write_text(json.dumps({'application': 'rvm-al-mufti', 'version': '1.0.0'}))
        binary = stage / 'release/linux-unpacked/rvm-al-mufti'
        binary.chmod(0o755)
        if shutil.which('ldd'):
            libraries = subprocess.run(['ldd', str(binary)], capture_output=True, text=True, check=False)
            missing = [line.strip() for line in libraries.stdout.splitlines() if 'not found' in line]
            if missing:
                raise RuntimeError('Library OS belum lengkap: ' + ', '.join(missing) + '. Lihat docs/INSTALL-LINUX.md.')
        if destination.exists():
            previous = Path(tempfile.mkdtemp(prefix='.rvm-previous-', dir=destination.parent))
            previous.rmdir()
            destination.rename(previous)
        stage.rename(destination)
        if previous and (previous / '.tools').exists():
            (previous / '.tools').rename(destination / '.tools')
        menu_file = applications / 'id.almufti.rvm.desktop'
        menu_file.write_text(desktop_entry(destination))
        startup_file = autostart / 'id.almufti.rvm.desktop'
        if args.autostart is True or (args.autostart is None and startup_file.exists()):
            startup_file.write_text(desktop_entry(destination, kiosk=True))
        elif args.autostart is False:
            startup_file.unlink(missing_ok=True)
        if previous:
            shutil.rmtree(previous)
        print(f'Instalasi selesai: {destination}')
        print('Buka menu aplikasi → RVM Al-Mufti, atau jalankan:')
        print(f'  "{destination / "run-rvm.sh"}"')
        if startup_file.exists():
            print('Startup fullscreen aktif setelah login desktop. Aktifkan login otomatis di pengaturan OS untuk boot langsung ke app.')
        print('USB ESP: tambahkan pengguna ke grup dialout (Ubuntu/Debian), lalu logout/login.')
        print('Compile/upload ESP: jalankan setup-esp-tools.sh pada folder instalasi bila diperlukan.')
    except Exception:
        # Roll back the app swap while keeping the optional toolchain and personal data.
        if previous and previous.exists():
            if destination.exists():
                if (destination / '.tools').exists() and not (previous / '.tools').exists():
                    (destination / '.tools').rename(previous / '.tools')
                shutil.rmtree(destination)
            previous.rename(destination)
        raise
    finally:
        if stage.exists():
            shutil.rmtree(stage)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError) as error:
        print(f'Instalasi gagal: {error}', file=sys.stderr)
        sys.exit(1)
