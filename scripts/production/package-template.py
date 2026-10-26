"""Update only the production template and its toolchain selector in the app."""
import hashlib
import json
from pathlib import Path
import shutil
import struct
root = Path(__file__).resolve().parents[2]
archive = root / 'release/linux-unpacked/resources/app.asar'
backup = root / 'backups/production-20261007/app-before.asar'
raw = archive.read_bytes()
_, size, _, count = struct.unpack('<4I', raw[:16])
header = json.loads(raw[16:16+count])
payload = raw[8+size:]
def entries(node, prefix=''):
    for name, item in node['files'].items():
        path = prefix+name
        if 'files' in item:
            yield from entries(item, path+'/')
        elif 'offset' in item:
            yield path, item
items = list(entries(header))
original = {p: payload[int(i['offset']):int(i['offset'])+i['size']] for p, i in items}
files = dict(original)
changes = {
    'firmware/arduino/rvm_production/rvm_production.ino': root/'firmware/arduino/rvm_production/rvm_production.ino',
    'electron/firmware.cjs': root/'scripts/workbench/firmware.cjs',
}
for p, local in changes.items():
    assert p in files, p
    files[p] = local.read_bytes()
assert files['firmware/arduino/rvm_diag/rvm_diag.ino'] == original['firmware/arduino/rvm_diag/rvm_diag.ino']
chunks, offset = [], 0
for p, item in items:
    data = files[p]
    item['offset'], item['size'] = str(offset), len(data)
    block = item.get('integrity', {}).get('blockSize', 4194304)
    item['integrity'] = {'algorithm': 'SHA256', 'hash': hashlib.sha256(data).hexdigest(),
        'blockSize': block, 'blocks': [hashlib.sha256(data[j:j+block]).hexdigest() for j in range(0,len(data),block)]}
    chunks.append(data)
    offset += len(data)
encoded = json.dumps(header, separators=(',', ':'), ensure_ascii=False).encode()
string = struct.pack('<I',len(encoded))+encoded
string += b'\0'*(-len(string)%4)
pickle = struct.pack('<I',len(string))+string
result = struct.pack('<II',4,len(pickle))+pickle+b''.join(chunks)
_, size2, _, count2 = struct.unpack('<4I', result[:16])
check = json.loads(result[16:16+count2]); checked = result[8+size2:]
for p, item in entries(check):
    assert checked[int(item['offset']):int(item['offset'])+item['size']] == files[p], p
if not backup.exists():
    shutil.copy2(archive, backup)
staged = archive.with_suffix('.production.tmp')
staged.write_bytes(result)
staged.replace(archive)
print('Updated production template and compile profile; all other packaged files unchanged.')
