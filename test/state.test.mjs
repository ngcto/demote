import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {stateStore} from '../src/state.mjs';
test('tier state persists atomically with private permissions and no temporary residue',async()=>{
 const dir=await mkdtemp(join(process.env.TMPDIR || process.cwd(),'demote-state-test-'));
 try {
  const path=join(dir,'state.json'),store=stateStore(path),state={version:1,entries:[{provider:'p',credential:'fingerprint',tier:2}]};
  assert.equal(await store.loadState(),undefined);await store.saveState(state);
  assert.deepEqual(await stateStore(path).loadState(),state);assert.equal((await stat(path)).mode&0o777,0o600);
  assert.deepEqual(await readdir(dir),['state.json']);assert.doesNotMatch(await readFile(path,'utf8'),/fixture-secret/);
  await writeFile(path,'broken');await assert.rejects(store.loadState(),/cannot read/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
