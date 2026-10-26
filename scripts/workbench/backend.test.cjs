const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {createFirmwareService}=require('./firmware.cjs');
const {createDiagnosticInstaller}=require('./diagnostic-connect.cjs');
const workspace=path.resolve(__dirname,'../..');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('Production and diagnostic drafts remain separate and edits survive switching',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'rvm-drafts-'));
 const f=createFirmwareService({workspace,resources:workspace,userData:tmp,listPorts:async()=>[],closeSerial:async()=>{},emit:()=>{}});
 await f.load();await f.save('void setup(){ /* production custom */ } void loop(){}');
 const d=await f.openDraft('diagnostic');assert.match(d.code,/almufti-diag-2.0.1/);await f.save(d.code+'\n// diagnostic custom');
 const p=await f.openDraft('production');assert.match(p.code,/production custom/);assert.doesNotMatch(p.code,/diagnostic custom/);
 assert.match((await f.openDraft('diagnostic')).code,/diagnostic custom/);
 assert.doesNotMatch(await f.template('diagnostic'),/diagnostic custom/);
 await assert.rejects(f.openDraft('../../escape'));await fs.rm(tmp,{recursive:true,force:true});
});
test('Auto installer skips matching firmware; uploads mismatched firmware and verifies the same port',async()=>{
 let version='almufti-diag-2.0.1',runs=0;const used=[];
 class Port extends EventEmitter{constructor(args){super();this.args=args;used.push(args.path)}open(cb){this.isOpen=true;cb()}close(cb){this.isOpen=false;cb()}write(line,cb){const m=JSON.parse(line);if(version)setImmediate(()=>this.emit('data',Buffer.from(JSON.stringify({type:'ack',id:m.id,ok:true,diagnostic:true,firmware:version})+'\n')));cb()}}
 const installer=createDiagnosticInstaller({workspace,resources:workspace,SerialPort:Port,emit:()=>{},runner:(file,args)=>{runs++;assert.equal(args[args.indexOf('--port')+1],'/dev/mock');const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>{};setTimeout(()=>{version='almufti-diag-2.0.1';c.emit('close',0)},10);return c}});
 await installer.ensure('/dev/mock');assert.equal(runs,0);
 version=null;const pending=installer.ensure('/dev/mock');await sleep(30);assert.equal(installer.isBusy(),true);await assert.rejects(installer.ensure('/dev/mock'),/sedang/);await pending;assert.equal(runs,1);assert.ok(used.every(p=>p==='/dev/mock'));assert.equal(installer.isBusy(),false);
});
test('Port-open failure never causes automatic flashing',async()=>{
 class Port extends EventEmitter{open(cb){cb(Error('Port busy'))}}
 let runs=0;const installer=createDiagnosticInstaller({workspace,resources:workspace,SerialPort:Port,emit:()=>{},runner:()=>runs++});
 await assert.rejects(installer.ensure('/dev/mock'),/busy/);assert.equal(runs,0);assert.equal(installer.isBusy(),false);
});
test('Rebuilt diagnostic compile/upload use the tested IDE profile and preserve its board defaults',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'rvm-tested-profile-'));
 const runs=[];
 const f=createFirmwareService({workspace,resources:workspace,userData:tmp,listPorts:async()=>[{path:'/dev/mock',vendorId:'test'}],closeSerial:async()=>{},emit:()=>{},runner:(file,args)=>{
  runs.push(args);const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  setImmediate(()=>child.emit('close',0));return child;
 }});
 const draft=await f.openDraft('diagnostic');await f.compile(draft.code);
 for(let i=0;i<100&&f.snapshot().status==='running';i++)await sleep(10);
 assert.equal(f.snapshot().status,'success');
 await f.upload({code:draft.code,port:'/dev/mock'});
 for(let i=0;i<100&&f.snapshot().status==='running';i++)await sleep(10);
 assert.equal(f.snapshot().status,'success');assert.equal(runs.length,2);
 for(const args of runs){assert.equal(args[args.indexOf('--config-file')+1],path.join(workspace,'.tools/arduino-tested.yaml'));assert.ok(!args.includes('FlashFreq=40'));}
 assert.ok(runs[0].includes('compiler.cpp.extra_flags=-DMFRC522_SPICLOCK=4000000UL'));
 await fs.rm(tmp,{recursive:true,force:true});
});
test('Only unchanged old production draft migrates to latest template; custom and diagnostic drafts survive',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'rvm-production-upgrade-'));await fs.mkdir(path.join(tmp,'firmware'));
 const previous=await fs.readFile(path.join(workspace,'backups/production-12s-caps-20261007/rvm_production.ino'),'utf8');
 await fs.writeFile(path.join(tmp,'firmware/production.ino'),previous);
 const service=createFirmwareService({workspace,resources:workspace,userData:tmp,listPorts:async()=>[],closeSerial:async()=>{},emit:()=>{}});
 const upgraded=await service.load();assert.match(upgraded.code,/almufti-production-1.0.5/);assert.match(upgraded.code,/RELEASE_MS=12000/);
 await service.save(previous+'\n// custom production');assert.equal((await service.load()).code,previous+'\n// custom production');
 const diagnostic=await service.openDraft('diagnostic');assert.match(diagnostic.code,/almufti-diag-2.0.1/);
 await fs.rm(tmp,{recursive:true,force:true});
});
