import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Controller, parseOptions} from '../src/controller.mjs';
function setup() {
 let snapshot={object:'trace',pid:1,routes:[]}, state, tick=0;
 const p={id:'p',routing:'order',keyList:['a','b','c','d'].map(id=>({id,on:true}))};
 const writes=[];
 const api={trace:async()=>structuredClone(snapshot),providers:async()=>[structuredClone(p)],
   loadState:async()=>structuredClone(state),saveState:async value=>{state=structuredClone(value);},
   route:async()=>{},arrange:async(id,order)=>{writes.push(order);p.keyList=order.map(id=>p.keyList.find(x=>x.id===id));}};
 let controller=new Controller(api);
 return {api,p,writes,get state(){return state},get c(){return controller},
   async init(){await controller.run();},
   async error(id,status,options={}){tick++;snapshot={object:'trace',pid:1,routes:[{id:tick,order:[{id:'p#'+id,provider:'p'}],tries:[{id:'p#'+id,status,done:true,start:new Date(tick*1000).toISOString()}]}]};await controller.run(options);},
   async restart(){controller=new Controller(api);await controller.run();},
   order(){return p.keyList.map(x=>x.id);}};
}
test('hard first, soft later stays above hard and below available',async()=>{
 const h=setup();await h.init();await h.error('a',401);await h.error('b',429);
 assert.deepEqual(h.order(),['c','d','b','a']);assert.deepEqual(h.state.entries.map(x=>x.tier),[2,1]);
});
test('soft first, hard later yields the same tier order',async()=>{
 const h=setup();await h.init();await h.error('b',429);await h.error('a',403);
 assert.deepEqual(h.order(),['c','d','b','a']);
});
test('multiple soft and hard failures retain stable order, repeated error moves within its tier',async()=>{
 const h=setup();await h.init();await h.error('a',401);await h.error('b',402);await h.error('c',429);await h.error('d',429);
 assert.deepEqual(h.order(),['c','d','a','b']);await h.error('c',429);assert.deepEqual(h.order(),['d','c','a','b']);
});
test('hard cannot be downgraded by soft and soft upgrades to hard',async()=>{
 const h=setup();await h.init();await h.error('a',401);await h.error('b',429);await h.error('a',429);
 assert.deepEqual(h.order(),['c','d','b','a']);assert.equal(h.state.entries.find(x=>x.credential==='a').tier,2);
 await h.error('b',402);assert.deepEqual(h.order(),['c','d','a','b']);
});
test('persisted hard identities survive host/controller restart',async()=>{
 const h=setup();await h.init();await h.error('a',401);await h.restart();await h.error('b',429);
 assert.deepEqual(h.order(),['c','d','b','a']);
});
test('custom soft/hard codes replace defaults, overlap is hard',async()=>{
 assert.deepEqual(parseOptions({softErrorCodes:[503],hardErrorCodes:[]}).soft,[503]);
 const h=setup();await h.init();await h.error('a',503,{softErrorCodes:[503],hardErrorCodes:[503]});
 assert.equal(h.state.entries[0].tier,2);
 for(const options of [{softErrorCodes:['429']},{hardErrorCodes:[200]},{softErrorCodes:null}]) {
  assert.throws(()=>parseOptions(options));
 }
});
test('legacy subsets migrate 429 soft and remaining errors hard',()=>{
 const c=parseOptions({errorCodes:[429,503]});assert.deepEqual(c.soft,[429]);assert.deepEqual(c.hard,[503]);
 assert.deepEqual(parseOptions({errorCodes:[]}).soft,[]);assert.deepEqual(parseOptions({errorCodes:[]}).hard,[]);
});
test('persistence failure prevents any remote arrangement',async()=>{
 const h=setup();h.api.saveState=async()=>{throw new Error('disk failure');};await h.init();
 await assert.rejects(h.error('a',401),/disk failure/);assert.equal(h.writes.length,0);
});
test('corrupt saved state fails closed instead of forgetting hard tiers',async()=>{
 const h=setup();h.api.loadState=async()=>({version:1,entries:[{provider:'p',credential:'a',tier:0}]});
 await assert.rejects(h.init(),/invalid saved tier state/);
});
test('single credential is remembered for when more credentials become available',async()=>{
 const h=setup();h.p.keyList=[h.p.keyList[0]];await h.init();await h.error('a',401);assert.equal(h.state.entries[0].tier,2);
 h.p.keyList.push({id:'b',on:true},{id:'c',on:true});await h.error('b',429);assert.deepEqual(h.order(),['c','b','a']);
});
test('removed credential tiers are pruned on the next observed failure',async()=>{
 const h=setup();await h.init();await h.error('a',401);h.p.keyList=h.p.keyList.filter(x=>x.id!=='a');await h.error('b',429);
 assert.equal(h.state.entries.some(x=>x.credential==='a'),false);
});
