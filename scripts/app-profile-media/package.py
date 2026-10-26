"""Package the home video and fresh profile RFID scanning into the current app."""
import hashlib
import json
from pathlib import Path
import shutil
import struct
root = Path(__file__).resolve().parents[2]
archive = root / 'release/linux-unpacked/resources/app.asar'
backup = root / 'backups/app-profile-media-20261019/app-before.asar'
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
ui_path='dist/assets/index-DIPzI07i.js'
ui=files[ui_path].decode()
def replace(old,new):
    global ui
    assert ui.count(old)==1,(old[:100],ui.count(old))
    ui=ui.replace(old,new,1)
if 'createProfileRFIDScanner' not in ui:
    ui='import {createProfileRFIDScanner} from "./profile-rfid.mjs";\n'+ui
    replace('function wg({db:g,updateDB:o,telemetry:j,notify:f})', 'const useProfileRFIDScan=createProfileRFIDScanner(A,Ml);function wg({db:g,updateDB:o,telemetry:j,notify:f})')
    replace('Yt=g.transactions.filter(U=>U.demo===g.settings.demo);async function Ut()', 'Yt=g.transactions.filter(U=>U.demo===g.settings.demo);const profileScan=useProfileRFIDScan(B?.id,j.firmware,uid=>X(current=>current?{...current,uid}:current));async function Ut()')
    replace('c.jsx("button",{disabled:!j.uid,onClick:()=>X({...B,uid:j.uid}),children:"UID terakhir"})', 'c.jsx("button",{type:"button",disabled:profileScan.busy,onClick:profileScan.scan,children:"Scan now"})')
    replace('value:B.uid,onChange:U=>X({...B,uid:U.target.value.toUpperCase()})', 'value:B.uid,onChange:U=>{profileScan.cancel();X({...B,uid:U.target.value.toUpperCase()})}')
    replace('placeholder:"Contoh: A1B2C3D4"', 'placeholder:"Tempelkan kartu setelah Scan now"')
    replace('label:"UID kartu RFID",children:', 'label:"UID kartu RFID",hint:profileScan.message?c.jsx("span",{role:"status","aria-live":"polite",children:profileScan.message}):"Tekan Scan now, lalu tempelkan kartu ke reader.",children:')
    replace('onClose:()=>X(null),children:', 'onClose:()=>{profileScan.cancel();X(null)},children:')
    replace('className:"full",onClick:()=>{Ut()},children:"Simpan anggota"', 'className:"full",disabled:profileScan.busy,onClick:()=>{Ut()},children:"Simpan anggota"')
ui=ui.replace('src:"./media/recycling.mp4"','src:"./media/recycling-12s.webm"')
files[ui_path]=ui.encode()
for name,local in [('dist/assets/profile-rfid.mjs','scripts/connection-fix/profile-rfid.mjs'),('dist/media/recycling-12s.webm','assets/media/recycling-12s.webm')]:
    files[name]=(root/local).read_bytes()
    node=header
    parts=name.split('/')
    for part in parts[:-1]: node=node['files'][part]
    node['files'].setdefault(parts[-1],{'size':0,'offset':'0'})
assert files['firmware/arduino/rvm_diag/rvm_diag.ino'] == original['firmware/arduino/rvm_diag/rvm_diag.ino']
items = list(entries(header))
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
print('Packaged fresh RFID profile scanning and 12-second recycling video; remaining files preserved.')
