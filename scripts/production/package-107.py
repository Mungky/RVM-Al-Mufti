"""Package production 1.0.7 and its Reset/status integration, preserving other features."""
import hashlib
import json
from pathlib import Path
import shutil
import struct
root = Path(__file__).resolve().parents[2]
archive = root / 'release/linux-unpacked/resources/app.asar'
backup = root / 'backups/production-107-20261019/app-before.asar'
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
    'dist/assets/production-client.mjs': root/'scripts/production/production-client.mjs',
}
for p, local in changes.items():
    assert p in files, p
    files[p] = local.read_bytes()
ui_path='dist/assets/index-DIPzI07i.js'
ui=files[ui_path].decode()
ui=ui.replace('k.capBusy&&k.productionState==="await_bottle"?"Tutup terdeteksi. Tunggu IR 3 bebas":', '')
def update(old,new):
    global ui
    if new in ui: return
    assert ui.count(old)==1,(old[:100],ui.count(old))
    ui=ui.replace(old,new,1)
update('cycleId:o.cycleId,error:o.error};','cycleId:o.cycleId,error:o.error,rejectionReason:o.rejectionReason};')
update('"productionError","ledMode"','"productionError","rejectionReason","ledMode"')
update('return_bottle:"Botol ditolak, silakan ambil kembali"','return_bottle:"Botol ditolak. Mengembalikan sampai IR 1"')
update('wait_removal:"Ambil botol. Menunggu IR 1 bebas"','wait_removal:"Ambil botol. Menunggu IR 1 bebas selama 300 ms"')
files[ui_path]=ui.encode()
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
print('Packaged production 1.0.7: weight limit, IR1 return, green ready and immediate Reset; other features preserved.')
