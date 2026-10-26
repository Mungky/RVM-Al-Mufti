// Headless verification against the staged app; no user database or hardware access.
const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.RVM_PLAYWRIGHT || '/home/rvm-prodesk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const archive = fs.readFileSync(process.env.RVM_STAGED_ARCHIVE || '/tmp/rvm-app-workbench.asar');
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
 let projects=[],state={status:'idle'};window._captures=[];
 window.rvm={load:async()=>null,save:async()=>{},vision:{
 status:async()=>({runtimeReady:true,state}),list:async()=>projects,
 create:async v=>{const p={...v,id:'test',classes:[],samples:[],trained:false};projects.push(p);return p},
 addClass:async v=>{projects[0].classes.push(v.name);return projects[0]},
 capture:async v=>{window._captures.push(v);projects[0].samples.push({file:'test.jpg',boxes:v.boxes});return projects[0]},
 sample:async()=>window._captures[0].image,stopTest:async()=>{},onEvent:fn=>{window._visionEvent=fn;return()=>{}},
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
 for(const size of [{width:1024,height:768},{width:800,height:600}]){await page.setViewportSize(size);await page.getByRole('heading',{name:'Studio model YOLO'}).scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if(size.width===1024)assert.equal(await page.locator('.screen').evaluate(e=>e.getBoundingClientRect().height),768);await page.screenshot({path:`/tmp/rvm-studio-${size.width}.png`});await page.getByRole('button',{name:'Uji kamera langsung'}).scrollIntoViewIfNeeded();}
 assert.deepEqual(errors,[]);console.log('PASS: 1024×768/800×600 layout, camera capture, two-class bounding boxes, dataset save; no renderer errors.');
 }finally{await browser?.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
