"""Add the diagnostic stepper interlock to the current packaged app."""
import hashlib
import json
from pathlib import Path
import shutil
import struct
root = Path(__file__).resolve().parents[2]
archive = root / 'release/linux-unpacked/resources/app.asar'
raw = archive.read_bytes()
_, size, _, count = struct.unpack('<4I', raw[:16])
header = json.loads(raw[16:16+count])
payload = raw[8+size:]
def entries(node, prefix=''):
    for name, item in node['files'].items():
        path = prefix + name
        if 'files' in item:
            yield from entries(item, path + '/')
        elif 'offset' in item:
            yield path, item
files = {p: payload[int(i['offset']):int(i['offset'])+i['size']] for p, i in entries(header)}
p = 'dist/assets/index-DIPzI07i.js'
ui = files[p].decode()
def replace(s, old, new):
    assert s.count(old) == 1, (old[:100], s.count(old))
    return s.replace(old, new, 1)
if 'Stepper conveyor' not in ui:
    ui = replace(ui, '"motorMoving","irActiveLow"', '"motorEnabled","motorMoving","irActiveLow"')
    a = ui.index('function Og('); b = ui.index('const Cg=', a)
    panel = ui[a:b]
    panel = replace(panel, 'const[scaleMessage,setScaleMessage]', 'const[demoMotorEnabled,setDemoMotorEnabled]=A.useState(false);const stepperEnabled=tt?demoMotorEnabled:f&&o.motorEnabled===true;const[scaleMessage,setScaleMessage]')
    panel = replace(panel, 'zt(false);if(!tt&&Ml.connected)Ml.command("motor_stop").catch(()=>{})', 'zt(false);setDemoMotorEnabled(false);if(!tt&&Ml.connected)Ml.command("motor_enable",{on:false}).catch(()=>{})')
    panel = replace(panel, 'async function Q(){', 'async function toggleStepper(){await ct("motor_enable",{on:!stepperEnabled},()=>{if(tt){setDemoMotorEnabled(!stepperEnabled);if(stepperEnabled){Bt.current&&clearInterval(Bt.current);Bt.current=null;zt(false)}}})}async function Q(){if(!stepperEnabled)return;')
    panel = replace(panel, 'async function continuous(direction){', 'async function continuous(direction){if(!stepperEnabled)return;')
    aMotor = panel.index('F==="motor"&&'); bMotor = panel.index('F==="loadcell"&&', aMotor)
    motor = panel[aMotor:bMotor]
    motor = replace(motor, 'children:[c.jsxs("div",{className:"two-cols"', '''children:[c.jsxs("div",{className:"stepper-enable",children:[c.jsxs("div",{children:[c.jsx("strong",{children:"Stepper conveyor"}),c.jsx("p",{role:"status",children:stepperEnabled?"ON · Pengujian motor diizinkan":"OFF · Nyalakan sebelum menguji conveyor"})]}),c.jsx("button",{type:"button",role:"switch","aria-label":"Aktifkan stepper conveyor","aria-checked":!!stepperEnabled,disabled:!m||!!X,onClick:toggleStepper,children:stepperEnabled?"ON":"OFF"})]}),c.jsxs("div",{className:"two-cols"''')
    motor = motor.replace('disabled:!m||ft||!!X', 'disabled:!m||!stepperEnabled||ft||!!X')
    motor = motor.replace('Forward/Reverse berjalan terus sampai Stop.', 'Toggle OFF menghentikan motor dan melepas daya penahan. Matikan setelah pengujian. Forward/Reverse berjalan terus sampai Stop.')
    panel = panel[:aMotor]+motor+panel[bMotor:]
    ui = ui[:a]+panel+ui[b:]
files[p] = ui.encode()
css = 'dist/assets/index-Cahcuz_X.css'
if b'.stepper-enable{' not in files[css]:
    files[css] += b'\n.stepper-enable{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px}.stepper-enable p{margin:4px 0 0;font-size:13px;color:#54715f}.stepper-enable button{min-width:76px;min-height:44px;border:1px solid #cdd9ce;border-radius:22px;background:#e7ece7;color:#456453;font-weight:700;cursor:pointer}.stepper-enable button[aria-checked=true]{background:#305e47;color:white}.stepper-enable button:disabled{opacity:.5;cursor:default}\n'
files['firmware/arduino/rvm_diag/rvm_diag.ino'] = (root/'firmware/arduino/rvm_diag/rvm_diag.ino').read_bytes()
for name in ('rvm_diag.ino.bin','rvm_diag.ino.bootloader.bin','rvm_diag.ino.partitions.bin','verification.json'):
    files['firmware/builds/rvm_diag/' + name] = (root/'firmware/builds/rvm_diag'/name).read_bytes()
chunks = []; offset = 0
for p, item in entries(header):
    data = files[p]; item['offset'] = str(offset); item['size'] = len(data)
    block = item.get('integrity', {}).get('blockSize', 4194304)
    item['integrity'] = {'algorithm':'SHA256','hash':hashlib.sha256(data).hexdigest(),'blockSize':block,'blocks':[hashlib.sha256(data[j:j+block]).hexdigest() for j in range(0,len(data),block)]}
    chunks.append(data); offset += len(data)
encoded = json.dumps(header,separators=(',',':'),ensure_ascii=False).encode()
s = struct.pack('<I',len(encoded))+encoded; s += b'\0'*(-len(s)%4)
h = struct.pack('<I',len(s))+s
backup = root/'backups/stepper-toggle-20261012'
backup.mkdir(exist_ok=True)
if not (backup/'app.asar').exists(): shutil.copy2(archive,backup/'app.asar')
staged = archive.with_suffix('.stepper.tmp')
staged.write_bytes(struct.pack('<II',4,len(h))+h+b''.join(chunks)); staged.replace(archive)
print('Packaged diagnostic toggle and firmware updated.')
