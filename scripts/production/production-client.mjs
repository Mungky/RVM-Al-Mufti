export const PRODUCTION_MODEL = 'apage';
export const DEFAULT_CONFIDENCE = 60;
export function selectedProductionClasses(settings) {
  if(settings.productionSingleClasses!==undefined)
    return Array.isArray(settings.productionSingleClasses)?[...new Set(settings.productionSingleClasses)]:[];
  return Number.isInteger(settings.productionSingleClass)&&settings.productionSingleClass>=0?[settings.productionSingleClass]:[];
}
function validClasses(ids, model) {
  return ids.length>0 && ids.every(id=>Number.isInteger(id)&&id>=0&&!!model?.classes?.[id]);
}
export function selectedRejectedClasses(settings) {
  return Array.isArray(settings.productionRejectedClasses)?[...new Set(settings.productionRejectedClasses)]:[];
}
export function validateClassRules(accepted, rejected, model) {
  if(!validClasses(accepted,model))throw Error('Pilih minimal satu kelas yang diterima untuk model production.');
  if(!validClasses(rejected,model))throw Error('Pilih minimal satu kelas yang ditolak, misalnya tutup botol. Model harus mengenali kelas tersebut.');
  if(accepted.some(id=>rejected.includes(id)))throw Error('Kelas yang sama tidak boleh dipilih sebagai diterima dan ditolak.');
}
export function bottleDecision(boxes, classes, accepted, rejected, confidence=60, rejectConfidence=confidence) {
  if(![confidence,rejectConfidence].every(n=>Number.isFinite(n)&&n>=25&&n<=100))return {accepted:false,reason:'confidence_invalid'};
  if(!accepted?.length||!rejected?.length||accepted.some(id=>rejected.includes(id)))return {accepted:false,reason:'rules_invalid'};
  const rows=Array.isArray(boxes)?boxes.filter(b=>Number.isInteger(b.classId)&&classes[b.classId]&&Number.isFinite(b.confidence)&&b.confidence>=0&&b.confidence<=1):[];
  const denied=rows.filter(b=>rejected.includes(b.classId)&&b.confidence>=rejectConfidence/100);
  if(denied.length)return {accepted:false,reason:'rejected_class',matches:denied};
  const bottles=rows.filter(b=>accepted.includes(b.classId)&&b.confidence>=confidence/100);
  return {accepted:bottles.length>0,reason:bottles.length?'bottle_detected':'bottle_not_detected',matches:bottles};
}
export function acceptsBottle(boxes, classes, percent=DEFAULT_CONFIDENCE) {
  if(!Number.isFinite(percent) || percent<25 || percent>100) return false;
  return Array.isArray(boxes) && boxes.some(box => Number.isInteger(box.classId) &&
    classes[box.classId] && Number.isFinite(box.confidence) &&
    box.confidence>=percent/100 && box.confidence<=1);
}

export const ERROR_MESSAGES = {
  weight_not_positive:'Berat botol nol atau negatif. Tekan Reset untuk menghentikan conveyor dan melakukan zero ulang.',
  weighing_invalid:'Sampel timbangan tidak valid. Tekan Reset untuk mencoba lagi.',
  tare_timeout:'Timbangan belum siap. Periksa koneksi timbangan, lalu tekan Reset.',
  tare_saturated:'Timbangan saturasi. Kosongkan timbangan, lalu tekan Reset.',
  cv_timeout:'Pemeriksaan kamera terlalu lama. Tekan Reset untuk mencoba lagi.',
  operator_stop:'Siklus dihentikan. Tekan Reset untuk melanjutkan.',
  controller_disconnected:'Komunikasi ESP terputus. Hubungkan kembali, lalu tekan Reset.',
  return_ir_timeout:'Botol belum terdeteksi di IR 1 setelah 30 detik. Periksa area pengembalian, lalu tekan Reset.'
};
export function errorMessage(code) { return ERROR_MESSAGES[code] || 'Mesin berhenti. Tekan Reset untuk mencoba lagi.'; }

