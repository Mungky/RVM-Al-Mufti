const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rvm', {
  cancelBluetoothSelection: () => ipcRenderer.send('bluetooth:cancel-selection'),
  load: () => ipcRenderer.invoke('db:load'), save: db => ipcRenderer.invoke('db:save', db), metrics: () => ipcRenderer.invoke('metrics'),
  external: url => ipcRenderer.invoke('external', url), kiosk: () => ipcRenderer.invoke('kiosk'),
  devices: {
    action: data => ipcRenderer.send('devices:action', data),
    onUpdate: callback => { const listener=(_,data)=>callback(data); ipcRenderer.on('devices:update',listener); return ()=>ipcRenderer.removeListener('devices:update',listener); }
  },
  firmware: {sketches:()=>ipcRenderer.invoke('firmware:sketches'),ports:()=>ipcRenderer.invoke('firmware:ports')},
  vision: {status:args=>ipcRenderer.invoke('vision:status',args),list:args=>ipcRenderer.invoke('vision:list',args),importModel:args=>ipcRenderer.invoke('vision:importModel',args),predict:args=>ipcRenderer.invoke('vision:predict',args),onEvent:callback=>{const listener=(_,state)=>callback(state);ipcRenderer.on('vision:event',listener);return()=>ipcRenderer.removeListener('vision:event',listener);}},
  onDiagnostic:callback=>{const listener=(_,state)=>callback(state);ipcRenderer.on('diagnostic:event',listener);return()=>ipcRenderer.removeListener('diagnostic:event',listener);},
  serial: {
    connect: (baud,options) => ipcRenderer.invoke('serial:connect', baud,options),
    write: data => ipcRenderer.invoke('serial:write', data),
    disconnect: () => ipcRenderer.invoke('serial:disconnect'),
    onEvent: callback => { const listener=(_,event)=>callback(event);ipcRenderer.on('serial:event',listener);return()=>ipcRenderer.removeListener('serial:event',listener); }
  }
});
