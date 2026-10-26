const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const BOARD = 'esp32:esp32:esp32';
const hash = code => crypto.createHash('sha256').update(code).digest('hex');
function validateCode(code) {
  if(typeof code !== 'string' || !code.trim() || Buffer.byteLength(code)>512*1024 || code.includes('\0')) throw new Error('Sketch harus berupa teks .ino, maksimal 512 KB.');
}
function createFirmwareService({workspace, resources, userData, listPorts, closeSerial, emit, runner=spawn, externalBusy=()=>false}) {
  const cli = path.join(workspace,'.tools/arduino-cli');
  const config = path.join(workspace,'.tools/arduino-cli.yaml');
  const testedConfig = path.join(workspace,'.tools/arduino-tested.yaml');
  const folder = path.join(userData,'firmware');
  let editorKind='production';
  const draftFile=()=>path.join(folder,editorKind==='diagnostic'?'diagnostic.ino':'production.ino');
  let writeQueue=Promise.resolve(), compiled=null, active=null;
  let state={kind:null,status:'idle',output:'',message:'Siap menulis firmware produksi.',compiledHash:null,board:BOARD,editorKind};
  const snapshot=()=>({...state});
  const publish=()=>emit(snapshot());
  const append=text=>{state.output=(state.output+text).slice(-100000);publish();};
  const isBusy=()=>state.status==='running';
  const isUploading=()=>isBusy()&&state.kind==='upload';
  const checkIdle=()=>{if(isBusy()||externalBusy())throw new Error('Tunggu proses compile/upload selesai.');};
  const template=async name=>{
    const sketches={production:'rvm_production',diagnostic:'rvm_diag'};
    if(!Object.hasOwn(sketches,name))throw new Error('Template tidak dikenal.');
    return fs.readFile(path.join(resources,'firmware/arduino',sketches[name],`${sketches[name]}.ino`),'utf8');
  };
  const save=code=>{
    validateCode(code);
    const draftPath=draftFile();
    const task=writeQueue.catch(()=>{}).then(async()=>{
      await fs.mkdir(folder,{recursive:true});
      await fs.writeFile(`${draftPath}.tmp`,code,'utf8');await fs.rename(`${draftPath}.tmp`,draftPath);
      return {savedAt:new Date().toISOString(),hash:hash(code)};
    });writeQueue=task;return task;
  };
  const openDraft=async kind=>{
    checkIdle();if(!['production','diagnostic'].includes(kind))throw Error('Jenis draft tidak valid.');
    await writeQueue.catch(()=>{});editorKind=kind;
    compiled=null;state={...state,compiledHash:null,editorKind};publish();
    return load();
  };
  const load=async()=>{
    const draftPath=draftFile();
    await writeQueue.catch(()=>{});
    let code;
    try{code=await fs.readFile(draftPath,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;code=await template(editorKind);await save(code);}
    let toolReady=false;try{await fs.access(cli,1);await fs.access(config);toolReady=true;}catch{}
    // Refresh only the exact previous built-in production draft; preserve customized sketches.
    if(editorKind==='production' && hash(code)==='8365675442521452115f1a4c2d4abd0f4328ee0f4fdbadca68397f2b42e97251') {
      const latest=await template('production');if(latest!==code){code=latest;await save(code);}
    }
    const stat=await fs.stat(draftPath);
    return {code,draftPath,kind:editorKind,cliPath:cli,toolReady,savedAt:stat.mtime.toISOString(),state:snapshot()};
  };
  function finish(job,status,message) {
    if(active!==job)return;
    clearTimeout(job.timer);clearTimeout(job.killTimer);
    active=null;state.status=status;state.message=message;
    if(job.kind==='compile' && status!=='success' && job.folder)void fs.rm(job.folder,{recursive:true,force:true}).catch(()=>{});
    append(`\n${message}\n`);
  }
  function reserve(kind,code) {
    checkIdle();validateCode(code);
    const job={kind,hash:hash(code),config:/almufti-(?:diag-2\.|production-1\.)/.test(code)?testedConfig:config,canceled:false,child:null,timer:null,killTimer:null};active=job;
    state={...state,kind,status:'running',output:'',message:kind==='compile'?'Menyiapkan compile…':'Menyiapkan upload…',sourceHash:job.hash};publish();return job;
  }
  function kill(job,signal) {
    try{if(process.platform!=='win32' && job.child?.pid)process.kill(-job.child.pid,signal);else job.child?.kill(signal);}catch(error){if(error.code!=='ESRCH')throw error;}
  }
  function run(job,args,onSuccess) {
    if(job.canceled){finish(job,'canceled','Compile dibatalkan.');return;}
    state.message=job.kind==='compile'?'Mengompilasi sketch…':'Mengunggah firmware…';publish();
    const env={...process.env,PATH:`${path.join(workspace,'.tools/venv/bin')}${path.delimiter}${process.env.PATH||''}`};
    const child=runner(cli,['--config-file',job.config,'--no-color',...args],{cwd:workspace,env,stdio:['ignore','pipe','pipe'],shell:false,detached:process.platform!=='win32'});job.child=child;
    const output=chunk=>{if(active===job)append(chunk.toString());};
    child.stdout.on('data',output);child.stderr.on('data',output);
    child.on('error',error=>finish(job,'error',`Arduino CLI gagal dijalankan: ${error.message}`));
    job.timer=setTimeout(()=>{job.timedOut=true;kill(job,'SIGTERM');job.killTimer=setTimeout(()=>kill(job,'SIGKILL'),5000);},job.kind==='compile'?600000:180000);
    child.on('close',code=>{
      if(active!==job)return;
      if(job.canceled){finish(job,'canceled','Compile dibatalkan.');return;}
      if(job.timedOut){finish(job,'error','Arduino CLI melewati batas waktu. Periksa konsol.');return;}
      if(code!==0){finish(job,'error',`${job.kind==='compile'?'Compile':'Upload'} gagal (exit ${code}). Periksa pesan konsol.`);return;}
      onSuccess();finish(job,'success',job.kind==='compile'?'Compile berhasil. Firmware siap di-upload.':'Upload berhasil. ESP akan menjalankan sketch ini.');
    });
  }
  const compile=async code=>{
    const job=reserve('compile',code);
    const oldBuild=compiled;compiled=null;state.compiledHash=null;
    void (async()=>{
      await save(code);
      if(oldBuild)await fs.rm(oldBuild.folder,{recursive:true,force:true});
      const buildFolder=path.join(folder,'builds',crypto.randomUUID());
      job.folder=buildFolder;
      const sketch=path.join(buildFolder,'production');const out=path.join(buildFolder,'out');
      await fs.mkdir(sketch,{recursive:true});await fs.mkdir(out,{recursive:true});
      await fs.writeFile(path.join(sketch,'production.ino'),code,'utf8');
      append(`Board: ESP32 Dev Module (${BOARD})\nSketch: production.ino\n\n`);
      run(job,['compile','--fqbn',BOARD,...(job.config===testedConfig?[]:['--board-options','FlashFreq=40']),'--jobs','1','--build-property','compiler.cpp.extra_flags=-DMFRC522_SPICLOCK='+(/MFRC522_SPICLOCK\s*!=\s*100000UL/.test(code)?'100000UL':/MFRC522_SPICLOCK\s*!=\s*1000000UL/.test(code)?'1000000UL':'4000000UL'),'--build-path',path.join(buildFolder,'cache'),'--output-dir',out,sketch],()=>{
        compiled={hash:job.hash,config:job.config,folder:buildFolder,sketch,out};state.compiledHash=job.hash;
      });
    })().catch(error=>finish(job,'error',error.message));
    return snapshot();
  };
  const ports=async()=>(await listPorts()).filter(p=>p.vendorId||/tty(?:USB|ACM)/.test(p.path)||process.platform==='win32').map(p=>({path:p.path,name:p.manufacturer||'USB Serial'}));
  const upload=async({code,port})=>{
    checkIdle();validateCode(code);
    if(!compiled || compiled.hash!==hash(code))throw new Error('Kode berubah atau belum berhasil di-compile. Compile versi ini dahulu.');
    const build=compiled,job=reserve('upload',code);job.config=build.config;
    void (async()=>{
      if(!(await ports()).some(p=>p.path===port))throw new Error('Port ESP belum tersedia. Sambungkan ESP dan refresh port.');
      await closeSerial();append(`Port: ${port}\nMonitor serial dilepas sebelum upload.\n\n`);
      run(job,['upload','--fqbn',BOARD,...(job.config===testedConfig?[]:['--board-options','FlashFreq=40']),'--port',port,'--input-dir',build.out,build.sketch],()=>{state.lastUploadedAt=new Date().toISOString();state.lastUploadedHash=build.hash;});
    })().catch(error=>finish(job,'error',error.message));return snapshot();
  };
  const cancel=()=>{
    if(!isBusy()||state.kind!=='compile')throw new Error('Hanya compile yang bisa dibatalkan.');
    const job=active;job.canceled=true;if(job.child){kill(job,'SIGTERM');job.killTimer=setTimeout(()=>kill(job,'SIGKILL'),5000);}return snapshot();
  };
  return {load,openDraft,save,template,compile,upload,ports,cancel,snapshot,isBusy,isUploading,shutdown:()=>{if(active?.kind==='compile')kill(active,'SIGTERM');}};
}

function registerFirmwareIPC({app,ipcMain,dialog,getWindow,checkSender,closeSerial,listPorts,externalBusy}) {
  const resources=path.resolve(__dirname,'..');
  const workspace=process.env.RVM_WORKSPACE||(app.isPackaged?path.resolve(path.dirname(app.getPath('exe')),'../..'):resources);
  const service=createFirmwareService({workspace,resources,userData:app.getPath('userData'),listPorts,closeSerial,externalBusy,emit:value=>{const window=getWindow();if(window&&!window.isDestroyed())window.webContents.send('firmware:event',value);}});
  for(const method of ['load','openDraft','save','template','compile','upload','ports','cancel','snapshot'])ipcMain.handle(`firmware:${method}`,(event,...args)=>{checkSender(event);return service[method](...args);});
  ipcMain.handle('firmware:import',async event=>{
    checkSender(event);const result=await dialog.showOpenDialog(getWindow(),{title:'Buka sketch ESP',filters:[{name:'Arduino sketch',extensions:['ino']}],properties:['openFile']});
    if(result.canceled)return null;
    const source=result.filePaths[0];if(path.extname(source).toLowerCase()!=='.ino'||(await fs.stat(source)).size>512*1024)throw new Error('Pilih file .ino maksimal 512 KB.');
    const code=await fs.readFile(source,'utf8');validateCode(code);return {code,name:path.basename(source)};
  });
  ipcMain.handle('firmware:export',async(event,code)=>{
    checkSender(event);validateCode(code);const result=await dialog.showSaveDialog(getWindow(),{title:'Simpan sketch ESP',defaultPath:'production.ino',filters:[{name:'Arduino sketch',extensions:['ino']}]});
    if(result.canceled)return null;const dest=path.extname(result.filePath).toLowerCase()==='.ino'?result.filePath:`${result.filePath}.ino`;await fs.writeFile(dest,code,'utf8');return dest;
  });
  return service;
}
module.exports={createFirmwareService,registerFirmwareIPC};
