const { randomUUID } = require('node:crypto');

// One in-page, scrollable picker. No device names are rendered as native buttons.
function createDevicePicker({ window, ipcMain, checkSender }) {
  let active = null;
  const alive = () => !window.isDestroyed() && !window.webContents.isDestroyed?.();
  function publish(state) {
    if (active !== state || !alive()) return;
    window.webContents.send('devices:update', {
      token: state.token, title: state.title, detail: state.detail,
      items: [...state.items.values()], busy: state.busy, error: state.error
    });
  }
  function finish(state, selection = null) {
    if (active !== state) return;
    active = null;
    if (alive()) window.webContents.send('devices:update', { token: state.token, closed: true });
    state.resolve(selection);
  }
  async function scan(state) {
    if (active !== state || state.busy) return;
    state.busy = true;
    state.error = '';
    publish(state);
    try {
      const items = await state.scan();
      if (active === state) state.items = new Map(items.map(item => [item.id, item]));
    } catch (error) {
      state.error = error.message || String(error);
    } finally {
      state.busy = false;
      publish(state);
    }
  }
  function onAction(event, data) {
    checkSender(event);
    const state = active;
    if (!state || data?.token !== state.token) return;
    if (data.action === 'cancel') finish(state);
    if (data.action === 'scan') void scan(state);
    if (data.action === 'select' && !state.busy && state.items.has(data.id)) finish(state, state.items.get(data.id));
  }
  ipcMain.on('devices:action', onAction);
  window.webContents.once('destroyed', () => {
    if (active) finish(active);
    ipcMain.removeListener('devices:action', onAction);
  });
  return {
    open({ title, detail, scan: scanItems }) {
      if (active) throw new Error('Pemilihan perangkat lain masih terbuka.');
      const state = { token: randomUUID(), title, detail, scan: scanItems, items: new Map(), busy: false, error: '' };
      const result = new Promise(resolve => { state.resolve = resolve; });
      active = state;
      void scan(state);
      return {
        result,
        update(items) {
          if (active !== state) return;
          state.items = new Map(items.map(item => [item.id, item]));
          publish(state);
        },
        cancel() { finish(state); }
      };
    }
  };
}

async function selectSerialPort({ listPorts, picker }) {
  let detail = 'Pilih ESP32, lalu tekan Hubungkan. Gunakan kabel USB data.';
  for (;;) {
    const request = picker.open({ title: 'Pilih port ESP32', detail,
      scan: async () => (await listPorts()).map(port => ({ id: port.path, name: port.manufacturer || 'USB Serial', detail: port.path }))
    });
    const selected = await request.result;
    if (!selected) throw new Error('Pemilihan port dibatalkan.');
    const port = (await listPorts()).find(port => port.path === selected.id);
    if (port) return port;
    detail = 'Port tadi sudah terputus. Sambungkan kembali ESP32, lalu pilih port yang tersedia.';
  }
}

function serialError(error, port) {
  const message = error?.message || String(error);
  if (/EACCES|permission denied|access denied/i.test(message)) {
    return new Error(`Izin akses ${port} ditolak. Pada Linux, akun perlu izin grup dialout; logout/login setelah izin diberikan. Detail: ${message}`);
  }
  if (/busy|locked|cannot lock|resource temporarily unavailable/i.test(message)) {
    return new Error(`Port ${port} sedang digunakan. Tutup Serial Monitor atau aplikasi lain yang memakai ESP32, lalu coba lagi. Detail: ${message}`);
  }
  return new Error(`Gagal membuka ${port}. Periksa kabel USB data dan sambungan ESP32. Detail: ${message}`);
}

function createBluetoothPicker({ picker, delay = 1200 }) {
  let current = null;
  const items = state => [...state.devices.values()].map(device => ({
    id: device.deviceId, name: device.deviceName || 'Perangkat tanpa nama', detail: device.deviceId
  }));
  function finish(state, id = '') {
    if (!state || current !== state) return;
    current = null;
    state.request?.cancel();
    state.callback(id);
  }
  return {
    select(event, devices, callback) {
      event.preventDefault();
      if (!current) {
        const state = { devices: new Map(), callback, request: null };
        current = state;
        try {
          state.request = picker.open({ title: 'Pilih controller LED',
            detail: 'Nyalakan controller. Pilih nama LED, lalu tekan Hubungkan. Profil LED LAMP / DMX dikenali otomatis bila didukung.',
            scan: async () => { await new Promise(resolve => setTimeout(resolve, delay)); return items(state); }
          });
          state.request.result.then(selected => finish(state, selected?.id || ''), () => finish(state));
        } catch {
          finish(state);
          return;
        }
      }
      current.callback = callback;
      for (const device of devices) current.devices.set(device.deviceId, device);
      current.request.update(items(current));
    },
    cancel() { finish(current); }
  };
}

module.exports = { createDevicePicker, selectSerialPort, serialError, createBluetoothPicker };
