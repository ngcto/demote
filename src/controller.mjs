export function parseOptions(o = {}) {
  const providers = o.providers ?? '*';
  const errorCodes = o.errorCodes ?? [401, 402, 403, 429];
  if (providers !== '*' && (!Array.isArray(providers) || !providers.every(x => typeof x === 'string' && x))) throw new Error('Demote: providers must be "*" or an array of exact provider ids');
  if (!Array.isArray(errorCodes) || !errorCodes.every(x => Number.isInteger(x) && x >= 400 && x <= 599)) throw new Error('Demote: errorCodes must contain HTTP status integers from 400 to 599');
  if (o.enforceOrder !== undefined && typeof o.enforceOrder !== 'boolean') throw new Error('Demote: enforceOrder must be boolean');
  return {providers, errorCodes, enforceOrder:o.enforceOrder !== false};
}
export function credentials(p) {
  if (p.account) return (p.account.logins ?? []).map(x => ({id:x.user, on:x.on || x.active}));
  return (p.keyList ?? []).map(x => ({id:x.id, on:x.on || x.active}));
}
export function credentialFor(p, seat) {
  const list = credentials(p);
  if (p.account) {
    const matches = list.filter(x => typeof seat.who === 'string' && x.id.toLowerCase() === seat.who.toLowerCase());
    return matches.length === 1 ? matches[0].id : undefined;
  }
  const prefix = p.id + '#';
  if (seat.id.startsWith(prefix)) return list.find(x => x.id === seat.id.slice(prefix.length))?.id;
  return list.length === 1 && seat.id === p.id ? list[0].id : undefined;
}
export class Controller {
  constructor(api) {this.api=api;this.pid=undefined;this.seen=new Set();this.busy=Promise.resolve();}
  run(options, signal) {
    const next=this.busy.catch(()=>{}).then(()=>this.reconcile(parseOptions(options),signal));
    this.busy=next;return next;
  }
  async reconcile(c,signal) {
    if(signal?.aborted) throw signal.reason;
    const trace=await this.api.trace(signal);
    if(trace.object!=='trace' || !Array.isArray(trace.routes)) throw new Error('Demote: invalid trace');
    // Bootstrap does not retroactively mutate accounts for requests preceding installation/reload.
    if(this.pid!==trace.pid) {
      this.pid=trace.pid;this.seen.clear();
      for(const r of trace.routes) for(let i=0;i<(r.tries??[]).length;i++) if(r.tries[i].done) this.seen.add(`${r.id}:${i}:${r.tries[i].start}`);
      return 0;
    }
    let changed=0;
    for(const r of trace.routes) {
      for(let i=0;i<(r.tries??[]).length;i++) {
        const t=r.tries[i], token=`${r.id}:${i}:${t.start}`;
        if(!t.done || this.seen.has(token)) continue;
        if(!c.errorCodes.includes(t.status)) {this.seen.add(token);continue;}
        const seats=[...(r.order??[]),...(r.left??[])].filter(s=>s.id===t.id);
        const seat=seats[0];
        if(!seat || seats.some(s=>s.provider!==seat.provider || s.who!==seat.who) || (c.providers!=='*' && !c.providers.includes(seat.provider))) {this.seen.add(token);continue;}
        const inventory=await this.api.providers(signal);
        const p=inventory.find(x=>x.id===seat.provider);
        if(!p || p.off) {this.seen.add(token);continue;}
        const target=credentialFor(p,seat), list=credentials(p);
        if(!target || list.length<2 || !list.find(x=>x.id===target)?.on) {this.seen.add(token);continue;}
        const order=list.filter(x=>x.id!==target).map(x=>x.id).concat(target);
        // Never promote a disabled account. Keep all accounts and enabled flags intact.
        const first=list.find(x=>x.id!==target && x.on);
        if(!first) {this.seen.add(token);continue;}
        const at=order.indexOf(first.id);order.splice(at,1);order.unshift(first.id);
        if(c.enforceOrder && p.routing!=='order') {
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
    }
    // Bounded by the trace's retained routes, not account count or prompt history.
    const live=new Set();for(const r of trace.routes) for(let i=0;i<(r.tries??[]).length;i++) live.add(`${r.id}:${i}:${r.tries[i].start}`);
    for(const x of this.seen) if(!live.has(x)) this.seen.delete(x);
    return changed;
  }
}
