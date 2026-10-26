const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/home/rvm-prodesk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const raw=fs.readFileSync('release/linux-unpacked/resources/app.asar');
const header=JSON.parse(raw.subarray(16,16+raw.readUInt32LE(12))),base=8+raw.readUInt32LE(4);
const server=http.createServer((req,res)=>{
 const parts=new URL(req.url,'http://localhost').pathname.split('/').filter(Boolean);let item=header.files.dist;
 for(const part of parts.length?parts:['index.html'])item=item?.files?.[part];
 if(!item||!('offset'in item)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',{'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.ttf':'font/ttf','.png':'image/png','.webm':'video/webm'}[path.extname(parts.at(-1)||'index.html')]||'application/octet-stream');
 res.end(raw.subarray(base+Number(item.offset),base+Number(item.offset)+item.size));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:'/home/rvm-prodesk/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'});
  const page=await browser.newPage({viewport:{width:1024,height:768}});page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   const db={settings:{demo:false,adminPin:'123456',productionVisionMode:'single',productionSingleModel:'bottles',productionSingleClass:1},users:[],transactions:[],models:[]};
   const models=[{id:'bottles',name:'Botol PET',trained:true,classes:['botol aqua','botol le minerale','tutup botol']},{id:'other',name:'Material daur ulang',trained:true,classes:['PET daur ulang','Kaca']}];
   window.rvm={load:async()=>JSON.parse(localStorage.getItem('test-db')||'null')||db,save:async value=>{window._saved=value;window._saves=(window._saves||0)+1;localStorage.setItem('test-db',JSON.stringify(value));},
    metrics:async()=>({cpu:1,totalMemory:8e9,freeMemory:4e9,processMemory:1,platform:'test',gpus:[]}),
    vision:{list:async()=>models,status:async()=>({runtimeReady:true,state:{status:'idle'}}),onEvent:()=>()=>{},stopTest:async()=>{}}};
  });
  async function admin(){await page.getByRole('button',{name:'Admin',exact:true}).click();await page.getByLabel('PIN administrator',{exact:true}).fill('123456');await page.getByRole('button',{name:/Buka panel admin/}).click();}
  const group=()=>page.getByRole('group',{name:'Kelas yang diterima',exact:true});
  const box=name=>group().getByRole('checkbox',{name,exact:true});
  const reject=name=>page.getByRole('group',{name:'Kelas yang ditolak',exact:true}).getByRole('checkbox',{name,exact:true});
  const save=()=>page.getByRole('button',{name:'Simpan pengaturan production',exact:true});
  await page.goto(`http://127.0.0.1:${server.address().port}`);await admin();await page.getByRole('button',{name:/Performa/}).click();
  await box('botol le minerale').waitFor();assert.ok(await box('botol le minerale').isChecked());assert.equal(await box('botol aqua').isChecked(),false);
  await box('botol aqua').check();await reject('tutup botol').check();await page.getByLabel('Confidence penolakan minimum (%)',{exact:true}).fill('55');await save().click();
  await page.waitForFunction(()=>window._saved?.settings.productionSingleClasses?.length===2);
  assert.deepEqual((await page.evaluate(()=>window._saved.settings.productionSingleClasses)).sort(),[0,1]);
  assert.equal(await box('tutup botol').isChecked(),false);assert.ok(await reject('tutup botol').isChecked());assert.deepEqual(await page.evaluate(()=>window._saved.settings.productionRejectedClasses),[2]);assert.equal(await page.evaluate(()=>window._saved.settings.productionRejectConfidence),55);
  for(const size of [{width:1024,height:768},{width:800,height:600}]){
   await page.setViewportSize(size);await group().scrollIntoViewIfNeeded();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({timeout:60000,path:`/tmp/rvm-multiclass-performance-${size.width}.png`});
  }
  await page.reload();await admin();await page.getByRole('button',{name:/Performa/}).click();
  assert.ok(await box('botol aqua').isChecked());assert.ok(await box('botol le minerale').isChecked());assert.ok(await reject('tutup botol').isChecked());assert.equal(await page.getByLabel('Confidence penolakan minimum (%)',{exact:true}).inputValue(),'55');
  await page.getByRole('button',{name:/Model/}).click();await page.getByRole('heading',{name:'Gunakan dalam siklus',exact:true}).waitFor();
  assert.ok(await box('botol aqua').isChecked());assert.ok(await box('botol le minerale').isChecked());
  await box('botol aqua').uncheck();await page.getByRole('button',{name:'Gunakan untuk siklus',exact:true}).click();
  await page.waitForFunction(()=>window._saved?.settings.productionSingleClasses?.length===1);
  assert.deepEqual(await page.evaluate(()=>window._saved.settings.productionSingleClasses),[1]);
  await box('botol aqua').check();await page.getByRole('button',{name:'Gunakan untuk siklus',exact:true}).click();
  await page.waitForFunction(()=>window._saved?.settings.productionSingleClasses?.length===2);
  await page.setViewportSize({width:1024,height:768});await group().scrollIntoViewIfNeeded();await page.screenshot({timeout:60000,path:'/tmp/rvm-multiclass-model.png'});
  await page.getByLabel('Model yang diuji',{exact:true}).selectOption('other');
  await box('PET daur ulang').waitFor();assert.equal(await box('PET daur ulang').isChecked(),false);assert.equal(await box('Kaca').isChecked(),false);
  assert.ok(await page.getByRole('button',{name:'Gunakan untuk siklus',exact:true}).isDisabled());
  await box('PET daur ulang').check();await reject('Kaca').check();await page.getByRole('button',{name:'Gunakan untuk siklus',exact:true}).click();
  await page.waitForFunction(()=>window._saved?.settings.productionSingleModel==='other');
  assert.deepEqual(await page.evaluate(()=>window._saved.settings.productionSingleClasses),[0]);
  await page.getByRole('button',{name:/Performa/}).click();assert.equal(await page.getByLabel('Model production',{exact:true}).inputValue(),'other');
  assert.ok(await box('PET daur ulang').isChecked());
  await box('PET daur ulang').uncheck();const saves=await page.evaluate(()=>window._saves);await save().click();
  await page.getByText('Pilih minimal satu kelas yang diterima untuk model production.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window._saves),saves);
  await page.getByLabel('Model production',{exact:true}).selectOption('bottles');assert.equal(await box('botol aqua').isChecked(),false);assert.equal(await box('botol le minerale').isChecked(),false);
  assert.deepEqual(errors,[]);
  console.log('PASS multi-class settings: legacy migration, two selected classes, save/reload, Model/Production sync, model switch clears stale IDs, empty selection blocked, 1024/800 layout.');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
