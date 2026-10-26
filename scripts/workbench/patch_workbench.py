from pathlib import Path
HERE=Path(__file__).parent
ROOT=HERE.parents[1]
def patch(files,replace):
    main=files['electron/main.cjs'].decode()
    main=replace(main,"session } = require('electron')","session, nativeImage } = require('electron')")
    main=replace(main,"const { registerFirmwareIPC } = require('./firmware.cjs');", "const { registerFirmwareIPC } = require('./firmware.cjs');\nconst {createDiagnosticInstaller}=require('./diagnostic-connect.cjs');\nconst {registerVisionIPC}=require('./vision.cjs');")
    main=replace(main,'serialPort, firmware;', 'serialPort, firmware, diagnosticInstaller, vision;')
    main=replace(main,"ipcMain.handle('kiosk', () => window.setKiosk(!window.isKiosk()));", "ipcMain.handle('kiosk', () => window.setFullScreen(!window.isFullScreen()));")
    main=replace(main,'closeSerial,listPorts:()=>SerialPort.list()});','closeSerial,listPorts:()=>SerialPort.list(),externalBusy:()=>diagnosticInstaller?.isBusy()});')
    main=main.replace('firmware.isUploading()', '(firmware.isUploading()||diagnosticInstaller?.isBusy())')
    marker="  ipcMain.handle('serial:connect', async (event,baud) => {"
    main=replace(main,marker,"""  const workspace=process.env.RVM_WORKSPACE||(app.isPackaged?path.resolve(path.dirname(app.getPath('exe')),'../..'):path.resolve(__dirname,'..'));
  diagnosticInstaller=createDiagnosticInstaller({workspace,resources:path.resolve(__dirname,'..'),SerialPort,emit:state=>{if(window&&!window.isDestroyed())window.webContents.send('diagnostic:event',state)}});
  vision=registerVisionIPC({app,ipcMain,nativeImage,checkSender:checkSerialSender,getWindow:()=>window});
  ipcMain.handle('serial:connect', async (event,baud,options={}) => {""")
    main=replace(main,'    const port=new SerialPort({path:selected.path,baudRate:baud,autoOpen:false});', "    if(options?.diagnostic===true){if(firmware.isBusy())throw Error('Tunggu compile/upload selesai.');if(baud!==115200)throw Error('Firmware pengujian memakai 115200 baud.');await diagnosticInstaller.ensure(selected.path);}\n    const port=new SerialPort({path:selected.path,baudRate:baud,autoOpen:false});")
    main=replace(main,'width:1024, height:600, minWidth:800, minHeight:480','width:1024, height:768, minWidth:800, minHeight:600')
    main=replace(main,"kiosk:process.argv.includes('--kiosk')", "fullscreen:!process.argv.includes('--windowed')")
    main=replace(main,"if(argv.includes('--kiosk'))window.setKiosk(true)","if(argv.includes('--kiosk'))window.setFullScreen(true)")
    main=replace(main,"window.webContents.on('before-input-event', (_,input) => { if(input.key==='F11' && input.type==='keyDown') window.setKiosk(!window.isKiosk()); if(input.key==='Escape' && window.isKiosk()) window.setKiosk(false); });", "window.webContents.on('before-input-event', (event,input) => {if(input.key==='F11' && input.type==='keyDown' && !input.isAutoRepeat){event.preventDefault();window.setFullScreen(!window.isFullScreen());}});\n  window.on('leave-full-screen',()=>window.setContentSize(1024,768));")
    main=replace(main,"firmware?.shutdown();", "firmware?.shutdown();vision?.shutdown();")
    files['electron/main.cjs']=main.encode()
    preload=files['electron/preload.cjs'].decode()
    preload=replace(preload,"connect: baud => ipcRenderer.invoke('serial:connect', baud)","connect: (baud,options) => ipcRenderer.invoke('serial:connect', baud,options)")
    methods=['status','list','create','addClass','capture','removeSample','sample','train','predict','cancel','stopTest']
    api='vision: {'+','.join(f"{name}:args=>ipcRenderer.invoke('vision:{name}',args)" for name in methods)+",onEvent:callback=>{const listener=(_,state)=>callback(state);ipcRenderer.on('vision:event',listener);return()=>ipcRenderer.removeListener('vision:event',listener);}},\n"
    preload=replace(preload,'  serial: {',"  "+api+"  onDiagnostic:callback=>{const listener=(_,state)=>callback(state);ipcRenderer.on('diagnostic:event',listener);return()=>ipcRenderer.removeListener('diagnostic:event',listener);},\n  serial: {")
    preload=replace(preload,"load:()=>ipcRenderer.invoke('firmware:load'),","load:()=>ipcRenderer.invoke('firmware:load'),openDraft:kind=>ipcRenderer.invoke('firmware:openDraft',kind),")
    files['electron/preload.cjs']=preload.encode()
    ui_path='dist/assets/index-DIPzI07i.js';ui=files[ui_path].decode()
    ui=replace(ui,'window.innerHeight/600','window.innerHeight/768')
    ui=replace(ui,'1024 × 600 ','1024 × 768 ')
    ui=replace(ui,'Draft produksi disimpan.','Draft firmware disimpan.')
    ui=replace(ui,'async connectSerial(o){','async connectSerial(o,options={}){')
    ui=replace(ui,'const T=await j.connect(o);','const T=await j.connect(o,options);')
    ui=replace(ui,'await Ml.connectSerial(o.settings.baud):O?', 'await Ml.connectSerial(B==="components"?115200:o.settings.baud,{diagnostic:B==="components"}):O?')
    ui=replace(ui,'z==="serial"?"Memindai…":f?"Terhubung":"Scan port"','z==="serial"?"Menyiapkan…":f?"Terhubung":B==="components"?"Hubungkan & siapkan":"Scan port"')
    # Diagnostic progress is visible in the admin shell, including failed upload.
    ui=replace(ui,'[Ut,Ot]=A.useState(o.settings.ledTemplate);async function U', '[Ut,Ot]=A.useState(o.settings.ledTemplate);const[diagnosticState,setDiagnosticState]=A.useState(null);A.useEffect(()=>window.rvm?.onDiagnostic?.(setDiagnosticState),[]);async function U')
    ui=replace(ui,'c.jsxs("div",{className:"admin-content",children:[','c.jsxs("div",{className:"admin-content",children:[B==="components"&&c.jsx("p",{className:"diagnostic-install-status",role:"status",children:diagnosticState?.message||"Hubungkan & siapkan akan memasang firmware pengujian jika versi ESP belum sesuai. Firmware yang sedang berjalan akan diganti dengan template pengujian."}),')
    ui=replace(ui,'B==="model"&&c.jsx(qg,{...g})', 'B==="model"&&c.jsxs(c.Fragment,{children:[c.jsx(ModelStudio,{...g}),c.jsxs("details",{className:"studio-legacy",children:[c.jsx("summary",{children:"Model impor lama (.pt / .onnx)"}),c.jsx(qg,{...g})]})]})')
    ui=replace(ui,'function Rg(g){','const ModelStudio=createModelStudio(A);function Rg(g){')
    ui='import {createModelStudio} from "./model-studio.mjs";\n'+ui
    # Template remains an immutable packaged source; copying into the editor is explicit.
    ui=replace(ui,'children:"Salin firmware uji"','children:"Firmware pengujian siap upload"')
    ui=replace(ui,'O(await j.template(b)),g(b===', 'await j.save(f);const draft=await j.openDraft(b);O(draft.code);B(draft.code);Gt(draft.draftPath);it(draft.state);g(b===')
    ui=replace(ui,'children:"production.ino"','children:I.editorKind==="diagnostic"?"diagnostic.ino":"production.ino"')
    ui=replace(ui,'Kerangka produksi dimuat. Isi aturan mesin sebelum menjalankan setoran.','Draft produksi dibuka. Lengkapi aturan mesin sebelum menjalankan setoran.')
    ui=replace(ui,'Salinan firmware uji dimuat ke editor. Source firmware uji tetap tersimpan.','Draft pengujian dibuka. Compile lalu Upload untuk memasang ke ESP baru.')
    ui=replace(ui,'Draft produksi terpisah dari firmware uji · satu file .ino','Draft pengujian dan produksi disimpan terpisah · template bawaan tetap tersedia')
    files[ui_path]=ui.encode()
    files['dist/assets/index-Cahcuz_X.css']+=b'\n'+(HERE/'workbench.css').read_bytes()
    for name in ['vision.cjs','vision-worker.py','diagnostic-connect.cjs','firmware.cjs']:files['electron/'+name]=(HERE/name).read_bytes()
    files['dist/assets/model-studio.mjs']=(HERE/'model-studio.mjs').read_bytes()
    for file in (ROOT/'firmware/builds/rvm_diag').glob('*.bin'):files['firmware/builds/rvm_diag/'+file.name]=file.read_bytes()
    files['firmware/builds/rvm_diag/verification.json']=(ROOT/'firmware/builds/rvm_diag/verification.json').read_bytes()
