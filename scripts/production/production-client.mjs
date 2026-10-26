// One photo per bottle. Sizes match firmware 1.1.1: 1 = Aqua 330ml (9–12 g), 2 = Le Minerale 600ml (15–18 g).
const SIZES=[[/aqua/i,1],[/le\s*minerale/i,2]];
const sizeOf=name=>SIZES.find(([pattern])=>pattern.test(name||''))?.[1]||0;
export const REASONS={
  accepted:'kelas diterima dikenali',rejected:'kelas ditolak terdeteksi',multiple:'lebih dari satu objek',
  none:'botol tidak terdeteksi',unknown:'bukan kelas yang diterima',low_confidence:'confidence di bawah minimum',error:'pemeriksaan kamera gagal'
};
// Popup "Siapkan" rules; defaults: Aqua/Le Minerale accepted at 70%, caps rejected from 40%.
export function productionRules(settings={}, classes=[]) {
  const pick=(value,fallback)=>Array.isArray(value)?[...new Set(value)].filter(id=>Number.isInteger(id)&&classes[id]):classes.map((n,i)=>fallback(n)?i:-1).filter(i=>i>=0);
  return {
    accepted:pick(settings.productionSingleClasses,n=>sizeOf(n)>0),
    rejected:pick(settings.productionRejectedClasses,n=>/tutup/i.test(n)),
    confidence:Number(settings.productionConfidence??70),
    rejectConfidence:Number(settings.productionRejectConfidence??40)
  };
}
export function validateRules(rules) {
  if(!rules.accepted.length) throw Error('Pilih minimal satu kelas yang diterima.');
  if(rules.accepted.some(id=>rules.rejected.includes(id))) throw Error('Kelas yang sama tidak boleh diterima dan ditolak.');
  if(![rules.confidence,rules.rejectConfidence].every(n=>Number.isFinite(n)&&n>=10&&n<=100)) throw Error('Confidence harus 10–100%.');
}
// A rejected class (e.g. cap) at its threshold rejects; otherwise exactly one object, an accepted class at its threshold.
export function cvDecision(boxes, classes, rules=productionRules({},classes)) {
  const minimum=Math.min(rules.confidence,rules.rejectConfidence)/100;
  const rows=(Array.isArray(boxes)?boxes:[]).filter(b=>Number.isInteger(b.classId)&&classes[b.classId]&&Number.isFinite(b.confidence)&&b.confidence>=minimum&&b.confidence<=1);
  if(rows.some(b=>rules.rejected.includes(b.classId)&&b.confidence>=rules.rejectConfidence/100)) return {accepted:false,reason:'rejected',size:0};
  if(rows.length>1) return {accepted:false,reason:'multiple',size:0};
  if(!rows.length) return {accepted:false,reason:'none',size:0};
  if(!rules.accepted.includes(rows[0].classId)) return {accepted:false,reason:'unknown',size:0};
  if(rows[0].confidence<rules.confidence/100) return {accepted:false,reason:'low_confidence',size:0};
  return {accepted:true,reason:'accepted',size:sizeOf(classes[rows[0].classId])};
}
const isRejected=(shot,box)=>shot.rules?.rejected.includes(box.classId);

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
  constructor({transport,vision,media=navigator.mediaDevices,document:dom=document,notify=()=>{},log=()=>{},wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),ImageCaptureClass=globalThis.ImageCapture}) {
    Object.assign(this,{transport,vision,media,dom,notify,log,wait,ImageCaptureClass});
    this.epoch=0; this.active=false; this.stream=null; this.video=null;
    this.model=null; this.pendingCycle=null; this.seen=new Set(); this.preparing=null; this.lastInspection=null;
    this.ledApplied=''; this.ledWanted=null; this.ledWriting=false;
    this.ledPattern=''; this.ledTimer=null; this.ledOn=true;
    this.settings={}; this.firmware=''; this.lastFault=''; this.lastStage='';
    this.lastCapCount=0; this.recovering=false;
  }
  async frame() {
    let source=this.video, bitmap=null;
    // A <video> that is not in the page can stop updating; grab straight from the camera track.
    const track=this.stream?.getVideoTracks()[0];
    if(track && this.ImageCaptureClass) { try { bitmap=await new this.ImageCaptureClass(track).grabFrame(); source=bitmap; } catch {} }
    const width=bitmap?.width||source?.videoWidth, height=bitmap?.height||source?.videoHeight;
    if(!width) throw Error('Gambar kamera inspeksi belum siap.');
    const canvas=this.dom.createElement('canvas');
    const ratio=Math.min(1,1920/Math.max(width,height));
    canvas.width=Math.round(width*ratio); canvas.height=Math.round(height*ratio);
    canvas.getContext('2d').drawImage(source,0,0,canvas.width,canvas.height);
    bitmap?.close?.();
    return canvas.toDataURL('image/jpeg',.9);
  }
  // Camera and YOLO stay open between sessions; returns true when it had to (re)open them.
  async prepare(settings={}) {
    this.settings=settings;
    const key=JSON.stringify([settings.productionSingleModel||'',settings.productionCamera||'']);
    if(this.preparing?.key===key) return this.preparing.promise;
    if(this.configKey===key && this.stream && this.model && this.stream.getVideoTracks().every(t=>t.readyState==='live')) return false;
    const promise=this.open(settings,key);
    this.preparing={key,promise};
    try { return await promise; } finally { if(this.preparing?.promise===promise) this.preparing=null; }
  }
  async open(settings,key) {
    const epoch=++this.epoch;
    this.closeCamera(); this.model=null; this.configKey='';
    if(!this.vision || !this.media?.getUserMedia) throw Error('Runtime YOLO atau kamera belum tersedia.');
    const model=(await this.vision.list()).find(m=>m.id===settings.productionSingleModel);
    if(!model?.trained || !model.classes?.length || model.datasetChanged) throw Error('Model production belum tersedia atau belum siap. Pilih model CV lewat Admin → Production → Siapkan.');
    validateRules(productionRules(settings,model.classes));
    const stream=await this.media.getUserMedia({video:{width:{ideal:1920},height:{ideal:1080},
      ...(settings.productionCamera?{deviceId:{exact:settings.productionCamera}}:{})},audio:false});
    if(epoch!==this.epoch) { stream.getTracks().forEach(t=>t.stop()); throw Error('Persiapan dibatalkan.'); }
    this.stream=stream;
    this.video=this.dom.createElement('video');
    this.video.muted=true; this.video.playsInline=true; this.video.srcObject=stream;
    try {
      await this.video.play();
      if(epoch!==this.epoch) throw Error('Persiapan dibatalkan.');
      // Load the CPU model before the conveyor starts. This prediction earns no points.
      await this.vision.predict({id:model.id,image:await this.frame()});
      if(epoch!==this.epoch) throw Error('Persiapan dibatalkan.');
      this.model=model; this.configKey=key; this.log(`Kamera & model siap: ${model.name} · ${model.classes.join(', ')}.`);
      return true;
    } catch(error) { if(epoch===this.epoch) this.closeCamera(); throw error; }
  }
  // Home screen / app start: keep camera and YOLO hot; respawns YOLO if something else stopped it.
  async warm(settings) {
    if(this.active || !settings?.productionSingleModel) return;
    if(!await this.prepare(settings) && !this.active) await this.vision.predict({id:this.model.id,image:await this.frame()});
  }
  async start(uid,settings) {
    const t0=Date.now(),laps=[],lap=name=>laps.push(`${name} ${Date.now()-t0}`);
    const ping=await this.transport.command('ping'); lap('ping');
    if(!/^almufti-production-1\./.test(ping.firmware||''))
      throw Error('Siapkan mode production dahulu lewat Admin → Production → Siapkan.');
    await this.prepare(settings); lap('kamera+model');
    let baseline;
    try { baseline=await this.transport.command('session_start',{uid}); lap('session_start'); }
    catch(error) { this.disconnect(); throw error; }
    this.log(`Waktu siap ${Date.now()-t0} ms (kumulatif: ${laps.join(' · ')} ms).`);
    this.lastCapCount=baseline.caps||0; this.active=true; this.seen.clear(); this.pendingCycle=null; this.lastFault=''; this.lastStage=''; this.recovering=false; this.lastInspection=null;
    return baseline;
  }
  async rearmRFID() {
    if(!this.active && /^almufti-production-1\./.test(this.firmware)) await this.transport.command('rfid_arm');
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
    const result=await this.transport.command('session_stop'); this.log('Sesi selesai — total setoran disimpan.'); return result;
  }
  closeCamera() {
    this.stream?.getTracks().forEach(t=>t.stop()); this.stream=null;
    if(this.video) { this.video.srcObject=null; this.video=null; }
  }
  disconnect() {
    this.active=false; this.epoch++; this.pendingCycle=null;
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
    const returned=`Silakan ambil botol Anda.${({
      weight_out_of_range:' Jenis botol tidak dikenali.',weight_changed:' Terdeteksi benda tambahan, masukkan satu per satu.',
      safety_weight_changed:' Terdeteksi benda tambahan, masukkan satu per satu.',not_dropped:' Botol tidak masuk, silakan coba lagi.',
      weight_class_mismatch:' Ukuran botol tidak sesuai beratnya.',cv_rejected:' Botol ditolak kamera.'
    })[reason]||''}`;
    const messages={
      taring:'Zero timbangan — mengambil sampel baru.',
      await_bottle:reason==='no_bottle'?'Tidak ada botol di conveyor — siap menerima botol berikutnya.':'Siap menerima botol berikutnya.',
      intake:'Conveyor reverse 12000 step — botol menuju inspeksi.',
      inspection:'Conveyor berhenti — 1 foto CV dan penimbangan 2 detik.',
      accept_move:'Botol diterima — Conveyor reverse 20000 step; relay 2 aktif di step 10000 selama 20 detik, LED kuning berkedip. Tunggu sebelum memasukkan botol berikutnya.',
      confirm_drop:'Memastikan botol masuk…',
      safety_pause:'Jauhkan tangan dari lubang botol.',
      return_bottle:returned,
      wait_removal:returned,
      check_empty:'Memastikan conveyor kosong…',
      rearm:'Conveyor berhenti — menunggu area masuk kosong.',
      fault:errorMessage(error)
    };
    if(messages[state]) this.log(messages[state]);
    if(state==='await_bottle') this.recovering=false;
  }
  async inspect(event) {
    if(!Number.isInteger(event.cycleId) || this.seen.has(event.cycleId) || this.pendingCycle!==null) return;
    const epoch=this.epoch, id=event.cycleId, stale=()=>epoch!==this.epoch || !this.active;
    this.seen.add(id); this.pendingCycle=id;
    try {
      let result={boxes:[]}, image='', decision, rules=null;
      try {
        await this.wait(500); // The conveyor just stopped: let the bottle settle, then take one photo.
        if(stale()) return;
        image=await this.frame();
        result=await this.vision.predict({id:this.model.id,image,timeoutMs:10000,save:id});
        rules=productionRules(this.settings,this.model.classes);
        decision=cvDecision(result.boxes,this.model.classes,rules);
      } catch(error) {
        if(stale()) return;
        // Never motor_stop here: that faults the ESP. A failed check is a rejection.
        decision={accepted:false,reason:'error',size:0};
        this.notify(`CV gagal: ${error.message}. Botol ditolak.`); this.log(`CV gagal: ${error.message}`);
      }
      if(stale()) return;
      if(this.controllerCycle===id && !['inspection','safety_pause'].includes(this.controllerState)) return;
      const classes=this.model.classes;
      this.lastInspection={cycleId:id,image,boxes:Array.isArray(result.boxes)?result.boxes:[],classes,rules,...decision};
      try { await this.transport.command('cv_result',{cycleId:id,accepted:decision.accepted,size:decision.size}); }
      catch(error) {
        // Weight rejection may already have returned the bottle before inference finishes.
        if(!/Hasil CV tidak valid \/ ID botol kedaluwarsa/.test(error.message)) this.log(`cv_result gagal: ${error.message}`);
        return;
      }
      const detections=this.lastInspection.boxes.filter(b=>classes[b.classId]&&Number.isFinite(b.confidence)).map(b=>`${classes[b.classId]} ${Math.round(b.confidence*100)}%`).join(', ');
      if(result.saved) this.log(`Foto inspeksi ${id}: ${result.saved}`);
      this.log(`Hasil CV botol ${id}: ${decision.accepted?'DITERIMA':'DITOLAK'} — ${REASONS[decision.reason]} · ${detections||'tidak ada deteksi'}.`);
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

// "Selesai menyetor" only between bottles; an unattended session ends itself so the next person never deposits into it.
export const FINISHABLE=['await_bottle','wait_removal','fault'];
export const IDLE_MS=120000, IDLE_WARNING_MS=30000;
export function sessionHint(telemetry,serial,idleMs) {
  const state=telemetry.productionState, shredder=telemetry.shredderRemainingMs;
  if(!serial) return '';
  if(idleMs>=IDLE_MS-IDLE_WARNING_MS) return `Tidak ada aktivitas — sesi selesai otomatis dalam ${Math.max(0,Math.ceil((IDLE_MS-idleMs)/1000))} detik.`;
  if(['accept_move','confirm_drop','rearm'].includes(state) && shredder>0) return `Pencacah berjalan — botol berikutnya bisa dimasukkan dalam ±${Math.ceil(shredder/1000)+1} detik.`;
  if(state && !FINISHABLE.includes(state)) return 'Botol sedang diproses. Tombol Selesai aktif setelah selesai.';
  return '';
}
export function createSessionTools(React) {
  const h=React.createElement;
  return function SessionTools({client,telemetry,settings,logs,serial,notify,onBusy,finish}) {
    const [busy,setBusy]=React.useState(false),[now,setNow]=React.useState(()=>Date.now());
    const lastActivity=React.useRef(Date.now());
    const state=telemetry.productionState, fault=state==='fault';
    // Any deposit, cap or machine step restarts the idle timer.
    React.useEffect(()=>{lastActivity.current=Date.now();},[telemetry.grams,telemetry.caps,state]);
    React.useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
    const idleMs=serial&&['await_bottle','wait_removal'].includes(state)?now-lastActivity.current:0, expired=idleMs>=IDLE_MS;
    React.useEffect(()=>{if(expired)finish?.();},[expired]);
    const hint=sessionHint(telemetry,serial,idleMs);
    const shot=client.lastInspection;
    async function reset() {
      if(busy) return;
      setBusy(true); onBusy(true);
      try { await client.reset(settings); notify(''); }
      catch(error) { notify(error.message); }
      finally { setBusy(false); onBusy(false); }
    }
    return h('section',{className:'session-tools'},
      h('div',{className:'session-recovery'},
        h('p',{role:fault?'alert':'status'},fault?errorMessage(telemetry.productionError):hint||'Reset: conveyor berhenti, relay 1 ON, relay 2 OFF, LED hijau berkedip, dan zero timbangan.'),
        h('button',{type:'button',className:'button secondary',onClick:reset,disabled:busy||client.recovering||!serial},busy?'Menyiapkan Reset…':'Reset')),
      shot&&h('figure',{className:'inspection-shot'},
        shot.image&&h('div',{className:'inspection-frame'},
          h('img',{src:shot.image,alt:`Foto inspeksi botol ${shot.cycleId}`}),
          h('svg',{viewBox:'0 0 1000 1000',preserveAspectRatio:'none','aria-hidden':true},shot.boxes.map((b,i)=>{
            const color=isRejected(shot,b)?'#e5484d':'#2fbf71';
            return h('g',{key:i},h('rect',{x:b.x*1000,y:b.y*1000,width:b.w*1000,height:b.h*1000,fill:'none',stroke:color,strokeWidth:6}),
              h('text',{x:b.x*1000+6,y:Math.max(30,b.y*1000-8),fill:color,fontSize:30,fontWeight:700},`${shot.classes[b.classId]||b.label} ${Math.round(b.confidence*100)}%`));
          }))),
        h('figcaption',{className:shot.accepted?'accepted':'rejected'},h('strong',null,`Botol ${shot.cycleId}: ${shot.accepted?'DITERIMA':'DITOLAK'}`),` — ${shot.reason==='rejected'?`${shot.boxes.filter(b=>isRejected(shot,b)).map(b=>shot.classes[b.classId]).join(', ')} terdeteksi`:REASONS[shot.reason]}`)),
      h('div',{className:'session-log',role:'log','aria-label':'Log aktivitas mesin','aria-live':'polite'},
        logs.length?h('ol',null,logs.slice(0,16).map((line,index)=>h('li',{key:index},line))):h('p',null,'Menunggu aktivitas mesin…')));
  };
}
