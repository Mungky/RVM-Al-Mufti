const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createDevicePicker, selectSerialPort, serialError, createBluetoothPicker } = require('./device-selection.cjs');
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
function fixture() {
  const ipcMain = new EventEmitter(), webContents = new EventEmitter(), updates = [];
  let destroyed = false;
  webContents.send = (_, data) => updates.push(data);
  const picker = createDevicePicker({ window: { webContents, isDestroyed: () => destroyed }, ipcMain,
    checkSender: event => { if (event.sender !== webContents) throw new Error('Untrusted sender'); } });
  return { picker, updates, ipcMain, webContents,
    send(action, id) { ipcMain.emit('devices:action', { sender: webContents }, { token: updates.at(-1).token, action, id }); },
    destroy() { destroyed = true; webContents.emit('destroyed'); }
  };
}
test('USB empty scan refreshes and requires explicit selection even for one port', async () => {
  const f = fixture(); let ports = [];
  const result = selectSerialPort({ listPorts: async () => ports, picker: f.picker });
  await tick();
  assert.equal(f.updates.at(-1).items.length, 0);
  ports = [{ path: '/dev/ttyUSB0', manufacturer: 'ESP32' }]; f.send('scan'); await tick();
  assert.equal(f.updates.at(-1).items[0].id, ports[0].path);
  assert.equal(f.updates.at(-1).closed, undefined);
  f.send('select', ports[0].path);
  assert.equal((await result).path, ports[0].path);
});
test('USB removal before open returns to picker and allows cancellation', async () => {
  const f = fixture(); let ports = [{ path: '/dev/ttyUSB0' }];
  const result = selectSerialPort({ listPorts: async () => ports, picker: f.picker });
  await tick(); ports = []; f.send('select', '/dev/ttyUSB0'); await tick();
  assert.match(f.updates.at(-1).detail, /terputus/);
  f.send('cancel'); await assert.rejects(result, /dibatalkan/);
});
test('picker rejects stale tokens, unknown devices and untrusted senders', async () => {
  const f = fixture(); const request = f.picker.open({ title: 'Test', scan: async () => [{ id: 'one' }] });
  await tick(); const token = f.updates.at(-1).token;
  f.ipcMain.emit('devices:action', { sender: f.webContents }, { token: 'old', action: 'select', id: 'one' });
  f.send('select', 'missing');
  assert.equal(f.updates.at(-1).closed, undefined);
  assert.throws(() => f.ipcMain.emit('devices:action', { sender: {} }, { token, action: 'select', id: 'one' }), /Untrusted/);
  f.send('select', 'one'); assert.equal((await request.result).id, 'one');
});
test('scan failure is visible and can be retried without opening another picker', async () => {
  const f = fixture(); let fail = true;
  const request = f.picker.open({ title: 'Test', scan: async () => { if (fail) throw new Error('Scan failed'); return []; } });
  await tick(); assert.equal(f.updates.at(-1).error, 'Scan failed');
  fail = false; f.send('scan'); await tick(); assert.equal(f.updates.at(-1).error, '');
  f.send('cancel'); assert.equal(await request.result, null);
});
test('cancel during scan cannot reopen the picker after late results', async () => {
  const f = fixture(); let resolve;
  const request = f.picker.open({ scan: () => new Promise(done => { resolve = done; }) });
  f.send('cancel'); resolve([{ id: 'late' }]); await tick();
  assert.equal(await request.result, null); assert.equal(f.updates.at(-1).closed, true);
});
test('closing application resolves picker and removes its IPC listener', async () => {
  const f = fixture(); const request = f.picker.open({ scan: async () => [] });
  f.destroy(); assert.equal(await request.result, null);
  assert.equal(f.ipcMain.listenerCount('devices:action'), 0);
});
test('Bluetooth discoveries update the same vertical picker, including later devices', async () => {
  const f = fixture(), completed = [], picker = createBluetoothPicker({ picker: f.picker, delay: 0 });
  const event = { preventDefault() {} };
  picker.select(event, [{ deviceId: 'a', deviceName: 'Other' }], id => completed.push(id));
  const token = f.updates.at(-1).token;
  picker.select(event, [{ deviceId: 'b', deviceName: 'LEDDMX-03' }], id => completed.push(id));
  await tick(); assert.equal(f.updates.at(-1).items.length, 2); assert.equal(f.updates.at(-1).token, token);
  f.send('select', 'b'); await tick(); assert.deepEqual(completed, ['b']);
});
test('Bluetooth cancellation finishes callback once and a new request can start', async () => {
  const f = fixture(), completed = [], picker = createBluetoothPicker({ picker: f.picker, delay: 0 });
  const event = { preventDefault() {} };
  picker.select(event, [], id => completed.push(id)); picker.cancel(); await tick();
  assert.deepEqual(completed, ['']);
  picker.select(event, [], id => completed.push(id)); await tick(); f.send('cancel'); await tick();
  assert.deepEqual(completed, ['', '']);
});
test('serial errors retain actionable permission and busy-port explanations', () => {
  assert.match(serialError(new Error('EACCES'), '/dev/ttyUSB0').message, /dialout/);
  assert.match(serialError(new Error('Resource busy'), '/dev/ttyUSB0').message, /Serial Monitor/);
});
