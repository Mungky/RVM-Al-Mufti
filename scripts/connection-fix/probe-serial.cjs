// Hardware diagnostic: reads serial output and sends only JSON ping messages.
// Does not upload firmware or send relay, motor, tare or calibration commands.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const { SerialPort } = require(path.join(root, 'release/linux-unpacked/resources/app.asar/node_modules/serialport'));
const portPath = process.argv.slice(2).find(value => !value.startsWith('--')) || '/dev/ttyUSB0';
const duration = Number(process.argv.find(value => value.startsWith('--seconds='))?.split('=')[1] || 0);
const release = process.argv.includes('--release-lines');
const baudRate = Number(process.argv.find(value => value.startsWith('--baud='))?.split('=')[1] || 115200);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const call = (port, method, ...args) => new Promise((resolve, reject) => port[method](...args, error => error ? reject(error) : resolve()));
(async () => {
  const users = spawnSync('/usr/bin/fuser', [portPath], { encoding: 'utf8' });
  if (users.status === 0 && users.stdout.trim()) throw new Error(`Port is in use by PID(s) ${users.stdout.trim()}; no probe performed.`);
  const port = new SerialPort({ path: portPath, baudRate, autoOpen: false });
  let buffer = '', bytes = 0, lines = 0, ack = false;
  const started = Date.now();
  port.on('error', error => console.log('SERIAL_ERROR', error.message));
  port.on('data', data => {
    bytes += data.length; buffer += data.toString('utf8');
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'), line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
      if (!line) continue;
      lines++;
      let value; try { value = JSON.parse(line); } catch {}
      if (value?.type === 'ack' && String(value.id).startsWith('rvm-probe-')) ack = true;
      if (duration || lines <= 8 || value?.type === 'ack') console.log(JSON.stringify({ ms: Date.now() - started, line: line.slice(0, 1400) }));
    }
    if (buffer.length > 8192) buffer = buffer.slice(-4096);
  });
  try {
    await call(port, 'open');
    console.log(JSON.stringify({ opened: portPath, baudRate, releaseLines: release }));
    if (release) { await call(port, 'set', { dtr: false, rts: false }); console.log('DTR_RTS_RELEASED'); }
    await sleep(900);
    for (let attempt = 1; attempt <= (duration || 6); attempt++) {
      const id = `rvm-probe-${Date.now()}-${attempt}`;
      await call(port, 'write', `${JSON.stringify({ id, cmd: 'ping' })}\n`);
      await call(port, 'drain');
      await sleep(1000);
      if (ack && !duration) break;
    }
    console.log(JSON.stringify({ bytes, lines, matchingAck: ack, partial: buffer.slice(0, 400) }));
  } finally { if (port.isOpen) await call(port, 'close'); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
