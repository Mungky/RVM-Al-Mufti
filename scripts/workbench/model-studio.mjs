import {cvDecision,productionRules,REASONS} from './production-client.mjs';

export function createModelStudio(React) {
 const h=React.createElement;
 return function ModelStudio({notify=()=>{},db}) {
  const api=window.rvm?.vision;
  const [models,setModels]=React.useState([]),[selected,setSelected]=React.useState(''),[busy,setBusy]=React.useState(false),[loading,setLoading]=React.useState(true);
  const [runtime,setRuntime]=React.useState(false),[error,setError]=React.useState(''),[status,setStatus]=React.useState('Membaca model…');
  const [camera,setCamera]=React.useState(false),[cameras,setCameras]=React.useState([]),[deviceId,setDeviceId]=React.useState(db.settings.productionCamera||'');
  const [image,setImage]=React.useState(''),[predictions,setPredictions]=React.useState([]),[aspect,setAspect]=React.useState(4/3),[testResult,setTestResult]=React.useState('');
  const video=React.useRef(null),stream=React.useRef(null),alive=React.useRef(true);
  const model=models.find(m=>m.id===selected),ready=!!model?.trained&&!!model.classes?.length&&!model.datasetChanged;
  async function refresh(preferred){
   if(!api){setLoading(false);return}
   const [items,state]=await Promise.all([api.list(),api.status()]);if(!alive.current)return;
   setModels(items);setRuntime(state.runtimeReady);setSelected(old=>preferred||old||items.find(m=>m.id===db.settings.productionSingleModel)?.id||items[0]?.id||'');setLoading(false);
  }
  async function action(fn){setBusy(true);setError('');try{return await fn()}catch(e){if(alive.current){setError(e.message);notify(e.message)}}finally{if(alive.current)setBusy(false)}}
  function stopCamera(){stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;setCamera(false);}
  React.useEffect(()=>{alive.current=true;refresh().catch(e=>{setError(e.message);setLoading(false)});const off=api?.onEvent(s=>{setStatus(s.message);});navigator.mediaDevices?.enumerateDevices().then(d=>{if(alive.current)setCameras(d.filter(c=>c.kind==='videoinput'))}).catch(()=>{});return()=>{alive.current=false;stream.current?.getTracks().forEach(t=>t.stop());off?.()}},[]);
  React.useEffect(()=>{if(camera&&video.current&&stream.current){video.current.srcObject=stream.current;video.current.play().catch(e=>setError(e.message))}},[camera]);
  React.useEffect(()=>{setImage('');setPredictions([]);setTestResult('');},[selected]);
  async function importModel(){await action(async()=>{stopCamera();const meta=await api.importModel();if(!meta)return;await refresh(meta.id);setStatus('Model siap diuji. Pilih untuk production lewat Production → Siapkan.');notify('Model berhasil diimpor. Kelas dibaca dari file .pt.');})}
  async function startCamera(){await action(async()=>{
   stopCamera();if(!navigator.mediaDevices?.getUserMedia)throw Error('Akses kamera tidak tersedia.');
   const media=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1920},height:{ideal:1080},...(deviceId?{deviceId:{exact:deviceId}}:{})},audio:false});
   if(!alive.current){media.getTracks().forEach(t=>t.stop());return}stream.current=media;setImage('');setPredictions([]);setCamera(true);
   setCameras((await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput'));
  })}
  function frame(){const v=video.current;if(!v?.videoWidth)throw Error('Tunggu gambar kamera muncul.');const canvas=document.createElement('canvas');const ratio=Math.min(1,1920/Math.max(v.videoWidth,v.videoHeight));canvas.width=Math.round(v.videoWidth*ratio);canvas.height=Math.round(v.videoHeight*ratio);canvas.getContext('2d').drawImage(v,0,0,canvas.width,canvas.height);setAspect(canvas.width/canvas.height);return canvas.toDataURL('image/jpeg',.9)}
  // Same single-photo rule as production, so the operator sees exactly what the machine would decide.
  async function testPhoto(){await action(async()=>{
   setTestResult('Memproses 1 foto…');const photo=frame();const result=await api.predict({id:selected,image:photo});if(!alive.current)return;
   const d=cvDecision(result.boxes,model.classes,productionRules(model.id===db.settings.productionSingleModel?db.settings:{},model.classes));setImage(photo);setPredictions(result.boxes);
   setTestResult(`CV: ${d.accepted?'DITERIMA':'DITOLAK'} · ${REASONS[d.reason]} · ${result.boxes.length} deteksi`);
  })}
  const button=(text,fn,disabled=false,secondary=false)=>h('button',{type:'button',className:'button'+(secondary?' secondary':''),onClick:fn,disabled},text);
  const label=(text,element)=>h('label',{className:'studio-field'},h('span',null,text),element);
  return h('section',{className:'model-studio'},
   h('div',{className:'studio-intro'},h('h2',null,'Model YOLO'),h('p',null,'Impor model PyTorch (.pt) dan uji dengan 1 foto. Model production dipilih di Production → Siapkan.')),
   !api&&h('p',{className:'studio-error',role:'alert'},'Impor dan pengujian model tersedia di aplikasi desktop.'),
   error&&h('p',{className:'studio-error',role:'alert'},error),
   api&&!runtime&&!loading&&h('p',{className:'studio-error'},'Runtime YOLO belum tersedia. Jalankan setup-vision-tools.sh.'),
   h('div',{className:'studio-inline'},button(busy?'Memproses…':'Impor model .pt',importModel,!api||busy||loading||!runtime),h('span',null,'YOLO PyTorch · maks. 500 MB · kelas dibaca otomatis')),
   (loading||busy)&&h('p',{role:'status'},status),
   !loading&&!models.length&&h('p',null,'Belum ada model. Impor file .pt untuk mulai.'),
   models.length>0&&label('Model yang diuji',h('select',{'aria-label':'Model yang diuji',value:selected,disabled:busy||loading,onChange:e=>setSelected(e.target.value)},models.map(m=>h('option',{key:m.id,value:m.id},`${m.name}${m.trained?'':' · belum siap'}`)))),
   model&&h(React.Fragment,null,
    h('div',{className:'studio-inline'},h('span',null,ready?'Siap diuji':model.importError||'Model belum siap.'),h('span',null,`${model.classes.length} kelas${model.task?' · '+({detect:'Deteksi',segment:'Segmentasi',classify:'Klasifikasi'}[model.task]||model.task):''}`)),
    h('details',{className:'model-class-list'},h('summary',null,'Kelas dalam model'),h('p',null,model.classes.join(', '))),
    h('div',{className:'studio-step'},h('h3',null,'Uji 1 foto'),
     h('div',{className:'studio-inline'},label('Kamera',h('select',{'aria-label':'Kamera',value:deviceId,disabled:camera,onChange:e=>setDeviceId(e.target.value)},h('option',{value:''},'Kamera default'),cameras.map((d,i)=>h('option',{key:d.deviceId||i,value:d.deviceId},d.label||`Kamera ${i+1}`)))),button(camera?'Matikan kamera':'Nyalakan kamera',camera?stopCamera:startCamera,busy||!ready,true),button('Ambil foto & uji',testPhoto,!ready||busy||!camera||!runtime)),
     h('div',{className:'studio-camera',style:{aspectRatio:String(aspect)}},h('video',{ref:video,muted:true,playsInline:true,onLoadedMetadata:()=>{if(video.current?.videoWidth)setAspect(video.current.videoWidth/video.current.videoHeight)}}),!camera&&!image&&h('div',{className:'studio-camera-empty'},'Nyalakan kamera untuk menguji model.'),image&&h('img',{src:image,alt:'Foto yang telah diproses YOLO'}),image&&h('svg',{viewBox:'0 0 1000 1000',preserveAspectRatio:'none','aria-label':'Hasil deteksi'},predictions.map((b,i)=>{const color=/tutup/i.test(b.label)?'#e5484d':'#33e69b';return h('g',{key:i},h('rect',{x:b.x*1000,y:b.y*1000,width:b.w*1000,height:b.h*1000,fill:'none',stroke:color,strokeWidth:4}),h('text',{x:b.x*1000+5,y:Math.max(22,b.y*1000+24),fill:'white',stroke:'#183e2c',strokeWidth:1,fontSize:24},`${b.label} ${Math.round(b.confidence*100)}%`))}))),
     testResult&&h('p',{role:'status'},testResult),h('p',null,'Uji foto hanya menampilkan hasil; motor tidak dijalankan.')))
  );
 };
}
