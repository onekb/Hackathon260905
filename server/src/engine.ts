import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { ChainAdapter, Outcome } from './chain.js';
import { decimal, emptyUsage, fee, mockTokens, units, type Quote, type Usage } from './money.js';
import { Store, sameMarket, type MarketIdentity } from './store.js';
import { DEMO_LIMITS, type DemoAdmission } from './runtime-config.js';
export interface Message { role: 'system'|'user'|'assistant'; content: string }
export interface RequestInput { model: string; messages: Message[]; max_tokens: number; max_spend: string; provider_id?: string; cache?: boolean; stream?: boolean }
export interface Provider {
  id: string; wallet: string; name: string; model: string; quote: Quote; capacity: number; busy: number; mode: string; mock: true;
  send(message: unknown): void;
}
export interface Order extends MarketIdentity {
  id: string; buyer: string; providerId: string; seller: string; model: string; budget: string; quote: Quote;
  usage: Usage; plannedUsage: Usage; maxTokens: number; output: string; lastSeq: number;
  status: 'locking'|'running'|'completed'|'budget_capped'|'buyer_cancelled'|'seller_failed'|'platform_failed'|'lock_failed'|'reservation_unknown';
  settlement: 'unsubmitted'|'pending'|'confirmed'|'failed'; reason?: string; charge: string; released: string;
  lockTx?: string; settlementTx?: string; settlementError?: string; deadline: number; createdAt: number; updatedAt: number;
  outcome?: Outcome; reservationUncertain?: boolean; cacheMode: 'none'|'read'|'write'; cacheKey?: string; mock: true;
}
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const terminal = (o: Order) => !['locking','running'].includes(o.status);
export class Engine extends EventEmitter {
  providers = new Map<string, Provider>();
  private queues = new Map<string, Promise<any>>();
  private timers = new Map<string, NodeJS.Timeout>();
  readonly marketIdentity: MarketIdentity;
  constructor(readonly chain: ChainAdapter, readonly store: Store, readonly requestTimeoutMs = 30000, readonly admission?: DemoAdmission) {
    super(); this.setMaxListeners(0);
    this.marketIdentity = {market_address:chain.market ?? 'memory:mon',asset_symbol:'MON',asset_decimals:18};
    if (!store.state.market) store.bindMarket(this.marketIdentity);
    else if (!sameMarket(store.state.market, this.marketIdentity)) throw new Error('Engine market does not match the bound ledger');
  }
  private current(o: Order): boolean { return sameMarket(o, this.marketIdentity); }
  private serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(key) ?? Promise.resolve()).then(fn, fn);
    this.queues.set(key, next);
    void next.finally(() => { if (this.queues.get(key) === next) this.queues.delete(key); }).catch(() => {});
    return next;
  }
  private save(o: Order): void { o.updatedAt = Date.now(); this.store.state.orders[o.id] = o; this.store.save(); this.emit('order', {...o, usage:{...o.usage}}); }
  get(id: string, buyer?: string): Order {
    const o = this.store.state.orders[id] as Order | undefined;
    if (!o || (buyer && o.buyer !== buyer.toLowerCase())) throw new HttpError(404,'Request not found');
    return o;
  }
  list(buyer: string): Order[] { return Object.values(this.store.state.orders).filter((o: Order) => o.buyer === buyer.toLowerCase()).sort((a: Order,b: Order) => b.createdAt-a.createdAt).slice(0,100); }
  async addProvider(provider: Provider): Promise<void> {
    const previous = this.providers.get(provider.id);
    if (previous && previous.wallet !== provider.wallet) throw new HttpError(409,'Provider ID belongs to another connected wallet');
    if (previous) await this.removeProvider(provider.id, previous);
    this.providers.set(provider.id,provider);
  }
  async removeProvider(id: string, expected?: Provider): Promise<void> {
    const provider = this.providers.get(id);
    if (!provider || (expected && provider !== expected)) return;
    this.providers.delete(id);
    await Promise.all(Object.values(this.store.state.orders).filter((o: Order) => this.current(o) && o.providerId === id && o.status === 'running').map((o: Order) => this.serial(o.id, () => this.finish(o,3,'Seller disconnected'))));
  }
  models(): any[] {
    return Array.from(this.providers.values()).map(p => ({id:p.model,object:'model',provider_id:p.id,provider_name:p.name,seller:p.wallet,quote:p.quote,online:true,available_slots:Math.max(0,p.capacity-p.busy),mock:true,metering:'Unicode code point = one mock token',mode:p.mode,...this.marketIdentity}));
  }
  private admitNewOrder(buyer:string,now:number):void {
    if(!this.admission)return;
    if(!this.admission.newOrdersEnabled)throw new HttpError(503,'Demo is not accepting new requests; existing requests can still be queried or cancelled');
    if(now<this.admission.startMs)throw new HttpError(503,'Demo start time is later than the current clock; new requests are paused');
    const orders=Object.values(this.store.state.orders) as Order[];
    // Count unresolved funding as concurrency, even if its inference has already stopped or it
    // predates this demo epoch. Changing an epoch must never hide outstanding reservations.
    const active=orders.filter(o=>['locking','running','reservation_unknown'].includes(o.status)||o.settlement==='pending'||(o.settlement==='failed'&&o.status!=='lock_failed'));
    if(active.filter(o=>o.buyer.toLowerCase()===buyer).length>=DEMO_LIMITS.walletConcurrent)throw new HttpError(429,'Demo allows one unsettled request per wallet');
    if(active.length>=DEMO_LIMITS.globalConcurrent)throw new HttpError(429,'Demo allows two unsettled requests at a time');
    const attempts=orders.filter(o=>o.createdAt>=this.admission!.startMs);
    if(attempts.length>=DEMO_LIMITS.globalAttempts)throw new HttpError(429,'Demo has reached its total limit of ten new request attempts');
    const utcDay=Math.floor(now/86400000);
    if(attempts.filter(o=>o.buyer.toLowerCase()===buyer&&Math.floor(o.createdAt/86400000)===utcDay).length>=DEMO_LIMITS.walletPerUtcDay)throw new HttpError(429,'Demo allows six new request attempts per wallet per UTC day');
  }
  create(buyer: string, input: RequestInput, idempotency?: string): Promise<Order> {
    return this.serial('create',async () => {
      buyer = buyer.toLowerCase();
      const fingerprint = hash(JSON.stringify({...input,stream:undefined}));
      const idem = idempotency ? `${this.marketIdentity.market_address.toLowerCase()}:${buyer}:${idempotency}` : undefined;
      if (idempotency) {
        const suffix = `${buyer}:${idempotency}`;
        const legacy = Object.entries(this.store.state.idempotency).find(([key, entry]) => {
          const order = this.store.state.orders[entry.id] as Order | undefined;
          return order && order.buyer === buyer && !this.current(order) && (key === suffix || key === `${order.market_address.toLowerCase()}:${suffix}`);
        });
        if (legacy) throw new HttpError(409, `Idempotency-Key belongs to legacy request ${legacy[1].id}; query that request. A new MON request must use a new key.`);
      }
      const prior = idem && this.store.state.idempotency[idem];
      if (prior) { if (prior.fingerprint !== fingerprint) throw new HttpError(409,'Idempotency-Key was already used with different request parameters'); return this.get(prior.id,buyer); }
      this.admitNewOrder(buyer,Date.now());
      const budget = units(input.max_spend);
      if (budget <= 0n) throw new HttpError(400,'max_spend must be positive');
      const inputCount = mockTokens(JSON.stringify(input.messages));
      const candidates = Array.from(this.providers.values()).filter(p => p.model === input.model && (!input.provider_id || p.id === input.provider_id) && p.busy < p.capacity);
      const priced: {p: Provider; quote:Quote; estimate:bigint; planned:Usage; cacheMode:'none'|'read'|'write'; cacheKey:string}[] = [];
      for (const p of candidates) {
        const quote = await this.chain.getQuote(p.wallet,p.model);
        if (!quote || budget < units(quote.minReserve)) continue;
        p.quote={...quote};
        const cacheKey = hash(JSON.stringify([this.marketIdentity.market_address,buyer,p.wallet,p.id,p.model,input.messages]));
        const caching = input.cache === true || p.mode === 'cache-hit';
        const cacheMode = caching ? ((this.store.state.cache[cacheKey] ?? 0) > Date.now() ? 'read' : 'write') : 'none';
        const planned = emptyUsage(); planned[cacheMode === 'read' ? 'cacheRead' : cacheMode === 'write' ? 'cacheWrite' : 'input'] = inputCount;
        // Admission uses the largest possible input rate, including cache creation, even on a prospective hit.
        const maxInputRate = [quote.input,quote.cacheRead,quote.cacheWrite].reduce((a,b) => units(a)>units(b)?a:b);
        if (fee({...quote,input:maxInputRate},{...emptyUsage(),input:inputCount}) > budget) continue;
        priced.push({p,quote,planned,cacheMode,cacheKey,estimate:fee(quote,{...planned,output:input.max_tokens})});
      }
      priced.sort((a,b) => a.estimate < b.estimate ? -1 : a.estimate > b.estimate ? 1 : a.p.id.localeCompare(b.p.id));
      const selected = priced[0];
      if (!selected) throw new HttpError(409,'No online seller with capacity and a quote fitting the minimum reserve and input budget');
      const {p,quote,planned,cacheMode,cacheKey} = selected;
      const account = await this.chain.getAccount(buyer);
      if (units(account.available) < budget || units(account.authorized) < budget || account.authorizationExpiresAt <= Date.now()/1000) throw new HttpError(402,'Deposit funds and grant a sufficient unexpired spending allowance first');
      // Recheck with the actual admission timestamp after RPC reads, including across UTC midnight.
      // This entire path is serialized; persisting the order below consumes its attempt before lock.
      const createdAt=Date.now();this.admitNewOrder(buyer,createdAt);
      p.busy++;
      const o: Order = {...this.marketIdentity,id:randomUUID(),buyer,providerId:p.id,seller:p.wallet,model:p.model,budget:decimal(budget),quote:{...quote},usage:emptyUsage(),plannedUsage:planned,maxTokens:input.max_tokens,output:'',lastSeq:-1,status:'locking',settlement:'unsubmitted',charge:decimal(0n),released:decimal(budget),deadline:Math.floor(createdAt/1000)+300,createdAt,updatedAt:createdAt,cacheMode,cacheKey,mock:true};
      if (idem) this.store.state.idempotency[idem] = {id:o.id,fingerprint};
      this.save(o);
      try {
        const locked = await this.chain.lock({id:o.id,buyer,seller:p.wallet,model:p.model,budget:o.budget,quote:o.quote,deadline:o.deadline});
        o.lockTx=locked.txHash; o.status='running'; this.save(o);
      } catch (error: any) {
        // Resolve ambiguous transaction outcomes before deciding whether funds need releasing.
        let state; try { state = await this.chain.getOrder(o.id); } catch {}
        if (state?.state === 'locked') { o.status='running'; o.lockTx=state.txHash; await this.finish(o,4,'Platform could not confirm reservation; request was not dispatched'); }
        else { p.busy=Math.max(0,p.busy-1); o.status='reservation_unknown';o.reservationUncertain=true;o.reason=`Reservation was not confirmed and no request was sent: ${String(error.message??error)}`;o.settlement='failed';o.settlementError='Checking for a late reservation confirmation; any confirmed funds will be released without inference charges';this.save(o); }
        return o;
      }
      if (this.providers.get(p.id) !== p) { await this.finish(o,3,'Seller disconnected before dispatch'); return o; }
      o.usage={...planned}; this.save(o);
      const timer=setTimeout(() => { void this.serial(o.id,() => this.finish(o,3,'Seller request timed out')); },this.requestTimeoutMs); timer.unref(); this.timers.set(o.id,timer);
      try { p.send({type:'request',requestId:o.id,buyer,model:o.model,messages:input.messages,maxTokens:o.maxTokens,cache:cacheMode,usage:{...planned}}); }
      catch { await this.finish(o,3,'Seller connection unavailable at dispatch'); }
      return o;
    });
  }
  providerEvent(provider: Provider, event: any): Promise<void> {
    return this.serial(event.requestId,async () => {
      const o=this.store.state.orders[event.requestId] as Order|undefined;
      if (!o || !this.current(o) || o.status !== 'running' || o.providerId !== provider.id || o.seller !== provider.wallet || this.providers.get(provider.id)!==provider) return;
      if (event.type==='started') return;
      if (event.type==='chunk') {
        if (!Number.isSafeInteger(event.seq) || event.seq<0 || typeof event.text!=='string' || event.text.length>65536) { await this.finish(o,3,'Invalid seller chunk'); return; }
        if (event.seq<=o.lastSeq) return;
        if (event.seq!==o.lastSeq+1) { await this.finish(o,3,'Seller chunk sequence has a gap'); return; }
        const chars=Array.from(event.text); let accepted=''; let capped=false;
        for (const char of chars) {
          const next={...o.usage,output:o.usage.output+1};
          if (next.output>o.maxTokens || fee(o.quote,next)>units(o.budget)) { capped=true; break; }
          accepted+=char; o.usage=next;
        }
        o.lastSeq=event.seq; o.output+=accepted; this.save(o);
        if (accepted) this.emit('chunk',{id:o.id,text:accepted});
        if (capped || o.usage.output>=o.maxTokens) await this.finish(o,2,'Output token or spending limit reached');
      } else if (event.type==='completed') {
        if (event.seq!==undefined && event.seq!==o.lastSeq+1) { await this.finish(o,3,'Seller completion sequence has a gap'); return; }
        await this.finish(o,0,'Completed');
      } else if (event.type==='failed' || event.type==='cancelled') await this.finish(o,3,typeof event.message==='string'?event.message.slice(0,500):'Seller failed');
    });
  }
  cancel(id: string,buyer: string): Promise<Order> { return this.serial(id,async () => { const o=this.get(id,buyer); if (!this.current(o)) throw new HttpError(409,'This is a legacy dUSD order; use its original market recovery or withdrawal controls'); if (o.status==='locking') throw new HttpError(409,'Reservation is confirming; retry cancellation after confirmation'); if (!terminal(o)) await this.finish(o,1,'Buyer cancelled'); return o; }); }
  private async finish(o: Order,outcome: Outcome,reason: string): Promise<void> {
    if (!this.current(o) || terminal(o)) return;
    if (o.status==='locking') return;
    const timer=this.timers.get(o.id); if (timer) clearTimeout(timer); this.timers.delete(o.id);
    const p=this.providers.get(o.providerId); if (p) { p.busy=Math.max(0,p.busy-1); if (outcome!==0) { try {p.send({type:'cancel',requestId:o.id,reason});} catch {} } }
    o.outcome=outcome; o.status=(['completed','buyer_cancelled','budget_capped','seller_failed','platform_failed'] as const)[outcome]; o.reason=reason;
    const charge=outcome>=3?0n:fee(o.quote,o.usage); o.charge=decimal(charge);o.released=decimal(units(o.budget)-charge);o.settlement='pending';
    if (outcome===0 && o.cacheMode==='write' && o.cacheKey) this.store.state.cache[o.cacheKey]=Date.now()+3600000;
    this.save(o); await this.settle(o);
  }
  private async settle(o: Order): Promise<void> {
    if (!this.current(o) || o.outcome===undefined || o.settlement==='confirmed') return;
    try {
      const existing=await this.chain.getOrder(o.id);
      if(existing.state==='settled'||existing.state==='refunded'){
        o.charge=existing.state==='refunded'?decimal(0n):existing.charge??o.charge;
        o.released=decimal(units(o.budget)-units(o.charge));o.settlementTx=existing.txHash;o.settlement='confirmed';delete o.settlementError;
        if(existing.state==='refunded')o.reason=`${o.reason??''}; buyer reclaimed expired funds directly on chain`;
      }else{
        if(o.deadline<=Date.now()/1000)throw new Error('Settlement deadline has passed. The buyer can reclaim this reservation directly from the contract.');
        const result=await this.chain.settle({id:o.id,usage:o.usage,outcome:o.outcome,charge:o.charge});o.settlementTx=result.txHash;o.settlement='confirmed';delete o.settlementError;
      }
    }
    catch(error:any) {o.settlement='failed';o.settlementError=String(error.message??error).slice(0,500);}
    this.save(o);
  }
  private async reconcileReservation(o:Order):Promise<void>{
    if (!this.current(o)) return;
    try{
      const state=await this.chain.getOrder(o.id);
      if(state.state==='locked'){
        o.reservationUncertain=false;o.lockTx=state.txHash;o.outcome=4;o.status='platform_failed';o.charge=decimal(0n);o.released=o.budget;o.reason='Late reservation confirmation; request was never dispatched and all inference fees are waived';o.settlement='pending';this.save(o);await this.settle(o);
      }else if(state.state==='settled'||state.state==='refunded'){
        o.reservationUncertain=false;o.outcome=4;o.status='platform_failed';o.charge=state.charge??decimal(0n);o.released=decimal(units(o.budget)-units(o.charge));o.settlement='confirmed';o.settlementTx=state.txHash;delete o.settlementError;this.save(o);
      }else if(o.deadline<=Date.now()/1000){
        // Once the reservation deadline has passed, reserve() can no longer create a late lock.
        o.reservationUncertain=false;o.status='lock_failed';o.settlement='unsubmitted';delete o.settlementError;this.save(o);
      }
    }catch(error:any){o.settlementError=String(error.message??error).slice(0,500);this.save(o);}
  }
  async retrySettlements(): Promise<void> { await Promise.all(Object.values(this.store.state.orders).filter((o:Order) => this.current(o)&&(o.reservationUncertain||o.settlement==='failed'||o.settlement==='pending')).map((o:Order) => this.serial(o.id,() => o.reservationUncertain?this.reconcileReservation(o):this.settle(o)))); }
  async recover(): Promise<void> {
    for (const o of Object.values(this.store.state.orders) as Order[]) {
      if (!this.current(o) || terminal(o)) continue;
      let state;try{state=await this.chain.getOrder(o.id);}catch{}
      if(!state||(state.state==='unknown'&&o.deadline>Date.now()/1000)){
        o.status='reservation_unknown';o.reservationUncertain=true;o.settlement='failed';o.reason='Router restarted while reservation status was uncertain. This request will never be replayed.';o.settlementError='Waiting to reconcile possible late reservation confirmation';this.save(o);
      }else if (state.state==='locked') {o.status='running';await this.finish(o,4,'Router restarted; request will not be replayed');}
      else {o.status='platform_failed';o.reason='Router restarted; reservation is no longer active';o.charge=state.charge??decimal(0n);o.released=decimal(units(o.budget)-units(o.charge));o.settlement=state.state==='unknown'?'unsubmitted':'confirmed';o.settlementTx=state.txHash;this.save(o);}
    }
    await this.retrySettlements();
  }
  waitForTerminal(id: string): Promise<Order> {
    const ready=(o:Order)=>terminal(o)&&o.settlement!=='pending';
    const current=this.get(id); if (ready(current)) return Promise.resolve(current);
    return new Promise(resolve => { const handler=(o:Order) => {if(o.id===id&&ready(o)){this.off('order',handler);resolve(o);}}; this.on('order',handler); });
  }
  close(): void { for(const timer of this.timers.values()) clearTimeout(timer); }
}
