const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createVisionService}=require('./vision.cjs');
// Inspection photos are kept for evidence and pruned to the newest 100.
test('predict with save keeps the photo and prunes to 100',async()=>{
  const userData=await fs.mkdtemp(path.join(os.tmpdir(),'rvm-insp-')),id='11111111-1111-1111-1111-111111111111';
  await fs.mkdir(path.join(userData,'vision',id),{recursive:true});
  await fs.writeFile(path.join(userData,'vision',id,'project.json'),JSON.stringify({id,trained:true,classes:['a']}));
  const folder=path.join(userData,'vision','inspections');await fs.mkdir(folder);
  for(let i=0;i<105;i++)await fs.writeFile(path.join(folder,`2000-${String(i).padStart(3,'0')}.jpg`),'x');
  const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'rvm-ws-'));await fs.mkdir(path.join(workspace,'.tools/vision/bin'),{recursive:true});
  await fs.writeFile(path.join(workspace,'.tools/vision/bin/python'),'',{mode:0o755});
  const {EventEmitter}=require('node:events');
  const runner=()=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.kill=()=>{};
    c.stdin={write:line=>{const r=JSON.parse(line);setImmediate(()=>c.stdout.emit('data','RVM_JSON '+JSON.stringify({kind:'prediction',id:r.id,boxes:[]})+'\n'))}};
    setImmediate(()=>c.stdout.emit('data','RVM_JSON {"kind":"ready"}\n'));return c};
  const image={isEmpty:()=>false,getSize:()=>({width:640,height:480}),toJPEG:()=>Buffer.from('jpeg')};
  await fs.mkdir(path.join(workspace,'electron'));await fs.copyFile(path.join(__dirname,'vision-worker.py'),path.join(workspace,'electron/vision-worker.py'));
  const service=createVisionService({workspace,resources:workspace,userData,nativeImage:{createFromDataURL:()=>image},emit:()=>{},runner});
  const result=await service.predict({id,image:'data:image/jpeg;base64,AA==',save:7});
  assert.match(result.saved,/-c7\.jpg$/);
  assert.equal((await fs.readFile(result.saved)).toString(),'jpeg');
  const left=await fs.readdir(folder);assert.equal(left.length,100);assert.ok(left.includes(path.basename(result.saved)));
  service.shutdown();
});
