import test from 'node:test';
import assert from 'node:assert/strict';
import {ProductionClient,cvDecision,productionRules,validateRules,sessionHint,IDLE_MS} from './production-client.mjs';
const model={id:'cv',name:'aqua330-leminerale600-tutup.pt',trained:true,classes:['Leminerale 600ml','tutup botol','Aqua 330ml']};
const LE=0,CAP=1,AQUA=2;
const settings={productionSingleModel:model.id};
function fixture({imageCapture}={}) {
  const commands=[],led=[],logs=[],notifications=[],predicts=[],waits=[],media=[];
  const track={readyState:'live',stop(){this.readyState='ended';}};
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
  const video={videoWidth:640,videoHeight:480,play:async()=>{}};
  const drawn=[];
  const dom={createElement:type=>type==='video'?video:{getContext:()=>({drawImage(source){drawn.push(source);}}),toDataURL:()=> 'data:image/jpeg;base64,frame'}};
  const transport={bleConnected:true,command:async(cmd,args)=>{
    commands.push({cmd,args});return cmd==='ping'?{firmware:'almufti-production-1.1.1'}:{grams:0,caps:0};
  },led:async(settings,value)=>led.push(value)};
  const vision={list:async()=>[model],predict:async args=>{predicts.push(args);return {boxes:[{classId:AQUA,confidence:.9}]};}};
  const client=new ProductionClient({transport,vision,media:{getUserMedia:async()=>{media.push(1);return stream;}},document:dom,log:v=>logs.push(v),notify:v=>notifications.push(v),wait:async ms=>{waits.push(ms);},ImageCaptureClass:imageCapture});
  const start=client.start.bind(client);
  client.start=(uid,extra={})=>start(uid,{...settings,...extra});
  return {client,transport,vision,commands,led,logs,notifications,predicts,track,waits,media,drawn,video};
}
const box=(classId,confidence)=>({classId,confidence});
test('CV rule (defaults): cap ≥40% rejects; exactly one known bottle ≥70% accepts with its size',()=>{
  const d=rows=>cvDecision(rows,model.classes,productionRules({},model.classes));
  assert.deepEqual(d([box(AQUA,.7)]),{accepted:true,reason:'accepted',size:1});
  assert.deepEqual(d([box(LE,.95)]),{accepted:true,reason:'accepted',size:2});
  assert.equal(d([box(AQUA,.99),box(CAP,.4)]).reason,'rejected');
  assert.equal(d([box(CAP,.9)]).reason,'rejected');
  assert.equal(d([box(AQUA,.99),box(CAP,.39)]).accepted,true,'caps under 40% are not detections');
  assert.equal(d([box(AQUA,.9),box(LE,.5)]).reason,'multiple');
  assert.equal(d([box(AQUA,.69)]).reason,'low_confidence');
  for(const rows of [[],null,[box(99,1)],[box(AQUA,NaN)],[box(AQUA,2)],[box(AQUA,.3)]])assert.equal(d(rows).reason,'none');
  assert.equal(d([box(AQUA,.9),box(LE,.3)]).accepted,true,'boxes under both thresholds are ignored');
});
test('popup rules: chosen classes and confidences replace the defaults',()=>{
  assert.deepEqual(productionRules({},model.classes),{accepted:[LE,AQUA],rejected:[CAP],confidence:70,rejectConfidence:40});
  const onlyAqua=productionRules({productionSingleClasses:[AQUA],productionRejectedClasses:[CAP,LE],productionConfidence:80,productionRejectConfidence:60},model.classes);
  assert.equal(cvDecision([box(LE,.95)],model.classes,onlyAqua).reason,'rejected');
  assert.equal(cvDecision([box(AQUA,.79)],model.classes,onlyAqua).reason,'low_confidence');
  assert.equal(cvDecision([box(AQUA,.99),box(CAP,.55)],model.classes,onlyAqua).accepted,true,'cap under its 60% threshold');
  assert.equal(cvDecision([box(0,.9)],['Botol lain'],{accepted:[],rejected:[],confidence:70,rejectConfidence:40}).reason,'unknown');
  assert.throws(()=>validateRules(productionRules({productionSingleClasses:[]},model.classes)),/minimal satu kelas/);
  assert.throws(()=>validateRules(productionRules({productionSingleClasses:[CAP],productionRejectedClasses:[CAP]},model.classes)),/tidak boleh/);
  assert.throws(()=>validateRules({...productionRules({},model.classes),confidence:5}),/10–100/);
});
test('inspection uses the rules saved by the Siapkan popup',async()=>{
  const f=fixture();await f.client.start('UID',{productionSingleClasses:[AQUA],productionRejectedClasses:[CAP,LE]});
  f.vision.predict=async()=>({boxes:[box(LE,.95)]});await f.client.inspect({cycleId:1});
  assert.deepEqual(f.commands.at(-1).args,{cycleId:1,accepted:false,size:0});assert.equal(f.client.lastInspection.reason,'rejected');
});
test('start warms camera/model before session_start; inspection waits 0.5 s, takes one photo and sends size',async()=>{
  const f=fixture();await f.client.start('A1B2C3D4');
  assert.equal(f.predicts.length,1);assert.deepEqual(f.commands.map(c=>c.cmd),['ping','session_start']);
  assert.ok(f.logs.some(l=>/^Waktu siap \d+ ms/.test(l)));
  await f.client.inspect({cycleId:4});await f.client.inspect({cycleId:4});
  assert.equal(f.predicts.length,2);assert.deepEqual(f.waits,[500]);
  assert.deepEqual(f.commands.at(-1),{cmd:'cv_result',args:{cycleId:4,accepted:true,size:1}});
  assert.equal(f.predicts.at(-1).save,4);assert.equal(f.predicts.at(-1).timeoutMs,10000);
  assert.equal(f.client.lastInspection.cycleId,4);assert.equal(f.client.lastInspection.accepted,true);
});
test('rejections send accepted:false with size 0 and keep the photo for the counting screen',async()=>{
  const f=fixture();await f.client.start('UID');
  for(const [rows,reason,cycle] of [[[box(AQUA,.99),box(CAP,.85)],'rejected',1],[[box(AQUA,.9),box(LE,.9)],'multiple',2],[[],'none',3]]){
    f.vision.predict=async()=>({boxes:rows});await f.client.inspect({cycleId:cycle});
    assert.deepEqual(f.commands.at(-1).args,{cycleId:cycle,accepted:false,size:0});assert.equal(f.client.lastInspection.reason,reason);
  }
  assert.ok(f.logs.some(l=>l.includes('DITOLAK — kelas ditolak terdeteksi')&&l.includes('tutup botol 85%')));
});
test('camera and YOLO stay open between sessions; next tap does not reopen or re-predict',async()=>{
  const f=fixture();await f.client.start('UID');
  f.client.observe({type:'telemetry',firmware:'almufti-production-1.1.1'},{});
  await f.client.stop();assert.equal(f.track.readyState,'live');
  await f.client.rearmRFID();assert.deepEqual(f.commands.slice(-2).map(c=>c.cmd),['session_stop','rfid_arm']);
  await f.client.start('UID');
  assert.equal(f.media.length,1);assert.equal(f.predicts.length,1);
  assert.equal(f.commands.some(c=>c.cmd==='controller_reset'),false);
});
test('warm prepares once, later warms only re-run a cheap prediction, and concurrent prepare is shared',async()=>{
  const f=fixture();
  await Promise.all([f.client.warm(settings),f.client.prepare(settings)]);
  assert.equal(f.media.length,1);assert.equal(f.predicts.length,1);
  await f.client.warm(settings);assert.equal(f.media.length,1);assert.equal(f.predicts.length,2);
  await f.client.warm({});assert.equal(f.predicts.length,2,'nothing configured: no-op');
  f.track.readyState='ended';await f.client.warm(settings);assert.equal(f.media.length,2,'dead camera track is reopened');
});
test('photo comes from the camera track via ImageCapture, falling back to the video element',async()=>{
  const bitmap={width:1920,height:1080,close(){this.closed=true;}};
  class Capture{constructor(track){this.track=track;}async grabFrame(){return bitmap;}}
  const f=fixture({imageCapture:Capture});await f.client.start('UID');
  assert.equal(f.drawn.at(-1),bitmap);assert.equal(bitmap.closed,true);
  class Broken{async grabFrame(){throw Error('not supported');}}
  const g=fixture({imageCapture:Broken});await g.client.start('UID');assert.equal(g.drawn.at(-1),g.video);
});
test('late CV after finish/disconnect cannot command hardware',async()=>{
  const f=fixture();await f.client.start('UID');
  let resolve;f.vision.predict=()=>new Promise(r=>resolve=r);
  const pending=f.client.inspect({cycleId:1});await new Promise(r=>setImmediate(r));await f.client.stop();resolve({boxes:[box(AQUA,.9)]});await pending;
  assert.equal(f.commands.filter(c=>c.cmd==='cv_result').length,0);
});
test('wrong firmware and missing/untrained/wrong-class model never start session',async()=>{
  const f=fixture();f.transport.command=async()=>({firmware:'almufti-diag-2.0.2'});
  await assert.rejects(f.client.start('UID'),/Siapkan mode production/);
  for(const list of [[],[{...model,trained:false}],[{...model,classes:['botol']}]]){
    const g=fixture();g.vision.list=async()=>list;
    await assert.rejects(g.client.start('UID'),/belum tersedia|minimal satu kelas/);
    assert.equal(g.commands.some(c=>c.cmd==='session_start'),false);
  }
});
test('runtime failure rejects the bottle with cv_result and never sends motor_stop',async()=>{
  const f=fixture();await f.client.start('UID');
  f.vision.predict=async()=>{throw Error('Inferensi timeout.');};await f.client.inspect({cycleId:1});
  assert.deepEqual(f.commands.at(-1),{cmd:'cv_result',args:{cycleId:1,accepted:false,size:0}});
  assert.equal(f.commands.some(c=>c.cmd==='motor_stop'),false);assert.equal(f.client.active,true);
  assert.match(f.notifications[0],/CV gagal: Inferensi timeout/);assert.equal(f.client.lastInspection.reason,'error');
});
test('production telemetry maps to existing solid LED API, deduplicated; diagnostics untouched',async()=>{
  const f=fixture();
  f.client.observe({type:'telemetry',firmware:'almufti-diag-2.0.2',ledColor:'#ff0000',ledBrightness:60},{});
  assert.equal(f.led.length,0);
  const event={type:'telemetry',firmware:'almufti-production-1.1.1',ledColor:'#00ff00',ledBrightness:30};
  f.client.observe(event,{});await Promise.resolve();f.client.observe(event,{});await Promise.resolve();
  assert.equal(f.led.length,1);assert.equal(f.led[0].mode,'solid');
  f.client.observe({...event,ledColor:'#0000ff',ledBrightness:60},{});await Promise.resolve();
  f.client.observe({...event,ledColor:'#ff0000',ledBrightness:60},{});await Promise.resolve();
  assert.deepEqual(f.led.map(v=>v.color),['#00ff00','#0000ff','#ff0000']);
});
test('fault recovery: Reset re-arms quickly with the camera still open and preserves ACK totals',async()=>{
  const f=fixture();await f.client.start('UID');
  f.client.observe({type:'telemetry',firmware:'almufti-production-1.1.1',productionState:'fault',productionError:'weight_not_positive'},{});
  assert.equal(f.client.active,false);assert.ok(f.logs.some(line=>line.includes('negatif')));
  const original=f.transport.command;
  f.transport.command=async(cmd,args)=>cmd==='session_reset'?{grams:30,caps:0}:original(cmd,args);
  const result=await f.client.reset(settings);assert.equal(result.grams,30);assert.equal(f.media.length,1);
  assert.equal(f.client.active,true);assert.equal(f.client.recovering,true);
  f.client.observe({type:'production',state:'taring',cycleId:2});
  assert.ok(f.logs.some(line=>line.includes('conveyor berhenti')));
  f.client.observe({type:'production',state:'await_bottle',cycleId:1});
  assert.equal(f.client.recovering,false);
});
test('Caps telemetry logs once per count and acceptance keeps firmware yellow LED',async()=>{
  const f=fixture();await f.client.start('UID');
  const event={type:'telemetry',firmware:'almufti-production-1.1.1',productionState:'await_bottle',caps:1,ledColor:'#0000ff',ledBrightness:60};f.client.observe(event);f.client.observe(event);
  assert.equal(f.logs.filter(v=>v.includes('Tutup botol terhitung')).length,1);
  f.client.observe({...event,productionState:'accept_move',ledColor:'#ffff00'});await new Promise(r=>setImmediate(r));
  assert.equal(f.led.at(-1).color,'#ffff00');assert.ok(f.logs.some(v=>v.includes('relay 2 aktif di step 10000')));
  f.client.disconnect();
});
test('blink alternates on/off, repeated telemetry preserves phase, solid cancels and disconnect clears timer',async()=>{
  const f=fixture();
  const event={type:'telemetry',firmware:'almufti-production-1.1.1',ledMode:'blink',ledColor:'#00ff00',ledBrightness:30};
  f.client.observe(event); await Promise.resolve();
  const timer=f.client.ledTimer;
  f.client.observe(event); assert.equal(f.client.ledTimer,timer);
  await new Promise(resolve=>setTimeout(resolve,550));
  assert.equal(f.led.at(-1).brightness,0);
  f.client.observe({...event,ledMode:'solid',ledColor:'#0000ff',ledBrightness:60}); await Promise.resolve();
  assert.equal(f.client.ledTimer,null); assert.equal(f.led.at(-1).color,'#0000ff'); assert.equal(f.led.at(-1).brightness,60);
  f.client.observe({...event,ledColor:'#ffff00',ledBrightness:60}); await Promise.resolve();
  assert.ok(f.client.ledTimer); assert.equal(f.led.at(-1).color,'#ffff00');
  f.client.observe({type:'serial',connected:false}); assert.equal(f.client.ledTimer,null);
});
test('Reset stops and zeros hardware before waiting for model preparation',async()=>{
  const f=fixture();await f.client.start('UID');
  let resolve;f.client.prepare=()=>new Promise(r=>resolve=r);
  const resetting=f.client.reset({});await new Promise(r=>setImmediate(r));
  assert.equal(f.commands.at(-1).cmd,'session_reset');assert.equal(f.client.active,false);
  resolve();await resetting;assert.equal(f.client.active,true);
});
test('late AI after weight rejection is discarded without stopping the returning conveyor',async()=>{
  const f=fixture();await f.client.start('UID');
  let resolve;f.vision.predict=()=>new Promise(r=>resolve=r);
  f.client.observe({type:'production',state:'inspection',cycleId:3});
  const pending=f.client.inspect({cycleId:3});await new Promise(r=>setImmediate(r));
  f.client.observe({type:'production',state:'return_bottle',cycleId:3,rejectionReason:'weight_out_of_range'});
  resolve({boxes:[box(AQUA,.9)]});await pending;
  assert.equal(f.commands.filter(c=>['cv_result','motor_stop'].includes(c.cmd)).length,0);
  assert.ok(f.logs.some(line=>line.includes('Jenis botol tidak dikenali')));
  f.client.observe({type:'production',state:'wait_removal',cycleId:4,rejectionReason:'weight_class_mismatch'});
  assert.ok(f.logs.some(line=>line.includes('Ukuran botol tidak sesuai beratnya')));
});
test('CV result is still sent during a safety pause',async()=>{
  const f=fixture();await f.client.start('UID');
  let resolve;f.vision.predict=async args=>{f.predicts.push(args);return new Promise(r=>resolve=r);};
  f.client.observe({type:'production',state:'inspection',cycleId:5});
  const pending=f.client.inspect({cycleId:5});await new Promise(r=>setImmediate(r));
  f.client.observe({type:'production',state:'safety_pause',cycleId:5});
  resolve({boxes:[box(LE,.9)]});await pending;
  assert.deepEqual(f.commands.at(-1),{cmd:'cv_result',args:{cycleId:5,accepted:true,size:2}});
});
test('expired CV result acknowledgment is harmless when firmware has already rejected the bottle',async()=>{
  const f=fixture();await f.client.start('UID');const original=f.transport.command;
  f.transport.command=async(cmd,args)=>{if(cmd==='cv_result')throw Error('Hasil CV tidak valid / ID botol kedaluwarsa.');return original(cmd,args);};
  await f.client.inspect({cycleId:4});assert.equal(f.commands.some(c=>c.cmd==='motor_stop'),false);assert.equal(f.client.active,true);
});
test('Reset cancels old inference and keeps new inspection queued while camera prepares',async()=>{
  const f=fixture();await f.client.start('UID');
  let resolveOld;f.vision.predict=()=>new Promise(r=>resolveOld=r);
  const old=f.client.inspect({cycleId:1});await new Promise(r=>setImmediate(r));
  let ready;f.client.prepare=()=>new Promise(r=>ready=r);
  const reset=f.client.reset({});await new Promise(r=>setImmediate(r));
  f.client.observe({type:'inspection_request',cycleId:3});
  resolveOld({boxes:[box(AQUA,.9)]});await old;
  assert.equal(f.commands.filter(c=>c.cmd==='cv_result').length,0);
  f.vision.predict=async()=>({boxes:[box(AQUA,.9)]});ready();await reset;for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));
  assert.deepEqual(f.commands.filter(c=>c.cmd==='cv_result').map(c=>c.args.cycleId),[3]);
});
test('camera preparation failure after Reset stops the machine',async()=>{
  const f=fixture();await f.client.start('UID');f.client.prepare=async()=>{throw Error('camera unavailable');};
  await assert.rejects(f.client.reset({}),/camera unavailable/);assert.equal(f.commands.at(-1).cmd,'motor_stop');assert.equal(f.client.active,false);
});
test('session hints: shredder countdown, busy lock and idle warning',()=>{
  assert.equal(sessionHint({productionState:'await_bottle'},true,0),'');
  assert.match(sessionHint({productionState:'rearm',shredderRemainingMs:14200},true,0),/±16 detik/);
  assert.match(sessionHint({productionState:'inspection'},true,0),/Tombol Selesai aktif setelah selesai/);
  assert.match(sessionHint({productionState:'await_bottle'},true,IDLE_MS-10000),/otomatis dalam 10 detik/);
  assert.equal(sessionHint({productionState:'inspection'},false,0),'','no ESP: nothing is locked');
});
test('a bottle that was pulled back is reported as an empty belt, not a rejection',()=>{
  const f=fixture();f.client.observe({type:'production',state:'await_bottle',cycleId:3,rejectionReason:'no_bottle'});
  assert.ok(f.logs.some(l=>l.includes('Tidak ada botol di conveyor')));
});
