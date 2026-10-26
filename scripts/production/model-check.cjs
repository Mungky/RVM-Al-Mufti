const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {createVisionService}=require('../workbench/vision.cjs');
(async()=>{
 const source='/home/rvm-prodesk/.config/rvm-al-mufti/vision/ce3e3b9a-af94-4cc5-9ccc-504b4260d7a8';
 const meta=JSON.parse(await fs.readFile(path.join(source,'project.json'),'utf8'));
 assert.equal(meta.name,'apage');assert.equal(meta.trained,true);
 const temp=await fs.mkdtemp('/tmp/rvm-apage-check-');const dest=path.join(temp,'vision',meta.id);
 await fs.mkdir(dest,{recursive:true});await fs.copyFile(path.join(source,'project.json'),path.join(dest,'project.json'));
 await fs.copyFile(path.join(source,'model.pt'),path.join(dest,'model.pt'));
 await fs.mkdir(path.join(temp,'resources/electron'),{recursive:true});
 await fs.copyFile('scripts/workbench/vision-worker.py',path.join(temp,'resources/electron/vision-worker.py'));
 // Use a temporary resources folder and copied weights; the user's trained model is read only.
 const real=createVisionService({workspace:process.cwd(),resources:path.join(temp,'resources'),userData:temp,
   nativeImage:{createFromDataURL:data=>({getSize:()=>({width:640,height:480}),isEmpty:()=>false,toJPEG:()=>Buffer.from(data.split(',')[1],'base64')})},emit(){}});
 try {
   const checks=[];
   for(const index of [0,Math.floor(meta.samples.length/2),meta.samples.length-1]) {
     const data='data:image/jpeg;base64,'+(await fs.readFile(path.join(source,'captures',meta.samples[index].file))).toString('base64');
     const result=await real.predict({id:meta.id,image:data});assert.ok(Array.isArray(result.boxes));
     checks.push({sample:index,detections:result.boxes.length,maximumConfidence:Math.max(0,...result.boxes.map(b=>b.confidence))});
   }
   console.log(JSON.stringify({model:meta.name,classes:meta.classes,checks}));
 }finally{real.shutdown();}
})().catch(e=>{console.error(e);process.exitCode=1});