export class ProductionClient {
  constructor({transport,vision,media=navigator.mediaDevices,document:dom=document,notify=()=>{},log=()=>{},wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
    Object.assign(this,{transport,vision,media,dom,notify,log,wait});
    this.epoch=0; this.active=false; this.stream=null; this.video=null;
    this.model=null; this.pendingCycle=null; this.seen=new Set();
    this.ledApplied=''; this.ledWanted=null; this.ledWriting=false;
    this.ledPattern=''; this.ledTimer=null; this.ledOn=true;
    this.settings={}; this.firmware=''; this.lastFault=''; this.lastStage='';
    this.lastCapCount=0; this.resetOnHome=false; this.restartPromise=null; this.recovering=false;
  }
  frame() {
    const video=this.video;
    if(!video?.videoWidth) throw Error('Gambar kamera inspeksi belum siap.');
    const canvas=this.dom.createElement('canvas');
    const ratio=Math.min(1,1920/Math.max(video.videoWidth,video.videoHeight));
    canvas.width=Math.round(video.videoWidth*ratio); canvas.height=Math.round(video.videoHeight*ratio);
    canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/jpeg',.9);
  }
  async prepare(settings={}) {
    this.settings=settings;
    if(this.configKey===JSON.stringify(settings) && this.stream && this.model && this.cameraId===(settings.productionCamera||'') &&
       this.stream.getVideoTracks().every(t=>t.readyState==='live')) return;
    const epoch=++this.epoch;
    this.closeCamera(); this.model=null;
    if(!this.vision || !this.media?.getUserMedia) throw Error('Runtime YOLO atau kamera belum tersedia.');
    const models=await this.vision.list();
    this.pipeline=settings.productionVisionMode==='pipeline'?settings.productionPipeline:null;
    if(settings.productionVisionMode==='pipeline'&&!this.pipeline)throw Error('Pilih tiga model dan kelas production dahulu.');
    const model=this.pipeline?models.find(m=>m.id===this.pipeline.object?.id):(settings.productionSingleModel?models.find(m=>m.id===settings.productionSingleModel):models.find(m=>m.name.trim().toLowerCase()===PRODUCTION_MODEL));
    if(!model?.trained || !model.classes?.length) throw Error('Model production belum tersedia atau belum siap. Impor model .pt dahulu.');
    if(!this.pipeline) {
      this.acceptedClasses=selectedProductionClasses(settings);
      this.rejectedClasses=selectedRejectedClasses(settings);
      validateClassRules(this.acceptedClasses,this.rejectedClasses,model);
      if(![settings.productionConfidence??60,settings.productionRejectConfidence??settings.productionConfidence??60].every(n=>Number.isFinite(n)&&n>=25&&n<=100))throw Error('Confidence minimum harus 25–100%.');
    }
    if(this.pipeline&&model.task==='classify')throw Error('Model objek untuk crop harus model deteksi.');
    if(this.pipeline)for(const role of ['object','pet','cap']){const cfg=this.pipeline[role],m=models.find(m=>m.id===cfg?.id);if(!m?.trained||m.datasetChanged||!m.classes?.[cfg.classId])throw Error(`Model/kelas ${role} belum siap. Impor model dan pilih kelas dahulu.`);}
    if(model.datasetChanged) throw Error('Model production belum siap. Impor file .pt yang valid.');
    const stream=await this.media.getUserMedia({video:{width:{ideal:1920},height:{ideal:1080},
      ...(settings.productionCamera?{deviceId:{exact:settings.productionCamera}}:{})},audio:false});
    if(epoch!==this.epoch) { stream.getTracks().forEach(t=>t.stop()); throw Error('Persiapan dibatalkan.'); }
    this.stream=stream; this.cameraId=settings.productionCamera||'';
    this.video=this.dom.createElement('video');
    this.video.muted=true; this.video.playsInline=true; this.video.srcObject=stream;
    try {
      await this.video.play();
      if(epoch!==this.epoch) throw Error('Persiapan dibatalkan.');
      // Load the CPU model before the conveyor starts. This prediction earns no points.
      await this.vision.predict({id:model.id,image:this.frame(),...(this.pipeline?{pipeline:{...this.pipeline,confidence:(settings.productionConfidence??DEFAULT_CONFIDENCE)/100}}:{})});
      if(epoch!==this.epoch) throw Error('Persiapan dibatalkan.');
      this.model=model;this.configKey=JSON.stringify(settings); this.log(`Production siap: ${this.pipeline?'objek → PET → tutup':model.name} · ${model.classes.join(', ')}.`);
    } catch(error) { if(epoch===this.epoch) this.closeCamera(); throw error; }
  }
  async start(uid,settings) {
    if(this.restartPromise) await this.restartPromise;
    const ping=await this.transport.command('ping');
    if(!/^almufti-production-1\./.test(ping.firmware||''))
      throw Error('Upload firmware production dahulu melalui Admin → Script.');
    await this.prepare(settings);
    let baseline;
    try { baseline=await this.transport.command('session_start',{uid}); }
    catch(error) { this.disconnect(); throw error; }
    this.lastCapCount=baseline.caps||0; this.active=true; this.seen.clear(); this.pendingCycle=null; this.lastFault=''; this.lastStage=''; this.recovering=false;
    return baseline;
  }
  async rearmRFID() {
    if(this.restartPromise) return this.restartPromise;
    if(!this.active && /^almufti-production-1\./.test(this.firmware)) {
      if(this.resetOnHome) {
        this.restartPromise=this.restartEsp().finally(()=>{this.restartPromise=null;});
        return this.restartPromise;
      }
      await this.transport.command('rfid_arm');
    }
  }
  async restartEsp() {
    this.disconnect(); this.log('Reset ESP32 — kembali ke posisi hitungan awal.');
    await this.transport.command('controller_reset');
    this.resetOnHome=false;
    await this.wait(2200);
    const ready=await this.transport.command('ping');
    if(!/^almufti-production-1\./.test(ready.firmware||'')) throw Error('ESP32 belum siap setelah reset.');
    this.log('ESP32 siap untuk pengguna berikutnya.');
    await this.transport.command('rfid_arm');
  }
  async reset(settings) {
    this.active=false; this.epoch++; this.pendingCycle=null;
    this.recovering=true;
    let applied=false, preparing;
    try {
      const result=await this.transport.command('session_reset');
      applied=true;
      // Stop/zero hardware immediately, before any slow camera/model preparation.
      preparing=this.prepare(settings); this.resetPreparation=preparing;
      const epoch=this.epoch;
      await preparing;
      if(epoch!==this.epoch) throw Error('Reset dibatalkan.');
      this.lastCapCount=result.caps||0; this.active=true; this.seen.clear(); this.lastFault=''; this.lastStage='';
      this.log('Reset siklus — conveyor berhenti, relay 1 ON, relay 2 OFF, LED hijau berkedip, zero ulang. Total setoran dipertahankan.');
      return result;
    } catch(error) {
      this.recovering=false; this.disconnect();
      if(applied) await this.transport.command('motor_stop').catch(()=>{});
      throw error;
    } finally { if(this.resetPreparation===preparing) this.resetPreparation=null; }
  }
  async stop() {
    // Discard late inference even when the stop ACK fails; firmware lease still protects hardware.
    this.active=false; this.epoch++; this.pendingCycle=null;
    try { const result=await this.transport.command('session_stop'); this.resetOnHome=true; this.log('Sesi selesai — total setoran disimpan.'); return result; }
    finally { this.closeCamera(); this.model=null; this.vision?.stopTest().catch(()=>{}); }
  }
  closeCamera() {
    this.stream?.getTracks().forEach(t=>t.stop()); this.stream=null;
    if(this.video) { this.video.srcObject=null; this.video=null; }
  }
  disconnect() {
    this.active=false; this.epoch++; this.pendingCycle=null; this.closeCamera(); this.model=null;
    this.vision?.stopTest().catch(()=>{});
  }
  observe(event,settings) {
    this.settings=settings||this.settings;
    if(event.type==='serial' && !event.connected) { this.setLedTarget(null); this.disconnect(); this.firmware=''; return; }
    if(event.type==='ble') { this.ledApplied=''; if(event.connected) this.flushLed(); return; }
    if(event.type==='production') { this.reportStage(event.state,event.cycleId,event.error,event.rejectionReason); return; }
    if(event.type==='telemetry') {
      this.firmware=event.firmware||this.firmware;
      if(!/^almufti-production-1\./.test(this.firmware)) { this.setLedTarget(null); this.ledApplied=''; return; }
      this.reportStage(event.productionState,event.cycleId,event.productionError,event.rejectionReason);
      if(this.active && Number.isInteger(event.caps) && event.caps>this.lastCapCount){this.log(`Tutup botol terhitung dari IR 3 — total ${event.caps}.`);this.lastCapCount=event.caps;}
      if(event.ledColor && Number.isFinite(event.ledBrightness)) {
        this.setLedTarget({mode:event.ledMode==='blink'?'blink':'solid',color:event.ledColor,brightness:event.ledBrightness});
      }
      if(event.productionState==='fault' && event.productionError!==this.lastFault) {
        this.lastFault=event.productionError; this.recovering=false; this.disconnect();
        // The counting screen shows the persistent, human-readable fault beside Reset.
      }
      return;
    }
    if(event.type==='inspection_request') {
      if(this.resetPreparation) this.resetPreparation.then(()=>{if(this.active)this.inspect(event);}).catch(()=>{});
      else if(this.active) this.inspect(event);
    }
  }
  reportStage(state,cycle,error,reason) {
    if(!state) return;
    this.controllerState=state; this.controllerCycle=cycle;
    const key=`${cycle??''}:${state}`;
    if(this.lastStage===key) return;
    this.lastStage=key;
    const messages={
      taring:'Zero timbangan — mengambil sampel baru.',
      await_bottle:'Siap menerima botol berikutnya.',
      intake:'Conveyor reverse — botol menuju inspeksi.',
      inspection:'Conveyor berhenti — CV dan penimbangan 2 detik.',
      entry:'Memeriksa botol…',
      weigh_base:'Memeriksa botol…',
      accept_move:'Botol diterima — Conveyor reverse 20000 step; relay 2 aktif 20 detik, LED kuning berkedip. Tunggu sebelum memasukkan botol berikutnya.',
      confirm_drop:'Memastikan botol masuk…',
      safety_pause:'Jauhkan tangan dari lubang botol.',
      return_bottle:`Silakan ambil botol Anda.${reason==='weight_out_of_range'?' Jenis botol tidak dikenali.':''}${['weight_changed','safety_weight_changed'].includes(reason)?' Terdeteksi benda tambahan, masukkan satu per satu.':''}${reason==='not_dropped'?' Botol tidak masuk, silakan coba lagi.':''}`,
      wait_removal:`Silakan ambil botol Anda.${reason==='weight_out_of_range'?' Jenis botol tidak dikenali.':''}${['weight_changed','safety_weight_changed'].includes(reason)?' Terdeteksi benda tambahan, masukkan satu per satu.':''}${reason==='not_dropped'?' Botol tidak masuk, silakan coba lagi.':''}`,
      check_empty:'Memastikan conveyor kosong…',
      rearm:'Conveyor berhenti — menunggu area masuk kosong.',
      fault:errorMessage(error)
    };
    if(messages[state]) this.log(messages[state]);
    if(state==='await_bottle') this.recovering=false;
  }
  async inspect(event) {
    if(!Number.isInteger(event.cycleId) || this.seen.has(event.cycleId) || this.pendingCycle!==null) return;
    const epoch=this.epoch, id=event.cycleId;
    this.seen.add(id); this.pendingCycle=id;
    try {
      const result=await this.vision.predict({id:this.model.id,image:this.frame(),timeoutMs:0,...(this.pipeline?{pipeline:{...this.pipeline,confidence:(this.settings.productionConfidence??DEFAULT_CONFIDENCE)/100}}:{})});
      if(epoch!==this.epoch || !this.active) return;
      if(this.controllerCycle===id && !['inspection','safety_pause'].includes(this.controllerState)) return;
      const confidence=this.settings.productionConfidence??DEFAULT_CONFIDENCE;
      const decision=this.pipeline?{accepted:result.accepted===true,reason:'pipeline'}:bottleDecision(result.boxes,this.model.classes,this.acceptedClasses,this.rejectedClasses,confidence,this.settings.productionRejectConfidence??confidence);
      const accepted=decision.accepted;
      await this.transport.command('cv_result',{cycleId:id,accepted});
      const reason=({rejected_class:'kelas ditolak terdeteksi (tutup)',bottle_not_detected:'botol tidak terdeteksi pada confidence minimum',bottle_detected:'botol terdeteksi tanpa kelas penolakan',confidence_invalid:'confidence tidak valid'})[decision.reason]||'pipeline PET + tutup';
      const detections=Array.isArray(result.boxes)?result.boxes.filter(b=>this.model.classes[b.classId]&&Number.isFinite(b.confidence)).map(b=>`${this.model.classes[b.classId]} ${Math.round(b.confidence*100)}%`).join(', '):'';
      this.log(`Hasil CV botol ${id}: ${accepted?'DITERIMA':'DITOLAK'} — ${reason} · ${this.model.name} · minimum botol ${confidence}%, penolakan ${this.settings.productionRejectConfidence??confidence}% · ${detections||'hasil kosong'}.`);
    } catch(error) {
      if(epoch!==this.epoch || !this.active) return;
      // Weight rejection may already have returned the bottle before inference finishes.
      if(/Hasil CV tidak valid \/ ID botol kedaluwarsa/.test(error.message)) return;
      this.notify(`CV gagal: ${error.message}. Sesi dihentikan.`); this.log(`CV gagal: ${error.message}`);
      // A camera/runtime error is not a visual rejection. Stop, never credit guessed results.
      this.active=false; this.epoch++; this.closeCamera(); this.model=null;
      await this.transport.command('motor_stop').catch(()=>{});
    } finally { if(this.pendingCycle===id) this.pendingCycle=null; }
  }
  setLedTarget(target) {
    const key=JSON.stringify(target);
    if(this.ledPattern===key) return;
    if(this.ledTimer) clearInterval(this.ledTimer);
    this.ledTimer=null; this.ledPattern=key; this.ledOn=true;
    if(!target) { this.ledWanted=null; return; }
    const apply=()=>{
      this.ledWanted={mode:'solid',color:target.color,brightness:this.ledOn?target.brightness:0,speed:50};
      this.flushLed();
    };
    apply();
    if(target.mode==='blink') {
      this.ledTimer=setInterval(()=>{this.ledOn=!this.ledOn;apply();},500);
      this.ledTimer.unref?.();
    }
  }
  async flushLed() {
    if(this.ledWriting || !this.transport.bleConnected || !this.ledWanted) return;
    const target={...this.ledWanted}, key=JSON.stringify(target);
    if(this.ledApplied===key) return;
    this.ledWriting=true;
    let success=false;
    try { await this.transport.led(this.settings,target); this.ledApplied=key; success=true; }
    catch(error) { this.log(`LED: ${error.message}`); }
    finally {
      this.ledWriting=false;
      if(success && JSON.stringify(this.ledWanted)!==key) this.flushLed();
    }
  }
}

export function createProductionSettings(React) {
  const h=React.createElement;
  return function ProductionSettings({db,updateDB,notify,serial,telemetry}) {
    const [cameras,setCameras]=React.useState([]),[camera,setCamera]=React.useState(db.settings.productionCamera||'');
    const [confidence,setConfidence]=React.useState(db.settings.productionConfidence??DEFAULT_CONFIDENCE);
    const [rejectConfidence,setRejectConfidence]=React.useState(db.settings.productionRejectConfidence??db.settings.productionConfidence??DEFAULT_CONFIDENCE),[rejectedClasses,setRejectedClasses]=React.useState(()=>selectedRejectedClasses(db.settings));
    const [mode,setMode]=React.useState(db.settings.productionVisionMode||'single'),[models,setModels]=React.useState([]);
    const [singleModel,setSingleModel]=React.useState(db.settings.productionSingleModel||''),[singleClasses,setSingleClasses]=React.useState(()=>selectedProductionClasses(db.settings));
    const [pipeline,setPipeline]=React.useState(db.settings.productionPipeline||{object:{id:'',classId:-1},pet:{id:'',classId:-1},cap:{id:'',classId:-1},requireNoCap:true});
    const [busy,setBusy]=React.useState(false);
    React.useEffect(()=>{window.rvm?.vision?.list().then(items=>{setModels(items);if(!db.settings.productionSingleModel){const legacy=items.find(m=>m.name.trim().toLowerCase()===PRODUCTION_MODEL);if(legacy){setSingleModel(legacy.id);if(legacy.classes.length===1&&db.settings.productionSingleClasses===undefined)setSingleClasses([0]);}}}).catch(()=>{});},[]);
    React.useEffect(()=>{navigator.mediaDevices?.enumerateDevices().then(devices=>setCameras(devices.filter(d=>d.kind==='videoinput'))).catch(()=>{});},[]);
    async function save() {
      setBusy(true);
      try { if(mode==='single'){const m=models.find(m=>m.id===singleModel);if(!m?.trained||m.datasetChanged)throw Error('Pilih model siap pakai.');validateClassRules(singleClasses,rejectedClasses,m);}if(mode==='pipeline')for(const role of ['object','pet','cap']){const cfg=pipeline[role],m=models.find(m=>m.id===cfg.id);if(!m?.trained||m.datasetChanged||!m.classes?.[cfg.classId])throw Error(`Pilih model ${role} yang siap pakai dan kelas yang cocok.`);}await updateDB(old=>({...old,settings:{...old.settings,productionCamera:camera,productionConfidence:Number(confidence),productionRejectConfidence:Number(rejectConfidence),productionRejectedClasses:rejectedClasses,productionVisionMode:mode,productionSingleModel:singleModel,productionSingleClasses:singleClasses,productionSingleClass:singleClasses[0]??-1,productionPipeline:{...pipeline,requireNoCap:true}}})); notify('Pengaturan production disimpan.'); }
      catch(e) { notify(e.message); } finally { setBusy(false); }
    }
    return h('section',{className:'card production-settings'},
      h('div',{className:'card-heading'},h('div',null,h('h3',null,'Production'),h('p',null,'Pilihan CV production · kelas diterima · kartu terdaftar'))),
      h('p',null,serial?`ESP32: ${telemetry.firmware||'terhubung'}`:'Hubungkan ESP32 dan LED melalui tombol di atas.'),
      h('div',{className:'production-fields'},
        h('label',{className:'field'},h('span',null,'Kamera inspeksi'),h('select',{value:camera,onChange:e=>setCamera(e.target.value)},
          h('option',{value:''},'Kamera default'),cameras.map((device,i)=>h('option',{key:device.deviceId||i,value:device.deviceId},device.label||`Kamera ${i+1}`)))),
        h('label',{className:'field'},h('span',null,'Confidence minimum (%)'),h('input',{type:'number',min:25,max:100,value:confidence,onChange:e=>setConfidence(e.target.value)}))),
      h('label',{className:'field'},h('span',null,'Alur CV'),h('select',{'aria-label':'Alur CV',value:mode,onChange:e=>setMode(e.target.value)},h('option',{value:'single'},'Satu model (pilih model sendiri)'),h('option',{value:'pipeline'},'Tiga model: objek → PET → tutup'))),
      mode==='single'&&h('div',{className:'production-fields'},
        h('label',{className:'field'},h('span',null,'Model production'),h('select',{'aria-label':'Model production',value:singleModel,onChange:e=>{setSingleModel(e.target.value);setSingleClasses([]);setRejectedClasses([]);}},h('option',{value:''},'Pilih model…'),models.map(m=>h('option',{key:m.id,value:m.id,disabled:!m.trained||m.datasetChanged},`${m.name}${m.trained&&!m.datasetChanged?'':' · belum siap'}`)))),
        h('div',{className:'production-rule-lists'},
          h('fieldset',{className:'production-class-list'},h('legend',null,'Kelas yang diterima'),
            models.find(m=>m.id===singleModel)?.classes.map((name,i)=>h('label',{key:i},h('input',{type:'checkbox',checked:singleClasses.includes(i),onChange:e=>{setSingleClasses(old=>e.target.checked?[...old,i]:old.filter(id=>id!==i));if(e.target.checked)setRejectedClasses(old=>old.filter(id=>id!==i));}}),h('span',null,name)))),
          h('fieldset',{className:'production-class-list'},h('legend',null,'Kelas yang ditolak'),
            models.find(m=>m.id===singleModel)?.classes.map((name,i)=>h('label',{key:i},h('input',{type:'checkbox',checked:rejectedClasses.includes(i),onChange:e=>{setRejectedClasses(old=>e.target.checked?[...old,i]:old.filter(id=>id!==i));if(e.target.checked)setSingleClasses(old=>old.filter(id=>id!==i));}}),h('span',null,name)))))),
      mode==='single'&&h('label',{className:'field'},h('span',null,'Confidence penolakan minimum (%)'),h('input',{type:'number',min:25,max:100,value:rejectConfidence,onChange:e=>setRejectConfidence(e.target.value)})),
      mode==='single'&&h('p',{className:'muted'},'Pilih Aqua/Le Minerale sebagai diterima dan tutup botol sebagai ditolak. Kelas ditolak diprioritaskan meskipun botol terdeteksi. Tanpa botol yang memenuhi confidence minimum, hasil ditolak. Kelas tutup di bawah ambang penolakan belum dianggap terdeteksi.'),
      mode==='pipeline'&&h('div',{className:'studio-step'},
        ['object','pet','cap'].map(role=>{
          const cfg=pipeline[role],model=models.find(m=>m.id===cfg.id);
          return h('div',{className:'studio-inline',key:role},
            h('label',{className:'field'},h('span',null,({object:'Deteksi objek untuk crop',pet:'Identifikasi PET',cap:'Kondisi tutup'})[role]),
              h('select',{'aria-label':({object:'Model objek',pet:'Model PET',cap:'Model kondisi tutup'})[role],value:cfg.id,onChange:e=>setPipeline(old=>({...old,[role]:{id:e.target.value,classId:-1}}))},h('option',{value:''},'Pilih model…'),models.map(m=>h('option',{key:m.id,value:m.id},`${m.name}${m.trained&&!m.datasetChanged?'':' · belum siap'}`)))),
            h('label',{className:'field'},h('span',null,role==='cap'?'Kelas TANPA TUTUP':'Kelas yang dianggap cocok'),
              h('select',{'aria-label':({object:'Kelas objek',pet:'Kelas PET',cap:'Kelas tanpa tutup'})[role],value:cfg.classId,onChange:e=>setPipeline(old=>({...old,[role]:{...old[role],classId:Number(e.target.value)}}))},h('option',{value:-1},'Pilih kelas…'),model?.classes.map((name,i)=>h('option',{key:i,value:i},name)))));
        }),h('p',null,'Aturan: hanya PET tanpa tutup diterima. Untuk model kondisi tutup, impor model yang mengenali tanpa tutup dan dengan tutup pada crop botol. Pilih kelas tanpa tutup sebagai kelas yang diterima. Hasil kosong ditolak.')),
      h('button',{className:'button',type:'button',onClick:save,disabled:busy||!Number.isFinite(Number(confidence))||Number(confidence)<25||Number(confidence)>100||(mode==='single'&&(!Number.isFinite(Number(rejectConfidence))||Number(rejectConfidence)<25||Number(rejectConfidence)>100))},'Simpan pengaturan production'),
      h('p',{className:'muted'},'Kembali ke layar utama lalu scan kartu. Kamera dan model disiapkan sebelum sesi dimulai.'));
  };
}


export function createSessionTools(React) {
  const h=React.createElement;
  return function SessionTools({client,telemetry,settings,logs,serial,notify,onBusy}) {
    const [busy,setBusy]=React.useState(false);
    const fault=telemetry.productionState==='fault';
    async function reset() {
      if(busy) return;
      setBusy(true); onBusy(true);
      try { await client.reset(settings); notify(''); }
      catch(error) { notify(error.message); }
      finally { setBusy(false); onBusy(false); }
    }
    return h('section',{className:'session-tools'},
      h('div',{className:'session-recovery'},
        h('p',{role:fault?'alert':undefined},fault?errorMessage(telemetry.productionError):'Reset: conveyor berhenti, relay 1 ON, relay 2 OFF, LED hijau berkedip, dan zero timbangan.'),
        h('button',{type:'button',className:'button secondary',onClick:reset,disabled:busy||client.recovering||!serial},busy?'Menyiapkan Reset…':'Reset')),
      h('div',{className:'session-log',role:'log','aria-label':'Log aktivitas mesin','aria-live':'polite'},
        logs.length?h('ol',null,logs.slice(0,16).map((line,index)=>h('li',{key:index},line))):h('p',null,'Menunggu aktivitas mesin…')));
  };
}
