"""Package production 1.1.1 changes into app.asar (backup kept once per backup folder)."""
import hashlib
import json
from pathlib import Path
import shutil
import struct
root = Path(__file__).resolve().parents[2]
archive = root / 'release/linux-unpacked/resources/app.asar'
backup = root / 'backups/production-111-20261026/app-before.asar'
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
files = {p: payload[int(i['offset']):int(i['offset'])+i['size']] for p, i in items}
changes = {
    'dist/assets/production-client.mjs': root/'scripts/production/production-client.mjs',
    'dist/assets/prepare-dialog.mjs': root/'scripts/production/prepare-dialog.mjs',
    'dist/assets/model-studio.mjs': root/'scripts/workbench/model-studio.mjs',
    'dist/assets/device-picker.mjs': root/'scripts/connection-fix/device-picker.mjs',
    'electron/vision-worker.py': root/'scripts/workbench/vision-worker.py',
    'electron/vision.cjs': root/'scripts/workbench/vision.cjs',
    'electron/firmware.cjs': root/'scripts/workbench/firmware.cjs',
    'electron/diagnostic-connect.cjs': root/'scripts/workbench/diagnostic-connect.cjs',
    'electron/device-selection.cjs': root/'scripts/connection-fix/device-selection.cjs',
    'electron/main.cjs': root/'scripts/electron/main.cjs',
    'electron/preload.cjs': root/'scripts/electron/preload.cjs',
    'firmware/arduino/rvm_production/rvm_production.ino': root/'firmware/arduino/rvm_production/rvm_production.ino',
}
for p, local in changes.items():
    if p not in files:  # New file: add an empty entry to the asar header, filled below.
        node = header
        for part in p.split('/')[:-1]:
            node = node['files'][part]
        item = node['files'][p.split('/')[-1]] = {'size': 0, 'offset': '0'}
        items.append((p, item))
    files[p] = local.read_bytes()
def patch(text, old, new, done=None):
    if (done or new) in text:
        return text
    assert text.count(old) == 1, (old[:80], text.count(old))
    return text.replace(old, new, 1)
ui_path = 'dist/assets/index-DIPzI07i.js'
ui = files[ui_path].decode()
# IR 2 (GPIO 26) is not installed: hide it from Uji komponen; telemetry index stays 0..2.
if '[14,26,27].map((w,$)=>$===1?null:' not in ui:
    assert ui.count('[14,26,27].map((w,$)=>') == 2
    ui = ui.replace('[14,26,27].map((w,$)=>', '[14,26,27].map((w,$)=>$===1?null:')
    ui = ui.replace('description:"3 input digital · ESP32"', 'description:"2 input digital · ESP32 (IR 2 tidak terpasang)"', 1)
ui = patch(ui, 'import {createModelStudio} from "./model-studio.mjs";', 'import {createModelStudio} from "./model-studio.mjs";\nimport {createPrepareButton} from "./prepare-dialog.mjs";')
ui = patch(ui, 'const ModelStudio=createModelStudio(A),', 'const PrepareButton=createPrepareButton(A,bn),ModelStudio=createModelStudio(A),')
# Demo mode removed: always off, the header toggle becomes "Siapkan" on Uji komponen and Production.
ui = patch(ui, 'demo:!0,gramRate', 'demo:!1,gramRate')
ui = patch(ui, 'settings:{...Qh,...g.settings}', 'settings:{...Qh,...g.settings,demo:!1}')
ui = patch(ui, 'B!=="script"&&c.jsxs("button",{className:`mode-toggle ${o.settings.demo?"on":""}`,onClick:()=>{g.toggleDemo(!o.settings.demo).catch(R=>T(R.message))},children:[c.jsx("span",{className:"toggle-track",children:c.jsx("i",{})}),"Mode demo"]}),',
    '(B==="components"||B==="performance")&&c.jsx(PrepareButton,{kind:B==="components"?"diagnostic":"production",transport:Ml,db:o,updateDB:j,notify:T,serial:f,ble:O,telemetry:g.telemetry},B),')
ui = patch(ui, '{id:"performance",name:"Performa",icon:Dh}', '{id:"performance",name:"Production",icon:Dh}')
# The ESP32 and LED buttons are now mode indicators; connecting happens in "Siapkan".
ui = patch(ui, 'c.jsxs("button",{onClick:()=>{U("serial")},disabled:!!z,children:[c.jsx(Vh,{size:17}),c.jsxs("span",{children:["ESP32 ",c.jsx("small",{children:f&&g.telemetry.firmware?g.telemetry.firmware:`USB Serial · ${o.settings.baud}`})]}),c.jsx(se,{color:f?"green":"gray",children:z==="serial"?"Menyiapkan…":f?"Terhubung":B==="components"?"Hubungkan & siapkan":"Scan port"})]})',
    'c.jsxs("button",{tabIndex:-1,"aria-disabled":!0,children:[c.jsx(Vh,{size:17}),c.jsxs("span",{children:["ESP32 ",c.jsx("small",{children:f&&g.telemetry.firmware?g.telemetry.firmware:"USB Serial · Silicon Labs"})]}),c.jsx(se,{color:f?"green":"gray",children:f?/^almufti-diag-/.test(g.telemetry.firmware||"")?"Mode pengujian":/^almufti-production-/.test(g.telemetry.firmware||"")?"Mode production":"Terhubung":"Belum disiapkan"})]})')
