const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const validId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
function createVisionService({workspace,resources,userData,nativeImage,emit,runner=spawn}) {
  const root=path.join(userData,'vision'),python=path.join(workspace,'.tools/vision/bin/python');
  let predictor=null,mutation=Promise.resolve();
  let state={status:'idle',message:'Impor model YOLO .pt untuk mulai.',projectId:null,output:''};
  const publish=patch=>{state={...state,...patch};emit(state)};
  const directory=id=>{if(!validId(id))throw Error('ID model tidak valid.');return path.join(root,id)};
  const read=async id=>JSON.parse(await fs.readFile(path.join(directory(id),'project.json'),'utf8'));
  const save=async meta=>{const file=path.join(directory(meta.id),'project.json');await fs.writeFile(file+'.tmp',JSON.stringify(meta,null,2));await fs.rename(file+'.tmp',file)};
  const serialized=fn=>{const task=mutation.catch(()=>{}).then(fn);mutation=task;return task};
  async function status(){let ready=false;try{await fs.access(python,1);ready=true}catch{}return {runtimeReady:ready,state};}
  async function stored(){await fs.mkdir(root,{recursive:true});const items=[];for(const id of await fs.readdir(root)){if(validId(id)){try{const m=await read(id);if(m.trained||m.imported)items.push(m)}catch{}}}return items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  async function inspect(id){
    return new Promise((resolve,reject)=>{
      let child,complete,error,closed=false;
      const timer=setTimeout(()=>{closed=true;child?.kill();reject(Error('Validasi model terlalu lama.'))},90000);
      launch('inspect',id,[],value=>{if(value.kind==='model')complete=value;if(value.kind==='error')error=value.message},(code,message)=>{clearTimeout(timer);closed=true;code===0&&complete?resolve(complete):reject(Error(error||message||'File bukan model YOLO .pt yang didukung.'))}).then(c=>{child=c;if(closed)c.kill()}).catch(e=>{clearTimeout(timer);reject(e)});
    });
  }
  async function importFile(source){
    if(typeof source!=='string'||path.extname(source).toLowerCase()!=='.pt')throw Error('Pilih file model YOLO PyTorch (.pt).');
    const stat=await fs.stat(source);if(!stat.isFile()||stat.size===0||stat.size>500*1024*1024)throw Error('Model harus berukuran 1 byte–500 MB.');
    const id=crypto.randomUUID(),folder=directory(id);await fs.mkdir(folder,{recursive:true});
    publish({status:'running',message:'Memvalidasi model dan membaca kelas…',projectId:id});
    try {
      await fs.copyFile(source,path.join(folder,'model.pt'));
      const info=await inspect(id);
      const meta={id,name:path.basename(source),architecture:'YOLO',task:info.task,classes:info.classes,samples:[],createdAt:new Date().toISOString(),trained:true,imported:true,datasetChanged:false,size:stat.size,sourcePath:source};
      await save(meta);publish({status:'success',message:'Model siap diuji dan dipilih untuk siklus.',projectId:id});return meta;
    }catch(e){await fs.rm(folder,{recursive:true,force:true});publish({status:'error',message:e.message});throw e;}
  }
  const importModel=source=>serialized(()=>importFile(source));
  // Upgrade files copied by the old importer into the same store used by inference.
  const list=()=>serialized(async()=>{
    let items=await stored();const legacy=path.join(userData,'models');let names=[];
    if(!(await status()).runtimeReady)return items;
    try{names=await fs.readdir(legacy)}catch(e){if(e.code!=='ENOENT')throw e}
    for(const name of names.filter(n=>/\.pt$/i.test(n))){const source=path.join(legacy,name);if(items.some(m=>m.sourcePath===source))continue;
      try{items.push(await importFile(source))}catch(e){const meta={id:crypto.randomUUID(),name,classes:[],samples:[],createdAt:new Date().toISOString(),trained:false,imported:true,sourcePath:source,importError:e.message};await fs.mkdir(directory(meta.id),{recursive:true});await save(meta);items.push(meta)}
    }
    return items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  });
  function imageBytes(data){if(typeof data!=='string'||data.length>8*1024*1024||!/^data:image\/(jpeg|png);base64,/.test(data))throw Error('Gambar tidak valid / terlalu besar.');const image=nativeImage.createFromDataURL(data);const {width,height}=image.getSize();if(image.isEmpty()||width<64||height<64||width>1920||height>1920)throw Error('Gambar harus 64–1920 piksel.');return image.toJPEG(90)}
  async function launch(action,id,extra=[],onEvent,onClose){
    if(!(await status()).runtimeReady)throw Error('Runtime YOLO belum terpasang. Jalankan setup-vision-tools.sh dari folder aplikasi.');
    const folder=path.join(root,'runtime');await fs.mkdir(folder,{recursive:true});const worker=path.join(folder,'vision-worker.py');await fs.copyFile(path.join(resources,'electron/vision-worker.py'),worker);
    const child=runner(python,['-u',worker,action,'--project',directory(id),...extra],{cwd:workspace,shell:false,env:{...process.env,YOLO_CONFIG_DIR:path.join(root,'ultralytics'),OMP_NUM_THREADS:'2',MKL_NUM_THREADS:'2'},stdio:['pipe','pipe','pipe']});
    let buffer='';child.stdout.on('data',chunk=>{buffer+=chunk.toString();let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(line.startsWith('RVM_JSON ')){try{onEvent(JSON.parse(line.slice(9)))}catch{}}}});
    let stderr='';child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4000)});child.on('error',e=>onClose(-1,e.message));child.on('close',code=>onClose(code,code?stderr:undefined));return child;
  }
  // Evidence for stale camera frames: keep the last 100 inspection photos.
  async function keepInspection(bytes,cycle){
    const folder=path.join(root,'inspections');await fs.mkdir(folder,{recursive:true});
    const file=path.join(folder,`${new Date().toISOString().replace(/[:.]/g,'-')}-c${cycle}.jpg`);await fs.writeFile(file,bytes);
    const old=(await fs.readdir(folder)).filter(n=>n.endsWith('.jpg')).sort().slice(0,-100);
    await Promise.all(old.map(n=>fs.rm(path.join(folder,n),{force:true})));return file;
  }
  function stopPredictor(){if(predictor){clearTimeout(predictor.timer);predictor.reject?.(Error('Pengujian kamera dihentikan.'));predictor.child?.kill();for(const p of predictor.pending.values()){clearTimeout(p.timer);p.reject(Error('Pengujian kamera dihentikan.'));}predictor=null}}
  async function predict({id,image,timeoutMs=60000,save}){
    const meta=await read(id);if(!meta.trained||!meta.classes?.length)throw Error('Model belum siap. Impor file YOLO .pt yang valid.');
    const bytes=imageBytes(image);
    if(predictor&&predictor.id!==id)stopPredictor();
    if(!predictor){const p={id,pending:new Map(),child:null,ready:null};predictor=p;
      p.ready=new Promise((resolve,reject)=>{p.resolve=resolve;p.reject=reject;p.timer=setTimeout(()=>{reject(Error('Runtime YOLO terlalu lama dimuat.'));stopPredictor()},90000)});
      p.ready.catch(()=>{});
      try {p.child=await launch('predict',id,[],m=>{if(m.kind==='ready'){clearTimeout(p.timer);p.resolve();}else if(m.id){const request=p.pending.get(m.id);if(request){clearTimeout(request.timer);p.pending.delete(m.id);m.kind==='prediction'?request.resolve(m):request.reject(Error(m.message));}}},(code,error)=>{clearTimeout(p.timer);p.reject(Error(error||'Runtime inferensi berhenti.'));for(const request of p.pending.values()){clearTimeout(request.timer);request.reject(Error('Inferensi berhenti.'))}if(predictor===p)predictor=null});if(predictor!==p){p.child.kill();throw Error('Pengujian kamera dihentikan.');}}catch(error){clearTimeout(p.timer);p.reject(error);if(predictor===p)predictor=null;throw error}
    }
    const p=predictor;if(!p)throw Error('Pengujian kamera dihentikan.');await p.ready;if(predictor!==p)throw Error('Pengujian kamera dihentikan.');if(p.pending.size)throw Error('Gambar sebelumnya masih diproses.');const requestId=crypto.randomUUID();const file=path.join(directory(id),'test-frame.jpg');await fs.writeFile(file,bytes);
    let saved;if(Number.isInteger(save)){saved=await keepInspection(bytes,save)}
    return new Promise((resolve,reject)=>{const timer=Number.isFinite(timeoutMs)&&timeoutMs>0?setTimeout(()=>{p.pending.delete(requestId);stopPredictor();reject(Error('Inferensi timeout.'))},timeoutMs):null;p.pending.set(requestId,{resolve:m=>resolve(saved?{...m,saved}:m),reject,timer});p.child.stdin.write(JSON.stringify({id:requestId,path:file})+'\n')});
  }
  return {status,list,importModel,predict,shutdown:()=>stopPredictor()};
}
function registerVisionIPC({app,ipcMain,nativeImage,dialog,checkSender,getWindow}){
  const workspace=process.env.RVM_WORKSPACE||(app.isPackaged?path.resolve(path.dirname(app.getPath('exe')),'../..'):path.resolve(__dirname,'..'));
  const service=createVisionService({workspace,resources:path.resolve(__dirname,'..'),userData:app.getPath('userData'),nativeImage,emit:state=>{const w=getWindow();if(w&&!w.isDestroyed())w.webContents.send('vision:event',state)}});
  for(const method of ['status','list','predict'])ipcMain.handle('vision:'+method,(event,args)=>{checkSender(event);return service[method](args)});
  ipcMain.handle('vision:importModel',async event=>{checkSender(event);const result=await dialog.showOpenDialog(getWindow(),{title:'Impor model YOLO',filters:[{name:'YOLO PyTorch',extensions:['pt']}],properties:['openFile']});return result.canceled?null:service.importModel(result.filePaths[0]);});
  return service;
}
module.exports={createVisionService,registerVisionIPC};
