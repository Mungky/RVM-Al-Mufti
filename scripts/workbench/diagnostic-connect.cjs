const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const call=(port,method,...args)=>new Promise((resolve,reject)=>port[method](...args,error=>error?reject(error):resolve()));
function createDiagnosticInstaller({workspace,resources,SerialPort,emit,firmware,runner=spawn}) {
  let busy=false;
  const report=(phase,message,output='')=>emit({phase,message,output});
  async function probe(portPath,version) {
    const port=new SerialPort({path:portPath,baudRate:115200,autoOpen:false});
    const id=crypto.randomUUID();let buffer='',matching=false;
    port.on('error',()=>{});
    port.on('data',chunk=>{buffer+=chunk.toString();let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const m=JSON.parse(line);if(m.type==='ack'&&m.id===id&&m.ok&&m.firmware===version)matching=true;}catch{}}if(buffer.length>8192)buffer='';});
    try{await call(port,'open');await sleep(1200);for(let attempt=0;attempt<2&&!matching;attempt++){await call(port,'write',JSON.stringify({id,cmd:'ping'})+'\n');await sleep(700)}return matching;}
    finally{if(port.isOpen)await call(port,'close');}
  }
  // Returns the installed version, or null for a sketch without the app protocol (upload only).
  async function ensure(portPath,name='rvm_diag') {
    if(busy)throw Error('Pemasangan firmware sedang berjalan.');busy=true;
    try {
      const {code:sketch,version}=await firmware.sketch(name),label=version||name;
      // Failure to OPEN is not evidence of missing firmware: never flash a busy/inaccessible port.
      if(version&&await firmware.unchanged(name,sketch)){report('probe',`Memeriksa firmware ESP (${version})…`);if(await probe(portPath,version)){report('ready',`Firmware ${version} sudah terpasang. Menghubungkan…`);return version;}}
      // The verified prebuilt pengujian binary is used only for the exact sketch it was built from.
      const manifest=name==='rvm_diag'?JSON.parse(await fs.readFile(path.join(resources,'firmware/builds/rvm_diag/verification.json'),'utf8')):null;
      if(manifest?.source_sha256!==crypto.createHash('sha256').update(sketch).digest('hex')){
        const message=`Compile & upload ${label}. Bisa beberapa menit; jangan cabut USB.`;
        report('upload',message);await firmware.flash(name,portPath,log=>report('upload',message,log));
        if(!version){report('ready',`Firmware ${name} terpasang.`);return null;}
        report('verify','Memeriksa respons firmware baru…');await sleep(1200);
        if(!await probe(portPath,version))throw Error(`Upload selesai tetapi ${version} belum merespons. Periksa port/board.`);
        report('ready',`Firmware ${version} siap. Menghubungkan…`);return version;
      }
      report('upload','Memasang firmware pengujian. Jangan cabut USB.');
      const folder=await fs.mkdtemp(path.join(workspace,'.tools/diag-upload-'));
      try {
        for(const [name,hash] of Object.entries(manifest.sha256)) {
          if(!/^rvm_diag\.ino(?:\.(?:bootloader|partitions))?\.bin$/.test(name))throw Error('Nama binary tidak valid.');
          const bytes=await fs.readFile(path.join(resources,'firmware/builds/rvm_diag',name));
          if(crypto.createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('Checksum firmware pengujian gagal.');
          await fs.writeFile(path.join(folder,name),bytes);
        }
        const sketchDir=path.join(folder,'rvm_diag');await fs.mkdir(sketchDir);await fs.writeFile(path.join(sketchDir,'rvm_diag.ino'),sketch);
        await new Promise((resolve,reject)=>{
          const child=runner(path.join(workspace,'.tools/arduino-cli'),['--config-file',path.join(workspace,'.tools/arduino-tested.yaml'),'upload','--fqbn','esp32:esp32:esp32','--port',portPath,'--input-dir',folder,sketchDir],{cwd:workspace,env:{...process.env,PATH:path.join(workspace,'.tools/venv/bin')+path.delimiter+process.env.PATH},shell:false});
          let log='',timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM')},180000);
          const output=b=>{log=(log+b).slice(-5000);report('upload','Memasang firmware pengujian. Jangan cabut USB.',log)};
          child.stdout.on('data',output);child.stderr.on('data',output);
          child.on('error',e=>{clearTimeout(timer);reject(e)});
          child.on('close',code=>{clearTimeout(timer);code===0&&!timedOut?resolve():reject(Error('Upload pengujian gagal: '+log.slice(-1200)))});
        });
      }finally{await fs.rm(folder,{recursive:true,force:true});}
      report('verify','Memeriksa respons firmware baru…');
      await sleep(1200);
      if(!await probe(portPath,version))throw Error('Upload selesai tetapi firmware pengujian belum merespons. Periksa port/board.');
      await firmware.markUploaded(name,sketch);
      report('ready','Firmware pengujian siap. Menghubungkan…');return version;
    }catch(error){report('error',error.message);throw error}finally{busy=false}
  }
  return {ensure,isBusy:()=>busy};
}
module.exports={createDiagnosticInstaller};
