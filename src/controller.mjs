function codes(value, name) {
  if (!Array.isArray(value) || !value.every(x => Number.isInteger(x) && x >= 400 && x <= 599))
    throw new Error(`Demote: ${name} must contain HTTP status integers from 400 to 599`);
  return value;
}
export function parseOptions(o = {}) {
  const providers = o.providers ?? '*';
  if (providers !== '*' && (!Array.isArray(providers) || !providers.every(x => typeof x === 'string' && x))) throw new Error('Demote: providers must be "*" or an array of exact provider ids');
  if (o.enforceOrder !== undefined && typeof o.enforceOrder !== 'boolean') throw new Error('Demote: enforceOrder must be boolean');
  // Preserve old custom subsets: 429 is soft, other legacy codes are hard.
  const legacy = o.softErrorCodes === undefined && o.hardErrorCodes === undefined && o.errorCodes !== undefined
    ? codes(o.errorCodes, 'errorCodes') : undefined;
  const soft = codes(o.softErrorCodes === undefined ? (legacy ? legacy.filter(x => x === 429) : [429]) : o.softErrorCodes, 'softErrorCodes');
  const hard = codes(o.hardErrorCodes === undefined ? (legacy ? legacy.filter(x => x !== 429) : [401, 402, 403]) : o.hardErrorCodes, 'hardErrorCodes');
  return {providers, soft, hard, enforceOrder:o.enforceOrder !== false};
}
export function credentials(p) {
  if (p.account) return (p.account.logins ?? []).map(x => ({id:x.user, on:!!(x.on || x.active)}));
  return (p.keyList ?? []).map(x => ({id:x.id, on:!!(x.on || x.active)}));
}
export function credentialFor(p, seat) {
  const list = credentials(p);
  if (p.account) {
    const matches = list.filter(x => typeof seat.who === 'string' && x.id.toLowerCase() === seat.who.toLowerCase());
    return matches.length === 1 ? matches[0].id : undefined;
  }
  const prefix = p.id + '#';
  if (typeof seat.id !== 'string') return undefined;
  if (seat.id.startsWith(prefix)) return list.find(x => x.id === seat.id.slice(prefix.length))?.id;
  return list.length === 1 && seat.id === p.id ? list[0].id : undefined;
}
function identity(provider, credential) {return JSON.stringify([provider, credential]);}
export class Controller {
  constructor(api) {
    this.api=api;this.pid=undefined;this.seen=new Set();this.busy=Promise.resolve();
    this.tiers=new Map();this.loaded=false;
  }
  run(options, signal) {
    const next=this.busy.catch(()=>{}).then(()=>this.reconcile(parseOptions(options),signal));
    this.busy=next;return next;
  }
  async load() {
    if (this.loaded) return;
    const state=await this.api.loadState?.();
    if (state !== undefined) {
      if (state?.version !== 1 || !Array.isArray(state.entries) || !state.entries.every(x =>
        typeof x.provider === 'string' && x.provider && typeof x.credential === 'string' && x.credential && (x.tier === 1 || x.tier === 2)))
        throw new Error('Demote: invalid saved tier state; refusing to forget hard demotions');
      for (const x of state.entries) this.tiers.set(identity(x.provider,x.credential),x);
    }
    this.loaded=true;
  }
  async mark(provider, target, tier, list) {
    const next=new Map(this.tiers);
    // Remove deleted credential identities when this provider is observed again.
    for (const [key, value] of next) if (value.provider === provider && !list.some(x => x.id === value.credential)) next.delete(key);
    const key=identity(provider,target);
    const old=next.get(key)?.tier || 0;
    const effective=Math.max(old,tier); // A soft failure must never weaken a hard demotion.
    next.set(key,{provider,credential:target,tier:effective});
    // Persist intent before remote writes; ambiguous writes can be reconciled without forgetting tiers.
    await this.api.saveState?.({version:1,entries:[...next.values()]});
    this.tiers=next;
    return effective;
  }
  async reconcile(c,signal) {
    if(signal?.aborted) throw signal.reason;
    await this.load();
    const trace=await this.api.trace(signal);
    if(trace.object!=='trace' || !Array.isArray(trace.routes)) throw new Error('Demote: invalid trace');
    if(this.pid!==trace.pid) {
      this.pid=trace.pid;this.seen.clear();
      for(const r of trace.routes) for(let i=0;i<(r.tries??[]).length;i++) if(r.tries[i].done) this.seen.add(`${r.id}:${i}:${r.tries[i].start}`);
      return 0;
    }
    const attempts=[];
    for(const r of trace.routes) for(let i=0;i<(r.tries??[]).length;i++) {
      const t=r.tries[i], token=`${r.id}:${i}:${t.start}`;
      if(t.done && !this.seen.has(token)) attempts.push({r,t,token,i});
    }
    // The trace can list newest routes first. Apply older observations first.
    attempts.sort((a,b)=>(Date.parse(a.t.start)||0)-(Date.parse(b.t.start)||0) || a.r.id-b.r.id || a.i-b.i);
    let changed=0;
    for(const {r,t,token} of attempts) {
      const tier=c.hard.includes(t.status)?2:c.soft.includes(t.status)?1:0;
      if(!tier) {this.seen.add(token);continue;}
      const seats=[...(r.order??[]),...(r.left??[])].filter(s=>s.id===t.id);
      const seat=seats[0];
      if(!seat || seats.some(s=>s.provider!==seat.provider || s.who!==seat.who) || (c.providers!=='*' && !c.providers.includes(seat.provider))) {this.seen.add(token);continue;}
      const inventory=await this.api.providers(signal);
      const p=inventory.find(x=>x.id===seat.provider);
      if(!p || p.off) {this.seen.add(token);continue;}
      const target=credentialFor(p,seat), list=credentials(p);
      if(!target || !list.find(x=>x.id===target)?.on) {this.seen.add(token);continue;}
      const effective=await this.mark(p.id,target,tier,list);
      // Available (0), soft (1), hard (2); stable within each tier, target last in its tier.
      const ranked=list.map((x,index)=>({...x,index,tier:this.tiers.get(identity(p.id,x.id))?.tier || 0}));
      ranked.sort((a,b)=>a.tier-b.tier || (a.id===target?1:0)-(b.id===target?1:0) || a.index-b.index);
      // Never promote a disabled account; all identities and enabled flags remain intact.
      const first=ranked.find(x=>x.on);
      if(!first || list.length<2 || !list.some(x=>x.on && x.id!==target)) {this.seen.add(token);continue;}
      const order=ranked.map(x=>x.id), at=order.indexOf(first.id);
      order.splice(at,1);order.unshift(first.id);
      // mark() already retains hard status when this attempt was soft.
      if(effective && c.enforceOrder && p.routing!=='order') {
        await this.api.route(p.id,'order',signal);
        const read=(await this.api.providers(signal)).find(x=>x.id===p.id);
        if(read?.routing!=='order') throw new Error('Demote: routing readback failed');
      }
      if(order.some((x,j)=>x!==list[j].id)) {
        await this.api.arrange(p.id,order,signal);
        const read=(await this.api.providers(signal)).find(x=>x.id===p.id);
        const actual=read && credentials(read);
        if(!actual || actual.length!==list.length || actual.some((x,j)=>x.id!==order[j] || x.on!==list.find(y=>y.id===x.id)?.on)) throw new Error('Demote: credential order readback failed');
        changed++;
      }
      this.seen.add(token);
    }
    const live=new Set();for(const r of trace.routes) for(let i=0;i<(r.tries??[]).length;i++) live.add(`${r.id}:${i}:${r.tries[i].start}`);
    for(const x of this.seen) if(!live.has(x)) this.seen.delete(x);
    return changed;
  }
}
