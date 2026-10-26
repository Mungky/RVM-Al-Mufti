// The renderer modules call window.rvm.*; every call they make must exist in preload.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
test('preload exposes every window.rvm call used by the renderer modules',()=>{
  let api;const load=Module._load;
  Module._load=(request,...rest)=>request==='electron'?{contextBridge:{exposeInMainWorld:(_,value)=>{api=value;}},ipcRenderer:{invoke(){},send(){},on(){},removeListener(){}}}:load(request,...rest);
  try{delete require.cache[require.resolve('./preload.cjs')];require('./preload.cjs');}finally{Module._load=load;}
  const sources=['../production/prepare-dialog.mjs','../production/production-client.mjs','../workbench/model-studio.mjs'].map(f=>fs.readFileSync(path.join(__dirname,f),'utf8')).join('\n');
  const calls=new Set([...sources.matchAll(/window\.rvm\??\.([a-zA-Z]+)\??\.?([a-zA-Z]+)?/g)].map(m=>m.slice(1).filter(Boolean).join('.')));
  assert.ok(calls.has('firmware.sketches')&&calls.has('vision.list'));
  for(const call of calls){const value=call.split('.').reduce((o,k)=>o?.[k],api);assert.equal(typeof value==='function'||typeof value==='object',true,`preload is missing window.rvm.${call}`);}
});
