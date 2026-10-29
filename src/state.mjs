import {readFile, mkdir, open, rename, unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
export function stateStore(path) {
  return {
    async loadState() {
      try {return JSON.parse(await readFile(path,'utf8'));}
      catch(e) {if(e.code==='ENOENT') return undefined;throw new Error('Demote: cannot read saved tier state');}
    },
    async saveState(state) {
      await mkdir(dirname(path),{recursive:true,mode:0o700});
      const temporary=path+'.'+randomUUID()+'.tmp';
      let handle;
      try {
        handle=await open(temporary,'wx',0o600);
        await handle.writeFile(JSON.stringify(state)+'\n');await handle.sync();
        await handle.close();handle=undefined;
        await rename(temporary,path);
      } catch {
        throw new Error('Demote: cannot persist tier state; account order left unchanged');
      } finally {await handle?.close();await unlink(temporary).catch(()=>{});}
    },
  };
}
