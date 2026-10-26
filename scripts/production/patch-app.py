"""Connect production serial events, local YOLO and the existing solid LED API."""
import hashlib
import json
from pathlib import Path
import shutil
import struct
root=Path(__file__).resolve().parents[2]
archive=root/'release/linux-unpacked/resources/app.asar'
raw=archive.read_bytes()
_,size,_,count=struct.unpack('<4I',raw[:16])
header=json.loads(raw[16:16+count]);payload=raw[8+size:]
def entries(node,prefix=''):
    for name,item in node['files'].items():
        path=prefix+name
        if 'files' in item: yield from entries(item,path+'/')
        elif 'offset' in item: yield path,item
files={p:payload[int(i['offset']):int(i['offset'])+i['size']] for p,i in entries(header)}
original=dict(files)
def replace(text,old,new):
    assert text.count(old)==1, (old[:100],text.count(old))
    return text.replace(old,new,1)
ui_path='dist/assets/index-DIPzI07i.js'
ui=files[ui_path].decode()
if 'import {ProductionClient' not in ui:
    ui='import {ProductionClient,createProductionSettings} from "./production-client.mjs";\n'+ui
    ui=replace(ui,'function Ng(g){const o=JSON.parse(g);','''function Ng(g){const o=JSON.parse(g);
if(o.type==="inspection_request"&&Number.isInteger(o.cycleId)&&o.cycleId>=0)return{type:o.type,cycleId:o.cycleId,uid:o.uid};
if(o.type==="production"&&typeof o.state==="string")return{type:o.type,state:o.state,cycleId:o.cycleId,error:o.error,rejectionReason:o.rejectionReason};''')
    ui=replace(ui,'"motorMoving","irActiveLow","diagnostic"]','"motorMoving","irActiveLow","diagnostic","sessionActive","sessionFinished","shredderPaused"]')
    ui=replace(ui,'"rfidResetCount"]','"rfidResetCount","cycleId","bottleGrams","acceptedBottles","ledBrightness","referenceGrams"]')
    ui=replace(ui,'["rfidStage","rfidResetReason"]','["rfidStage","rfidResetReason","productionState","productionError","rejectionReason","ledMode","ledColor","pausedFrom"]')
    ui=replace(ui,'const ModelStudio=createModelStudio(A);','const ModelStudio=createModelStudio(A),ProductionSettings=createProductionSettings(A);')
    ui=replace(ui,'B==="components"&&c.jsxs("div",{className:"connection-bar"','["components","performance","script"].includes(B)&&c.jsxs("div",{className:"connection-bar"')
    ui=replace(ui,'B==="performance"&&c.jsx(Bg,{serial:f,ble:O})','B==="performance"&&c.jsxs(c.Fragment,{children:[c.jsx(ProductionSettings,{...g}),c.jsx(Bg,{serial:f,ble:O})]})')
    ui=replace(ui,'m=A.useRef(Promise.resolve());function b(M)',
      'm=A.useRef(Promise.resolve()),productionClient=A.useRef(null);if(!productionClient.current)productionClient.current=new ProductionClient({transport:Ml,vision:window.rvm?.vision,notify:C,log:D});function b(M)')
    ui=replace(ui,'A.useEffect(()=>Ml.on(M=>{if(M.type===',
      'A.useEffect(()=>{const off=Ml.on(M=>{productionClient.current.observe(M,j.current?.settings);if(M.type===')
    ui=replace(ui,'T.current==="home"&&ft(st)}}),[]);async function ft(M)',
      'T.current==="home"&&ft(st)}});return()=>{off();productionClient.current.disconnect();};},[]);async function ft(M)')
    ui=replace(ui,'C("Kartu belum terdaftar atau tidak aktif. Hubungi petugas.")','C("Kartu tidak dikenali, silahkan hubungi admin")')
    ui=replace(ui,'$=await Ml.command("session_start")','$=await productionClient.current.start(M,j.current.settings)')
    ui=replace(ui,'const w=await Ml.command("session_stop")','const w=await productionClient.current.stop()')
    ui=replace(ui,'className:"session-page",children:[c.jsxs("div",{className:"deposit-stats"',
      '''className:"session-page",children:[!B.demo&&c.jsxs("div",{className:"production-status",role:"status",children:[c.jsx("span",{children:({taring:"Menyiapkan timbangan…",await_bottle:"Silakan masukkan botol",entry:"Memeriksa botol…",weigh_base:"Memeriksa botol…",intake:"Botol menuju zona inspeksi",inspection:"Memeriksa botol dan menimbang…",safety_pause:"Jauhkan tangan dari lubang botol",accept_move:"Botol diterima",confirm_drop:"Memastikan botol masuk…",return_bottle:"Silakan ambil botol Anda",wait_removal:"Silakan ambil botol Anda",check_empty:"Memastikan conveyor kosong…",rearm:"Menunggu area masuk kosong",fault:"Mesin berhenti. Tekan Selesai."})[k.productionState]||"Menyiapkan sesi…"}),c.jsxs("strong",{children:[Xt(jg(B.grams,B.caps,g.settings))," poin"]})]}),c.jsxs("div",{className:"deposit-stats"''')
    files[ui_path]=ui.encode()
