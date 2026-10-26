import test from 'node:test';
import assert from 'node:assert/strict';
import {ProductionClient,acceptsBottle,selectedProductionClasses,bottleDecision} from './production-client.mjs';
const model={id:'apage-id',name:'apage',trained:true,classes:['botol aqua','tutup botol']};
function fixture() {
  const commands=[],led=[],logs=[],notifications=[],predicts=[];
  const track={readyState:'live',stop(){this.readyState='ended';}};
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
  const video={videoWidth:640,videoHeight:480,play:async()=>{}};
  const dom={createElement:type=>type==='video'?video:{getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,frame'}};
  const transport={bleConnected:true,command:async(cmd,args)=>{
    commands.push({cmd,args});return cmd==='ping'?{firmware:'almufti-production-1.0.4'}:{grams:0,caps:0};
  },led:async(settings,value)=>led.push(value)};
  const vision={list:async()=>[model],predict:async args=>{predicts.push(args);return {boxes:[{classId:0,confidence:.9}]};},stopTest:async()=>{}};
  const client=new ProductionClient({transport,vision,media:{getUserMedia:async()=>stream},document:dom,log:v=>logs.push(v),notify:v=>notifications.push(v),wait:async()=>{}});
  const start=client.start.bind(client);
  client.start=(uid,settings={})=>{
    const merged={productionSingleModel:model.id,productionSingleClasses:[0],productionRejectedClasses:[1],...settings};
    if(settings.productionSingleClass!==undefined&&settings.productionSingleClasses===undefined)delete merged.productionSingleClasses;
    return start(uid,merged);
  };
  return {client,transport,vision,commands,led,logs,notifications,predicts,track};
}
test('visual acceptance requires matching class and confidence, accepts exact boundary',()=>{
  assert.equal(acceptsBottle([{classId:0,confidence:.6}],model.classes,60),true);
  for(const box of [{classId:0,confidence:.59},{classId:99,confidence:.99},{classId:0,confidence:NaN},{classId:0,confidence:2}])
    assert.equal(acceptsBottle([box],model.classes,60),false);
  assert.equal(acceptsBottle([],model.classes),false);
});
test('preflight loads camera/model before UID authorization; inspection sends one decision per cycle',async()=>{
  const f=fixture();await f.client.start('A1B2C3D4',{productionConfidence:60});
  assert.equal(f.predicts.length,1);assert.deepEqual(f.commands.map(c=>c.cmd),['ping','session_start']);
  assert.equal(f.commands[1].args.uid,'A1B2C3D4');
  await f.client.inspect({cycleId:4});await f.client.inspect({cycleId:4});
  assert.equal(f.predicts.length,2);assert.deepEqual(f.commands.at(-1),{cmd:'cv_result',args:{cycleId:4,accepted:true}});
});
test('low confidence and empty frame reject visually',async()=>{
  const f=fixture();await f.client.start('A1B2C3D4',{});
  f.vision.predict=async()=>({boxes:[{classId:0,confidence:.4}]});await f.client.inspect({cycleId:1});
  assert.equal(f.commands.at(-1).args.accepted,false);
  f.vision.predict=async()=>({boxes:[]});await f.client.inspect({cycleId:2});
  assert.equal(f.commands.at(-1).args.accepted,false);
});
test('late CV after finish/disconnect cannot command hardware',async()=>{
  const f=fixture();await f.client.start('A1B2C3D4',{});
  let resolve;f.vision.predict=()=>new Promise(r=>resolve=r);
  const pending=f.client.inspect({cycleId:1});await f.client.stop();resolve({boxes:[{classId:0,confidence:.9}]});await pending;
  assert.equal(f.commands.filter(c=>c.cmd==='cv_result').length,0);assert.equal(f.track.readyState,'ended');
});
test('wrong firmware and missing/untrained model never start session',async()=>{
  const f=fixture();f.transport.command=async()=>({firmware:'almufti-diag-2.0.1'});
  await assert.rejects(f.client.start('A1B2C3D4',{}),/production dahulu/);
  const g=fixture();g.vision.list=async()=>[{...model,trained:false}];
  await assert.rejects(g.client.start('A1B2C3D4',{}),/belum siap/);
  assert.equal(g.commands.some(c=>c.cmd==='session_start'),false);
});
test('runtime failure stops the motor rather than guessing accepted/rejected',async()=>{
  const f=fixture();await f.client.start('A1B2C3D4',{});
  f.vision.predict=async()=>{throw Error('camera lost');};await f.client.inspect({cycleId:1});
  assert.equal(f.commands.at(-1).cmd,'motor_stop');assert.equal(f.client.active,false);
  assert.match(f.notifications[0],/CV gagal/);
});
test('production telemetry maps to existing solid LED API, deduplicated; diagnostics untouched',async()=>{
  const f=fixture();
  f.client.observe({type:'telemetry',firmware:'almufti-diag-2.0.1',ledColor:'#ff0000',ledBrightness:60},{});
  assert.equal(f.led.length,0);
  const event={type:'telemetry',firmware:'almufti-production-1.0.4',ledColor:'#00ff00',ledBrightness:30};
  f.client.observe(event,{});await Promise.resolve();f.client.observe(event,{});await Promise.resolve();
  assert.equal(f.led.length,1);assert.equal(f.led[0].mode,'solid');
  f.client.observe({...event,ledColor:'#0000ff',ledBrightness:60},{});await Promise.resolve();
  f.client.observe({...event,ledColor:'#ff0000',ledBrightness:60},{});await Promise.resolve();
  assert.deepEqual(f.led.map(v=>v.color),['#00ff00','#0000ff','#ff0000']);
});

test('home rearm works after stop and the same UID starts a second independent session',async()=>{
  const f=fixture();await f.client.start('A1B2C3D4',{});
  f.client.observe({type:'telemetry',firmware:'almufti-production-1.0.4'},{});
  await f.client.stop();await f.client.rearmRFID();
  assert.equal(f.commands.at(-1).cmd,'rfid_arm');
  f.track.readyState='live';await f.client.start('A1B2C3D4',{});
  assert.equal(f.commands.filter(c=>c.cmd==='session_start').length,2);
  assert.equal(f.client.active,true);
});

test('negative weight recovery prepares camera, preserves ACK totals and discards old inference',async()=>{
  const f=fixture();await f.client.start('A1B2C3D4',{});
  f.client.observe({type:'telemetry',firmware:'almufti-production-1.0.4',productionState:'fault',productionError:'weight_not_positive'},{});
  assert.equal(f.client.active,false);assert.ok(f.logs.some(line=>line.includes('negatif')));
  f.track.readyState='live';const original=f.transport.command;
  f.transport.command=async(cmd,args)=>cmd==='session_reset'?{grams:30,caps:0}:original(cmd,args);
  const result=await f.client.reset({productionSingleModel:model.id,productionSingleClasses:[0],productionRejectedClasses:[1]});assert.equal(result.grams,30);
  assert.equal(f.client.active,true);assert.equal(f.client.recovering,true);
  f.client.observe({type:'production',state:'taring',cycleId:2});
  assert.ok(f.logs.some(line=>line.includes('conveyor berhenti')));
  f.client.observe({type:'production',state:'await_bottle',cycleId:1});
  assert.equal(f.client.recovering,false);
});
test('ESP restarts only after successful finish and home, before the next session',async()=>{
  const f=fixture();await f.client.start('A1B2C3D4',{});
  f.client.observe({type:'telemetry',firmware:'almufti-production-1.0.4'},{});
  await f.client.rearmRFID();assert.equal(f.commands.some(c=>c.cmd==='controller_reset'),false);
  await f.client.stop();assert.equal(f.commands.some(c=>c.cmd==='controller_reset'),false);
  await f.client.rearmRFID();
  assert.deepEqual(f.commands.slice(-3).map(c=>c.cmd),['controller_reset','ping','rfid_arm']);
  assert.equal(f.client.resetOnHome,false);
});
test('three-stage production uses pipeline decision, warms all models and never accepts an empty response',async()=>{
 const f=fixture();const roles=['object','pet','cap'];f.vision.list=async()=>roles.map(id=>({id,name:id,trained:true,classes:[id==='cap'?'Tanpa tutup':'match']}));
 const settings={productionVisionMode:'pipeline',productionConfidence:70,productionPipeline:{object:{id:'object',classId:0},pet:{id:'pet',classId:0},cap:{id:'cap',classId:0},requireNoCap:true}};
 await f.client.start('UID',settings);assert.equal(f.predicts[0].pipeline.requireNoCap,true);assert.equal(f.predicts[0].pipeline.confidence,.7);
 f.vision.predict=async()=>({accepted:true,boxes:[]});await f.client.inspect({cycleId:1});assert.equal(f.commands.at(-1).args.accepted,true);
 f.vision.predict=async()=>({accepted:false,boxes:[{classId:0,confidence:.99}]});await f.client.inspect({cycleId:2});assert.equal(f.commands.at(-1).args.accepted,false);
 f.vision.predict=async()=>({boxes:[{classId:0,confidence:.99}]});await f.client.inspect({cycleId:3});assert.equal(f.commands.at(-1).args.accepted,false);
 f.client.disconnect();
 const g=fixture();g.vision.list=async()=>roles.map(id=>({id,trained:id!=='cap',classes:['match']}));await assert.rejects(g.client.start('UID',settings),/cap.*belum siap/);assert.equal(g.commands.some(c=>c.cmd==='session_start'),false);
});
test('single production uses selected model and class, never falls back to apage for invalid selection',async()=>{
 const f=fixture();const custom={id:'custom',name:'Botol PET',trained:true,classes:['PET tanpa tutup','Dengan tutup']};f.vision.list=async()=>[model,custom];
 await f.client.start('UID',{productionSingleModel:'custom',productionSingleClass:0});assert.equal(f.predicts[0].id,'custom');
 f.vision.predict=async()=>({boxes:[{classId:1,confidence:.99}]});await f.client.inspect({cycleId:1});assert.equal(f.commands.at(-1).args.accepted,false);
 f.vision.predict=async()=>({boxes:[{classId:0,confidence:.9}]});await f.client.inspect({cycleId:2});assert.equal(f.commands.at(-1).args.accepted,true);f.client.disconnect();
 const g=fixture();await assert.rejects(g.client.start('UID',{productionSingleModel:'missing',productionSingleClass:0}),/belum tersedia/);assert.equal(g.commands.some(c=>c.cmd==='session_start'),false);
 const h=fixture();await assert.rejects(h.client.start('UID',{productionSingleModel:model.id,productionSingleClass:-1}),/Pilih minimal/);
});
test('Caps telemetry logs once per count and acceptance keeps firmware yellow LED',async()=>{
 const f=fixture();await f.client.start('UID',{});
 const event={type:'telemetry',firmware:'almufti-production-1.0.5',productionState:'await_bottle',caps:1,ledColor:'#0000ff',ledBrightness:60};f.client.observe(event);f.client.observe(event);
 assert.equal(f.logs.filter(v=>v.includes('Tutup botol terhitung')).length,1);
 f.client.observe({...event,productionState:'accept_move',ledColor:'#ffff00'});await new Promise(r=>setImmediate(r));
 assert.equal(f.led.at(-1).color,'#ffff00');assert.ok(f.logs.some(v=>v.includes('relay 2 aktif 20 detik')));
 f.client.disconnect();
});

test('blink alternates on/off, repeated telemetry preserves phase, solid cancels and disconnect clears timer',async()=>{
  const f=fixture();
  const event={type:'telemetry',firmware:'almufti-production-1.0.6',ledMode:'blink',ledColor:'#00ff00',ledBrightness:30};
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
  const f=fixture();await f.client.start('UID',{});
  let resolve;f.client.prepare=()=>new Promise(r=>resolve=r);
  const resetting=f.client.reset({});await new Promise(r=>setImmediate(r));
  assert.equal(f.commands.at(-1).cmd,'session_reset');assert.equal(f.client.active,false);
  resolve();await resetting;assert.equal(f.client.active,true);
});
test('late AI after weight rejection is discarded without stopping the returning conveyor',async()=>{
  const f=fixture();await f.client.start('UID',{});
  let resolve;f.vision.predict=()=>new Promise(r=>resolve=r);
  f.client.observe({type:'production',state:'inspection',cycleId:3});
  const pending=f.client.inspect({cycleId:3});
  f.client.observe({type:'production',state:'return_bottle',cycleId:3,rejectionReason:'weight_out_of_range'});
  resolve({boxes:[{classId:0,confidence:.9}]});await pending;
  assert.equal(f.commands.filter(c=>['cv_result','motor_stop'].includes(c.cmd)).length,0);
  assert.ok(f.logs.some(line=>line.includes('Jenis botol tidak dikenali')));
});
test('CV result is sent during safety pause and production inference has no earlier timeout',async()=>{
  const f=fixture();await f.client.start('UID',{});
  let resolve;f.vision.predict=async args=>{f.predicts.push(args);return new Promise(r=>resolve=r);};
  f.client.observe({type:'production',state:'inspection',cycleId:5});
  const pending=f.client.inspect({cycleId:5});
  f.client.observe({type:'production',state:'safety_pause',cycleId:5});
  resolve({boxes:[{classId:0,confidence:.9}]});await pending;
  assert.equal(f.commands.at(-1).cmd,'cv_result');
  assert.equal(f.commands.at(-1).args.cycleId,5);
  assert.equal(f.predicts.at(-1).timeoutMs,0);
});
test('expired CV result acknowledgment is harmless when firmware has already rejected the bottle',async()=>{
  const f=fixture();await f.client.start('UID',{});const original=f.transport.command;
  f.transport.command=async(cmd,args)=>{if(cmd==='cv_result')throw Error('Hasil CV tidak valid / ID botol kedaluwarsa.');return original(cmd,args);};
  await f.client.inspect({cycleId:4});assert.equal(f.commands.some(c=>c.cmd==='motor_stop'),false);assert.equal(f.client.active,true);
});
test('Reset cancels old inference and keeps new inspection queued while camera prepares',async()=>{
  const f=fixture();await f.client.start('UID',{});
  let resolveOld;f.vision.predict=()=>new Promise(r=>resolveOld=r);
  const old=f.client.inspect({cycleId:1});
  let ready;f.client.prepare=()=>new Promise(r=>ready=r);
  const reset=f.client.reset({});await new Promise(r=>setImmediate(r));
  f.client.observe({type:'inspection_request',cycleId:3});
  resolveOld({boxes:[{classId:0,confidence:.9}]});await old;
  assert.equal(f.commands.filter(c=>c.cmd==='cv_result').length,0);
  f.vision.predict=async()=>({boxes:[{classId:0,confidence:.9}]});ready();await reset;await new Promise(r=>setImmediate(r));
  assert.deepEqual(f.commands.filter(c=>c.cmd==='cv_result').map(c=>c.args.cycleId),[3]);
});
test('camera preparation failure after Reset stops the machine',async()=>{
  const f=fixture();await f.client.start('UID',{});f.client.prepare=async()=>{throw Error('camera unavailable');};
  await assert.rejects(f.client.reset({}),/camera unavailable/);assert.equal(f.commands.at(-1).cmd,'motor_stop');assert.equal(f.client.active,false);
});

test('single-model multi-class accepts either selected class with confidence, excludes other classes',async()=>{
 const f=fixture();f.vision.list=async()=>[{id:'bottles',name:'Botol PET',trained:true,classes:['PET bening','PET berwarna','Bukan PET']}];
 await f.client.start('UID',{productionSingleModel:'bottles',productionSingleClasses:[0,1],productionRejectedClasses:[2],productionConfidence:70});
 for(const [id,confidence,expected] of [[0,.7,true],[1,.9,true],[2,.99,false],[1,.69,false]]){
  f.vision.predict=async()=>({boxes:[{classId:id,confidence}]});await f.client.inspect({cycleId:f.predicts.length+f.commands.length});assert.equal(f.commands.at(-1).args.accepted,expected);
 }
 f.vision.predict=async()=>({boxes:[]});await f.client.inspect({cycleId:99});assert.equal(f.commands.at(-1).args.accepted,false);
 f.client.disconnect();
});
test('explicit class list overrides legacy scalar; empty and malformed selections never start hardware',async()=>{
 assert.deepEqual(selectedProductionClasses({productionSingleClass:1}),[1]);
 assert.deepEqual(selectedProductionClasses({productionSingleClasses:[0,1,1],productionSingleClass:2}),[0,1]);
 for(const ids of [[],[-1],[99],['0'],[0,99],null,'all']){
  const f=fixture();await assert.rejects(f.client.start('UID',{productionSingleModel:model.id,productionSingleClass:0,productionSingleClasses:ids}),/Pilih minimal satu kelas/);
  assert.equal(f.commands.some(c=>c.cmd==='session_start'),false);
 }
});

test('Aqua and Le Minerale accept, but any detected cap overrides either bottle',()=>{
 const classes=['botol aqua','botol le minerale','tutup botol'];
 const decide=rows=>bottleDecision(rows,classes,[0,1],[2],70,60);
 assert.equal(decide([{classId:0,confidence:.7}]).accepted,true);
 assert.equal(decide([{classId:1,confidence:.9}]).accepted,true);
 for(const bottle of [0,1]){
  const d=decide([{classId:bottle,confidence:.99},{classId:2,confidence:.6}]);
  assert.equal(d.accepted,false);assert.equal(d.reason,'rejected_class');
 }
 assert.equal(decide([{classId:2,confidence:.9}]).accepted,false);
 for(const rows of [[],[{classId:0,confidence:.69}],[{classId:99,confidence:1}],null]){
  const d=decide(rows);assert.equal(d.accepted,false);assert.equal(d.reason,'bottle_not_detected');
 }
 assert.equal(decide([{classId:0,confidence:.9},{classId:2,confidence:.59}]).accepted,true);
 assert.equal(bottleDecision([{classId:0,confidence:.9},{classId:2,confidence:.7}],classes,[0,1],[2],70,80).accepted,true);
 assert.equal(bottleDecision([{classId:0,confidence:.9}],classes,[0],[],70,60).accepted,false);
});
test('missing or overlapping rejection rules block session, and cap+botol sends rejected CV',async()=>{
 for(const rejected of [undefined,[],[0],[99],['1']]){
  const f=fixture();await assert.rejects(f.client.start('UID',{productionRejectedClasses:rejected}),/ditolak|Kelas yang sama/);
  assert.equal(f.commands.some(c=>c.cmd==='session_start'),false);
 }
 const f=fixture();await f.client.start('UID',{});
 f.vision.predict=async()=>({boxes:[{classId:0,confidence:.99},{classId:1,confidence:.85}]});
 await f.client.inspect({cycleId:10});assert.equal(f.commands.at(-1).args.accepted,false);
 assert.ok(f.logs.some(line=>line.includes('kelas ditolak')&&line.includes('tutup botol 85%')));
});
