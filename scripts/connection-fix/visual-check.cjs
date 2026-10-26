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
    browser = await chromium.launch({ headless: true, executablePath: process.env.RVM_CHROMIUM || '/home/rvm-prodesk/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome' });
    const page = await browser.newPage({ viewport: { width: 1024, height: 600 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window._actions = [];
      window.rvm = { load: async () => null, save: async () => {},
        devices: { onUpdate: listener => { window._showPicker = listener; }, action: data => window._actions.push(data) }
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window._showPicker && document.querySelector('#root')?.children.length);
    const items = Array.from({ length: 30 }, (_, index) => ({ id: `device-${index}`, name: index === 0 ? 'LEDDMX-03-AB12' : `Controller ${index} ${'nama-perangkat-panjang-'.repeat(4)}`, detail: `AA:BB:CC:DD:EE:${String(index).padStart(2, '0')}` }));
    for (const viewport of [{ width: 1024, height: 600 }, { width: 800, height: 480 }, { width: 480, height: 320 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(items => window._showPicker({ token: 'test', title: 'Pilih controller LED', detail: 'Pilih nama LED, lalu tekan Hubungkan. Profil LED LAMP / DMX dikenali otomatis bila didukung.', busy: false, items }), items);
      const layout = await page.evaluate(() => {
        const panel = document.querySelector('.rvm-device-panel'), list = document.querySelector('.rvm-device-list');
        const bounds = panel.getBoundingClientRect();
        const footer = document.querySelector('.rvm-device-footer').getBoundingClientRect();
        const rows = [...list.children].slice(0, 2).map(row => row.getBoundingClientRect());
        return { within: bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight,
          footer: footer.bottom <= innerHeight && footer.top >= 0, scrolls: list.scrollHeight > list.clientHeight,
          horizontal: list.scrollWidth > list.clientWidth, vertical: rows[1].top > rows[0].bottom,
          inert: document.getElementById('root').inert };
      });
      assert.ok(layout.within && layout.footer && layout.scrolls && layout.vertical && layout.inert, JSON.stringify(layout));
      assert.equal(layout.horizontal, false);
      await page.screenshot({ path: `/tmp/rvm-picker-${viewport.width}x${viewport.height}.png` });
      console.log(`Vertical list fits ${viewport.width}x${viewport.height}; footer visible; 30 devices scroll.`);
    }
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.getByRole('radio').first().check();
    await page.getByRole('button', { name: 'Hubungkan', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window._actions.at(-1)), { token: 'test', action: 'select', id: 'device-0' });
    await page.evaluate(() => window._showPicker({ token: 'test', closed: true }));
    assert.equal(await page.locator('[role=dialog]').count(), 0);
    assert.equal(await page.evaluate(() => document.getElementById('root').inert), false);
    // Device names are plain text, even when a device advertises HTML-like content.
    await page.evaluate(() => window._showPicker({ token: 'empty', title: 'Pilih port ESP32', items: [], busy: false }));
    assert.ok(await page.getByRole('button', { name: 'Hubungkan', exact: true }).isDisabled());
    await page.getByRole('button', { name: 'Scan ulang', exact: true }).click();
    assert.equal(await page.evaluate(() => window._actions.at(-1).action), 'scan');
    await page.evaluate(() => window._showPicker({ token: 'empty', title: 'Pilih port ESP32', items: [{ id: 'x', name: '<img src=x onerror=alert(1)>', detail: '/dev/ttyUSB0' }], busy: false }));
    assert.equal(await page.locator('.rvm-device-list img').count(), 0);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window._actions.at(-1).action), 'cancel');
    await page.evaluate(() => window._showPicker({ token: 'empty', closed: true }));
    // Exercise the actual React connection button with a simulated BLE peripheral.
    await page.getByRole('button', { name: 'Admin', exact: true }).click();
    await page.getByLabel('PIN administrator', { exact: true }).fill('123456');
    await page.getByRole('button', { name: /Buka panel admin/ }).click();
    await page.getByRole('button', { name: 'Mode demo', exact: true }).click();
    await page.evaluate(() => {
      const device = { name: 'LEDDMX-03-TEST', addEventListener() {}, gatt: {
        connected: false,
        async connect() { this.connected = true; return { async getPrimaryService(uuid) {
          if (!uuid.includes('ffe0')) throw new Error('Wrong automatic service');
          return { async getCharacteristic(uuid) {
            if (!uuid.includes('ffe1')) throw new Error('Wrong automatic characteristic');
            return { properties: { write: true }, async writeValueWithResponse() {} };
          } };
        } }; },
        disconnect() { this.connected = false; }
      } };
      Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: {
        requestDevice() {
          window._showPicker({ token: 'integration', title: 'Pilih controller LED', detail: 'Pilih nama LED, lalu tekan Hubungkan.', busy: false, items: [{ id: 'led-test', name: device.name }] });
          return new Promise((resolve, reject) => {
            window.rvm.devices.action = data => {
              if (data.token !== 'integration') return;
              if (data.action === 'select') { window._showPicker({ token: data.token, closed: true }); resolve(device); }
              if (data.action === 'cancel') { window._showPicker({ token: data.token, closed: true }); reject(new Error('Cancelled')); }
            };
          });
        }
      } });
      window.rvm.cancelBluetoothSelection = () => {};
    });
    await page.getByRole('button', { name: /LED controller.*Scan BLE/ }).click();
    await page.getByRole('radio').check();
    await page.getByRole('button', { name: 'Hubungkan', exact: true }).click();
    await page.getByText('LED LAMP · otomatis', { exact: true }).waitFor();
    await page.screenshot({ path: '/tmp/rvm-led-connected.png' });
    await page.getByRole('button', { name: 'Konfigurasi koneksi', exact: true }).click();
    assert.equal(await page.locator('details').getAttribute('open'), null);
    assert.ok(await page.getByText('Pengaturan manual (opsional)', { exact: true }).isVisible());
    await page.screenshot({ path: '/tmp/rvm-led-settings.png' });
    assert.deepEqual(errors, []);
    console.log('Selection, cancel, rescan, empty state, escaped labels, automatic LED connection and optional settings passed.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
