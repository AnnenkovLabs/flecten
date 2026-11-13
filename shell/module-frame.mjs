// Transport only: the document runs in an opaque-origin, script-only sandbox with its own CSP.
export const MODULE_FRAME_DOCUMENT = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
addEventListener('message',function initialize(event){
  if(event.source!==parent||event.data?.type!=='flecten.module.initialize'||typeof event.data.html!=='string'||event.data.html.length>9*1024*1024)return;
  removeEventListener('message',initialize);
  document.open();document.write(event.data.html);document.close();
});
parent.postMessage({type:'flecten.module.ready'},'*');
</script></body></html>`;
