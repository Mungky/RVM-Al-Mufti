// Exercise the packaged UI with an isolated database and simulated diagnostic ESP.
const fs=require('node:fs'), http=require('node:http'), path=require('node:path'), assert=require('node:assert/strict');
const {chromium}=require('/home/rvm-prodesk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const baseline=process.env.RVM_BASELINE==='1';
const raw=fs.readFileSync(baseline?'backups/app-profile-media-20261019/app-before.asar':'release/linux-unpacked/resources/app.asar');
const header=JSON.parse(raw.subarray(16,16+raw.readUInt32LE(12))), base=8+raw.readUInt32LE(4);
const server=http.createServer((req,res)=>{
  const parts=new URL(req.url,'http://localhost').pathname.split('/').filter(Boolean); let item=header.files.dist;
  for(const part of parts.length?parts:['index.html'])item=item?.files?.[part];
  if(!item||!('offset' in item)){res.writeHead(404);res.end();return;}
  const data=raw.subarray(base+Number(item.offset),base+Number(item.offset)+item.size);
  res.setHeader('Content-Type',{'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.ttf':'font/ttf','.png':'image/png','.mp4':'video/mp4','.webm':'video/webm'}[path.extname(parts.at(-1)||'index.html')]||'application/octet-stream');
  res.setHeader('Accept-Ranges','bytes');
  const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
  if(range){const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),data.length-1):data.length-1;res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${data.length}`});res.end(data.subarray(start,end+1));}
  else res.end(data);
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); let browser;
  try{
    browser=await chromium.launch({headless:true,executablePath:'/home/rvm-prodesk/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'});
    const page=await browser.newPage({viewport:{width:1024,height:768}});page.setDefaultTimeout(30000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      const db={version:1,settings:{demo:false,adminPin:'123456',baud:115200,gramRate:1/30,capRate:4},users:[],transactions:[],models:[]};
      window._commands=[];window._firmware='almufti-diag-2.0.2';
      window._emit=event=>window._serialEvent?.({type:'data',data:JSON.stringify(event)+'\n'});
      window._telemetry=(uid='DEADBEEF')=>window._emit({type:'telemetry',firmware:window._firmware,diagnostic:true,rfidUid:uid,rfidReady:true,ir:[false,false,false],grams:0,caps:0,position:0});
      window.rvm={load:async()=>db,save:async value=>{window._saved=value;},metrics:async()=>({cpu:1,totalMemory:8000000000,freeMemory:4000000000,processMemory:1,platform:'test',gpus:[]}),
        serial:{onEvent:fn=>{window._serialEvent=fn;return()=>{window._serialEvent=null;}},connect:async()=>({path:'/dev/test'}),disconnect:async()=>{},
          write:async line=>{
            const cmd=JSON.parse(line);window._commands.push(cmd);
            window._emit({type:'ack',id:cmd.id,ok:!(cmd.cmd==='rfid_scan'&&window._rejectScan),message:window._rejectScan?'Stop motor / tunggu timbangan.':'OK',firmware:window._firmware});
            window._telemetry();
          }
        }};
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    if(!baseline){
      await page.waitForFunction(()=>{const v=document.querySelector('video.kiosk-video');return v?.readyState>=2&&v.currentTime>0;});
      const info=await page.locator('video.kiosk-video').evaluate(v=>({duration:v.duration,width:v.videoWidth,height:v.videoHeight,loop:v.loop,muted:v.muted}));
      assert.ok(info.duration>=10&&info.duration<=15,JSON.stringify(info));assert.equal(info.width,1280);assert.equal(info.height,720);assert.ok(info.loop&&info.muted);
      console.log('PASS home video:',JSON.stringify(info));
    }
    await page.locator("video.kiosk-video").evaluate(v=>v.pause());
    await page.screenshot({timeout:60000,path:`/tmp/rvm-home-${baseline?'before':'after'}.png`});
    await page.getByRole('button',{name:'Admin',exact:true}).click();await page.getByLabel('PIN administrator',{exact:true}).fill('123456');await page.getByRole('button',{name:/Buka panel admin/}).click();
    await page.getByRole('button',{name:/Performa/}).click();
    await page.getByRole('button',{name:/ESP32.*Scan port/}).click();
    await page.waitForFunction(()=>window._commands.some(cmd=>cmd.cmd==='ping'));
    await page.getByRole('button',{name:/Database/}).click();await page.getByRole('button',{name:/UID baru/}).click();
    const dialog=page.getByRole('dialog',{name:'Daftarkan kartu baru'}),uid=dialog.locator('.input-action input');
    await dialog.getByLabel('Nama anggota',{exact:true}).fill('Anggota uji RFID');
    if(baseline){await page.screenshot({timeout:60000,path:'/tmp/rvm-profile-before.png'});return;}
    const scan=dialog.getByRole('button',{name:'Scan now',exact:true});
    assert.equal(await uid.inputValue(),'');
    await scan.click();await dialog.getByText('Tempelkan kartu ke reader RFID…',{exact:true}).waitFor();
    assert.ok(await scan.isDisabled());assert.ok(await dialog.getByRole('button',{name:'Simpan anggota'}).isDisabled());
    assert.equal(await uid.inputValue(),''); // Retained DEADBEEF telemetry is ignored.
    assert.ok(await page.evaluate(()=>window._commands.some(cmd=>cmd.cmd==='rfid_scan')));
    await page.screenshot({timeout:60000,path:'/tmp/rvm-profile-scanning.png'});
    await page.evaluate(()=>window._emit({type:'rfid',uid:'04:A1:B2:C3'}));
    await page.waitForFunction(()=>document.querySelector('.input-action input')?.value==='04A1B2C3');
    assert.ok(await scan.isEnabled());
    await page.evaluate(()=>window._emit({type:'rfid',uid:'11223344'}));assert.equal(await uid.inputValue(),'04A1B2C3');
    await scan.click();await page.evaluate(()=>window._emit({type:'rfid',uid:'04A1B2C3'}));await dialog.getByText('UID terbaca. Periksa nama lalu simpan anggota.',{exact:true}).waitFor();
    await page.screenshot({timeout:60000,path:'/tmp/rvm-profile-after.png'});
    await page.setViewportSize({width:1024,height:600});await page.screenshot({timeout:60000,path:'/tmp/rvm-profile-after-600.png'});
    const box=await dialog.getByRole('button',{name:'Simpan anggota'}).boundingBox();assert.ok(box.y>=0&&box.y+box.height<=600);
    await dialog.getByRole('button',{name:'Simpan anggota'}).click();
    await page.waitForFunction(()=>window._saved?.users.some(user=>user.name==='Anggota uji RFID'&&user.uid==='04A1B2C3'));
    // Closing cancels a scan; later RFID events cannot fill a new form.
    await page.getByRole('button',{name:/UID baru/}).click();await scan.click();await dialog.getByRole('button',{name:'Tutup',exact:true}).click();
    await page.evaluate(()=>window._emit({type:'rfid',uid:'55667788'}));
    await page.getByRole('button',{name:/UID baru/}).click();assert.equal(await uid.inputValue(),'');
    // Refused reader command displays a useful error without copying old UID.
    await page.evaluate(()=>{window._rejectScan=true;});await scan.click();await dialog.getByText(/Scan gagal: Stop motor/).waitFor();assert.ok(await scan.isEnabled());assert.equal(await uid.inputValue(),'');
    await page.evaluate(()=>{window._rejectScan=false;});
    await page.clock.install();await scan.click();await page.clock.runFor(15100);
    await dialog.getByText('Kartu belum terbaca. Tekan Scan now untuk mencoba lagi.',{exact:true}).waitFor();assert.ok(await scan.isEnabled());
    // Production firmware is never reset by the profile form.
    await page.evaluate(()=>{window._firmware='almufti-production-1.0.6';window._telemetry();});
    const count=await page.evaluate(()=>window._commands.filter(cmd=>cmd.cmd==='rfid_scan').length);
    await scan.click();await dialog.getByText('Gunakan firmware pengujian untuk scan UID.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window._commands.filter(cmd=>cmd.cmd==='rfid_scan').length),count);
    await page.evaluate(()=>{window._firmware='almufti-diag-2.0.2';window._telemetry();});await scan.click();
    await page.evaluate(()=>window._serialEvent({type:'closed'}));
    await dialog.getByText(/Koneksi ESP32 terputus/).waitFor();assert.ok(await scan.isEnabled());
    assert.deepEqual(errors,[]);
    console.log('PASS fresh RFID scan, retained UID ignored, same-card rescan, one-shot capture, save, modal cleanup, timeout, refusal, firmware guard, disconnect and 600px layout.');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
