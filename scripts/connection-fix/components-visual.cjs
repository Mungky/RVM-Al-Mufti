// Headless verification against the staged app; no user database or hardware access.
const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.RVM_PLAYWRIGHT || '/home/rvm-prodesk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const archive = fs.readFileSync(process.env.RVM_STAGED_ARCHIVE || '/tmp/rvm-app-connection-v2.asar');
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
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({headless:true, executablePath:'/home/rvm-prodesk/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'});
    const page=await browser.newPage({viewport:{width:1024,height:600}});
    const errors=[];page.on('pageerror', e=>errors.push(e.message));
    await page.addInitScript(()=>{
      window._commands=[];
      window._telemetry={type:'telemetry',ir:[false,false,true],irRaw:[true,true,false],irPolarity:[true,true,true],irActiveLow:true,relayOn:[false,false],grams:186,caps:0,position:0,motorEnabled:false,motorMoving:false,motorContinuous:0,loadcellReady:true,loadcellCalibrated:true,loadcellStable:false,loadcellSpread:3000,loadcellSpreadGrams:7,loadcellRaw:12345,loadcellFiltered:12345,loadcellSamples:40,loadcellAgeMs:50,loadcellFactor:440,loadcellOffset:50,rfidReady:true,rfidUid:'',rfidCardPresent:false,rfidSpiHz:4000000,rfidVersion:130,rfidStatus:3};
      window._send=()=>window._event?.({type:'data',data:JSON.stringify(window._telemetry)+'\n'});
      window.rvm={load:async()=>null,save:async()=>{},serial:{
        onEvent:fn=>{window._event=fn;return()=>{window._event=null}},
        connect:async()=>({path:'mock-esp'}),disconnect:async()=>{},
        write:async line=>{const cmd=JSON.parse(line);window._commands.push(cmd);
          if(cmd.cmd==='rfid_scan'||cmd.cmd==='rfid_reset'){window._telemetry.rfidUid='';window._telemetry.rfidCardPresent=false}
          if(cmd.cmd==='relay')window._telemetry.relayOn[cmd.pin===15?0:1]=cmd.on;
          if(cmd.cmd==='motor_enable'){window._telemetry.motorEnabled=cmd.on;window._telemetry.motorMoving=false;window._telemetry.motorContinuous=0}
          if(cmd.cmd==='motor_run'){window._telemetry.motorMoving=true;window._telemetry.motorContinuous=cmd.direction}
          if(cmd.cmd==='motor_stop'){window._telemetry.motorMoving=false;window._telemetry.motorContinuous=0}
          if(cmd.cmd==='ir_config'&&Number.isInteger(cmd.sensor))window._telemetry.irPolarity[cmd.sensor]=cmd.activeLow;
          window._event({type:'data',data:JSON.stringify({type:'ack',id:cmd.id,ok:!(['tare','calibrate'].includes(cmd.cmd)&&window._rejectScale),message:window._rejectScale?'ADC HX711 saturasi. Zero ditolak.':'OK',firmware:'almufti-diag-2.0.0'})+'\n'});window._send();
        }
      }};
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('button',{name:'Admin',exact:true}).click();
    await page.getByLabel('PIN administrator',{exact:true}).fill('123456');
    await page.getByRole('button',{name:/Buka panel admin/}).click();
    await page.getByRole('button',{name:'Mode demo',exact:true}).click();
    await page.getByRole('button',{name:/ESP32.*(?:Scan port|Hubungkan & siapkan)/}).click();
    await page.getByLabel('Polaritas IR 3',{exact:true}).waitFor();
    await page.getByText('LOW (0)',{exact:true}).waitFor();
    assert.equal(await page.getByText('HIGH (1)',{exact:true}).count(),2);
    await page.getByLabel('Polaritas IR 3',{exact:true}).selectOption('false');
    assert.ok(await page.evaluate(()=>_commands.some(c=>c.cmd==='ir_config'&&c.sensor===2&&c.activeLow===false)));
    await page.screenshot({path:'/tmp/rvm-components-ir.png',fullPage:true});
    await page.getByRole('button',{name:'RFID',exact:true}).click();
    await page.getByText('Modul siap',{exact:true}).waitFor();
    await page.getByText('BELUM ADA UID VALID',{exact:true}).waitFor();
    await page.evaluate(()=>{_telemetry.rfidUid='9DC2FC06';_telemetry.rfidCardPresent=true;_telemetry.rfidStatus=0;_send()});
    await page.getByText('UID KARTU TERBACA',{exact:true}).waitFor();
    await page.getByText('9DC2FC06',{exact:true}).waitFor();
    await page.evaluate(()=>{_telemetry.rfidCardPresent=false;_telemetry.rfidStatus=3;_send()});
    await page.getByText('UID KARTU TERAKHIR',{exact:true}).waitFor();
    assert.equal(await page.getByText('9DC2FC06',{exact:true}).count(),1);
    await page.getByRole('button',{name:'Pulihkan reader',exact:true}).click();
    await page.getByText('BELUM ADA UID VALID',{exact:true}).waitFor();
    assert.equal(await page.getByText('9DC2FC06',{exact:true}).count(),0);
    await page.evaluate(()=>{_telemetry.rfidUid='04AABBCCDDEEFF';_telemetry.rfidCardPresent=true;_telemetry.rfidStatus=0;_send()});
    await page.getByText('04AABBCCDDEEFF',{exact:true}).waitFor();
    await page.evaluate(()=>{_telemetry.rfidUid='';_telemetry.rfidCardPresent=false;_send()});
    await page.getByText('BELUM ADA UID VALID',{exact:true}).waitFor();
    await page.evaluate(()=>{_telemetry.rfidUid='9DC2FC06';_telemetry.rfidCardPresent=true;_send()});
    await page.getByText('9DC2FC06',{exact:true}).waitFor();
    await page.screenshot({path:'/tmp/rvm-components-rfid.png',fullPage:true});
    await page.getByRole('button',{name:'Relay',exact:true}).click();
    const relay1=page.locator('section').filter({has:page.getByRole('heading',{name:'Relay 1',exact:true})});
    await relay1.getByRole('button',{name:'Aktifkan relay',exact:true}).click();
    await page.waitForFunction(()=>_commands.some(c=>c.cmd==='relay'&&c.pin===15&&c.on&&c.activeLow));
    await relay1.getByRole('button',{name:'Matikan relay',exact:true}).click();
    await page.waitForFunction(()=>_commands.some(c=>c.cmd==='relay'&&c.pin===15&&!c.on));
    const relay2=page.locator('section').filter({has:page.getByRole('heading',{name:'Relay 2',exact:true})});
    await relay2.getByRole('button',{name:'Aktifkan relay',exact:true}).click();
    await page.waitForFunction(()=>_commands.some(c=>c.cmd==='relay'&&c.pin===33&&c.on&&c.activeLow));
    await page.evaluate(()=>{_telemetry.relayOn=[false,false];_send()});
    await relay2.getByRole('button',{name:'Aktifkan relay',exact:true}).waitFor();
    await page.screenshot({path:'/tmp/rvm-components-relay.png',fullPage:true});
    await page.getByRole('button',{name:'Stepper',exact:true}).click();
    assert.ok(await page.getByRole('button',{name:'Forward terus',exact:true}).isDisabled());
    assert.ok(await page.getByRole('button',{name:'Reverse terus',exact:true}).isDisabled());
    await page.getByRole('switch',{name:'Aktifkan stepper conveyor'}).click();
    await page.waitForFunction(()=>_telemetry.motorEnabled);
    await page.getByRole('button',{name:'Forward terus',exact:true}).click();
    await page.waitForFunction(()=>_commands.some(c=>c.cmd==='motor_run'&&c.direction===1));
    assert.ok(await page.getByRole('button',{name:'Reverse terus',exact:true}).isDisabled());
    await page.getByRole('button',{name:'Stop motor',exact:true}).click();
    await page.getByRole('button',{name:'Reverse terus',exact:true}).click();
    await page.waitForFunction(()=>_commands.some(c=>c.cmd==='motor_run'&&c.direction===-1));
    await page.screenshot({path:'/tmp/rvm-components-motor.png',fullPage:true});
    await page.getByRole('switch',{name:'Aktifkan stepper conveyor'}).click();
    await page.waitForFunction(()=>!_telemetry.motorEnabled&&!_telemetry.motorMoving);
    assert.ok(await page.getByRole('button',{name:'Forward terus',exact:true}).isDisabled());
    await page.getByRole('switch',{name:'Aktifkan stepper conveyor'}).click();
    await page.getByRole('button',{name:'Forward terus',exact:true}).click();
    await page.getByRole('button',{name:'Loadcell',exact:true}).click();
    await page.waitForFunction(()=>!_telemetry.motorEnabled);
    await page.waitForFunction(()=>!_telemetry.motorMoving);
    await page.getByText('Berat dari sampel RAW',{exact:true}).waitFor();
    await page.evaluate(()=>{_telemetry.loadcellStable=true;_telemetry.loadcellSpreadGrams=1;_send()});
    await page.getByText('Berat dari sampel RAW',{exact:true}).waitFor();
    await page.evaluate(()=>{_rejectScale=true;_telemetry.loadcellReady=false;_telemetry.loadcellSaturated=true;_send()});
    assert.ok(await page.getByRole('button',{name:'Zero / tare',exact:true}).isEnabled());
    assert.ok(await page.getByRole('button',{name:'Kalibrasi',exact:true}).isEnabled());
    await page.getByRole('button',{name:'Zero / tare',exact:true}).click();
    await page.locator('p[role=status]').filter({hasText:'ADC HX711 saturasi. Zero ditolak.'}).waitFor();
    await page.getByRole('button',{name:'Kalibrasi',exact:true}).click();
    await page.waitForFunction(()=>_commands.some(c=>c.cmd==='calibrate'));
    await page.screenshot({path:'/tmp/rvm-components-scale.png',fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('IR raw/polarity, reader vs UID, last scanned UID, continuous directions, stop on tab exit, RAW display and calibration feedback: passed.');
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