# Clear the previous unknown-card toast once a valid member begins preparation.
ui=files[ui_path].decode()
old='C("Kartu tidak dikenali, silahkan hubungi admin");return}Ot.current=!0'
new='C("Kartu tidak dikenali, silahkan hubungi admin");return}C("");Ot.current=!0'
if old in ui:
    ui=replace(ui,old,new)
    files[ui_path]=ui.encode()
# Re-enable a held/previously scanned card when the public home screen returns.
ui=files[ui_path].decode()
old='function b(M){T.current=M,O(M)}'
new='function b(M){T.current=M,O(M);if(M==="home"&&!j.current?.settings.demo&&Ml.connected)productionClient.current.rearmRFID().catch(error=>C(error.message));}'
if old in ui:
    ui=replace(ui,old,new)
    files[ui_path]=ui.encode()
# Add recovery controls and an activity log to the public counting screen.
ui=files[ui_path].decode()
if 'createSessionTools' not in ui:
    ui=replace(ui,'import {ProductionClient,createProductionSettings}',
                  'import {ProductionClient,createProductionSettings,createSessionTools}')
    ui=replace(ui,'ProductionSettings=createProductionSettings(A);',
                  'ProductionSettings=createProductionSettings(A),SessionTools=createSessionTools(A);')
    ui=replace(ui,'fault:"Mesin berhenti. Tekan Selesai."',
                  'wait_removal:"Ambil botol. Menunggu IR 1 bebas",fault:"Mesin berhenti. Tekan Reset."')
    ui=replace(ui,'c.jsxs(ee,{className:"finish-button",busy:Yt',
                  '!B.demo&&c.jsx(SessionTools,{client:productionClient.current,telemetry:k,settings:g.settings,logs:le,serial:St,notify:C,onBusy:value=>{Ot.current=value;Ut(value);}}),c.jsxs(ee,{className:"finish-button",busy:Yt')
    files[ui_path]=ui.encode()
ui=files[ui_path].decode()
old='color:g.settings.demo?"amber":St?"green":"gray",children:g.settings.demo?"Mode demo":St?"RVM siap":"Menunggu perangkat"'
new='color:g.settings.demo?"amber":k.productionState==="fault"?"amber":St?"green":"gray",children:g.settings.demo?"Mode demo":k.productionState==="fault"?"Mesin berhenti":St?"RVM siap":"Menunggu perangkat"'
if old in ui:
    ui=replace(ui,old,new)
    files[ui_path]=ui.encode()
# Acceptance release holds the next intake; show cap activity and the 12-second wait.
ui=files[ui_path].decode()
if '"capCounterEnabled","capBusy"' not in ui:
    ui=replace(ui,'"sessionActive","sessionFinished"]','"sessionActive","sessionFinished","capCounterEnabled","capBusy"]')
