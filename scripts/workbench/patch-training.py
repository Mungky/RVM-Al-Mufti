"""Refresh import-only YOLO modules without changing firmware."""
import hashlib,json,struct,shutil
from pathlib import Path
root=Path(__file__).resolve().parents[2]
archive=root/'release/linux-unpacked/resources/app.asar'
raw=archive.read_bytes();_,size,_,count=struct.unpack('<4I',raw[:16]);header=json.loads(raw[16:16+count]);payload=raw[8+size:]
def entries(node,prefix=''):
    for name,item in node['files'].items():
        key=prefix+name
        if 'files' in item:yield from entries(item,key+'/')
        elif 'offset' in item:yield key,item
files={p:payload[int(i['offset']):int(i['offset'])+i['size']] for p,i in entries(header)}
original=files.copy()
for target,source in {'electron/vision.cjs':'scripts/workbench/vision.cjs','electron/vision-worker.py':'scripts/workbench/vision-worker.py','dist/assets/model-studio.mjs':'scripts/workbench/model-studio.mjs','dist/assets/production-client.mjs':'scripts/production/production-client.mjs'}.items():files[target]=(root/source).read_bytes()
preload=files['electron/preload.cjs'].decode()
a=preload.index('  vision: {');b=preload.index('\n',a)
methods=['status','list','importModel','predict','stopTest']
api='  vision: {'+','.join(f"{method}:args=>ipcRenderer.invoke('vision:{method}',args)" for method in methods)+",onEvent:callback=>{const listener=(_,state)=>callback(state);ipcRenderer.on('vision:event',listener);return()=>ipcRenderer.removeListener('vision:event',listener);}},"
preload=preload[:a]+api+preload[b:]
preload=preload.replace("modelImport: () => ipcRenderer.invoke('model:import'), ",'')
files['electron/preload.cjs']=preload.encode()
main=files['electron/main.cjs'].decode()
if "ipcMain.handle('model:import'" in main:
    a=main.index("  ipcMain.handle('model:import'");b=main.index("  ipcMain.handle('external'",a);main=main[:a]+main[b:]
main=main.replace('registerVisionIPC({app,ipcMain,nativeImage,checkSender:', 'registerVisionIPC({app,ipcMain,nativeImage,dialog,checkSender:')
files['electron/main.cjs']=main.encode()
p='dist/assets/index-DIPzI07i.js';ui=files[p].decode()
old='B==="model"&&c.jsxs(c.Fragment,{children:[c.jsx(ModelStudio,{...g}),c.jsxs("details",{className:"studio-legacy",children:[c.jsx("summary",{children:"Model impor lama (.pt / .onnx)"}),c.jsx(qg,{...g})]})]})'
if old in ui:ui=ui.replace(old,'B==="model"&&c.jsx(ModelStudio,{...g})',1)
# Remove the obsolete importer component, which cannot run inference.
if 'function qg(' in ui:
    a=ui.index('function qg(');b=ui.index('function wg(',a);ui=ui[:a]+ui[b:]
files[p]=ui.encode()
chunks=[];offset=0
for p,item in entries(header):
    data=files[p];item['offset']=str(offset);item['size']=len(data);block=item.get('integrity',{}).get('blockSize',4194304)
    item['integrity']={'algorithm':'SHA256','hash':hashlib.sha256(data).hexdigest(),'blockSize':block,'blocks':[hashlib.sha256(data[j:j+block]).hexdigest() for j in range(0,len(data),block)]}
    chunks.append(data);offset+=len(data)
encoded=json.dumps(header,separators=(',',':'),ensure_ascii=False).encode();s=struct.pack('<I',len(encoded))+encoded;s+=b'\0'*(-len(s)%4);h=struct.pack('<I',len(s))+s
result=struct.pack('<II',4,len(h))+h+b''.join(chunks)
for p,data in original.items():
    if p.startswith('firmware/'):assert files[p]==data,p
backup=root/'backups/yolo-import-20261013';backup.mkdir(parents=True,exist_ok=True)
if not (backup/'app-before-import-only.asar').exists():shutil.copy2(archive,backup/'app-before-import-only.asar')
staged=archive.with_suffix('.training.tmp');staged.write_bytes(result);staged.replace(archive)
print('Import-only YOLO modules updated. All packaged firmware preserved byte-for-byte.')
