const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const call=(port,method,...args)=>new Promise((resolve,reject)=>port[method](...args,error=>error?reject(error):resolve()));
function createDiagnosticInstaller({workspace,resources,SerialPort,emit,runner=spawn}) {
  let busy=false;
  const report=(phase,message,output='')=>emit({phase,message,output});
  async function probe(portPath,version) {
    const port=new SerialPort({path:portPath,baudRate:115200,autoOpen:false});
    const id=crypto.randomUUID();let buffer='',matching=false;
    port.on('error',()=>{});
    port.on('data',chunk=>{buffer+=chunk.toString();let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const m=JSON.parse(line);if(m.type==='ack'&&m.id===id&&m.ok&&m.diagnostic&&m.firmware===version)matching=true;}catch{}}if(buffer.length>8192)buffer='';});
    try{await call(port,'open');await sleep(1200);for(let attempt=0;attempt<2&&!matching;attempt++){await call(port,'write',JSON.stringify({id,cmd:'ping'})+'\n');await sleep(700)}return matching;}
    finally{if(port.isOpen)await call(port,'close');}
  }
  async function ensure(portPath) {
    if(busy)throw Error('Pemasangan firmware pengujian sedang berjalan.');busy=true;
    try {
      const sketch=await fs.readFile(path.join(resources,'firmware/arduino/rvm_diag/rvm_diag.ino'),'utf8');
      const version=sketch.match(/FIRMWARE\s*=\s*"([^"]+)"/)?.[1];if(!version)throw Error('Versi template pengujian tidak valid.');
      report('probe','Memeriksa firmware ESP…');
      // Failure to OPEN is not evidence of missing firmware: never flash a busy/inaccessible port.
      if(await probe(portPath,version)){report('ready','Firmware pengujian sesuai. Menghubungkan…');return;}
      report('upload','Memasang firmware pengujian. Jangan cabut USB.');
      const manifest=JSON.parse(await fs.readFile(path.join(resources,'firmware/builds/rvm_diag/verification.json'),'utf8'));
      if(manifest.source_sha256!==crypto.createHash('sha256').update(sketch).digest('hex'))throw Error('Binary pengujian tidak sesuai template. Build ulang diperlukan.');
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
      report('ready','Firmware pengujian siap. Menghubungkan…');
    }catch(error){report('error',error.message);throw error}finally{busy=false}
  }
  return {ensure,isBusy:()=>busy};
}
module.exports={createDiagnosticInstaller};
