const el=id=>document.getElementById(id);
let options={};
async function load() {
 await magpie.ready;options=(await magpie.options.get()) || {};
 el('providers').value=options.providers==='*' || options.providers===undefined?'*':options.providers.join(', ');
 el('codes').value=(options.errorCodes || [401,402,403,429]).join(', ');
 el('order').checked=options.enforceOrder!==false;
 el('port').value=options.webPort || '';
}
el('save').addEventListener('click',async()=>{
 try {
  const p=el('providers').value.trim();
  const providers=p==='*'?'*':p.split(',').map(x=>x.trim()).filter(Boolean);
  const errorCodes=el('codes').value.trim()===''?[]:el('codes').value.split(',').map(x=>Number(x.trim()));
  if(!errorCodes.every(x=>Number.isInteger(x)&&x>=400&&x<=599))throw new Error('Use HTTP error status integers from 400 to 599.');
  const next={...options,providers,errorCodes,enforceOrder:el('order').checked};
  const port=el('port').value;
  if(port) {next.webPort=Number(port);if(!Number.isInteger(next.webPort)||next.webPort<1||next.webPort>65535)throw new Error('Invalid port.');}else delete next.webPort;
  options=await magpie.options.set(next);el('status').textContent='Saved. Changes apply to subsequent requests.';
 }catch(e){el('status').textContent=e.message;}
});
load().catch(e=>{el('status').textContent=e.message;});
