// Real CPU import and prediction, with isolated storage and simulated machine transport.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {createVisionService}=require('./vision.cjs');
(async()=>{
 const temp=await fs.mkdtemp('/tmp/rvm-import-check-');await fs.mkdir(path.join(temp,'resources/electron'),{recursive:true});
 await fs.copyFile(path.join(__dirname,'vision-worker.py'),path.join(temp,'resources/electron/vision-worker.py'));
 const source=process.env.RVM_IMPORT_FIXTURE||'/home/rvm-prodesk/.config/rvm-al-mufti/models/1791860262517-best.pt';
 const imagePath=process.env.RVM_IMAGE_FIXTURE||path.join(process.cwd(),'.tools/vision/lib/python3.12/site-packages/ultralytics/assets/bus.jpg');
 const image='data:image/jpeg;base64,'+(await fs.readFile(imagePath)).toString('base64');
 const service=createVisionService({workspace:process.cwd(),resources:path.join(temp,'resources'),userData:temp,nativeImage:{createFromDataURL:data=>({getSize:()=>({width:810,height:1080}),isEmpty:()=>false,toJPEG:()=>Buffer.from(data.split(',')[1],'base64')})},emit(){}});
 try{
  assert.equal(service.create,undefined);assert.equal(service.train,undefined);
  const model=await service.importModel(source);assert.equal(model.trained,true);assert.equal(model.datasetChanged,false);assert.ok(model.classes.length>0);
  const result=await service.predict({id:model.id,image});assert.ok(Array.isArray(result.boxes));await service.stopTest();
  const {ProductionClient}=await import('../production/production-client.mjs');
  const commands=[],track={readyState:'live',stop(){this.readyState='ended'}};
  const client=new ProductionClient({vision:service,transport:{command:async(cmd,args)=>{commands.push({cmd,args});return cmd==='ping'?{firmware:'almufti-production-1.0.5'}:{caps:0}},bleConnected:false},media:{getUserMedia:async()=>({getTracks:()=>[track],getVideoTracks:()=>[track]})},document:{createElement:type=>type==='video'?{videoWidth:810,videoHeight:1080,play:async()=>{}}:{getContext:()=>({drawImage(){}}),toDataURL:()=>image}}});
  const settings={productionVisionMode:'single',productionSingleModel:model.id,productionSingleClass:0,productionRejectedClasses:model.classes.map((_,i)=>i).slice(1),productionConfidence:60};
  if(model.classes.length>1){
    await client.start('TEST',settings);await client.inspect({cycleId:1});assert.equal(commands.at(-1).cmd,'cv_result');assert.equal(typeof commands.at(-1).args.accepted,'boolean');await client.stop();
  }else{
    await assert.rejects(client.start('TEST',settings),/kelas yang ditolak/);assert.equal(commands.some(c=>c.cmd==='session_start'),false);
  }
  const before=(await service.list()).length;const invalid=path.join(temp,'invalid.pt');await fs.writeFile(invalid,'not pytorch');await assert.rejects(service.importModel(invalid));assert.equal((await service.list()).length,before);
  await assert.rejects(service.importModel(path.join(temp,'model.onnx')),/\.pt/);
  // The old importer copied files without inference metadata; list upgrades them once.
  await fs.mkdir(path.join(temp,'models'));await fs.copyFile(source,path.join(temp,'models/old-best.pt'));
  const migrated=await service.list();assert.equal(migrated.length,before+1);const old=migrated.find(m=>m.name==='old-best.pt');assert.equal(old.trained,true);assert.deepEqual(old.classes,model.classes);assert.equal((await service.list()).length,migrated.length);
  console.log(JSON.stringify({passed:'import, class extraction, actual CPU prediction, production preflight or missing rejection class guard, invalid file rollback, old import migration',classes:model.classes,task:model.task,detected:result.boxes.length,storage:temp}));
 }finally{service.shutdown()}
})().catch(e=>{console.error(e);process.exitCode=1});
