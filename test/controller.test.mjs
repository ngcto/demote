import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Controller,parseOptions} from '../src/controller.mjs';
function harness(account=false) {
 let trace={object:'trace',pid:1,routes:[]}, calls=[];
 let provider=account ? {id:'p',routing:'smart',account:{logins:[{user:'A@x.test',on:true},{user:'B@x.test',on:true},{user:'disabled',on:false}]}} : {id:'p',routing:'smart',keyList:[{id:'a',on:true},{id:'b',on:true},{id:'off',on:false}]};
 const api={trace:async()=>structuredClone(trace),providers:async()=>[structuredClone(provider)],route:async(id,v)=>{calls.push(['route',v]);provider.routing=v;},arrange:async(id,order)=>{calls.push(['arrange',order]);const list=account?provider.account.logins:provider.keyList;const get=x=>account?x.user:x.id;const next=order.map(id=>list.find(x=>get(x)===id));if(account)provider.account.logins=next;else provider.keyList=next;}};
 const c=new Controller(api);
 return {c,api,calls,get provider(){return provider},set trace(t){trace=t},fail(status=401){trace={object:'trace',pid:1,routes:[{id:1,order:[{id:account?'p':'p#a',provider:'p',who:account?'a@x.test':'masked'}],tries:[{id:account?'p':'p#a',start:'now',done:true,status},{id:account?'p@B@x.test':'p#b',start:'later',done:true,status:200}]}]};}};
}
test('defaults and validation',()=>{assert.deepEqual(parseOptions().errorCodes,[401,402,403,429]);for(const o of [{providers:'p'},{errorCodes:['401']},{errorCodes:[200]},{enforceOrder:1}])assert.throws(()=>parseOptions(o));});
test('detects failed attempt even if final fallback succeeded and preserves disabled state',async()=>{const h=harness();await h.c.run();h.fail();assert.equal(await h.c.run(),1);assert.deepEqual(h.calls,[['route','order'],['arrange',['b','off','a']]]);assert.equal(h.provider.keyList[1].on,false);});
test('subscription identity joins active seat by who, preserves exact stored user',async()=>{const h=harness(true);await h.c.run();h.fail(402);await h.c.run();assert.deepEqual(h.calls[1],['arrange',['B@x.test','disabled','A@x.test']]);});
test('deduplicates trace snapshots',async()=>{const h=harness();await h.c.run();h.fail();await h.c.run();await h.c.run();assert.equal(h.calls.length,2);});
test('no historical replay on bootstrap or gateway restart',async()=>{const h=harness();h.fail();await h.c.run();assert.equal(h.calls.length,0);h.trace={object:'trace',pid:2,routes:[]};await h.c.run();assert.equal(h.calls.length,0);});
test('default excludes request and transient errors',async()=>{for(const s of [400,404,422,500,503]){const h=harness();await h.c.run();h.fail(s);await h.c.run();assert.equal(h.calls.length,0);}});
test('all four default status codes trigger',async()=>{for(const s of [401,402,403,429]){const h=harness();await h.c.run();h.fail(s);await h.c.run();assert.equal(h.calls.length,2);}});
test('custom subset replaces defaults',async()=>{const h=harness();await h.c.run({errorCodes:[503]});h.fail(503);await h.c.run({errorCodes:[503]});assert.equal(h.calls.length,2);});
test('provider scope excludes without mutations',async()=>{const h=harness();await h.c.run({providers:['q']});h.fail();await h.c.run({providers:['q']});assert.equal(h.calls.length,0);});
test('optional routing preservation',async()=>{const h=harness();await h.c.run({enforceOrder:false});h.fail();await h.c.run({enforceOrder:false});assert.equal(h.calls.length,1);assert.equal(h.provider.routing,'smart');});
test('disabled credentials never promoted, no enabled alternative is left alone',async()=>{const h=harness();h.provider.keyList[1].on=false;await h.c.run();h.fail();await h.c.run();assert.equal(h.calls.length,0);});
test('arrangement is verified and failed readback remains retryable',async()=>{const h=harness();h.api.arrange=async()=>{};await h.c.run();h.fail();await assert.rejects(h.c.run(),/readback failed/);});
test('serializes concurrent reconciliation and cancels before writes',async()=>{const h=harness();await h.c.run();h.fail();await Promise.all([h.c.run(),h.c.run()]);assert.equal(h.calls.length,2);const a=new AbortController();a.abort();await assert.rejects(h.c.run({},a.signal));});
