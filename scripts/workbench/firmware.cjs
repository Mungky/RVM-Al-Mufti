const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const BOARD = 'esp32:esp32:esp32';
const hash = code => crypto.createHash('sha256').update(code).digest('hex');
// "Siapkan" installs sketches straight from <app>/firmware/arduino/<name>/<name>.ino; they are edited in Arduino IDE.
function createFirmwareService({workspace, resources, userData, listPorts, runner=spawn}) {
  const cli = path.join(workspace,'.tools/arduino-cli');
  const testedConfig = path.join(workspace,'.tools/arduino-tested.yaml');
  const folder = path.join(userData,'firmware'), record = path.join(folder,'uploaded.json');
  const sketchRoots=[path.join(workspace,'firmware/arduino'),path.join(resources,'firmware/arduino')];
  let busy=false;
  const sketchFile=async name=>{
    if(typeof name!=='string'||!/^[a-z0-9_]+$/i.test(name))throw Error('Nama firmware tidak valid.');
    for(const root of sketchRoots){const file=path.join(root,name,`${name}.ino`);try{await fs.access(file);return file;}catch{}}
    throw Error(`Firmware ${name} tidak ditemukan di folder firmware/arduino.`);
  };
  const sketch=async name=>{
    const code=await fs.readFile(await sketchFile(name),'utf8');
    return {name,code,version:code.match(/FIRMWARE\s*=\s*"([^"]+)"/)?.[1]||null};
  };
  const sketches=async()=>{
    const names=new Set();
    for(const root of sketchRoots){try{for(const name of await fs.readdir(root))try{await fs.access(path.join(root,name,`${name}.ino`));names.add(name);}catch{}}catch{}}
    return Promise.all([...names].sort().map(async name=>{const {code,...info}=await sketch(name);return info;}));
  };
  const uploads=async()=>{try{return JSON.parse(await fs.readFile(record,'utf8'));}catch{return {};}};
  // A version reported by the ESP is trusted only when the file has not changed since the last upload from here.
  const unchanged=async(name,code)=>{const last=(await uploads())[name];return last===undefined||last===hash(code);};
  const markUploaded=async(name,code)=>{const all={...await uploads(),[name]:hash(code)};await fs.mkdir(folder,{recursive:true});await fs.writeFile(`${record}.tmp`,JSON.stringify(all));await fs.rename(`${record}.tmp`,record);};
  const spiClock=code=>'compiler.cpp.extra_flags=-DMFRC522_SPICLOCK='+(/MFRC522_SPICLOCK\s*!=\s*100000UL/.test(code)?'100000UL':/MFRC522_SPICLOCK\s*!=\s*1000000UL/.test(code)?'1000000UL':'4000000UL');
  const flash=async(name,port,onOutput)=>{
    if(busy)throw Error('Upload firmware lain sedang berjalan.');
    busy=true;
    try {
      // Sketches in firmware/arduino were all verified with the tested Arduino IDE profile.
      const {code}=await sketch(name),dir=path.join(folder,'builds',`siapkan-${name}`),sketchDir=path.join(dir,name);
      await fs.mkdir(sketchDir,{recursive:true});await fs.writeFile(path.join(sketchDir,`${name}.ino`),code,'utf8');
      const env={...process.env,PATH:`${path.join(workspace,'.tools/venv/bin')}${path.delimiter}${process.env.PATH||''}`};
      await new Promise((resolve,reject)=>{
        const child=runner(cli,['--config-file',testedConfig,'--no-color','compile','--fqbn',BOARD,'--jobs','1','--build-property',spiClock(code),'--build-path',path.join(dir,'cache'),'--upload','--port',port,sketchDir],{cwd:workspace,env,stdio:['ignore','pipe','pipe'],shell:false});
        let log='',timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM')},780000);
        const output=chunk=>{log=(log+chunk).slice(-5000);onOutput(log);};
        child.stdout.on('data',output);child.stderr.on('data',output);
        child.on('error',error=>{clearTimeout(timer);reject(error)});
        child.on('close',code=>{clearTimeout(timer);code===0&&!timedOut?resolve():reject(Error(`Compile/upload ${name} gagal: ${log.slice(-1200)}`))});
      });
      await markUploaded(name,code);
    } finally { busy=false; }
  };
  const ports=async()=>(await listPorts()).filter(p=>p.vendorId||/tty(?:USB|ACM)/.test(p.path)||process.platform==='win32').map(p=>({path:p.path,name:p.manufacturer||'USB Serial'}));
  return {sketch,sketches,flash,unchanged,markUploaded,ports,isBusy:()=>busy,isUploading:()=>busy,shutdown:()=>{}};
}

function registerFirmwareIPC({app,ipcMain,checkSender,listPorts}) {
  const resources=path.resolve(__dirname,'..');
  const workspace=process.env.RVM_WORKSPACE||(app.isPackaged?path.resolve(path.dirname(app.getPath('exe')),'../..'):resources);
  const service=createFirmwareService({workspace,resources,userData:app.getPath('userData'),listPorts});
  for(const method of ['sketches','ports'])ipcMain.handle(`firmware:${method}`,(event,...args)=>{checkSender(event);return service[method](...args);});
  return service;
}
module.exports={createFirmwareService,registerFirmwareIPC};
