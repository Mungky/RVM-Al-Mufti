const bridge = window.rvm?.devices;
if (bridge) {
  let overlay, list, status, connect, refresh, token, selected, lastFocus, root, wasInert;
  let rows = new Map();
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    element.className = className;
    if (text) element.textContent = text;
    return element;
  };
  function send(action, id) { bridge.action({ token, action, id }); }
  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    rows.clear();
    if (root) root.inert = wasInert;
    if (lastFocus?.isConnected) lastFocus.focus();
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(event) {
    if (!overlay) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); send('cancel'); }
    if (event.key === 'Tab') {
      const elements = [...overlay.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }
  function mount(data) {
    token = data.token;
    selected = '';
    lastFocus = document.activeElement;
    root = document.getElementById('root');
    if (root) { wasInert = root.inert; root.inert = true; }
    overlay = node('div', 'rvm-device-overlay');
    const panel = node('section', 'rvm-device-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'rvm-device-title');
    panel.setAttribute('aria-describedby', 'rvm-device-detail');
    const header = node('header', 'rvm-device-header');
    const title = node('h2', '', data.title); title.id = 'rvm-device-title';
    const dismiss = node('button', 'rvm-device-close', '×');
    dismiss.setAttribute('aria-label', 'Tutup pemilihan perangkat');
    dismiss.onclick = () => send('cancel');
    header.append(title, dismiss);
    const detail = node('p', 'rvm-device-detail', data.detail); detail.id = 'rvm-device-detail';
    status = node('p', 'rvm-device-status'); status.setAttribute('role', 'status');
    list = node('div', 'rvm-device-list'); list.setAttribute('role', 'radiogroup'); list.setAttribute('aria-label', 'Perangkat tersedia');
    const footer = node('footer', 'rvm-device-footer');
    const cancel = node('button', 'rvm-device-secondary', 'Batal'); cancel.onclick = () => send('cancel');
    refresh = node('button', 'rvm-device-secondary', 'Scan ulang'); refresh.onclick = () => send('scan');
    connect = node('button', 'rvm-device-primary', 'Hubungkan'); connect.disabled = true;
    connect.onclick = () => send('select', selected);
    footer.append(cancel, refresh, connect);
    panel.append(header, detail, status, list, footer);
    overlay.append(panel);
    document.body.append(overlay);
    document.addEventListener('keydown', onKey, true);
    dismiss.focus();
  }
  bridge.onUpdate(data => {
    if (data.closed) { if (token === data.token) close(); return; }
    if (!overlay || token !== data.token) { close(); mount(data); }
    const items = data.items || [];
    const ids = new Set(items.map(item => item.id));
    for (const [id, row] of rows) if (!ids.has(id)) { row.label.remove(); rows.delete(id); }
    if (!ids.has(selected)) selected = '';
    for (const item of items) {
      let row = rows.get(item.id);
      if (!row) {
        const label = node('label', 'rvm-device-row');
        const radio = node('input', ''); radio.type = 'radio'; radio.name = 'rvm-device'; radio.value = item.id;
        const text = node('span', 'rvm-device-text');
        const name = node('strong', ''), detail = node('small', '');
        text.append(name, detail); label.append(radio, text); list.append(label);
        radio.onchange = () => {
          selected = item.id;
          connect.disabled = refresh.disabled;
          for (const [id, entry] of rows) entry.label.classList.toggle('selected', id === selected);
        };
        row = { label, radio, name, detail }; rows.set(item.id, row);
      }
      row.name.textContent = item.name;
      row.detail.textContent = item.detail || '';
      row.radio.checked = item.id === selected;
      row.label.classList.toggle('selected', item.id === selected);
    }
    status.textContent = data.error || (data.busy ? 'Mencari perangkat…' : items.length ? `${items.length} perangkat ditemukan. Pilih satu untuk dihubungkan.` : 'Belum ada perangkat. Periksa sambungan lalu tekan Scan ulang.');
    status.classList.toggle('error', !!data.error);
    refresh.disabled = !!data.busy;
    refresh.textContent = data.busy ? 'Memindai…' : 'Scan ulang';
    connect.disabled = !!data.busy || !selected;
  });
}
