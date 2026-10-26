"""Rebuild the supplied ASAR without installing dependencies or running the app."""
import hashlib
import json
from pathlib import Path
import struct
import sys
from patch_diagnostics import patch as patch_diagnostics

ROOT = Path(__file__).resolve().parents[2]
# Reproducible builds always start from the untouched distribution.
ARCHIVE = ROOT / 'backups/connection-fix-20261003/app.asar'


def unpack(raw):
    _, header_size, _, json_size = struct.unpack('<4I', raw[:16])
    return json.loads(raw[16:16 + json_size]), raw[8 + header_size:]


def entries(node, prefix=''):
    for name, item in node['files'].items():
        path = prefix + name
        if 'files' in item:
            yield from entries(item, path + '/')
        else:
            yield path, item


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f'Unexpected bundle version: {old[:100]}')
    return text.replace(old, new, 1)


def build(raw):
    header, payload = unpack(raw)
    files = {path: payload[int(item['offset']):int(item['offset']) + item['size']]
             for path, item in entries(header) if 'offset' in item}
    main = files['electron/main.cjs'].decode()
    main = replace_once(main, "const os = require('node:os');", "const os = require('node:os');\nconst { createDevicePicker, selectSerialPort, serialError, createBluetoothPicker } = require('./device-selection.cjs');")
    start = main.index('    const ports=(await SerialPort.list())')
    end = main.index('    const emit=value=>', start)
    main = main[:start] + """    const selected = await selectSerialPort({ listPorts: () => SerialPort.list(), picker: devicePicker });
    if(firmware.isUploading())throw new Error('Upload sedang berjalan. Tunggu sebelum membuka port ESP.');
    const port=new SerialPort({path:selected.path,baudRate:baud,autoOpen:false});
""" + main[end:]
    main = replace_once(main,
        '    await new Promise((resolve,reject)=>port.open(error=>error?reject(error):resolve()));',
        """    try {
      await new Promise((resolve,reject)=>port.open(error=>error?reject(error):resolve()));
    } catch(error) {
      const explained = serialError(error, selected.path);
      await dialog.showMessageBox(window, {type:'error',title:'ESP32 belum terhubung',message:explained.message});
      throw explained;
    }""")
    main = replace_once(main, 'return {path:ports[index].path};', 'return {path:selected.path};')
    start = main.index('  let bluetoothDialog = false;')
    end = main.index('  session.defaultSession.setBluetoothPairingHandler', start)
    main = main[:start] + """  const devicePicker = createDevicePicker({ window, ipcMain, checkSender: checkSerialSender });
  const bluetoothPicker = createBluetoothPicker({ picker: devicePicker });
  window.webContents.on('select-bluetooth-device', bluetoothPicker.select);
  window.webContents.on('destroyed', () => bluetoothPicker.cancel());
  ipcMain.on('bluetooth:cancel-selection', event => {
    checkSerialSender(event);
    bluetoothPicker.cancel();
  });
""" + main[end:]
    files['electron/main.cjs'] = main.encode()
    preload = files['electron/preload.cjs'].decode()
    preload = replace_once(preload, "contextBridge.exposeInMainWorld('rvm', {", "contextBridge.exposeInMainWorld('rvm', {\n  cancelBluetoothSelection: () => ipcRenderer.send('bluetooth:cancel-selection'),")
    preload = replace_once(preload, '  firmware: {', """  devices: {
    action: data => ipcRenderer.send('devices:action', data),
    onUpdate: callback => { const listener=(_,data)=>callback(data); ipcRenderer.on('devices:update',listener); return ()=>ipcRenderer.removeListener('devices:update',listener); }
  },
  firmware: {""")
    files['electron/preload.cjs'] = preload.encode()
    ui_path = 'dist/assets/index-DIPzI07i.js'
    ui = files[ui_path].decode()
    ui = replace_once(ui, 'consumeLine(o){if(o.trim())try{', 'consumeLine(o){if(o.trim())try{const probe=JSON.parse(o.trim());if(probe.type==="hx-only"){const message="ESP terdeteksi, tetapi firmware yang berjalan adalah tes HX711 (hx-only), bukan firmware RVM. Upload firmware RVM yang sesuai melalui Admin → Script.";this.emit({type:"log",message});for(const [id,pending] of this.pending){clearTimeout(pending.timer);pending.reject(new Error(message));this.pending.delete(id)}this.serialFirmwareError=message;return;}')
    ui = replace_once(ui, 'const j=window.rvm?.serial;this.stopping=!1;', 'const j=window.rvm?.serial;this.serialFirmwareError=null;this.stopping=!1;')
    ui = replace_once(ui, 'const f=await this.command("ping");', 'if(this.serialFirmwareError)throw new Error(this.serialFirmwareError);const f=await this.command("ping");')
    start = ui.index('async connectBluetooth(o){')
    end = ui.index('disconnectBluetooth(){', start)
    ui = ui[:start] + 'async connectBluetooth(o){return connectLed(this,o)}' + ui[end:]
    ui = replace_once(ui, 'async led(o,j){', 'async led(o,j){if(this.ledProfile==="leddmx")return writeDmx(this,j);')
    ui = replace_once(ui, 'z==="serial"?"Menyambung…":f?"Terhubung":"Hubungkan"', 'z==="serial"?"Memindai…":f?"Terhubung":"Scan port"')
    ui = replace_once(ui, 'z==="ble"?"Menyambung…":O?"Terhubung":"Hubungkan"', 'z==="ble"?"Memindai…":O?"Terhubung":"Scan BLE"')
    ui = replace_once(ui, 'children:"Bluetooth BLE"', 'children:O&&Ml.ledProfile==="leddmx"?"LED LAMP · otomatis":"Bluetooth BLE"')
    # Persist connection failures in the existing activity log as well as the toast.
    ui = replace_once(ui, 'await Ml.connectBluetooth(o.settings)}catch(bt){T(bt.message)}finally', 'await Ml.connectBluetooth(o.settings)}catch(bt){g.log(`Koneksi gagal: ${bt.message}`),T(bt.message)}finally')
    # Keep UUIDs available for existing custom controllers, outside the normal flow.
    start = ui.index('c.jsxs("div",{className:"two-cols",children:[c.jsx(Ye,{label:"BLE service UUID"')
    end = ui.index(',c.jsxs("div",{className:"notice"', start)
    manual_fields = ui[start:end]
    ui = ui[:start] + 'c.jsxs("details",{children:[c.jsx("summary",{children:"Pengaturan manual (opsional)"}),' + manual_fields + ']})' + ui[end:]
    ui = replace_once(ui, 'Bluetooth klasik/SPP dan paket biner DMX memerlukan adapter sesuai tipe controller.', 'LEDDMX-00/01/03 dari LED LAMP: cukup pilih perangkat lalu Hubungkan. UUID diisi otomatis; pengaturan manual boleh dikosongkan.')
    ui = replace_once(ui, 'c.jsx(pn,{label:"Speed",value:Ot,unit:"%",min:1,onChange:U})', 'Ml.ledProfile==="leddmx"?c.jsx("p",{children:"Kecepatan efek mengikuti pengaturan controller LED LAMP."}):c.jsx(pn,{label:"Speed",value:Ot,unit:"%",min:1,onChange:U})')
    ui = 'import "./device-picker.mjs";\nimport { connectLed, writeDmx } from "./led-connection.mjs";\n' + ui
    ui = patch_diagnostics(ui, replace_once)
    files[ui_path] = ui.encode()
    files['firmware/arduino/rvm_diag/rvm_diag.ino'] = (ROOT / 'firmware/arduino/rvm_diag/rvm_diag.ino').read_bytes()
    files['firmware/arduino/rvm_production/rvm_production.ino'] = (ROOT / 'firmware/arduino/rvm_production/rvm_production.ino').read_bytes()
    for destination, source in {
        'electron/device-selection.cjs': 'device-selection.cjs',
        'dist/assets/device-picker.mjs': 'device-picker.mjs',
        'dist/assets/led-connection.mjs': 'led-connection.mjs',
    }.items():
        files[destination] = (Path(__file__).parent / source).read_bytes()
        parent = header
        parts = destination.split('/')
        for part in parts[:-1]:
            parent = parent['files'][part]
        parent['files'][parts[-1]] = {'size': 0, 'offset': '0'}
    css_path = 'dist/assets/index-Cahcuz_X.css'
    files[css_path] += b'\n' + (Path(__file__).parent / 'device-picker.css').read_bytes()
    files[css_path] += b'\n.pin-map > div{flex-wrap:wrap;gap:8px}.pin-map select{max-width:100%;min-width:0}.motor-actions{flex-wrap:wrap}.motor-actions>*{flex:1 1 180px}.rfid-diagnostics,.scale-diagnostics{overflow-wrap:anywhere}'
    sys.path.insert(0,str(ROOT / 'scripts/workbench'))
    from patch_workbench import patch as patch_workbench
    patch_workbench(files,replace_once)
    for destination in files:
        parent=header
        parts=destination.split('/')
        for part in parts[:-1]: parent=parent['files'].setdefault(part,{'files':{}})
        parent['files'].setdefault(parts[-1],{'size':0,'offset':'0'})
    chunks = []
    offset = 0
    for path, item in entries(header):
        if 'offset' not in item:
            continue
        data = files[path]
        item['offset'] = str(offset)
        item['size'] = len(data)
        block_size = item.get('integrity', {}).get('blockSize', 4194304)
        item['integrity'] = {
            'algorithm': 'SHA256', 'hash': hashlib.sha256(data).hexdigest(),
            'blockSize': block_size,
            'blocks': [hashlib.sha256(data[i:i + block_size]).hexdigest() for i in range(0, len(data), block_size)]
        }
        chunks.append(data)
        offset += len(data)
    encoded = json.dumps(header, separators=(',', ':'), ensure_ascii=False).encode()
    string_payload = struct.pack('<I', len(encoded)) + encoded
    string_payload += b'\0' * (-len(string_payload) % 4)
    header_pickle = struct.pack('<I', len(string_payload)) + string_payload
    result = struct.pack('<II', 4, len(header_pickle)) + header_pickle + b''.join(chunks)
    # Verify archive structure and bytes before returning it.
    checked_header, checked_payload = unpack(result)
    for path, item in entries(checked_header):
        if 'offset' in item:
            data = checked_payload[int(item['offset']):int(item['offset']) + item['size']]
            assert data == files[path], path
    return result


if __name__ == '__main__':
    output = Path(sys.argv[1])
    output.write_bytes(build(ARCHIVE.read_bytes()))
    print(f'Staged archive: {output}')
