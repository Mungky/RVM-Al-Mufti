// Headless verification against the staged app; no user database or hardware access.
const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.RVM_PLAYWRIGHT || '/home/rvm-prodesk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const archive = fs.readFileSync(process.env.RVM_STAGED_ARCHIVE || 'release/linux-unpacked/resources/app.asar');
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
 let projects=[],state={status:'idle'};window._predicts=[];window._saved=null;window._imports=0;
 window.rvm={load:async()=>null,save:async value=>{window._saved=value},vision:{
 status:async()=>({runtimeReady:true,state}),list:async()=>projects,
 importModel:async()=>{window._imports++;if(window._cancelImport)return null;if(window._invalidImport)throw Error('File bukan model YOLO .pt yang didukung.');const p={id:'imported',name:'best.pt',classes:['PET tanpa tutup','Botol bertutup'],samples:[],trained:true,imported:true,task:'detect'};projects=[p];return p},
 stopTest:async()=>{},onEvent:fn=>{window._visionEvent=fn;return()=>{}},
 predict:async args=>{window._predicts.push(args);return {boxes:[{classId:0,label:'PET tanpa tutup',confidence:.9,x:.1,y:.1,w:.2,h:.4}]}}
 }};
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByRole('button',{name:'Admin',exact:true}).click();await page.getByLabel('PIN administrator',{exact:true}).fill('123456');await page.getByRole('button',{name:/Buka panel admin/}).click();
 await page.getByRole('button',{name:/Model/}).click();
 assert.equal(await page.getByRole('button',{name:'Buat model',exact:true}).count(),0);
 assert.equal(await page.getByText('Training lokal',{exact:true}).count(),0);
 assert.equal(await page.getByText('Model impor lama (.pt / .onnx)',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Impor model .pt',exact:true}).click();
 await page.getByRole('heading',{name:'Gunakan dalam siklus'}).waitFor();
 await page.getByRole('group',{name:'Kelas yang diterima',exact:true}).getByRole('checkbox',{name:'PET tanpa tutup',exact:true}).check();
 await page.getByRole('group',{name:'Kelas yang ditolak',exact:true}).getByRole('checkbox',{name:'Botol bertutup',exact:true}).check();
 await page.getByRole('button',{name:'Gunakan untuk siklus',exact:true}).click();
 await page.waitForFunction(()=>_saved?.settings.productionSingleModel==='imported'&&_saved.settings.productionSingleClass===0&&_saved.settings.productionVisionMode==='single');
 await page.getByRole('button',{name:'Nyalakan kamera',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.studio-camera video')?.videoWidth>0);
 await page.getByRole('button',{name:'Uji kamera langsung',exact:true}).click();
 await page.getByLabel('Hasil deteksi').getByText('PET tanpa tutup 90%',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>_predicts[0].id),'imported');
 await page.getByRole('button',{name:'Hentikan uji',exact:true}).click();
 await page.getByRole('button',{name:'Matikan kamera',exact:true}).click();
 for(const size of [{width:1024,height:600},{width:800,height:600}]){
  await page.setViewportSize(size);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByRole('heading',{name:'Model YOLO',exact:true,level:2}).scrollIntoViewIfNeeded();await page.screenshot({path:`/tmp/rvm-import-${size.width}.png`});
 }
 await page.evaluate(()=>{_cancelImport=true});await page.getByRole('button',{name:'Impor model .pt',exact:true}).click();
 assert.equal(await page.getByLabel('Model yang diuji').inputValue(),'imported');
 await page.evaluate(()=>{_cancelImport=false;_invalidImport=true});await page.getByRole('button',{name:'Impor model .pt',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'File bukan model YOLO'}).waitFor();
 await page.getByRole('button',{name:/Performa/}).click();
 assert.equal(await page.getByLabel('Model production',{exact:true}).inputValue(),'imported');assert.ok(await page.getByRole('group',{name:'Kelas yang diterima',exact:true}).getByRole('checkbox',{name:'PET tanpa tutup',exact:true}).isChecked());
 assert.deepEqual(errors,[]);console.log('PASS: import-only UI, model/class cycle settings, camera inference overlay, cancel/error states, production settings, 1024/800 layout.');
 }finally{await browser?.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