ui = patch(ui, 'c.jsxs("button",{onClick:()=>{U("ble")},disabled:!!z,children:[c.jsx(Uh,{size:17})', 'c.jsxs("button",{tabIndex:-1,"aria-disabled":!0,children:[c.jsx(Uh,{size:17})')
ui = patch(ui, 'children:z==="ble"?"Memindai…":O?"Terhubung":"Scan BLE"', 'children:O?"Terhubung":"Belum terhubung"')
ui = patch(ui, 'B==="components"&&c.jsx("p",{className:"diagnostic-install-status",role:"status",children:diagnosticState?.message||"Hubungkan & siapkan akan memasang firmware pengujian jika versi ESP belum sesuai. Firmware yang sedang berjalan akan diganti dengan template pengujian."}),', '', done='B==="components"&&c.jsx(Og,{...g})," ",B==="performance"')
# Camera + YOLO stay hot: warm them when the app opens and every time the home screen shows.
ui = patch(ui, 'zg().then(M=>{j.current=M,o(M)})', 'zg().then(M=>{j.current=M,o(M),productionClient.current.warm(M.settings).catch(e=>D(`Pemanasan kamera/model: ${e.message}`))})')
ui = patch(ui, 'function b(M){T.current=M,O(M);if(M==="home"&&!j.current?.settings.demo&&Ml.connected)productionClient.current.rearmRFID().catch(error=>C(error.message));}',
    'function b(M){T.current=M,O(M);if(M==="home"&&Ml.connected)productionClient.current.rearmRFID().catch(error=>C(error.message));if(M==="home")productionClient.current.warm(j.current?.settings).catch(e=>D(`Pemanasan kamera/model: ${e.message}`));}')
# A sketch without the app protocol is uploaded only; there is no port to talk to.
ui = patch(ui, 'const T=await j.connect(o,options);this.writer=', 'const T=await j.connect(o,options);if(T.connected===!1){this.nativeUnsubscribe(),this.nativeUnsubscribe=null;return T}this.writer=')
# Production settings card and Script page removed: Siapkan holds the settings, sketches are edited in Arduino IDE.
ui = patch(ui, 'import {ProductionClient,createProductionSettings,createSessionTools}', 'import {ProductionClient,createSessionTools}', done='import {ProductionClient,createSessionTools')
ui = patch(ui, 'ProductionSettings=createProductionSettings(A),', '', done='const PrepareButton=createPrepareButton(A,bn),ModelStudio=createModelStudio(A),SessionTools')
ui = patch(ui, 'c.jsx(ProductionSettings,{...g}),', '', done='B==="performance"&&c.jsxs(c.Fragment,{children:[c.jsx(Bg,')
ui = patch(ui, ',{id:"script",name:"Script",icon:Rh}', '', done='{id:"database",name:"Database",icon:Ty}]')
ui = patch(ui, '," ",B==="script"&&c.jsx(Dg,{notify:T,log:g.log})', '', done='B==="database"&&c.jsx(wg,{...g})]')
# 1.1.2: shredder countdown in telemetry; "Selesai" only between bottles; idle sessions finish themselves.
ui = patch(ui, '"acceptedBottles","ledBrightness","referenceGrams"]', '"acceptedBottles","ledBrightness","referenceGrams","shredderRemainingMs"]')
ui = patch(ui, 'c.jsxs(ee,{className:"finish-button",busy:Yt,onClick:()=>{ct()},', 'c.jsxs(ee,{className:"finish-button",busy:Yt,disabled:!B.demo&&St&&!FINISHABLE.includes(k.productionState),onClick:()=>{ct()},')
ui = patch(ui, 'c.jsx(SessionTools,{client:productionClient.current,', 'c.jsx(SessionTools,{finish:ct,client:productionClient.current,')
ui = patch(ui, 'import {ProductionClient,createSessionTools}', 'import {ProductionClient,createSessionTools,FINISHABLE}')
files[ui_path] = ui.encode()
css_path = 'dist/assets/index-Cahcuz_X.css'
marker = b'/* Siapkan */'
files[css_path] = files[css_path].split(marker)[0]+b'\n'+marker+b'\n'+(root/'scripts/production/production-111.css').read_bytes()
chunks, offset = [], 0
for p, item in items:
    data = files[p]
    item['offset'], item['size'] = str(offset), len(data)
    block = item.get('integrity', {}).get('blockSize', 4194304)
    item['integrity'] = {'algorithm': 'SHA256', 'hash': hashlib.sha256(data).hexdigest(),
        'blockSize': block, 'blocks': [hashlib.sha256(data[j:j+block]).hexdigest() for j in range(0, len(data), block)]}
    chunks.append(data)
    offset += len(data)
encoded = json.dumps(header, separators=(',', ':'), ensure_ascii=False).encode()
string = struct.pack('<I', len(encoded))+encoded
string += b'\0'*(-len(string) % 4)
pickle = struct.pack('<I', len(string))+string
result = struct.pack('<II', 4, len(pickle))+pickle+b''.join(chunks)
_, size2, _, count2 = struct.unpack('<4I', result[:16])
check = json.loads(result[16:16+count2]); checked = result[8+size2:]
for p, item in entries(check):
    assert checked[int(item['offset']):int(item['offset'])+item['size']] == files[p], p
if not backup.exists():
    backup.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(archive, backup)
staged = archive.with_suffix('.production.tmp')
staged.write_bytes(result)
staged.replace(archive)
print('Packaged:', ', '.join(changes))
