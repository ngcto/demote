import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
async function page(initial={}) {
 const elements=Object.fromEntries(['providers','softCodes','hardCodes','order','port','save','status'].map(id=>[id,{value:'',textContent:'',addEventListener(event,fn){this.click=fn;}}]));
 let saved;
 const context={document:{getElementById:id=>elements[id]},magpie:{ready:Promise.resolve(),options:{get:async()=>initial,set:async x=>{saved=x;return x;}}}};
 vm.runInNewContext(readFileSync(new URL('../page/app.js',import.meta.url),'utf8'),context);
 await new Promise(r=>setImmediate(r));return {elements,get saved(){return saved}};
}
test('settings page loads separate defaults and saves configured tier codes',async()=>{
 const h=await page(),e=h.elements;
 assert.equal(e.providers.value,'*');assert.equal(e.softCodes.value,'429');assert.equal(e.hardCodes.value,'401, 402, 403');assert.equal(e.order.checked,true);
 e.providers.value='openai, relay';e.softCodes.value='429,503';e.hardCodes.value='401,402';await e.save.click();
 assert.equal(JSON.stringify(h.saved),JSON.stringify({providers:['openai','relay'],softErrorCodes:[429,503],hardErrorCodes:[401,402],enforceOrder:true}));
 assert.equal(e.status.textContent,'Saved. Changes apply to subsequent requests.');
 e.softCodes.value='200';await e.save.click();assert.match(e.status.textContent,/400 to 599/);
});
test('settings page migrates legacy subset without silently enabling other errors',async()=>{
 const h=await page({errorCodes:[429,503],custom:'preserved'}),e=h.elements;
 assert.equal(e.softCodes.value,'429');assert.equal(e.hardCodes.value,'503');await e.save.click();
 assert.equal(h.saved.errorCodes,undefined);assert.equal(h.saved.custom,'preserved');
});
