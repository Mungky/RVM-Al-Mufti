// Real CPU model loading and inference in temporary projects; user models are untouched.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');const {createVisionService}=require('./vision.cjs');
(async()=>{
 const workspace=process.cwd(),temp=await fs.mkdtemp('/tmp/rvm-pipeline-');await fs.mkdir(path.join(temp,'resources/electron'),{recursive:true});await fs.copyFile(path.join(__dirname,'vision-worker.py'),path.join(temp,'resources/electron/vision-worker.py'));
 execFileSync(path.join(workspace,'.tools/vision/bin/python'),['-c','from PIL import Image;import sys;Image.new("RGB",(640,480),(32,64,96)).save(sys.argv[1])',path.join(temp,'frame.jpg')]);
 const image='data:image/jpeg;base64,'+(await fs.readFile(path.join(temp,'frame.jpg'))).toString('base64');
 const service=createVisionService({workspace,resources:path.join(temp,'resources'),userData:temp,nativeImage:{createFromDataURL:data=>({getSize:()=>({width:640,height:480}),isEmpty:()=>false,toJPEG:()=>Buffer.from(data.split(',')[1],'base64')})},emit:()=>{}});
 try{
  const pipeline={confidence:.6,requireNoCap:true};
  for(const role of ['object','pet','cap']){const p=await service.importModel(path.join(workspace,'.tools/vision-models/yolo26n.pt'));pipeline[role]={id:p.id,classId:0};}
  const start=Date.now();const first=await service.predict({id:pipeline.object.id,image,pipeline});const warmup=Date.now()-start;assert.equal(first.accepted,false);
  const next=Date.now();const second=await service.predict({id:pipeline.object.id,image,pipeline});const steady=Date.now()-next;assert.equal(second.accepted,false);assert.ok(steady<30000);
  console.log(`PASS: actual CPU three-model load ${warmup}ms, warm inference ${steady}ms, empty frame rejected.`);
 }finally{service.shutdown()}
})().catch(e=>{console.error(e);process.exitCode=1});
