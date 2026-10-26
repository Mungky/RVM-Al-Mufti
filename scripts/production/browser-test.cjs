const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/home/rvm-prodesk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const raw=fs.readFileSync('release/linux-unpacked/resources/app.asar');
const header=JSON.parse(raw.subarray(16,16+raw.readUInt32LE(12))),base=8+raw.readUInt32LE(4);
const server=http.createServer((req,res)=>{
 const parts=new URL(req.url,'http://localhost').pathname.split('/').filter(Boolean);let item=header.files.dist;
 for(const part of parts.length?parts:['index.html'])item=item?.files?.[part];
 if(!item||!('offset' in item)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',{'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.ttf':'font/ttf','.png':'image/png','.mp4':'video/mp4','.webm':'video/webm'}[path.extname(parts.at(-1)||'index.html')]||'application/octet-stream');
 res.end(raw.subarray(base+Number(item.offset),base+Number(item.offset)+item.size));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try {
 browser=await chromium.launch({headless:true,executablePath:'/home/rvm-prodesk/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 const page=await browser.newPage({viewport:{width:1024,height:768}});const errors=[];page.setDefaultTimeout(30000);
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
   const db={settings:{demo:false,gramRate:.1,capRate:2,adminPin:'123456',baud:115200,productionSingleModel:'apage-id',productionSingleClasses:[0],productionRejectedClasses:[1]},users:[{id:'member',uid:'A1B2C3D4',name:'Anggota Uji',active:true,demo:false,points:10}],transactions:[],models:[]};
   window._commands=[];window._blePackets=[];window._total=0;window._caps=0;window._nextBoxes=[{classId:0,confidence:.9}];window._predictCount=0;
   window._heldUID='';window._ir1=false;window._cycle=1;window._emit=value=>{if(value.type==='rfid')window._heldUID=value.uid;if(value.type==='inspection_request')window._cycle=value.cycleId;window._serialListener?.({type:'data',data:JSON.stringify(value)+'\n'});};
   window._telemetry=(state='standby',grams=window._total,color='#00ff00',brightness=30,error='')=>window._emit({type:'telemetry',ir:[window._ir1,false,false],cycleId:window._cycle,productionError:error,grams,caps:window._caps,capBusy:window._capBusy||false,capCounterEnabled:!['standby','fault'].includes(state),firmware:'almufti-production-1.0.8',diagnostic:false,productionState:state,ledMode:['standby','taring','await_bottle','rearm','accept_move'].includes(state)?'blink':'solid',ledColor:color,ledBrightness:brightness});
   window.rvm={load:async()=>db,save:async value=>{window._saved=value;},cancelBluetoothSelection(){},
     metrics:async()=>({cpu:2,totalMemory:8000000000,freeMemory:4000000000,temperature:40,processMemory:120000000,platform:'test',gpus:[]}),
     serial:{onEvent:fn=>{window._serialListener=fn;return()=>{window._serialListener=null;}},connect:async(baud,options)=>{window._connectOptions=options;window._telemetry();return{path:'/dev/test'};},disconnect:async()=>{},
       write:async line=>{const cmd=JSON.parse(line);window._commands.push(cmd);const out={type:'ack',id:cmd.id,ok:true,firmware:'almufti-production-1.0.8',grams:window._total,caps:window._caps};
         if(cmd.cmd==='session_start'){window._total=0;window._caps=0;out.grams=0;out.caps=0;}
         if(cmd.cmd==='controller_reset'){window._total=0;window._caps=0;window._reboots=(window._reboots||0)+1;}
         if(cmd.cmd==='session_reset'){window._resetCount=(window._resetCount||0)+1;window._cycle++;}
         queueMicrotask(()=>{window._emit(out);if(cmd.cmd==='session_reset')window._telemetry('taring',window._total,'#00ff00',30);if(cmd.cmd==='rfid_arm'&&window._heldUID)window._emit({type:'rfid',uid:window._heldUID});});
       }},
     vision:{list:async()=>[{id:'apage-id',name:'apage',classes:['botol aqua','tutup botol'],trained:true}],predict:async args=>{window._predictCount++;window._lastImage=args.image;return{boxes:window._nextBoxes};},stopTest:async()=>{window._stopped=true;}}
   };
   const characteristic={properties:{write:true},writeValueWithResponse:async value=>window._blePackets.push([...value])};
   const device={name:'LEDDMX-01-1F00',addEventListener(){},gatt:{connected:true,connect:async()=>({getPrimaryService:async()=>({getCharacteristic:async()=>characteristic})}),disconnect(){}}};
   Object.defineProperty(navigator,'bluetooth',{value:{requestDevice:async()=>device},configurable:true});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByRole('button',{name:'Admin',exact:true}).click();await page.getByLabel('PIN administrator',{exact:true}).fill('123456');await page.getByRole('button',{name:/Buka panel admin/}).click();
 await page.getByRole('button',{name:/Performa/}).click();await page.getByRole('heading',{name:'Production',exact:true}).waitFor();
 await page.getByLabel('Confidence minimum (%)').fill('65');await page.getByRole('button',{name:'Simpan pengaturan production'}).click();
 await page.waitForFunction(()=>window._saved?.settings.productionConfidence===65);
 await page.getByRole('button',{name:/ESP32.*Scan port/}).click();await page.waitForFunction(()=>window._commands.some(c=>c.cmd==='ping'));
 assert.equal(await page.evaluate(()=>window._connectOptions.diagnostic),false);
 await page.getByRole('button',{name:/LED controller.*Scan BLE/}).click();
 await page.waitForFunction(()=>window._blePackets.some(p=>p[2]===7&&p[3]===0&&p[4]===255&&p[5]===0));
 await page.screenshot({timeout:60000,path:'/tmp/rvm-production-settings.png'});
 await page.getByRole('button',{name:/Kembali ke RVM/}).click();
 await page.evaluate(()=>window._emit({type:'rfid',uid:'11223344'}));
 await page.getByText('Kartu tidak dikenali, silahkan hubungi admin',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window._commands.some(c=>c.cmd==='session_start')),false);
 await page.evaluate(()=>window._emit({type:'rfid',uid:'A1B2C3D4'}));
 await page.getByRole('button',{name:/Selesai menyetor/}).waitFor();
 await page.getByText('Kartu tidak dikenali, silahkan hubungi admin',{exact:true}).waitFor({state:'hidden'});
 assert.equal(await page.evaluate(()=>window._commands.find(c=>c.cmd==='session_start').uid),'A1B2C3D4');
 await page.evaluate(()=>window._telemetry('await_bottle',0,'#00ff00',30));
 await page.getByText('Silakan masukkan botol',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window._blePackets.some(p=>p[2]===7&&p[3]===0&&p[4]===0&&p[5]===255)),false);
 assert.ok(await page.getByRole('button',{name:'Reset',exact:true}).isEnabled());
 await page.evaluate(()=>window._telemetry('inspection',0,'#0000ff',60));
 await page.waitForFunction(()=>window._blePackets.some(p=>p[2]===7&&p[3]===0&&p[4]===0&&p[5]===255));
 await page.evaluate(()=>window._emit({type:'inspection_request',cycleId:1}));
 await page.waitForFunction(()=>window._commands.some(c=>c.cmd==='cv_result'&&c.cycleId===1));
 assert.equal(await page.evaluate(()=>window._commands.find(c=>c.cmd==='cv_result').accepted),true);
 assert.ok((await page.evaluate(()=>window._lastImage)).startsWith('data:image/jpeg;base64,'));
 await page.evaluate(()=>{window._total=30;window._telemetry('accept_move',30,'#ffff00',60);});
 await page.getByText('3 poin',{exact:true}).waitFor();
 await page.getByText('Botol diterima. Tunggu 20 detik',{exact:true}).waitFor();
 await page.waitForFunction(()=>window._blePackets.some(p=>p[2]===7&&p[3]===255&&p[4]===255&&p[5]===0));
 await page.getByRole('log',{name:'Log aktivitas mesin'}).getByText(/Botol diterima.*Conveyor reverse/).waitFor();
 await page.screenshot({timeout:60000,path:'/tmp/rvm-production-session.png'});
 await page.setViewportSize({width:800,height:600});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({timeout:60000,path:'/tmp/rvm-production-session-800.png'});
 await page.setViewportSize({width:1024,height:768});
 await page.evaluate(()=>{window._nextBoxes=[{classId:0,confidence:.99},{classId:1,confidence:.9}];window._emit({type:'inspection_request',cycleId:2});});
 await page.waitForFunction(()=>window._commands.some(c=>c.cmd==='cv_result'&&c.cycleId===2));
 assert.equal(await page.evaluate(()=>window._commands.find(c=>c.cmd==='cv_result'&&c.cycleId===2).accepted),false);
 await page.evaluate(()=>window._telemetry('return_bottle',30,'#ff0000',60));
 await page.getByText('Botol ditolak. Mengembalikan sampai IR 1',{exact:true}).waitFor();
 await page.waitForFunction(()=>window._blePackets.some(p=>p[2]===7&&p[3]===255&&p[4]===0&&p[5]===0));
 const greenBefore=await page.evaluate(()=>window._blePackets.filter(p=>p[2]===7&&p[3]===0&&p[4]===255&&p[5]===0).length);
 await page.evaluate(()=>{window._ir1=true;window._telemetry('wait_removal',30,'#ff0000',60);});
 await page.getByText('Ambil botol. Menunggu IR 1 bebas selama 300 ms',{exact:true}).waitFor();
 await page.evaluate(()=>{window._ir1=false;window._telemetry('await_bottle',30,'#00ff00',30);});
 await page.waitForFunction(count=>window._blePackets.filter(p=>p[2]===7&&p[3]===0&&p[4]===255&&p[5]===0).length>count,greenBefore);
 await page.evaluate(()=>window._telemetry('fault',30,'#ff0000',60,'weight_not_positive'));
 await page.getByRole('button',{name:'Reset',exact:true}).waitFor();
 await page.getByRole('button',{name:'Reset',exact:true}).isEnabled();
 await page.screenshot({timeout:60000,path:'/tmp/rvm-production-recovery.png'});
 await page.getByRole('button',{name:'Reset',exact:true}).click();
 await page.waitForFunction(()=>window._resetCount===1);
 await page.evaluate(()=>window._telemetry('taring',30,'#00ff00',30));
 await page.getByText('Menyiapkan timbangan…',{exact:true}).waitFor();
 await page.evaluate(()=>window._telemetry('await_bottle',30,'#00ff00',30));
 await page.getByText('3 poin',{exact:true}).waitFor();
 await page.getByRole('log',{name:'Log aktivitas mesin'}).getByText(/Reset siklus/).waitFor();
 await page.evaluate(()=>window._telemetry('accept_move',30,'#ffff00',60));
 assert.ok(await page.getByRole('button',{name:'Reset',exact:true}).isEnabled());
 await page.getByRole('button',{name:'Reset',exact:true}).click();
 await page.waitForFunction(()=>window._resetCount===2);
 await page.getByText('Menyiapkan timbangan…',{exact:true}).waitFor();
 await page.evaluate(()=>window._telemetry('await_bottle',30,'#00ff00',30));
 await page.getByText('Silakan masukkan botol',{exact:true}).waitFor();
 await page.setViewportSize({width:800,height:600});
 const finishBox=await page.getByRole('button',{name:/Selesai menyetor/}).boundingBox();
 assert.ok(finishBox.y+finishBox.height<=600);
 await page.screenshot({timeout:60000,path:'/tmp/rvm-production-recovery-800.png'});
 await page.setViewportSize({width:1024,height:768});
 await page.evaluate(()=>{window._caps=1;window._capBusy=true;window._telemetry('await_bottle',30,'#00ff00',30);});
 assert.equal(await page.getByText('Tutup terdeteksi. Tunggu IR 3 bebas',{exact:true}).count(),0);
 await page.getByText('5 poin',{exact:true}).waitFor();
 await page.getByRole('log',{name:'Log aktivitas mesin'}).getByText(/Tutup botol terhitung dari IR 3.*total 1/).waitFor();
 await page.evaluate(()=>{window._capBusy=false;window._telemetry('await_bottle',30,'#00ff00',30);});
 await page.getByRole('button',{name:/Selesai menyetor/}).click();
 await page.getByText('SETORAN BERHASIL',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window._saved.transactions[0].points),5);
 assert.equal(await page.evaluate(()=>window._saved.transactions[0].caps),1);
 assert.equal(await page.evaluate(()=>window._saved.users[0].points),15);
 assert.equal(await page.evaluate(()=>window._stopped),true);
 await page.getByRole('button',{name:/Kembali ke awal/}).click();
 await page.getByRole('button',{name:/Selesai menyetor/}).waitFor();
 assert.equal(await page.evaluate(()=>window._reboots),1);
 assert.equal(await page.evaluate(()=>window._commands.filter(c=>c.cmd==='session_start').length),2);
 assert.equal(await page.evaluate(()=>window._commands.filter(c=>c.cmd==='session_start')[1].uid),'A1B2C3D4');
 await page.evaluate(()=>{window._total=10;window._telemetry('accept_move',10,'#ffff00',60);});
 await page.getByText('1 poin',{exact:true}).waitFor();
 await page.getByRole('button',{name:/Selesai menyetor/}).click();
 await page.getByText('SETORAN BERHASIL',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window._saved.transactions.length),2);
 assert.equal(await page.evaluate(()=>window._saved.users[0].points),16);
 assert.deepEqual(errors,[]);
 console.log('PASS packaged app: production connection without diagnostic flash, saved settings, unknown/known UID, camera frame, apage accept/reject, cumulative points, returned-bottle lockout, live logs, immediate Reset from error and healthy release preserving points, ESP reboot on home, second session same RFID.');
 }finally {await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
