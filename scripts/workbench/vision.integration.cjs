const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {createVisionService}=require('./vision.cjs');
(async()=>{
 const temp=await fs.mkdtemp('/tmp/rvm-vision-test-');await fs.mkdir(path.join(temp,'resources/electron'),{recursive:true});await fs.copyFile(path.join(__dirname,'vision-worker.py'),path.join(temp,'resources/electron/vision-worker.py'));
 require('node:child_process').execFileSync(path.join(process.cwd(),'.tools/vision/bin/python'),['-c',`from PIL import Image, ImageDraw
from pathlib import Path
p=Path('${temp}')/'fixtures';p.mkdir()
for i in range(12):
 im=Image.new('RGB',(320,320),(35+i*8,70,90));d=ImageDraw.Draw(im);d.rectangle((32+i,32,112+i,192),fill='red');d.ellipse((192,96+i,272,176+i),fill='yellow');im.save(p/f'{i}.jpg')`]);
 let lastMessage;let finished,fail;const done=new Promise((r,j)=>{finished=r;fail=j});done.catch(()=>{});
 const service=createVisionService({workspace:process.cwd(),resources:path.join(temp,'resources'),userData:temp,nativeImage:{createFromDataURL:data=>({getSize:()=>({width:320,height:320}),isEmpty:()=>false,toJPEG:()=>Buffer.from(data.split(',')[1],'base64')})},emit:s=>{if(s.message!==lastMessage){console.log(s.message);lastMessage=s.message;}if(s.status==='success')finished(s);if(s.status==='error')fail(Error(s.message+'\n'+s.output));}});
 try{
 let p=await service.create({name:'Integration: two objects',architecture:'yolo26n'});p=await service.addClass({id:p.id,name:'Rectangle'});p=await service.addClass({id:p.id,name:'Circle'});
 let image;
 for(let i=0;i<12;i++){image='data:image/jpeg;base64,'+(await fs.readFile(path.join(temp,`fixtures/${i}.jpg`))).toString('base64');p=await service.capture({id:p.id,image,boxes:[{classId:0,x:(32+i)/320,y:.1,w:.25,h:.5},{classId:1,x:.6,y:(96+i)/320,w:.25,h:.25}]});}
 await assert.rejects(service.capture({id:p.id,image,boxes:[{classId:0,x:.1,y:.1,w:.3,h:.3}]}),/sama/);
 await assert.rejects(service.capture({id:p.id,image,boxes:[{classId:2,x:.1,y:.1,w:.3,h:.3}]}),/valid/);
 await service.train({id:p.id,epochs:1});await assert.rejects(service.addClass({id:p.id,name:'Forbidden'}),/Training|training/);
 const timer=setTimeout(()=>fail(Error('Training timeout')),240000);try{await done}finally{clearTimeout(timer)};
 const trained=(await service.list())[0];assert.equal(trained.trained,true);assert.equal(trained.split.train+trained.split.val,12);assert.ok((await fs.stat(path.join(temp,'vision',p.id,'model.pt'))).size>1000000);
 const result=await service.predict({id:p.id,image});assert.ok(Array.isArray(result.boxes));await service.stopTest();console.log('PASS: dataset validation, actual CPU training, saved weights, live prediction; '+temp);
 }finally{service.shutdown()}
})().catch(e=>{console.error(e);process.exitCode=1});
