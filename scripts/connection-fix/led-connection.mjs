// LEDDMX-00/03 profile: https://github.com/user154lt/LEDDMX-00
const uuid = value => value?.length === 4 ? `0000${value.toLowerCase()}-0000-1000-8000-00805f9b34fb` : value?.toLowerCase();
const serviceUUID = uuid('ffe0');
const characteristicUUID = uuid('ffe1');
// Variant 01 verified on LEDDMX-01-1F00: FFE0/FFE1, write-without-response.
const isDmx = name => /^LED[\s_-]*DMX[\s_-]*(?:00|01|03)(?:[\s_-]|$)/i.test(name || '');

export async function connectLed(target, settings, bluetooth = navigator.bluetooth) {
  if (!bluetooth) throw new Error('Bluetooth BLE belum tersedia. Periksa adapter dan Bluetooth Linux.');
  const services = new Set([serviceUUID]);
  if (settings.bleService) services.add(uuid(settings.bleService));
  let device;
  try {
    device = await bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [...services] });
  } finally {
    window.rvm?.cancelBluetoothSelection?.();
  }
  const automatic = isDmx(device.name);
  if (!automatic && (!settings.bleService || !settings.bleCharacteristic)) {
    throw new Error(`${device.name || 'Controller'} ditemukan, tetapi profilnya belum dikenali otomatis. Profil bawaan mendukung LEDDMX-00/01/03 dari LED LAMP. Catat nama perangkat ini untuk penyesuaian profil.`);
  }
  target.bluetooth = device;
  device.addEventListener('gattserverdisconnected', () => {
    if (target.bluetooth !== device) return;
    target.bleConnected = false;
    target.characteristic = null;
    target.ledProfile = null;
    target.emit({ type: 'ble', connected: false });
  });
  try {
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(automatic ? serviceUUID : uuid(settings.bleService));
    const characteristic = await service.getCharacteristic(automatic ? characteristicUUID : uuid(settings.bleCharacteristic));
    if (!characteristic.properties.write && !characteristic.properties.writeWithoutResponse) {
      throw new Error('Layanan controller tidak mendukung pengiriman perintah LED.');
    }
    if (!device.gatt.connected) throw new Error('Controller terputus saat membaca profil. Coba hubungkan kembali.');
    target.characteristic = characteristic;
    target.ledProfile = automatic ? 'leddmx' : 'custom';
    target.bleConnected = true;
    target.emit({ type: 'log', message: `${device.name || 'Controller'}: ${automatic ? 'profil LED LAMP / DMX otomatis' : 'profil koneksi manual'}` });
    target.emit({ type: 'ble', connected: true, name: device.name });
  } catch (error) {
    device.gatt.disconnect();
    target.bluetooth = null;
    target.characteristic = null;
    target.ledProfile = null;
    target.bleConnected = false;
    throw new Error(`Gagal menghubungkan ${device.name || 'controller'}. Tutup koneksi LED LAMP di HP jika masih aktif. ${error.message}`);
  }
}

export function dmxPackets({ mode, color, brightness }) {
  if (!['solid', 'running', 'rainbow'].includes(mode)) throw new Error('Mode LED tidak didukung.');
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Warna LED tidak valid.');
  if (!Number.isFinite(brightness) || brightness < 0 || brightness > 100) throw new Error('Brightness harus 0–100.');
  const level = Math.round(brightness);
  const packet = values => Uint8Array.from([0x7b, 0xff, ...values, 0xbf]);
  if (!level) return [packet([0x04, 0x02, 0xff, 0xff, 0xff, 0xff])];
  // Verified on LEDDMX-01-1F00: power 03, brightness mode 00, then RGB.
  // Brightness after RGB can restore the controller's previous animation.
  const frames = [packet([0x04, 0x03, 0xff, 0xff, 0xff, 0xff]),
    packet([0x01, Math.floor(level * 32 / 100), level, 0x00, 0xff, 0xff])];
  if (mode === 'solid') {
    const rgb = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
    // Repeat the idempotent static selection, matching the hardware-verified sequence.
    for (let repeat = 0; repeat < 3; repeat++) frames.push(packet([0x07, ...rgb, 0x00, 0xff]));
  } else {
    frames.push(packet([0x03, mode === 'running' ? 122 : 3, 0xff, 0xff, 0xff, 0xff]));
  }
  return frames;
}

export async function writeDmx(target, values) {
  const frames = dmxPackets(values);
  const characteristic = target.characteristic;
  if (!target.bleConnected || !characteristic) throw new Error('Controller LED belum terhubung.');
  const send = async () => {
    for (const frame of frames) {
      if (!target.bleConnected || target.characteristic !== characteristic) throw new Error('Controller terputus sebelum seluruh perintah LED terkirim.');
      if (characteristic.properties.write) await characteristic.writeValueWithResponse(frame);
      else await characteristic.writeValueWithoutResponse(frame);
      // The BLE write promise means queued, not applied by the controller MCU.
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  };
  const job = (target.ledWriteQueue || Promise.resolve()).catch(() => {}).then(send);
  target.ledWriteQueue = job;
  return job;
}
