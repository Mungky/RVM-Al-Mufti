import {selectedProductionClasses,selectedRejectedClasses,validateClassRules,bottleDecision} from './production-client.mjs';

export function createModelStudio(React) {
 const h=React.createElement;
 return function ModelStudio({notify=()=>{},db,updateDB}) {
  const api=window.rvm?.vision;
  const [models,setModels]=React.useState([]),[selected,setSelected]=React.useState(''),[busy,setBusy]=React.useState(false),[loading,setLoading]=React.useState(true);
  const [runtime,setRuntime]=React.useState(false),[error,setError]=React.useState(''),[status,setStatus]=React.useState('Membaca model…');
  const [camera,setCamera]=React.useState(false),[cameras,setCameras]=React.useState([]),[deviceId,setDeviceId]=React.useState(db.settings.productionCamera||'');
  const [testing,setTesting]=React.useState(false),[image,setImage]=React.useState(''),[predictions,setPredictions]=React.useState([]),[aspect,setAspect]=React.useState(4/3);
  const [classIds,setClassIds]=React.useState([]),[confidence,setConfidence]=React.useState(db.settings.productionConfidence??60);
  const [rejectedIds,setRejectedIds]=React.useState([]),[rejectConfidence,setRejectConfidence]=React.useState(db.settings.productionRejectConfidence??db.settings.productionConfidence??60);
  const [pipelineTest,setPipelineTest]=React.useState(false),[testResult,setTestResult]=React.useState('');
  const video=React.useRef(null),stream=React.useRef(null),running=React.useRef(false),alive=React.useRef(true);
  const model=models.find(m=>m.id===selected),ready=!!model?.trained&&!!model.classes?.length&&!model.datasetChanged;
  const pipeline=db.settings.productionPipeline,pipelineReady=['object','pet','cap'].every(role=>pipeline?.[role]?.id);
  const savedClasses=selectedProductionClasses(db.settings);
  const configured=db.settings.productionVisionMode!=='pipeline'&&db.settings.productionSingleModel===selected&&classIds.length>0&&savedClasses.length===classIds.length&&classIds.every(id=>savedClasses.includes(id))&&rejectedIds.length>0&&selectedRejectedClasses(db.settings).length===rejectedIds.length&&rejectedIds.every(id=>selectedRejectedClasses(db.settings).includes(id));
  async function refresh(preferred){
   if(!api){setLoading(false);return}
   const [items,state]=await Promise.all([api.list(),api.status()]);if(!alive.current)return;
   setModels(items);setRuntime(state.runtimeReady);setSelected(old=>preferred||old||items.find(m=>m.id===db.settings.productionSingleModel)?.id||items[0]?.id||'');setLoading(false);
  }
  async function action(fn){setBusy(true);setError('');try{return await fn()}catch(e){if(alive.current){setError(e.message);notify(e.message)}}finally{if(alive.current)setBusy(false)}}
  function stopCamera(){running.current=false;setTesting(false);stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;setCamera(false);api?.stopTest().catch(()=>{});}
  React.useEffect(()=>{alive.current=true;refresh().catch(e=>{setError(e.message);setLoading(false)});const off=api?.onEvent(s=>{setStatus(s.message);});navigator.mediaDevices?.enumerateDevices().then(d=>{if(alive.current)setCameras(d.filter(c=>c.kind==='videoinput'))}).catch(()=>{});return()=>{alive.current=false;running.current=false;stream.current?.getTracks().forEach(t=>t.stop());api?.stopTest().catch(()=>{});off?.()}},[]);
  React.useEffect(()=>{if(camera&&video.current&&stream.current){video.current.srcObject=stream.current;video.current.play().catch(e=>setError(e.message))}},[camera]);
  React.useEffect(()=>{setClassIds(model?.id===db.settings.productionSingleModel?selectedProductionClasses(db.settings):model?.classes.length===1?[0]:[]);setRejectedIds(model?.id===db.settings.productionSingleModel?selectedRejectedClasses(db.settings):[]);setImage('');setPredictions([]);setTestResult('');},[selected]);
  async function importModel(){await action(async()=>{stopCamera();const meta=await api.importModel();if(!meta)return;await refresh(meta.id);setStatus('Model siap diuji dan dipakai dalam siklus.');notify('Model berhasil diimpor. Kelas dibaca dari file .pt.');})}
  async function startCamera(){await action(async()=>{
   stopCamera();if(!navigator.mediaDevices?.getUserMedia)throw Error('Akses kamera tidak tersedia.');
   const media=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1920},height:{ideal:1080},...(deviceId?{deviceId:{exact:deviceId}}:{})},audio:false});
   if(!alive.current){media.getTracks().forEach(t=>t.stop());return}stream.current=media;setImage('');setPredictions([]);setCamera(true);
   setCameras((await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput'));
  })}
  function frame(){const v=video.current;if(!v?.videoWidth)throw Error('Tunggu gambar kamera muncul.');const canvas=document.createElement('canvas');const ratio=Math.min(1,1920/Math.max(v.videoWidth,v.videoHeight));canvas.width=Math.round(v.videoWidth*ratio);canvas.height=Math.round(v.videoHeight*ratio);canvas.getContext('2d').drawImage(v,0,0,canvas.width,canvas.height);setAspect(canvas.width/canvas.height);return canvas.toDataURL('image/jpeg',.9)}
  async function testLive(){
   if(testing){running.current=false;setTesting(false);await api.stopTest();return}
   running.current=true;setTesting(true);setError('');setTestResult('Memuat model dan memproses kamera…');
   try{while(running.current&&alive.current){const photo=frame();const result=await api.predict({id:pipelineTest?pipeline.object.id:selected,image:photo,...(pipelineTest?{pipeline:{...pipeline,confidence:Number(confidence)/100}}:{})});if(!running.current||!alive.current)break;
    setImage(photo);setPredictions(result.boxes);setTestResult(pipelineTest?`Pipeline: ${result.accepted?'DITERIMA':'DITOLAK'} · PET ${result.pet?'ya':'tidak'} · tanpa tutup ${result.withoutCap?'ya':'tidak'} · ${result.objectCount} objek`:(()=>{const d=bottleDecision(result.boxes,model.classes,classIds,rejectedIds,Number(confidence),Number(rejectConfidence));return `CV: ${d.accepted?'DITERIMA':'DITOLAK'} · ${d.reason==='rejected_class'?'kelas ditolak/tutup terdeteksi':d.reason==='bottle_detected'?'botol terdeteksi':d.reason==='rules_invalid'?'atur kelas diterima dan ditolak terlebih dahulu':'botol tidak terdeteksi pada ambang'} · ${result.boxes.length} deteksi`;})());await new Promise(r=>setTimeout(r,400));}
   }catch(e){if(alive.current&&running.current)setError(e.message)}finally{running.current=false;if(alive.current)setTesting(false);await api.stopTest().catch(()=>{})}
  }
  async function useInCycle(){await action(async()=>{
   if(!ready)throw Error('Pilih model siap pakai.');validateClassRules(classIds,rejectedIds,model);
   await updateDB(old=>({...old,settings:{...old.settings,productionVisionMode:'single',productionSingleModel:model.id,productionSingleClasses:classIds,productionSingleClass:classIds[0]??-1,productionRejectedClasses:rejectedIds,productionRejectConfidence:Number(rejectConfidence),productionConfidence:Number(confidence),productionCamera:deviceId}}));
   notify('Model dan kelas disimpan untuk siklus mesin.');
  })}
  const button=(text,fn,disabled=false,secondary=false)=>h('button',{type:'button',className:'button'+(secondary?' secondary':''),onClick:fn,disabled},text);
  const label=(text,element)=>h('label',{className:'studio-field'},h('span',null,text),element);
  return h('section',{className:'model-studio'},
   h('div',{className:'studio-intro'},h('h2',null,'Model YOLO'),h('p',null,'Impor model PyTorch (.pt), uji kamera, lalu pilih kelas untuk siklus mesin.')),
   !api&&h('p',{className:'studio-error',role:'alert'},'Impor dan pengujian model tersedia di aplikasi desktop.'),
   error&&h('p',{className:'studio-error',role:'alert'},error),
   api&&!runtime&&!loading&&h('p',{className:'studio-error'},'Runtime YOLO belum tersedia. Jalankan setup-vision-tools.sh.'),
   h('div',{className:'studio-inline'},button(busy?'Memproses…':'Impor model .pt',importModel,!api||busy||loading||testing||!runtime),h('span',null,'YOLO PyTorch · maks. 500 MB · kelas dibaca otomatis')),
   (loading||busy)&&h('p',{role:'status'},status),
   !loading&&!models.length&&h('p',null,'Belum ada model. Impor file .pt untuk mulai.'),
   models.length>0&&label('Model yang diuji',h('select',{'aria-label':'Model yang diuji',value:selected,disabled:busy||loading||testing,onChange:e=>{stopCamera();setSelected(e.target.value)}},models.map(m=>h('option',{key:m.id,value:m.id},`${m.name}${m.trained?'':' · belum siap'}`)))),
   model&&h(React.Fragment,null,
    h('div',{className:'studio-inline'},h('span',null,ready?'Siap diuji':model.importError||'Model belum siap.'),h('span',null,`${model.classes.length} kelas${model.task?' · '+({detect:'Deteksi',segment:'Segmentasi',classify:'Klasifikasi'}[model.task]||model.task):''}`)),
    h('details',{className:'model-class-list'},h('summary',null,'Kelas dalam model'),h('p',null,model.classes.join(', '))),
    h('div',{className:'studio-step'},h('h3',null,'Uji kamera'),
     h('div',{className:'studio-inline'},label('Kamera',h('select',{'aria-label':'Kamera',value:deviceId,disabled:camera||testing,onChange:e=>setDeviceId(e.target.value)},h('option',{value:''},'Kamera default'),cameras.map((d,i)=>h('option',{key:d.deviceId||i,value:d.deviceId},d.label||`Kamera ${i+1}`)))),button(camera?'Matikan kamera':'Nyalakan kamera',camera?stopCamera:startCamera,busy||!ready,true),button(testing?'Hentikan uji':'Uji kamera langsung',testLive,!ready||busy||!camera||!runtime)),
     pipelineReady&&label('Jenis uji',h('select',{value:pipelineTest?'pipeline':'single',disabled:testing,onChange:e=>setPipelineTest(e.target.value==='pipeline')},h('option',{value:'single'},'Model yang dipilih'),h('option',{value:'pipeline'},'Pipeline objek → PET → tutup'))),
     h('div',{className:'studio-camera',style:{aspectRatio:String(aspect)}},h('video',{ref:video,muted:true,playsInline:true,onLoadedMetadata:()=>{if(video.current?.videoWidth)setAspect(video.current.videoWidth/video.current.videoHeight)}}),!camera&&!image&&h('div',{className:'studio-camera-empty'},'Nyalakan kamera untuk melihat dan menguji model.'),image&&h('img',{src:image,alt:'Frame kamera yang telah diproses YOLO'}),image&&h('svg',{viewBox:'0 0 1000 1000',preserveAspectRatio:'none','aria-label':'Hasil deteksi'},predictions.map((b,i)=>h('g',{key:i},h('rect',{x:b.x*1000,y:b.y*1000,width:b.w*1000,height:b.h*1000,fill:'rgba(53,199,140,.10)',stroke:'#33e69b',strokeWidth:4}),h('text',{x:b.x*1000+5,y:Math.max(22,b.y*1000+24),fill:'white',stroke:'#183e2c',strokeWidth:1,fontSize:24},`${b.label} ${Math.round(b.confidence*100)}%`))))),
     testResult&&h('p',{role:'status'},testResult),h('p',null,'Uji kamera hanya menampilkan hasil; motor tidak dijalankan.')),
    h('div',{className:'studio-step'},h('h3',null,'Gunakan dalam siklus'),
     h('div',{className:'production-rule-lists'},
       h('fieldset',{className:'production-class-list',disabled:busy},h('legend',null,'Kelas yang diterima'),model.classes.map((name,i)=>h('label',{key:i},h('input',{type:'checkbox',checked:classIds.includes(i),onChange:e=>{setClassIds(old=>e.target.checked?[...old,i]:old.filter(id=>id!==i));if(e.target.checked)setRejectedIds(old=>old.filter(id=>id!==i));}}),h('span',null,name)))),
       h('fieldset',{className:'production-class-list',disabled:busy},h('legend',null,'Kelas yang ditolak'),model.classes.map((name,i)=>h('label',{key:i},h('input',{type:'checkbox',checked:rejectedIds.includes(i),onChange:e=>{setRejectedIds(old=>e.target.checked?[...old,i]:old.filter(id=>id!==i));if(e.target.checked)setClassIds(old=>old.filter(id=>id!==i));}}),h('span',null,name))))),
     h('div',{className:'studio-inline'},label('Confidence minimum (%)',h('input',{type:'number',min:25,max:100,value:confidence,onChange:e=>setConfidence(e.target.value)})),label('Confidence penolakan minimum (%)',h('input',{type:'number',min:25,max:100,value:rejectConfidence,onChange:e=>setRejectConfidence(e.target.value)})),button('Gunakan untuk siklus',useInCycle,!ready||busy||!classIds.length||!rejectedIds.length||![Number(confidence),Number(rejectConfidence)].every(n=>Number.isFinite(n)&&n>=25&&n<=100))),
     h('p',{role:'status'},configured?`Aktif untuk siklus: ${model.name} · diterima ${classIds.map(id=>model.classes[id]).join(', ')} · ditolak ${rejectedIds.map(id=>model.classes[id]).join(', ')}`:'Pilih botol Aqua/Le Minerale sebagai diterima dan tutup botol sebagai ditolak. Penolakan diprioritaskan. Tanpa botol yang memenuhi confidence minimum, hasil ditolak.'),h('p',null,'Untuk alur tiga model objek → PET → tutup, atur pilihan model dan kelas di Performa.'))
   )
  );
 };
}
