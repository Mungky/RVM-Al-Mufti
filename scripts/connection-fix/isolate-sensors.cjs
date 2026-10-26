// Diagnostic-only: antenna/poll isolation and HX711 pulse timing. No calibration or actuator commands.
const path=require('node:path'),fs=require('node:fs'),{spawnSync}=require('node:child_process');
const {SerialPort}=require(path.resolve('release/linux-unpacked/resources/app.asar/node_modules/serialport'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const port=new SerialPort({path:'/dev/ttyUSB0',baudRate:115200,autoOpen:false});
const call=(method,...args)=>new Promise((ok,no)=>port[method](...args,e=>e?no(e):ok()));
let buffer='',sequence=0,stage='',pending=new Map(),rows=[];
port.on('data',chunk=>{buffer+=chunk.toString();let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const o=JSON.parse(line);if(o.type==='ack'){const p=pending.get(o.id);if(p){clearTimeout(p.timer);pending.delete(o.id);o.ok?p.ok(o):p.no(Error(o.message));}}else if(o.type==='telemetry')rows.push({stage,...o});}catch{}}});
async function command(cmd,args={}){const id='isolate-'+(++sequence);const reply=new Promise((ok,no)=>{pending.set(id,{ok,no,timer:setTimeout(()=>{pending.delete(id);no(Error('Timeout '+cmd))},4000)})});await call('write',JSON.stringify({id,cmd,...args})+'\n');return reply;}
(async()=>{
 const users=spawnSync('/usr/bin/fuser',['/dev/ttyUSB0'],{encoding:'utf8'});if(users.status===0&&users.stdout.trim())throw Error('ESP port still in use');
 await call('open');
 try{
  await sleep(500);
  if(process.argv.includes('--check-rfid')) console.log(await command('rfid_check'));
  else for(const [mode,pulseUs] of [['all',3],['loadcell',3],['loadcell',10],['rfid',3]]){
   stage=mode+'-'+pulseUs;await command('diagnostic_mode',{mode,pulseUs});console.log('Sampling',stage);
   for(let i=0;i<12;i++){await command('ping');await sleep(1000)}
  }
 }finally{
  if(port.isOpen){try{await command('diagnostic_mode',{mode:'all',pulseUs:3})}finally{await call('close')}}
  fs.writeFileSync('/tmp/rvm-isolated-sensors.json',JSON.stringify(rows,null,2));
 }
 for(const name of [...new Set(rows.map(r=>r.stage))]){
  const r=rows.filter(r=>r.stage===name);const unique=[...new Map(r.map(o=>[o.loadcellSamples,o])).values()].slice(5);const raw=unique.map(o=>o.loadcellRaw);
  console.log(JSON.stringify({stage:name,samples:raw.length,rawMin:Math.min(...raw),rawMax:Math.max(...raw),uids:[...new Set(r.map(o=>o.rfidUid))],rfidValid:r.filter(o=>o.rfidCardPresent).length,rfidErrors:r.filter(o=>![0,3].includes(o.rfidStatus)).length}));
 }
})().catch(e=>{console.error(e.message);process.exitCode=1});
