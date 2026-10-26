const { app, BrowserWindow, ipcMain, dialog, shell, session, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { createDevicePicker, selectSerialPort, serialError, createBluetoothPicker } = require('./device-selection.cjs');
const { DatabaseSync } = require('node:sqlite');
const { SerialPort } = require('serialport');
const { registerFirmwareIPC } = require('./firmware.cjs');
const {createDiagnosticInstaller}=require('./diagnostic-connect.cjs');
const {registerVisionIPC}=require('./vision.cjs');
let window, db, previousCPU, serialPort, firmware, diagnosticInstaller, vision;
if (process.env.RVM_TEST_DATA) app.setPath('userData', process.env.RVM_TEST_DATA);
app.commandLine.appendSwitch('enable-features', 'WebBluetooth');
function trusted(origin) { try { const url = new URL(origin); return url.protocol === 'file:' || url.origin === 'http://127.0.0.1:5173'; } catch { return false; } }
if(!app.requestSingleInstanceLock())app.quit();
else {
app.on('second-instance',(_,argv)=>{if(window){if(window.isMinimized())window.restore();if(argv.includes('--kiosk'))window.setFullScreen(true);window.show();window.focus();}});
app.whenReady().then(async () => {
  db = new DatabaseSync(path.join(app.getPath('userData'), 'rvm.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)');
  ipcMain.handle('db:load', () => { const row = db.prepare('SELECT data FROM state WHERE id=1').get(); return row ? JSON.parse(row.data) : null; });
  ipcMain.handle('db:save', (_, state) => {
    if (!state || !Array.isArray(state.users) || !Array.isArray(state.transactions) || !state.settings || JSON.stringify(state).length > 10000000) throw new Error('Database tidak valid.');
    db.prepare('INSERT INTO state (id,data) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(JSON.stringify(state));
  });
  ipcMain.handle('metrics', async () => {
    const cpus = os.cpus(); const current = cpus.reduce((a,c) => { a.idle += c.times.idle; a.total += Object.values(c.times).reduce((x,y)=>x+y,0); return a; }, {idle:0,total:0});
    const cpu = previousCPU && current.total > previousCPU.total ? (1-(current.idle-previousCPU.idle)/(current.total-previousCPU.total))*100 : 0; previousCPU = current;
    let temperature = null, storageFree = null;
    if (process.platform === 'linux') { try { for (const name of await fs.readdir('/sys/class/thermal')) { if (!name.startsWith('thermal_zone')) continue; const type = await fs.readFile(`/sys/class/thermal/${name}/type`,'utf8'); if (/cpu|x86_pkg|soc/i.test(type)) { temperature = Number(await fs.readFile(`/sys/class/thermal/${name}/temp`,'utf8'))/1000; break; } } } catch {} }
    try { const stats = await fs.statfs(app.getPath('userData')); storageFree = stats.bavail * stats.bsize; } catch {}
    return { cpu, totalMemory: os.totalmem(), freeMemory: os.freemem(), processMemory: app.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize*1024, 0), temperature, uptime: process.uptime(), platform: `${os.platform()} ${os.arch()}`, storageFree };
  });
  ipcMain.handle('external', (_, url) => { if (typeof url === 'string' && /^https:\/\/mixkit\.co\//.test(url)) return shell.openExternal(url); });
  ipcMain.handle('kiosk', () => window.setFullScreen(!window.isFullScreen()));
  const checkSerialSender = event => { if(event.sender !== window.webContents || !trusted(event.sender.getURL())) throw new Error('Akses serial ditolak.'); };
  const closeSerial = async () => { const port=serialPort; if(port?.isOpen) await new Promise((resolve,reject)=>port.close(error=>error?reject(error):resolve())); };
  firmware=registerFirmwareIPC({app,ipcMain,checkSender:checkSerialSender,listPorts:()=>SerialPort.list()});
  const workspace=process.env.RVM_WORKSPACE||(app.isPackaged?path.resolve(path.dirname(app.getPath('exe')),'../..'):path.resolve(__dirname,'..'));
  diagnosticInstaller=createDiagnosticInstaller({workspace,resources:path.resolve(__dirname,'..'),SerialPort,firmware,emit:state=>{if(window&&!window.isDestroyed())window.webContents.send('diagnostic:event',state)}});
  vision=registerVisionIPC({app,ipcMain,nativeImage,dialog,checkSender:checkSerialSender,getWindow:()=>window});
  ipcMain.handle('serial:connect', async (event,baud,options={}) => {
    checkSerialSender(event);
    if((firmware.isUploading()||diagnosticInstaller?.isBusy()))throw new Error('Upload sedang berjalan. Tunggu sebelum membuka port ESP.');
    if(![9600,57600,115200,230400].includes(baud)) throw new Error('Baud rate tidak valid.');
    await closeSerial();
    // "Siapkan" names the port and the firmware sketch chosen in its popup.
    const sketch=typeof options?.prepare==='string'?options.prepare:null;
    const selected = options?.port ? (await SerialPort.list()).find(port=>port.path===options.port) : await selectSerialPort({ listPorts: () => SerialPort.list(), picker: devicePicker });
    if(!selected)throw new Error('Port ESP32 yang dipilih tidak tersedia. Sambungkan kembali lalu muat ulang daftar perangkat.');
    if((firmware.isUploading()||diagnosticInstaller?.isBusy()))throw new Error('Upload sedang berjalan. Tunggu sebelum membuka port ESP.');
    if(sketch){
      if(firmware.isBusy())throw Error('Tunggu compile/upload selesai.');if(baud!==115200)throw Error('Firmware memakai 115200 baud.');
      if(!await diagnosticInstaller.ensure(selected.path,sketch))return {path:selected.path,connected:false};
    }
    const port=new SerialPort({path:selected.path,baudRate:baud,autoOpen:false});
    const emit=value=>{if(!window.isDestroyed())window.webContents.send('serial:event',value);};
    port.on('data',chunk=>emit({type:'data',data:chunk.toString('utf8')}));
    port.on('error',error=>emit({type:'error',message:error.message}));
    port.on('close',()=>{if(serialPort===port)serialPort=null;emit({type:'closed'});});
    try {
      await new Promise((resolve,reject)=>port.open(error=>error?reject(error):resolve()));
    } catch(error) {
      const explained = serialError(error, selected.path);
      await dialog.showMessageBox(window, {type:'error',title:'ESP32 belum terhubung',message:explained.message});
      throw explained;
    }
    if((firmware.isUploading()||diagnosticInstaller?.isBusy())){await new Promise(resolve=>port.close(()=>resolve()));throw new Error('Upload sedang berjalan.');}
    serialPort=port;
    return {path:selected.path};
  });
  ipcMain.handle('serial:write', async (event,data) => {
    checkSerialSender(event);
    if(typeof data!=='string' || Buffer.byteLength(data)>4096)throw new Error('Data serial tidak valid.');
    if(!serialPort?.isOpen)throw new Error('Port ESP32 belum terbuka.');
    const port=serialPort;
    await new Promise((resolve,reject)=>port.write(data,error=>error?reject(error):resolve()));
  });
  ipcMain.handle('serial:disconnect', async event=>{checkSerialSender(event);await closeSerial();});
  session.defaultSession.setPermissionCheckHandler((wc,permission,origin) => !!wc && trusted(origin) && ['serial','bluetooth','media'].includes(permission));
  session.defaultSession.setPermissionRequestHandler((wc,permission,callback) => callback(trusted(wc.getURL()) && ['serial','bluetooth','media'].includes(permission)));
  session.defaultSession.setDevicePermissionHandler(details => trusted(details.origin) && ['serial','bluetooth'].includes(details.deviceType));
  session.defaultSession.on('select-serial-port', async (event, ports, wc, callback) => {
    event.preventDefault(); if (!ports.length) return callback('');
    const result = await dialog.showMessageBox(window, { title:'Pilih port ESP32', message:'Hubungkan ESP32 melalui USB', buttons:[...ports.map(p=>p.displayName || p.portName), 'Batal'], cancelId:ports.length });
    callback(ports[result.response]?.portId || '');
  });
  const fullscreen=!process.argv.includes('--windowed');
  window = new BrowserWindow({ width:1024, height:768, minWidth:800, minHeight:600, useContentSize:true, fullscreen, show:false, backgroundColor:'#f7f8f4', autoHideMenuBar:true, title:'RVM Al-Mufti', icon:path.join(__dirname,'../dist/icon.png'), webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true} });
  // GNOME/mutter maps a screen-sized window maximized with its title bar and may ignore an early fullscreen request.
  window.once('ready-to-show',()=>{window.show();if(fullscreen)window.setFullScreen(true);});
  window.on('close',event=>{if((firmware.isUploading()||diagnosticInstaller?.isBusy())){event.preventDefault();void dialog.showMessageBox(window,{type:'info',message:'Upload sedang berjalan. Tunggu selesai sebelum menutup aplikasi.'});}});
  const devicePicker = createDevicePicker({ window, ipcMain, checkSender: checkSerialSender });
  const bluetoothPicker = createBluetoothPicker({ picker: devicePicker });
  window.webContents.on('select-bluetooth-device', bluetoothPicker.select);
  window.webContents.on('destroyed', () => bluetoothPicker.cancel());
  ipcMain.on('bluetooth:cancel-selection', event => {
    checkSerialSender(event);
    bluetoothPicker.cancel();
  });
  session.defaultSession.setBluetoothPairingHandler((details,callback) => { callback({confirmed:false}); });
  window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  window.webContents.on('will-navigate', (event,url) => { if (!trusted(url)) event.preventDefault(); });
  window.webContents.on('before-input-event', (event,input) => {if(input.key==='F11' && input.type==='keyDown' && !input.isAutoRepeat){event.preventDefault();window.setFullScreen(!window.isFullScreen());}});
  window.on('leave-full-screen',()=>window.setContentSize(1024,768));
  if (process.env.RVM_DEV === '1') await window.loadURL('http://127.0.0.1:5173'); else await window.loadFile(path.join(__dirname,'../dist/index.html'));
});
}
app.on('window-all-closed',()=>app.quit());
app.on('will-quit',()=>{firmware?.shutdown();vision?.shutdown();if(serialPort?.isOpen)serialPort.close();db?.close();});
