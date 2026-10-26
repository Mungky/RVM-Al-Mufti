const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const raw = fs.readFileSync(process.env.RVM_STAGED_ARCHIVE || '/tmp/rvm-app-connection-v2.asar');
const header = JSON.parse(raw.subarray(16, 16 + raw.readUInt32LE(12)));
const item = header.files.dist.files.assets.files['index-DIPzI07i.js'];
const offset = 8 + raw.readUInt32LE(4) + Number(item.offset);
const transport = raw.subarray(offset, offset + item.size).toString().match(/class Eg[\s\S]*?(?=const Ml=new Eg)/)[0];
async function fixture(name = 'LEDDMX-03-1234', props = { write: true }) {
  const { connectLed, writeDmx, dmxPackets } = await import('./led-connection.mjs');
  const calls = [], packets = [], events = [];
  let disconnectListener;
  const characteristic = { properties: props,
    writeValueWithResponse: async packet => packets.push([...packet]),
    writeValueWithoutResponse: async packet => packets.push([...packet]) };
  const device = { name, addEventListener: (_, listener) => { disconnectListener = listener; }, gatt: {
    connected: false,
    connect: async () => { device.gatt.connected = true; return { getPrimaryService: async id => {
      calls.push(id); return { getCharacteristic: async id => { calls.push(id); return characteristic; } };
    } }; },
    disconnect: () => { device.gatt.connected = false; disconnectListener?.(); }
  } };
  const native = { cancelBluetoothSelection: () => calls.push('cancel-picker') };
  global.window = { rvm: native };
  const bluetooth = { requestDevice: async options => { calls.push(options); return device; } };
  const context = vm.createContext({ window: { rvm: native }, TextEncoder, TextDecoder, setTimeout, clearTimeout,
    setInterval, clearInterval, crypto, connectLed: (target, settings) => connectLed(target, settings, bluetooth), writeDmx });
  vm.runInContext(`${transport};globalThis.client=new Eg`, context);
  context.client.on(event => events.push(event));
  return { client: context.client, device, characteristic, bluetooth, calls, packets, events, dmxPackets, native };
}
test('LED LAMP / DMX connects with empty settings and sends no commands during connection', async () => {
  const f = await fixture(); await f.client.connectBluetooth({});
  assert.ok(f.calls[0].optionalServices.includes('0000ffe0-0000-1000-8000-00805f9b34fb'));
  assert.equal(f.calls[2], '0000ffe0-0000-1000-8000-00805f9b34fb');
  assert.equal(f.calls[3], '0000ffe1-0000-1000-8000-00805f9b34fb');
  assert.equal(f.client.ledProfile, 'leddmx'); assert.ok(f.client.bleConnected);
  assert.equal(f.packets.length, 0);
});
test('LED DMX name variants use automatic profile even if stale manual UUIDs exist', async () => {
  for (const name of ['LED DMX 00-ABCD', 'LED-DMX-03-ABCD', 'LEDDMX-01-1F00']) {
    const f = await fixture(name); await f.client.connectBluetooth({ bleService: 'fff0', bleCharacteristic: 'fff3' });
    assert.equal(f.client.ledProfile, 'leddmx'); assert.match(f.calls[2], /ffe0/);
  }
});
test('unknown controller is not falsely reported connected', async () => {
  const f = await fixture('Unknown LED');
  await assert.rejects(f.client.connectBluetooth({}), /belum dikenali otomatis/);
  assert.equal(f.client.bleConnected, false); assert.equal(f.device.gatt.connected, false);
});
test('custom controller keeps explicit UUID and original text protocol', async () => {
  const f = await fixture('Custom');
  await f.client.connectBluetooth({ bleService: 'fff0', bleCharacteristic: 'fff3' });
  assert.match(f.calls[2], /fff0/); assert.match(f.calls[3], /fff3/);
  await f.client.led({ ledTemplate: 'color={color}' }, { color: '#123456' });
  assert.equal(new TextDecoder().decode(Uint8Array.from(f.packets[0])), 'color=#123456\n');
});
test('non-writable characteristic cannot report successful connection', async () => {
  const f = await fixture('LEDDMX-03', { read: true });
  await assert.rejects(f.client.connectBluetooth({}), /tidak mendukung/);
  assert.equal(f.client.bleConnected, false); assert.equal(f.device.gatt.connected, false);
});
test('disconnect clears LED state', async () => {
  const f = await fixture(); await f.client.connectBluetooth({}); f.device.gatt.disconnect();
  assert.equal(f.client.bleConnected, false); assert.equal(f.client.characteristic, null);
});
test('LED DMX solid control uses binary color and brightness packets, not JSON', async () => {
  const f = await fixture(); await f.client.connectBluetooth({});
  await f.client.led({}, { mode: 'solid', color: '#123456', brightness: 80, speed: 50 });
  assert.deepEqual(f.packets[2], [0x7b, 0xff, 7, 0x12, 0x34, 0x56, 0, 0xff, 0xbf]);
  assert.deepEqual(f.packets[1], [0x7b, 0xff, 1, 25, 80, 0, 0xff, 0xff, 0xbf]);
});
test('LED DMX supports command writes, built-in effects and off; validates values', async () => {
  const f = await fixture('LEDDMX-00', { writeWithoutResponse: true }); await f.client.connectBluetooth({});
  await f.client.led({}, { mode: 'running', color: '#ffffff', brightness: 50 }); assert.equal(f.packets[2][3], 122);
  assert.equal(f.dmxPackets({ mode: 'rainbow', color: '#ffffff', brightness: 50 })[2][3], 3);
  assert.deepEqual([...f.dmxPackets({ mode: 'solid', color: '#ffffff', brightness: 0 })[0]], [0x7b, 0xff, 4, 2, 0xff, 0xff, 0xff, 0xff, 0xbf]);
  assert.throws(() => f.dmxPackets({ mode: 'solid', color: '#ffffff', brightness: NaN }), /Brightness/);
});
test('failed USB selection still releases connection listeners', async () => {
  const f = await fixture(); let released = false;
  f.native.serial = { onEvent: () => () => { released = true; }, connect: async () => { throw new Error('Batal'); }, disconnect: async () => {} };
  await assert.rejects(f.client.connectSerial(115200), /Batal/); assert.ok(released); assert.equal(f.client.connected, false);
});
test('real hx-only firmware rejects pending handshake with specific diagnosis', async () => {
  const f = await fixture();
  let rejection;
  f.client.pending.set('ping-test', { timer: setTimeout(() => {}, 1000), reject: error => { rejection = error; } });
  f.client.consumeLine('{"type":"hx-only","raw":-393217,"complete":true}');
  assert.match(rejection.message, /tes HX711/);
  assert.equal(f.client.pending.size, 0);
  assert.match(f.client.serialFirmwareError, /Upload firmware RVM/);
  assert.equal(f.client.connected, false);
});

test('LED batches keep brightness before static RGB, with repetitions and no interleaving', async () => {
  const f=await fixture('LEDDMX-01-1F00',{writeWithoutResponse:true});await f.client.connectBluetooth({});
  const times=[];f.characteristic.writeValueWithoutResponse=async packet=>{times.push(Date.now());f.packets.push([...packet])};
  await Promise.all([f.client.led({}, {mode:'solid',color:'#ff0000',brightness:30}),f.client.led({}, {mode:'solid',color:'#00ff00',brightness:30})]);
  assert.deepEqual(f.packets.map(p=>p[2]),[4,1,7,7,7,4,1,7,7,7]);
  assert.deepEqual(f.packets[1],[0x7b,0xff,1,9,30,0,0xff,0xff,0xbf]);
  assert.deepEqual(f.packets[2],[0x7b,0xff,7,255,0,0,0,0xff,0xbf]);
  assert.deepEqual(f.packets[7],[0x7b,0xff,7,0,255,0,0,0xff,0xbf]);
  for(let i=1;i<times.length;i++)assert.ok(times[i]-times[i-1]>=140,'frame pacing');
});
