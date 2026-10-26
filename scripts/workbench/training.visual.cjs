// Headless verification against the staged app; no user database or hardware access.
const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.RVM_PLAYWRIGHT || '/home/rvm-prodesk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const archive = fs.readFileSync(process.env.RVM_STAGED_ARCHIVE || path.resolve(__dirname,'../../release/linux-unpacked/resources/app.asar'));
const header = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)));
const base = 8 + archive.readUInt32LE(4);
const server = http.createServer((request, response) => {
  const parts = new URL(request.url, 'http://localhost').pathname.split('/').filter(Boolean);
  let item = header.files.dist;
  for (const part of parts.length ? parts : ['index.html']) item = item?.files?.[part];
  if (!item || !('offset' in item)) { response.writeHead(404); response.end(); return; }
  const extension = path.extname(parts.at(-1) || 'index.html');
  response.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png', '.mp4': 'video/mp4' }[extension] || 'application/octet-stream');
  const offset = base + Number(item.offset);
  response.end(archive.subarray(offset, offset + item.size));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
 browser=await chromium.launch({headless:true,executablePath:'/home/rvm-prodesk/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 const page=await browser.newPage({viewport:{width:1024,height:768}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
 let projects=[],state={status:'idle'};window._captures=[];window._markModelsTrained=()=>projects.forEach(p=>p.trained=true);
 window.rvm={load:async()=>null,save:async value=>{window._saved=value},vision:{
 status:async()=>({runtimeReady:true,state}),list:async()=>projects,
 create:async v=>{const p={...v,id:crypto.randomUUID(),classes:[],samples:[],pending:[],trained:false};projects.push(p);return p},
 addClass:async v=>{const p=projects.find(p=>p.id===v.id);p.classes.push(v.name);return p},
 queueFrame:async v=>{const p=projects.find(p=>p.id===v.id);p.pending.push({file:`batch-${p.pending.length}.jpg`,group:v.group,image:v.image});window._batchCount=(window._batchCount||0)+1;return {meta:p,duplicate:false}},discardPending:async v=>{projects[0].pending=projects[0].pending.filter(r=>r.file!==v.file);return projects[0]},
 capture:async v=>{if(v.pendingFile)projects[0].pending=projects[0].pending.filter(r=>r.file!==v.pendingFile);window._captures.push(v);projects[0].samples.push({file:'test.jpg',boxes:v.boxes});return projects[0]},
 sample:async v=>projects[0].pending.find(r=>r.file===v.file)?.image||window._captures[0].image,stopTest:async()=>{},onEvent:fn=>{window._visionEvent=fn;return()=>{}},
 predict:async()=>({boxes:[{classId:0,label:'Botol',confidence:.9,x:.1,y:.1,w:.2,h:.4}]})
 }};
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByRole('button',{name:'Admin',exact:true}).click();await page.getByLabel('PIN administrator',{exact:true}).fill('123456');await page.getByRole('button',{name:/Buka panel admin/}).click();
 await page.getByRole('button',{name:/Model/}).click();
 await page.getByLabel('Nama model',{exact:true}).fill('Botol dan tutup');await page.getByRole('button',{name:'Buat model',exact:true}).click();
 for(const name of ['Botol','Tutup']){await page.getByLabel('Nama objek',{exact:true}).fill(name);await page.getByRole('button',{name:'Tambah objek',exact:true}).click();}
 await page.getByRole('button',{name:'Nyalakan kamera',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.studio-camera video')?.videoWidth>0);await page.getByRole('button',{name:'Ambil gambar',exact:true}).click();
 const svg=page.getByLabel('Area anotasi objek');await svg.scrollIntoViewIfNeeded();const r=await svg.boundingBox();
 for(let i=0;i<2;i++){await page.getByLabel('Label kotak berikutnya').selectOption(String(i));await svg.scrollIntoViewIfNeeded();const b=await svg.boundingBox();await page.mouse.move(b.x+b.width*(.1+i*.4),b.y+b.height*.2);await page.mouse.down();await page.mouse.move(b.x+b.width*(.35+i*.4),b.y+b.height*.6);await page.mouse.up();}
 await page.getByText('2 kotak',{exact:true}).waitFor();await page.screenshot({path:'/tmp/rvm-studio-annotation.png'});await page.getByRole('button',{name:'Simpan ke dataset',exact:true}).click();
 const captures=await page.evaluate(()=>window._captures);assert.equal(captures.length,1);assert.deepEqual(captures[0].boxes.map(b=>b.classId),[0,1]);assert.ok(captures[0].boxes.every(b=>b.w>.2&&b.w<.3));
 await page.getByLabel('Resolusi foto (sisi terpanjang)').selectOption('640');await page.getByRole('button',{name:'Rekam batch',exact:true}).click();
 await page.getByText(/Batch selesai:/).waitFor({timeout:20000});
 const count=await page.evaluate(()=>window._batchCount);assert.ok(count>0&&count<=200,`Actual frames ${count}`);
 await page.getByRole('button',{name:'Label foto berikutnya',exact:true}).click();await svg.scrollIntoViewIfNeeded();const b=await svg.boundingBox();await page.mouse.move(b.x+b.width*.1,b.y+b.height*.1);await page.mouse.down();await page.mouse.move(b.x+b.width*.7,b.y+b.height*.7);await page.mouse.up();await page.getByRole('button',{name:'Simpan ke dataset',exact:true}).click();assert.ok((await page.evaluate(()=>window._captures))[1].pendingFile);
 for(const size of [{width:1024,height:768},{width:800,height:600}]){await page.setViewportSize(size);await page.getByRole('heading',{name:'Studio model YOLO'}).scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if(size.width===1024)assert.equal(await page.locator('.screen').evaluate(e=>e.getBoundingClientRect().height),768);await page.screenshot({path:`/tmp/rvm-studio-${size.width}.png`});await page.getByLabel('Target FPS').scrollIntoViewIfNeeded();await page.screenshot({path:`/tmp/rvm-batch-controls-${size.width}.png`});await page.getByRole('button',{name:'Uji kamera langsung'}).scrollIntoViewIfNeeded();}
 for(const [modelName,classes] of [['PET',['PET','Non PET']],['Kondisi tutup',['Tanpa tutup','Dengan tutup']]]){await page.getByLabel('Nama model',{exact:true}).fill(modelName);await page.getByRole('button',{name:'Buat model',exact:true}).click();for(const name of classes){await page.getByLabel('Nama objek',{exact:true}).fill(name);await page.getByRole('button',{name:'Tambah objek',exact:true}).click();}}
 await page.evaluate(()=>window._markModelsTrained());
 await page.getByRole('button',{name:/Performa/}).click();const singleOptions=await page.getByLabel('Model production',{exact:true}).locator('option').evaluateAll(nodes=>nodes.map(n=>({value:n.value,text:n.textContent})));const selected=singleOptions.find(o=>o.text==='PET');await page.getByLabel('Model production',{exact:true}).selectOption(selected.value);await page.getByRole('group',{name:'Kelas yang diterima',exact:true}).getByRole('checkbox').first().check();await page.getByRole('button',{name:'Simpan pengaturan production',exact:true}).click();await page.waitForFunction(id=>window._saved?.settings.productionSingleModel===id,selected.value);assert.equal(await page.evaluate(()=>window._saved.settings.productionSingleClass),0);await page.screenshot({path:'/tmp/rvm-single-model-settings.png'});await page.getByLabel('Alur CV',{exact:true}).selectOption('pipeline');await page.getByText('Aturan: hanya PET tanpa tutup diterima.',{exact:false}).waitFor();
 const options=await page.getByLabel('Model objek',{exact:true}).locator('option').evaluateAll(nodes=>nodes.map(n=>({value:n.value,text:n.textContent})));
 for(const [field,text,cls] of [['Model objek','Botol dan tutup','Kelas objek'],['Model PET','PET','Kelas PET'],['Model kondisi tutup','Kondisi tutup','Kelas tanpa tutup']]){const option=options.find(o=>o.text.startsWith(text));await page.getByLabel(field,{exact:true}).selectOption(option.value);await page.getByLabel(cls,{exact:true}).selectOption('0');}
 await page.getByRole('button',{name:'Simpan pengaturan production',exact:true}).click();await page.waitForFunction(()=>window._saved?.settings.productionVisionMode==='pipeline');assert.equal(await page.evaluate(()=>window._saved.settings.productionPipeline.requireNoCap),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'/tmp/rvm-pipeline-settings.png'});
 assert.deepEqual(errors,[]);console.log('PASS: camera capture, 10s/20FPS batch, pending labeling, 1024/800 layout, pipeline settings; no renderer errors.');
 }finally{await browser?.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
