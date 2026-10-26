// Listen only for a fresh RFID event, never a retained telemetry UID.
export function createProfileRFIDScanner(React, transport) {
  return function useProfileRFIDScan(profileId, firmware, onUID) {
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const pending = React.useRef(null);
    const receive = React.useRef(onUID);
    receive.current = onUID;
    function cancel() {
      pending.current?.();
      pending.current = null;
      setBusy(false);
      setMessage('');
    }
    React.useEffect(() => {
      setBusy(false);
      setMessage('');
      return () => { pending.current?.(); pending.current = null; };
    }, [profileId]);
    function scan() {
      cancel();
      if (!profileId) return;
      if (!transport.connected) { setMessage('Hubungkan ESP32 di Uji komponen terlebih dahulu.'); return; }
      if (!/^almufti-diag-/.test(firmware || '')) {
        setMessage('Gunakan firmware pengujian untuk scan UID.'); return;
      }
      let finished = false, timer;
      const finish = (text, uid) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        off();
        pending.current = null;
        setBusy(false);
        setMessage(text);
        if (uid) receive.current(uid);
      };
      const off = transport.on(event => {
        if (event.type === 'serial' && !event.connected) {
          finish('Koneksi ESP32 terputus. Hubungkan kembali lalu tekan Scan now.');
        } else if (event.type === 'rfid') {
          const uid = String(event.uid || '').replace(/[\s:-]/g, '').toUpperCase();
          if (/^(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$/.test(uid)) finish('UID terbaca. Periksa nama lalu simpan anggota.', uid);
        }
      });
      pending.current = () => {
        finished = true;
        clearTimeout(timer);
        off();
      };
      setBusy(true);
      setMessage('Tempelkan kartu ke reader RFID…');
      timer = setTimeout(() => finish('Kartu belum terbaca. Tekan Scan now untuk mencoba lagi.'), 15000);
      // Reset the diagnostic reader so the same held card can be scanned again.
      transport.command('rfid_scan').catch(error => finish(`Scan gagal: ${error.message}`));
    }
    return { busy, message, scan, cancel };
  };
}
