import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {Controller, parseOptions} from './src/controller.mjs';
import {stateStore} from './src/state.mjs';

function loopback(value, fallback) {
  const u=new URL(value || fallback);
  if(u.protocol!=='http:' || !['127.0.0.1','localhost','[::1]'].includes(u.hostname) || u.username || u.password || u.pathname!=='/' || u.search || u.hash)
    throw new Error('Demote: endpoints must be plain HTTP loopback origins');
  return u;
}
async function setup(options) {
  parseOptions(options);
  const dir=join(process.env.XDG_CONFIG_HOME || join(homedir(),'.config'),'magpie');
  let saved={};
  try {saved=JSON.parse(await readFile(join(dir,'web-page.json'),'utf8'));} catch(e) {if(e.code!=='ENOENT') throw new Error('Demote: cannot read Browser access configuration');}
  const port=options.webPort ?? (saved.mode ? saved.port || 3430 : 3430);
  if(!Number.isInteger(port) || port<1 || port>65535) throw new Error('Demote: invalid webPort');
  const key=process.env.DEMOTE_WEB_KEY || process.env.MAGPIE_WEB_KEY || (saved.mode && saved.key);
  if(typeof key!=='string' || !/^[a-zA-Z0-9._~-]{16,}$/.test(key)) throw new Error('Demote: enable authenticated Browser access, or supply DEMOTE_WEB_KEY in Magpie’s environment');
  const web=loopback(`http://127.0.0.1:${port}`);
  const address=process.env.MAGPIE_ADDR || '127.0.0.1:3425';
  const gateway=loopback(options.gatewayUrl,`http://${address}`);
  async function json(base,path,signal,body,auth=false) {
    if(signal?.aborted) throw signal.reason;
    const headers={'Accept':'application/json'};
    if(auth) headers.Cookie=`magpie_web_${port}=${key}`;
    if(body) headers['Content-Type']='application/json';
    const res=await fetch(new URL(path,base), {method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(1500)]):AbortSignal.timeout(1500)});
    if(!res.ok) throw new Error(`Demote: local API ${path} returned ${res.status}`);
    // Never log response text: management responses and traces can contain private data.
    const text=await res.text();
    if(text.length>8*1024*1024) throw new Error('Demote: local API response too large');
    try {return JSON.parse(text);} catch {throw new Error('Demote: invalid local API JSON');}
  }
  return new Controller({
    ...stateStore(join(dir,'demote-state.json')),
    trace:signal=>json(gateway,'/v1/magpie/trace',signal),
    providers:async signal=>{
      const v=await json(web,'/api/providers',signal,undefined,true);
      if(!Array.isArray(v.providers)) throw new Error('Demote: invalid provider inventory');
      return v.providers;
    },
    route:(id,routing,signal)=>json(web,'/api/provider/route',signal,{id,routing},true),
    arrange:(id,accountOrder,signal)=>json(web,'/api/provider/arrange',signal,{id,accountOrder},true),
  });
}
let current;
let signature;
let starting;
async function reconcile(ctx) {
  const options=ctx.options || {};
  const sig=JSON.stringify(options);
  if(!current || sig!==signature) {
    if(!starting) starting=setup(options).then(v=>{current=v;signature=sig;}).finally(()=>{starting=undefined;});
    await starting;
  }
  const changes=await current.run(options,ctx.signal);
  ctx.report?.(changes ? 'ready':'empty',0);
}
export async function onRequest(body,ctx) {
  try {await reconcile(ctx);} catch(e) {ctx.report?.('unavailable',0);throw e;}
  // Never change the agent's model, conversation, tools or reply.
}
export async function onResponse(reply,ctx) {await reconcile(ctx);}
