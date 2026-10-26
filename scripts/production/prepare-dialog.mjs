import {productionRules,validateRules} from './production-client.mjs';

// "Siapkan" on Uji komponen (pengujian) and Production: choose USB device, LED, firmware (and CV rules), then install + connect.
// almufti-production-1.1.1 → "Production 1.1.1"; sketches without the app protocol keep their folder name.
export const sketchLabel=s=>{const [,type,version]=(s.version||'').match(/^almufti-(production|diag)-(.+)$/)||[];
  return `${type?`${type==='production'?'Production':'Pengujian'} ${version}`:s.version||s.name}${s.version?'':' · upload saja'}`;};
export function createPrepareButton(React, Modal) {
  const h=React.createElement;
  return function PrepareButton({kind,transport,db,updateDB,notify,serial,ble,telemetry}) {
    const production=kind==='production',label=production?'production':'pengujian';
    const [open,setOpen]=React.useState(false),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[progress,setProgress]=React.useState(null);
    const [ports,setPorts]=React.useState([]),[port,setPort]=React.useState('');
    const [sketches,setSketches]=React.useState([]),[sketch,setSketch]=React.useState('');
    const [bleList,setBleList]=React.useState({token:null,items:[]}),[bleChoice,setBleChoice]=React.useState('');
    const [models,setModels]=React.useState([]),[model,setModel]=React.useState(db.settings.productionSingleModel||''),[rules,setRules]=React.useState(null);
    const [cameras,setCameras]=React.useState([]),[camera,setCamera]=React.useState(db.settings.productionCamera||'');
    const bleRequest=React.useRef(null);
    const chosenModel=models.find(m=>m.id===model),classes=chosenModel?.classes||[];
    React.useEffect(()=>window.rvm?.onDiagnostic?.(setProgress),[]);
    React.useEffect(()=>window.rvm?.devices?.onUpdate(data=>setBleList(old=>data.closed?(old.token===data.token?{token:null,items:[]}:old):{token:data.token,items:data.items||[]})),[]);
    // Preselect the LED DMX controller once the scan finds it.
    React.useEffect(()=>{if(!bleChoice)setBleChoice(bleList.items.find(d=>/^LED[\s_-]*DMX/i.test(d.name))?.id||'');},[bleList]);
    function loadPorts(){window.rvm?.firmware?.ports().then(list=>{setPorts(list);setPort(old=>list.some(p=>p.path===old)?old:(list.find(p=>/silicon labs/i.test(p.name))||list[0])?.path||'');}).catch(e=>setError(e.message));}
    function show() {
      setOpen(true);setError('');setProgress(null);setBleChoice('');setBleList({token:null,items:[]});
      // Web Bluetooth needs this click's user activation: start the scan now, connect on "Siapkan".
      if(!transport.bleConnected){const request=transport.connectBluetooth(db.settings);bleRequest.current=request;request.catch(()=>{});}
      loadPorts();
      window.rvm?.firmware?.sketches().then(list=>{setSketches(list);const preferred=production?'rvm_production':'rvm_diag';setSketch(list.some(s=>s.name===preferred)?preferred:list[0]?.name||'');}).catch(e=>setError(e.message));
      if(production)navigator.mediaDevices?.enumerateDevices().then(list=>setCameras(list.filter(d=>d.kind==='videoinput'))).catch(()=>{});
      if(production)window.rvm?.vision?.list().then(list=>{setModels(list);const m=list.find(m=>m.id===model);setRules(productionRules(db.settings,m?.classes||[]));}).catch(e=>setError(e.message));
    }
    function chooseModel(id){setModel(id);setRules(productionRules({productionConfidence:rules?.confidence,productionRejectConfidence:rules?.rejectConfidence},models.find(m=>m.id===id)?.classes||[]));}
    function cancelBle(){if(bleRequest.current){window.rvm?.cancelBluetoothSelection?.();bleRequest.current=null;}}
    function close(){if(busy)return;cancelBle();setOpen(false);}
    const toggle=(list,id,on)=>on?[...new Set([...list,id])]:list.filter(x=>x!==id);
    async function prepare() {
      setBusy(true);setError('');setProgress(null);
      const problems=[];let uploadOnly=false;
      try {
        if(production){
          if(!chosenModel?.trained||chosenModel.datasetChanged)throw Error('Pilih model CV yang siap dipakai.');
          validateRules(rules);
          await updateDB(old=>({...old,settings:{...old.settings,productionSingleModel:model,productionSingleClasses:rules.accepted,productionRejectedClasses:rules.rejected,productionConfidence:rules.confidence,productionRejectConfidence:rules.rejectConfidence,productionCamera:camera}}));
        }
        if(bleRequest.current){
          const request=bleRequest.current;bleRequest.current=null;
          if(bleChoice&&bleList.token){window.rvm.devices.action({token:bleList.token,action:'select',id:bleChoice});try{await request;}catch(e){problems.push(`LED: ${e.message}`);}}
          else window.rvm?.cancelBluetoothSelection?.();
        }
        if(transport.connected)await transport.disconnectSerial();
        uploadOnly=(await transport.connectSerial(115200,{prepare:sketch,port}))?.connected===false;
      } catch(e) { problems.push(e.message); }
      finally { setBusy(false); }
      if(problems.length){setError(problems.join(' · '));return;}
      notify(uploadOnly?`Firmware ${sketch} terpasang. Sketch ini tidak memakai protokol aplikasi, jadi ESP32 tidak dihubungkan.`:`Mode ${label} siap.`);setOpen(false);
    }
    const field=(text,control)=>h('label',{className:'field'},h('span',null,text),control);
    const classList=(legend,key,other)=>h('fieldset',{className:'production-class-list',disabled:busy},h('legend',null,legend),
      classes.map((name,i)=>h('label',{key:i},h('input',{type:'checkbox',checked:rules[key].includes(i),onChange:e=>setRules(old=>({...old,[key]:toggle(old[key],i,e.target.checked),[other]:e.target.checked?old[other].filter(x=>x!==i):old[other]}))}),h('span',null,name))));
    const current=sketches.find(s=>s.name===sketch);
    return h(React.Fragment,null,
      h('button',{className:'button prepare-button',type:'button',onClick:show},'Siapkan'),
      open&&h(Modal,{title:`Siapkan mode ${label}`,subtitle:`ESP32 sekarang: ${serial?telemetry?.firmware||'terhubung':'belum terhubung'}`,onClose:close},
        h('div',{className:'prepare-form','data-device-inline':''},
          field('Device USB (ESP32)',h('select',{'aria-label':'Device USB',value:port,disabled:busy,onChange:e=>setPort(e.target.value)},
            !ports.length&&h('option',{value:''},'Tidak ada port — sambungkan USB'),ports.map(p=>h('option',{key:p.path,value:p.path},`${p.name} · ${p.path}`)))),
          h('button',{type:'button',className:'button secondary prepare-refresh',disabled:busy,onClick:loadPorts},'Muat ulang port'),
          field('Bluetooth (LED)',ble?h('select',{'aria-label':'Bluetooth',disabled:true},h('option',null,`${transport.bluetooth?.name||'LED'} · terhubung`)):
            h('select',{'aria-label':'Bluetooth',value:bleChoice,disabled:busy,onChange:e=>setBleChoice(e.target.value)},
              h('option',{value:''},bleList.items.length?'Tidak menghubungkan LED':'Mencari perangkat Bluetooth…'),bleList.items.map(d=>h('option',{key:d.id,value:d.id},d.name)))),
          field('Firmware',h('select',{'aria-label':'Firmware',value:sketch,disabled:busy,onChange:e=>setSketch(e.target.value)},
            sketches.map(s=>h('option',{key:s.name,value:s.name},sketchLabel(s))))),
          current&&!current.version&&h('p',{className:'muted prepare-wide'},'Sketch ini tidak memakai protokol aplikasi: firmware di-upload, tetapi ESP32 tidak dihubungkan ke aplikasi.'),
          production&&field('Model CV',h('select',{'aria-label':'Model CV',value:model,disabled:busy,onChange:e=>chooseModel(e.target.value)},
            h('option',{value:''},'Pilih model…'),models.map(m=>h('option',{key:m.id,value:m.id,disabled:!m.trained||m.datasetChanged},`${m.name}${m.trained&&!m.datasetChanged?'':' · belum siap'}`)))),
          production&&field('Kamera inspeksi',h('select',{'aria-label':'Kamera inspeksi',value:camera,disabled:busy,onChange:e=>setCamera(e.target.value)},
            h('option',{value:''},'Kamera default'),cameras.map((d,i)=>h('option',{key:d.deviceId||i,value:d.deviceId},d.label||`Kamera ${i+1}`)))),
          production&&rules&&field('Confidence diterima (%)',h('input',{type:'number',min:10,max:100,value:rules.confidence,disabled:busy,onChange:e=>setRules(old=>({...old,confidence:Number(e.target.value)}))})),
          production&&rules&&field('Confidence ditolak (%)',h('input',{type:'number',min:10,max:100,value:rules.rejectConfidence,disabled:busy,onChange:e=>setRules(old=>({...old,rejectConfidence:Number(e.target.value)}))})),
          production&&rules&&classes.length>0&&h('div',{className:'production-rule-lists prepare-wide'},classList('Kelas yang diterima','accepted','rejected'),classList('Kelas yang ditolak','rejected','accepted'))),
        busy&&h('p',{className:'muted',role:'status'},progress?.message||'Menghubungkan…'),
        busy&&progress?.output&&h('pre',{className:'prepare-output'},progress.output.slice(-600)),
        error&&h('p',{className:'form-error',role:'alert'},error),
        h('button',{className:'button full',type:'button',onClick:prepare,disabled:busy||!sketch||!port||(production&&(!chosenModel||!rules))},busy?'Menyiapkan…':'Siapkan')));
  };
}
