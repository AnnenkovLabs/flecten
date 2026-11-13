/** Runs inside an opaque-origin iframe. It has no access to the renderer or Electron. */
export const MODULE_FRAME_BRIDGE = `(()=>{
const pending=new Map(),listeners=new Set();
addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.shiftKey&&event.key==='F12'){event.preventDefault();parent.postMessage({type:'flecten.module.recover'},'*')}});
addEventListener('message',event=>{
  if(event.source!==parent)return;
  if(event.data?.type==='flecten.module.locale'){document.documentElement.lang=event.data.locale;dispatchEvent(new Event('flecten.locale'));return}
  if(event.data?.type==='flecten.module.theme'){for(const [name,value] of Object.entries(event.data.tokens||{}))document.documentElement.style.setProperty(name,value);return}
  if(event.data?.type==='flecten.module.event'){for(const listener of listeners)listener(event.data.event);return}
  if(event.data?.type==='flecten.module.accepted'){const task=pending.get(event.data.id);if(task)clearTimeout(task.timer);return}
  if(event.data?.type!=='flecten.module.response')return;
  const task=pending.get(event.data.id);if(!task)return;
  pending.delete(event.data.id);clearTimeout(task.timer);
  event.data.ok?task.resolve(event.data.result):task.reject(new Error(event.data.error));
});
const request=(method,fields={})=>new Promise((resolve,reject)=>{
  const id=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(new Error('Module request timed out'))},300000);
  pending.set(id,{resolve,reject,timer});parent.postMessage({type:'flecten.module.request',id,method,...fields},'*');
});
addEventListener('pagehide',()=>{for(const task of pending.values()){clearTimeout(task.timer);task.reject(new Error('Module surface closed'))}pending.clear()});
Object.defineProperty(window,'flecten',{value:Object.freeze({apiVersion:1,
  tools:()=>request('tools'),call:(tool,args={})=>request('call',{tool,arguments:args}),read:(resource,offset=0)=>request('read',{resource,offset}),
  harness:Object.freeze({snapshot:()=>request('snapshot'),request:command=>request('request',{command}),
    subscribe:async listener=>{await request('subscribe');listeners.add(listener);return()=>listeners.delete(listener)}
  })
})});
})()`;
