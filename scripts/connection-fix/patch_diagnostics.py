"""Focused changes to the supplied diagnostic screen and telemetry parser."""
def patch(ui, replace):
    ui=replace(ui, '"loadcellReady","loadcellCalibrated"', '"loadcellStable","scaleBusy","loadcellReady","loadcellCalibrated"')
    ui=replace(ui, '"loadcellRaw","loadcellFiltered"', '"motorContinuous","loadcellSpread","loadcellSpreadGrams","loadcellRaw","loadcellFiltered"')
    ui=replace(ui, 'return kf(o.rfidUid)&&(j.rfidUid=gu(o.rfidUid))', 'for(const key of ["irRaw","irPolarity"])if(Array.isArray(o[key])&&o[key].length===4&&o[key].every(v=>typeof v==="boolean"))j[key]=o[key];return (o.rfidUid===""||kf(o.rfidUid))&&(j.rfidUid=gu(o.rfidUid))')
    ui=replace(ui, 'return (o.rfidUid===""||kf(o.rfidUid))', 'for(const key of ["relayOn","relayRaw"])if(Array.isArray(o[key])&&o[key].length===2&&o[key].every(v=>typeof v==="boolean"))j[key]=o[key];return (o.rfidUid===""||kf(o.rfidUid))')
    start=ui.index('function Og(');end=ui.index('const Cg=',start)
    panel=ui[start:end]
    panel=replace(panel, 'A.useEffect(()=>()=>{Bt.current&&clearInterval(Bt.current)},[])', 'A.useEffect(()=>()=>{Bt.current&&clearInterval(Bt.current)},[]),A.useEffect(()=>()=>{if(F==="motor"){Bt.current&&clearInterval(Bt.current);Bt.current=null;zt(false);if(!tt&&Ml.connected)Ml.command("motor_stop").catch(()=>{})}},[F,tt,f])')
    panel=replace(panel, 'async function M(){', '''async function continuous(direction){if(tt){zt(true);Bt.current=setInterval(()=>{le.current+=direction*bt/10;Qt(Math.round(le.current))},100)}else await ct("motor_run",{direction,speed:bt})}async function M(){''')
    panel=replace(panel, 'c.jsx(se,{color:o.ir[$]?"green":"gray",children:o.ir[$]?"HIGH*":"LOW*"})', '''c.jsx(se,{color:o.ir[$]?"green":"gray",children:tt?"Simulasi":!f||!o.irRaw?"—":o.irRaw[$]?"HIGH (1)":"LOW (0)"}),c.jsxs("select",{"aria-label":`Polaritas IR ${$+1}`,disabled:!m||!!X,value:String(o.irPolarity?.[$]??o.irActiveLow!==false),onChange:e=>{const activeLow=e.target.value==="true";ct("ir_config",{sensor:$,activeLow},()=>j({...o,irPolarity:[0,1,2,3].map(i=>i===$?activeLow:(o.irPolarity?.[i]??o.irActiveLow!==false))}))},children:[c.jsx("option",{value:"true",children:"Active LOW"}),c.jsx("option",{value:"false",children:"Active HIGH"})]})''')
    panel=replace(panel,'children:"Polaritas trigger"','children:"Terapkan ke semua IR"')
    panel=replace(panel,'ct("ir_config",{activeLow:w.target.value==="true"},()=>j({...o,irActiveLow:w.target.value==="true"}))','ct("ir_config",{activeLow:w.target.value==="true"},()=>j({...o,irActiveLow:w.target.value==="true",irPolarity:Array(4).fill(w.target.value==="true")}))')
    panel=replace(panel,'* Status logis trigger. Polaritas fisik dapat disesuaikan di atas.','HIGH/LOW adalah level pin asli. HIGH saat kosong dan LOW saat ada objek sesuai Active LOW. Uji setiap sensor dengan mendekatkan dan menjauhkan objek; polaritas bisa berbeda per sensor.')
    panel=replace(panel,'o.rfidReady?"RC522 terbaca":"RC522 belum terbaca"','!f?"Offline":o.rfidReady?"Modul siap":"Modul belum siap"')
    panel=replace(panel,'children:o.uid?"UID KARTU TERBACA":"MENUNGGU KARTU RFID"','children:!f&&!tt?"ESP BELUM TERHUBUNG":o.uid?o.rfidCardPresent||tt?"UID KARTU TERBACA":"UID KARTU TERAKHIR":"BELUM ADA UID VALID"')
    panel=replace(panel,'o.rfidStatus===0?"UID valid"','o.rfidStatus===0&&o.rfidCardPresent&&o.uid?"UID valid"')
    panel=replace(panel,'UID terakhir dapat dipakai saat mendaftarkan anggota di Database.','UID hasil scan terakhir. Lepas lalu tempelkan kartu untuk scan berikutnya, mengikuti program dasar RFID Anda.')
    panel=replace(panel,'disabled:!m||ft,busy:X==="motor_move"','disabled:!m||ft||!!X,busy:X==="motor_move"')
    panel=replace(panel,'c.jsxs("div",{className:"motor-actions",children:[','''c.jsxs("div",{className:"motor-actions",children:[c.jsx(ee,{disabled:!m||ft||!!X,busy:X==="motor_run",onClick:()=>continuous(1),children:"Forward terus"}),c.jsx(ee,{secondary:true,disabled:!m||ft||!!X,onClick:()=>continuous(-1),children:"Reverse terus"}),''')
    panel=replace(panel,'Posisi adalah jumlah pulsa dari titik awal firmware. Konfigurasi microstep mengikuti DIP switch TB6600.','Forward/Reverse berjalan terus sampai Stop. Hentikan sebelum mengganti arah. Firmware menghentikan motor jika heartbeat ESP putus selama 3 detik. RFID dan loadcell dijeda selama motor berjalan. Posisi merupakan hitungan pulsa, bukan posisi hasil sensor.')
    panel=replace(panel,'D?"Berat dari ESP"','D?"Berat dari sampel RAW"')
    panel=replace(panel,'"200 ms · median 5 + perataan · "','"HX711 RAW · tiap 500 ms · "')
    panel=replace(panel,'" · DT ",o.loadcellDout?"HIGH":"LOW"','" · DT ",o.loadcellDout?"HIGH":"LOW"," · Rentang 10 sampel: ",Xt(o.loadcellSpread??0)," ADC",D?` (${Xt(o.loadcellSpreadGrams??0)} gram)`:""')
    panel=replace(panel,'o.loadcellDelta??o.loadcellRaw','o.loadcellRaw')
    panel=replace(panel,'b=tt||f&&o.loadcellReady===!0&&!o.loadcellSaturated','b=tt||f')
    panel=replace(panel,'ft=tt?Ht:!!o.motorMoving;', 'ft=tt?Ht:!!o.motorMoving;const[scaleMessage,setScaleMessage]=A.useState("");const liveUid=tt?o.uid:f?(o.rfidUid??o.uid??""):"";')
    panel=replace(panel,'async function ct(w,$={},kt){z(w);try{','async function ct(w,$={},kt){z(w);if(w==="tare"||w==="calibrate")setScaleMessage("Mengambil sampel…");try{')
    panel=replace(panel,'Y(`${tt?"DEMO":"ESP"} ${w} ${JSON.stringify($)}`)}catch(Lt){T(Lt.message)}', 'Y(`${tt?"DEMO":"ESP"} ${w} ${JSON.stringify($)}`);if(w==="tare"||w==="calibrate")setScaleMessage(tt?"Simulasi selesai.":"Berhasil. Pengaturan timbangan disimpan.")}catch(Lt){T(Lt.message);if(w==="tare"||w==="calibrate")setScaleMessage(Lt.message)}')
    panel=replace(panel,'c.jsxs(ee,{className:"full",secondary:!0,disabled:!b', 'c.jsx("p",{role:"status",className:"scale-diagnostics",children:!m?"Hubungkan ESP untuk Zero/Kalibrasi.":ft?"Stop motor sebelum Zero/Kalibrasi.":X||o.scaleBusy?"Tunggu proses yang sedang berjalan.":scaleMessage||"Zero/Kalibrasi dapat dicoba. ESP akan memeriksa sampel sebelum menyimpan."}),c.jsxs(ee,{className:"full",secondary:!0,disabled:!b')
    panel=replace(panel,'children:"Pulihkan reader"','children:"Pulihkan reader"')
    panel=replace(panel,'ct("rfid_reset")','ct("rfid_scan",{},()=>j({...o,uid:"",rfidUid:"",rfidCardPresent:false}))')
    panel=replace(panel,'disabled:!b,busy:X==="tare"','disabled:!b||!!X||!!o.scaleBusy||ft,busy:X==="tare"')
    panel=replace(panel,'disabled:!b||yt<=0||yt>1e4','disabled:!b||!!X||!!o.scaleBusy||ft||yt<=0||yt>1e4')
    panel=replace(panel,'3. Tekan Kalibrasi.','3. Tunggu beban diam, lalu tekan Kalibrasi. Sampel yang terlalu berubah ditolak; zero/faktor lama dipertahankan.')
    panel=replace(panel,'children:p[$]?"Perintah ON":"Perintah OFF"','children:p[$]?"Output ON":"Output OFF"')
    panel=replace(panel,'children:[33,15].map((w,$)', 'children:[15,33].map((w,$)')
    panel=replace(panel,'[bt,Gt]=A.useState(800)','[bt,Gt]=A.useState(500)')
    panel=replace(panel,'[tt]);async function ct(', '[tt]),A.useEffect(()=>{if(f&&Array.isArray(o.relayOn))k(o.relayOn)},[f,o.relayOn]);async function ct(')
    panel=replace(panel,'k(kt=>kt.map((Lt,Ct)=>Ct===$?!Lt:Lt))','k(kt=>kt.map((Lt,Ct)=>Ct===$?!p[$]:Lt))')
    panel=replace(panel,'value:String(I),onChange:w=>it(w.target.value==="true")','value:"true",disabled:true,onChange:w=>it(true)')
    panel=replace(panel,'pin:w,on:!p[$],activeLow:I','pin:w,on:!p[$],activeLow:true')
    panel=replace(panel,'Sesuaikan dengan modul relay yang terpasang','Active LOW sesuai tes dasar · Relay 1 GPIO15 · Relay 2 GPIO33')
    panel=replace(panel,'Status menunjukkan perintah terakhir yang diterima. Pastikan relay berbunyi atau output berubah untuk memverifikasi.','Status mengikuti output firmware. Relay mulai OFF dan kembali OFF jika heartbeat app terputus.')
    rfid_start=panel.index('F==="rfid"&&')
    rfid_end=panel.index('F==="relay"&&',rfid_start)
    live_panel=panel[rfid_start:rfid_end].replace('o.uid','liveUid')
    panel=panel[:rfid_start]+live_panel+panel[rfid_end:]
    ui = ui[:start]+panel+ui[end:]
    for old, new in [
        ('o.ir.length===4', 'o.ir.length===3'),
        ('o[key].length===4', 'o[key].length===3'),
        ('ir:[!1,!1,!1,!1]', 'ir:[!1,!1,!1]'),
        ('4 input digital · ESP32', '3 input digital · ESP32'),
        ('[14,25,26,27]', '[14,26,27]'),
        ('[0,1,2,3].map(i=>i===$', '[0,1,2].map(i=>i===$'),
        ('irPolarity:Array(4)', 'irPolarity:Array(3)'),
        ('HX711 · DT GPIO 35 · SCK GPIO 32', 'HX711 · DT GPIO 34 · SCK GPIO 32'),
        ('[["MISO",19],["MOSI",23],["RST",17],["SDA / SS",5],["SCK",18]]', '[["MISO",13],["MOSI",21],["RST",17],["SDA / SS",16],["SCK",22]]'),
        ('TB6600 · PUL GPIO 2 · DIR GPIO 4', 'TB6600 · PUL GPIO 2 · DIR GPIO 4 · ENA GPIO 25 (LOW aktif)'),
    ]:
        if old == "[14,25,26,27]":
            assert old in ui
            ui = ui.replace(old, new)
        else:
            ui = replace(ui, old, new)
    return ui
