const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {createFirmwareService}=require('./firmware.cjs');
const {createDiagnosticInstaller}=require('./diagnostic-connect.cjs');
const workspace=path.resolve(__dirname,'../..');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const child=onClose=>{const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>{};setTimeout(()=>{onClose?.();c.emit('close',0)},10);return c};
// Sketches come from a copy of firmware/arduino so tests can "edit them in Arduino IDE".
async function service(runner) {
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'rvm-fw-'));
  await fs.cp(path.join(workspace,'firmware/arduino'),path.join(tmp,'ws/firmware/arduino'),{recursive:true});
  for(const name of ['.tools'])await fs.symlink(path.join(workspace,name),path.join(tmp,'ws',name)).catch(()=>{});
  const ws=path.join(tmp,'ws');
  return {tmp,ws,f:createFirmwareService({workspace:ws,resources:workspace,userData:path.join(tmp,'data'),listPorts:async()=>[{path:'/dev/mock',vendorId:'test'}],runner})};
}
const versionOf=async(ws,name)=>(await fs.readFile(path.join(ws,'firmware/arduino',name,`${name}.ino`),'utf8')).match(/FIRMWARE\s*=\s*"([^"]+)"/)[1];
// Mock ESP: answers ping with `state.version`, or stays silent when it is null.
const espPort=(state,used=[])=>class extends EventEmitter{constructor(args){super();used.push(args.path)}open(cb){this.isOpen=true;cb()}close(cb){this.isOpen=false;cb()}write(line,cb){const m=JSON.parse(line);if(state.version)setImmediate(()=>this.emit('data',Buffer.from(JSON.stringify({type:'ack',id:m.id,ok:true,firmware:state.version})+'\n')));cb()}};
test('Siapkan lists every sketch in firmware/arduino with its protocol version',async()=>{
  const {tmp,f}=await service();const byName=Object.fromEntries((await f.sketches()).map(s=>[s.name,s]));
  for(const name of ['hx711_reference','rfid_reference','rfid_user_test','rvm_diag','rvm_production','stepper_basic'])assert.ok(byName[name],name);
  assert.equal(byName.rvm_production.version,await versionOf(workspace,'rvm_production'));assert.match(byName.rvm_diag.version,/^almufti-diag-2\./);assert.equal(byName.stepper_basic.version,null);
  assert.ok(Object.values(byName).every(s=>!('code' in s)));
  await assert.rejects(f.sketch('../etc'),/tidak valid/);
  await fs.rm(tmp,{recursive:true,force:true});
});
test('Pengujian: matching ESP is not reflashed; otherwise the verified prebuilt binary is uploaded to the same port',async()=>{
  const {tmp,ws,f}=await service();const diag=await versionOf(ws,'rvm_diag');
  const state={version:diag},used=[];let runs=0;
  const installer=createDiagnosticInstaller({workspace,resources:workspace,SerialPort:espPort(state,used),firmware:f,emit:()=>{},runner:(file,args)=>{runs++;assert.equal(args[args.indexOf('--port')+1],'/dev/mock');assert.ok(args.includes('--input-dir'));return child(()=>{state.version=diag})}});
  assert.equal(await installer.ensure('/dev/mock','rvm_diag'),diag);assert.equal(runs,0);
  state.version=null;const pending=installer.ensure('/dev/mock','rvm_diag');await sleep(30);assert.equal(installer.isBusy(),true);await assert.rejects(installer.ensure('/dev/mock'),/sedang/);await pending;assert.equal(runs,1);assert.ok(used.every(p=>p==='/dev/mock'));assert.equal(installer.isBusy(),false);
  await fs.rm(tmp,{recursive:true,force:true});
});
test('Production: compile+upload in one call, verify the version, and re-upload after an Arduino IDE edit',async()=>{
  const runs=[];const state={version:'almufti-production-1.1.0'},production=await versionOf(workspace,'rvm_production');
  const {tmp,ws,f}=await service((file,args)=>{runs.push(args);return child(()=>{state.version=production})});
  const installer=createDiagnosticInstaller({workspace,resources:workspace,SerialPort:espPort(state),firmware:f,emit:()=>{}});
  assert.equal(await installer.ensure('/dev/mock','rvm_production'),production);
  assert.equal(runs.length,1);const args=runs[0];
  assert.ok(args.includes('compile')&&args.includes('--upload'));assert.equal(args[args.indexOf('--port')+1],'/dev/mock');
  assert.equal(args[args.indexOf('--config-file')+1],path.join(ws,'.tools/arduino-tested.yaml'));
  assert.ok(args.includes('compiler.cpp.extra_flags=-DMFRC522_SPICLOCK=4000000UL'));
  await installer.ensure('/dev/mock','rvm_production');assert.equal(runs.length,1,'same file + matching version: no upload');
  // Edited in Arduino IDE without bumping the version string: still uploaded.
  const file=path.join(ws,'firmware/arduino/rvm_production/rvm_production.ino');await fs.appendFile(file,'\n// edited in Arduino IDE\n');
  await installer.ensure('/dev/mock','rvm_production');assert.equal(runs.length,2);
  assert.match(await fs.readFile(path.join(tmp,'data/firmware/builds/siapkan-rvm_production/rvm_production/rvm_production.ino'),'utf8'),/edited in Arduino IDE/);
  // An edited pengujian sketch no longer matches the prebuilt binary, so it is compiled.
  await fs.appendFile(path.join(ws,'firmware/arduino/rvm_diag/rvm_diag.ino'),'\n// edited\n');state.version=null;
  await assert.rejects(installer.ensure('/dev/mock','rvm_diag'),/belum merespons/);assert.ok(runs[2].includes('--upload'));
  await fs.rm(tmp,{recursive:true,force:true});
});
test('A reference sketch without the app protocol is uploaded only',async()=>{
  const runs=[];const {tmp,f}=await service((file,args)=>{runs.push(args);return child();});
  const installer=createDiagnosticInstaller({workspace,resources:workspace,SerialPort:espPort({version:null}),firmware:f,emit:()=>{}});
  assert.equal(await installer.ensure('/dev/mock','stepper_basic'),null);assert.equal(runs.length,1);assert.ok(runs[0].at(-1).endsWith('stepper_basic'));
  await fs.rm(tmp,{recursive:true,force:true});
});
test('Port-open failure never causes automatic flashing',async()=>{
  class Port extends EventEmitter{open(cb){cb(Error('Port busy'))}}
  let runs=0;const {tmp,f}=await service(()=>runs++);
  const installer=createDiagnosticInstaller({workspace,resources:workspace,SerialPort:Port,firmware:f,emit:()=>{},runner:()=>runs++});
  await assert.rejects(installer.ensure('/dev/mock','rvm_production'),/busy/);assert.equal(runs,0);assert.equal(installer.isBusy(),false);
  await fs.rm(tmp,{recursive:true,force:true});
});
