// Admin "Siapkan": demo toggle gone, popups install + connect, ESP32/LED buttons are mode indicators.
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/home/rvm-prodesk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const shots=process.argv[2]||'/tmp';
const raw=fs.readFileSync('release/linux-unpacked/resources/app.asar');
const header=JSON.parse(raw.subarray(16,16+raw.readUInt32LE(12))),base=8+raw.readUInt32LE(4);
const server=http.createServer((req,res)=>{
 const parts=new URL(req.url,'http://localhost').pathname.split('/').filter(Boolean);let item=header.files.dist;
 for(const part of parts.length?parts:['index.html'])item=item?.files?.[part];
 if(!item||!('offset' in item)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',{'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.ttf':'font/ttf','.png':'image/png','.webm':'video/webm'}[path.extname(parts.at(-1)||'index.html')]||'application/octet-stream');
 res.end(raw.subarray(base+Number(item.offset),base+Number(item.offset)+item.size));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try {
  browser=await chromium.launch({headless:true,executablePath:'/home/rvm-prodesk/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const page=await browser.newPage({viewport:{width:1024,height:768}});const errors=[];page.setDefaultTimeout(15000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   const db={settings:{demo:true,gramRate:.1,capRate:2,adminPin:'123456',baud:115200,productionSingleModel:'old',productionSingleClasses:[0,2],productionRejectedClasses:[1]},users:[{id:'m',uid:'A1B2C3D4',name:'Anggota Uji',active:true,demo:false,points:0}],transactions:[],models:[]};
   window._connects=[];window._firmware='';window._ble=0;
   const emit=value=>window._serial?.({type:'data',data:JSON.stringify(value)+'\n'});
   const characteristic={properties:{write:true},writeValueWithResponse:async()=>{}};
   const device={name:'LEDDMX-01-1F00',addEventListener(){},gatt:{connected:true,connect:async()=>({getPrimaryService:async()=>({getCharacteristic:async()=>characteristic})}),disconnect(){}}};
   let pendingBle=null;
   window.rvm={load:async()=>db,save:async value=>{window._saved=value;},onDiagnostic:()=>()=>{},
    cancelBluetoothSelection(){if(pendingBle){pendingBle.reject(Error('User cancelled the requestDevice() chooser.'));pendingBle=null;window._devices?.({token:'t1',closed:true});}},
    devices:{onUpdate:fn=>{window._devices=fn;return()=>{}},action:({token,action,id})=>{if(token==='t1'&&action==='select'&&id==='dmx'&&pendingBle){pendingBle.resolve(device);pendingBle=null;window._devices?.({token:'t1',closed:true});}}},
    metrics:async()=>({cpu:2,totalMemory:8e9,freeMemory:4e9,temperature:40,processMemory:1e8,platform:'test'}),
    firmware:{sketches:async()=>[{name:'hx711_reference',version:null,edited:false},{name:'rvm_diag',version:'almufti-diag-2.0.2',edited:false},{name:'rvm_production',version:'almufti-production-1.1.1',edited:false},{name:'stepper_basic',version:null,edited:false}],
     ports:async()=>[{path:'/dev/ttyACM0',name:'Arduino'},{path:'/dev/ttyUSB0',name:'Silicon Labs'}],onEvent:()=>()=>{}},
    serial:{onEvent:fn=>{window._serial=fn;return()=>{}},disconnect:async()=>{},
     connect:async(baud,options)=>{window._connects.push({baud,...options});if(!/^rvm_/.test(options.prepare))return {path:options.port,connected:false};
      window._firmware=options.prepare==='rvm_production'?'almufti-production-1.1.1':'almufti-diag-2.0.2';setTimeout(()=>emit({type:'telemetry',ir:[false,false,false],grams:0,caps:0,firmware:window._firmware,diagnostic:options.prepare!=='rvm_production'}),50);return {path:options.port};},
     write:async line=>{const cmd=JSON.parse(line);window._sent=[...(window._sent||[]),cmd];queueMicrotask(()=>emit({type:'ack',id:cmd.id,ok:true,firmware:window._firmware,diagnostic:window._firmware.includes('diag'),grams:0,caps:0}));}},
    vision:{list:async()=>[{id:'old',name:'model lama',classes:['Leminerale 600ml','tutup botol','Aqua 330ml'],trained:true},{id:'new',name:'aqua330-leminerale600-tutup.pt',classes:['Leminerale 600ml','tutup botol','Aqua 330ml'],trained:true}],status:async()=>({runtimeReady:true}),predict:async args=>{window._predicts=(window._predicts||0)+1;return {boxes:[{classId:2,label:'Aqua 330ml',confidence:.93,x:.3,y:.2,w:.3,h:.6},{classId:1,label:'tutup botol',confidence:.81,x:.38,y:.15,w:.1,h:.08}]};},onEvent:()=>()=>{}}
   };
   // requestDevice stays pending until the popup selects a device, like Electron's select-bluetooth-device.
   Object.defineProperty(navigator,'bluetooth',{value:{requestDevice:()=>{window._ble++;setTimeout(()=>window._devices?.({token:'t1',title:'Pilih controller LED',items:[{id:'phone',name:'Phone'},{id:'dmx',name:'LEDDMX-01-1F00'}]}),100);return new Promise((resolve,reject)=>{pendingBle={resolve,reject};});}},configurable:true});
  });
  await page.clock.install();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:'Admin',exact:true}).click();await page.getByLabel('PIN administrator',{exact:true}).fill('123456');await page.getByRole('button',{name:/Buka panel admin/}).click();
  // Demo is forced off even when the stored settings say demo:true.
  assert.equal(await page.getByText('Mode demo').count(),0);
  assert.equal(await page.getByRole('button',{name:/Performa/}).count(),0);
  await page.getByRole('button',{name:/ESP32.*Belum disiapkan/}).waitFor();
  // Pengujian popup: USB device, Bluetooth and firmware dropdowns. A reference sketch is upload-only.
  await page.getByRole('button',{name:'Siapkan',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Siapkan mode pengujian'});
  await page.waitForFunction(()=>document.querySelector('[aria-label="Bluetooth"]')?.value==='dmx');
  assert.equal(await dialog.getByLabel('Device USB').inputValue(),'/dev/ttyUSB0','Silicon Labs preselected');
  assert.equal(await dialog.getByLabel('Firmware').inputValue(),'rvm_diag');
  assert.equal(await page.locator('.rvm-device-overlay').count(),0,'old picker overlay stays hidden');
  await page.screenshot({path:path.join(shots,'siapkan-pengujian.png')});
  await dialog.getByLabel('Firmware').selectOption('stepper_basic');await dialog.getByText('tidak memakai protokol aplikasi').waitFor();
  await dialog.getByRole('button',{name:'Siapkan',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  assert.deepEqual(await page.evaluate(()=>window._connects.at(-1)),{baud:115200,prepare:'stepper_basic',port:'/dev/ttyUSB0'});
  await page.getByText(/stepper_basic terpasang/).waitFor();
  await page.getByRole('button',{name:/LED controller.*Terhubung/}).waitFor();await page.getByRole('button',{name:/ESP32.*Belum disiapkan/}).waitFor();
  // Second time: LED already connected (not rescanned); install the pengujian firmware.
  await page.getByRole('button',{name:'Siapkan',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[aria-label="Bluetooth"]')?.textContent==='LEDDMX-01-1F00 · terhubung');
  await dialog.getByRole('button',{name:'Siapkan',exact:true}).click();await dialog.waitFor({state:'hidden'});
  assert.deepEqual(await page.evaluate(()=>window._connects.at(-1)),{baud:115200,prepare:'rvm_diag',port:'/dev/ttyUSB0'});
  assert.equal(await page.evaluate(()=>window._ble),1);
  await page.getByRole('button',{name:/ESP32.*Mode pengujian/}).waitFor();
  // Production popup: also model CV, confidences and accepted/rejected classes.
  await page.getByRole('button',{name:/Production/}).click();
  assert.equal(await page.getByText('Model production').count(),0,'settings card removed');
  assert.equal(await page.getByRole('button',{name:/Script/}).count(),0,'Script page removed');
  await page.getByRole('button',{name:'Siapkan',exact:true}).click();
  const prod=page.getByRole('dialog',{name:'Siapkan mode production'});
  assert.equal(await prod.getByLabel('Firmware').inputValue(),'rvm_production');
  await prod.getByLabel('Model CV').selectOption('new');
  assert.ok(await prod.getByLabel('Kamera inspeksi').count());
  await prod.getByLabel('Confidence diterima (%)').fill('75');
  const accepted=prod.getByRole('group',{name:'Kelas yang diterima'}),rejected=prod.getByRole('group',{name:'Kelas yang ditolak'});
  assert.equal(await accepted.getByLabel('Leminerale 600ml').isChecked(),true);assert.equal(await rejected.getByLabel('tutup botol').isChecked(),true);
  await page.screenshot({path:path.join(shots,'siapkan-production.png'),fullPage:true});
  await prod.getByRole('button',{name:'Siapkan',exact:true}).click();
  await prod.waitFor({state:'hidden'});
  assert.deepEqual(await page.evaluate(()=>window._connects.at(-1)),{baud:115200,prepare:'rvm_production',port:'/dev/ttyUSB0'});
  const saved=await page.evaluate(()=>window._saved.settings);
  assert.deepEqual([saved.productionSingleModel,saved.productionSingleClasses,saved.productionRejectedClasses,saved.productionConfidence,saved.productionRejectConfidence,saved.productionCamera],['new',[0,2],[1],75,40,'']);
  await page.getByRole('button',{name:/ESP32.*Mode production/}).waitFor();
  await page.screenshot({path:path.join(shots,'production-tab.png')});
  // Uji komponen hides IR 2.
  await page.getByRole('button',{name:/Uji komponen/}).click();
  assert.equal(await page.getByText('IR 2',{exact:true}).count(),0);await page.getByText('IR 3',{exact:true}).first().waitFor();
  // Counting screen: one inspection shows the photo, boxes and the decision with its reason.
  await page.getByRole('button',{name:/Kembali ke RVM/}).click();
  await page.waitForFunction(()=>window._predicts>=2);await page.waitForTimeout(300);const warmed=await page.evaluate(()=>window._predicts);
  await page.evaluate(()=>window._serial({type:'data',data:JSON.stringify({type:'rfid',uid:'A1B2C3D4'})+'\n'}));
  await page.getByRole('button',{name:/Selesai menyetor/}).waitFor();
  assert.equal(await page.evaluate(()=>window._predicts),warmed,'camera/model warmed on home (app open + new model), the tap adds no prediction');
  await page.evaluate(()=>{const s=d=>window._serial({type:'data',data:JSON.stringify(d)+'\n'});s({type:'production',state:'inspection',cycleId:7});s({type:'inspection_request',cycleId:7});});
  await page.getByText('Botol 7: DITOLAK',{exact:true}).waitFor();await page.locator('figcaption').getByText('tutup botol terdeteksi').waitFor();
  assert.equal(await page.locator('.inspection-frame rect').count(),2);
  assert.deepEqual(await page.locator('.inspection-frame rect').evaluateAll(r=>r.map(e=>e.getAttribute('stroke'))),['#2fbf71','#e5484d']);
  assert.deepEqual(await page.evaluate(()=>window._sent.filter(c=>c.cmd==='cv_result').map(({cycleId,accepted,size})=>({cycleId,accepted,size}))),[{cycleId:7,accepted:false,size:0}]);
  await page.screenshot({path:path.join(shots,'counting-inspection.png')});
  // Selesai is locked while a bottle is processed; the shredder countdown and idle auto-finish use the same line.
  const telemetry=(state,extra={})=>page.evaluate(([state,extra])=>window._serial({type:'data',data:JSON.stringify({type:'telemetry',ir:[false,false,false],grams:0,caps:0,firmware:'almufti-production-1.1.2',productionState:state,...extra})+'\n'}),[state,extra]);
  await telemetry('rearm',{shredderRemainingMs:14200});
  await page.getByText('botol berikutnya bisa dimasukkan dalam ±16 detik').waitFor();
  assert.equal(await page.getByRole('button',{name:/Selesai menyetor/}).isDisabled(),true);
  await telemetry('await_bottle');
  await page.waitForFunction(()=>!document.querySelector('.finish-button').disabled);
  await page.clock.fastForward(95000);await page.getByText(/sesi selesai otomatis dalam \d+ detik/).waitFor();
  await page.screenshot({path:path.join(shots,'counting-idle.png')});
  await page.clock.fastForward(30000);
  await page.waitForFunction(()=>window._sent.some(c=>c.cmd==='session_stop'));
  await page.getByRole('button',{name:/Selesai menyetor/}).waitFor({state:'detached'});
  assert.deepEqual(errors,[]);
  console.log('prepare browser test passed');
 } finally { await browser?.close(); server.close(); }
})().catch(error=>{console.error(error);process.exit(1);});