old='children:({taring:'
new='children:k.capBusy&&k.productionState==="await_bottle"?"Tutup terdeteksi. Tunggu IR 3 bebas":({taring:'
ui=ui.replace(new,old)
old='accept_move:"Botol diterima"'
new='accept_move:"Botol diterima. Tunggu 12 detik"'
if old in ui:ui=replace(ui,old,new)
ui=ui.replace('accept_move:"Botol diterima. Relay 2 aktif 12 detik; tunggu LED kuning selesai"','accept_move:"Botol diterima. Tunggu 12 detik"')
files[ui_path]=ui.encode()
css_path='dist/assets/index-Cahcuz_X.css'
if b'.production-fields' not in files[css_path]:
    files[css_path]+=b'\n.production-fields{display:grid;grid-template-columns:2fr 1fr;gap:16px;margin:16px 0}.production-fields select,.production-fields input{width:100%;min-width:0}.production-settings .muted{margin-top:12px}.production-status{display:flex;justify-content:space-between;gap:16px;width:100%;font-size:18px;color:#305e47}.production-status strong{white-space:nowrap}@media(max-width:800px){.production-fields{grid-template-columns:1fr}}\n'
if b'.session-tools{' not in files[css_path]:
    files[css_path]+=b'\n.session-tools{margin:16px 0 0}.session-recovery{display:flex;align-items:center;gap:16px;margin-bottom:10px}.session-recovery p{flex:1;margin:0;font-size:13px;line-height:1.5;color:#54715f}.session-recovery p[role=alert]{color:#a53b35}.session-recovery .button{min-width:96px;flex-shrink:0}.session-log{max-height:96px;min-height:64px;overflow-y:auto;padding:10px 14px;border:1px solid #dce5d8;border-radius:10px;background:#fff;font-size:12px;line-height:1.6;color:#456453}.session-log ol{list-style:none;padding:0;margin:0}.session-log li+li{border-top:1px solid #eff3ed;padding-top:3px;margin-top:3px}.session-log p{margin:0}\n'
files['dist/assets/production-client.mjs']=(root/'scripts/production/production-client.mjs').read_bytes()
files['firmware/arduino/rvm_production/rvm_production.ino']=(root/'firmware/arduino/rvm_production/rvm_production.ino').read_bytes()
files['electron/firmware.cjs']=(root/'scripts/workbench/firmware.cjs').read_bytes()
# Insert the one new module into the archive directory.
header['files']['dist']['files']['assets']['files'].setdefault('production-client.mjs',{'size':0,'offset':'0'})
chunks=[];offset=0
for p,item in entries(header):
    data=files[p];item['offset']=str(offset);item['size']=len(data)
    block=item.get('integrity',{}).get('blockSize',4194304)
    item['integrity']={'algorithm':'SHA256','hash':hashlib.sha256(data).hexdigest(),'blockSize':block,
      'blocks':[hashlib.sha256(data[j:j+block]).hexdigest() for j in range(0,len(data),block)]}
    chunks.append(data);offset+=len(data)
encoded=json.dumps(header,separators=(',',':'),ensure_ascii=False).encode()
s=struct.pack('<I',len(encoded))+encoded;s+=b'\0'*(-len(s)%4)
h=struct.pack('<I',len(s))+s
result=struct.pack('<II',4,len(h))+h+b''.join(chunks)
_,size,_,count=struct.unpack('<4I',result[:16]);checked=json.loads(result[16:16+count]);pay=result[8+size:]
for p,item in entries(checked):assert pay[int(item['offset']):int(item['offset'])+item['size']]==files[p],p
for p,data in original.items():
    if p.startswith('firmware/') and 'rvm_production' not in p: assert files[p]==data,p
backup=root/'backups/production-20261007/app-before-integration.asar'
if not backup.exists():shutil.copy2(archive,backup)
staged=archive.with_suffix('.production.tmp');staged.write_bytes(result);staged.replace(archive)
print('Production integrated; diagnostic firmware and remaining packaged sources preserved.')
