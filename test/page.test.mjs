import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('Demote settings page loads defaults and saves configured scope/codes',async()=>{
 const elements=Object.fromEntries(['providers','codes','order','port','save','status'].map(id=>[id,{value:'',textContent:'',addEventListener(event,fn){this.click=fn;}}]));
 let saved;
 const context={document:{getElementById:id=>elements[id]},magpie:{ready:Promise.resolve(),options:{get:async()=>({}),set:async x=>{saved=x;return x;}}}};
 vm.runInNewContext(readFileSync(new URL('../page/app.js',import.meta.url),'utf8'),context);
 await new Promise(r=>setImmediate(r));
 assert.equal(elements.providers.value,'*');assert.equal(elements.codes.value,'401, 402, 403, 429');assert.equal(elements.order.checked,true);
 elements.providers.value='openai, relay';elements.codes.value='401,402';await elements.save.click();
 assert.equal(JSON.stringify(saved),JSON.stringify({providers:['openai','relay'],errorCodes:[401,402],enforceOrder:true}));
 assert.equal(elements.status.textContent,'Saved. Changes apply to subsequent requests.');
 elements.codes.value='200';await elements.save.click();assert.match(elements.status.textContent,/400 to 599/);
});
