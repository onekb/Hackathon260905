import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryChain } from '../src/chain.js';
import { Engine, HttpError, type Provider, type RequestInput } from '../src/engine.js';
import { mockTokens, type Quote } from '../src/money.js';
import { Store } from '../src/store.js';
const BUYER='0x1111111111111111111111111111111111111111';
const SELLER='0x2222222222222222222222222222222222222222';
const quote:Quote={input:'0',cacheRead:'0',cacheWrite:'0',output:'1000',minReserve:'0.001'};
const request:RequestInput={model:'mock-reasoner',messages:[{role:'user',content:'hello'}],max_tokens:100,max_spend:'1'};
async function setup(q=quote,timeout=10000) {
  const chain=new MemoryChain();chain.fund(BUYER);chain.quote(SELLER,request.model,q);
  const store=new Store();const engine=new Engine(chain,store,timeout);const sent:any[]=[];
  const provider:Provider={id:'seller-a',wallet:SELLER,name:'Mock seller',model:request.model,quote:q,capacity:8,busy:0,mode:'normal',mock:true,send:m=>{sent.push(m);}};
  await engine.addProvider(provider);
  return {chain,store,engine,provider,sent};
}
test('reservation precedes dispatch and idempotency avoids a second lock',async()=>{
  const s=await setup();let resolve!:()=>void;const original=s.chain.lock.bind(s.chain);
  s.chain.lock=async input=>{await new Promise<void>(r=>{resolve=r;});return original(input);};
  const first=s.engine.create(BUYER,request,'key');
  await new Promise(r=>setImmediate(r));assert.equal(s.sent.length,0);resolve();
  const o=await first;const same=await s.engine.create(BUYER,request,'key');
  assert.equal(o.id,same.id);assert.equal(s.chain.orders.size,1);assert.equal(s.sent.length,1);
  await assert.rejects(s.engine.create(BUYER,{...request,max_tokens:2},'key'),(e:any)=>e.status===409);
  s.engine.close();
});
test('seller failure after partial delivery clears the entire inference fee',async()=>{
  const s=await setup();const o=await s.engine.create(BUYER,request);
  await s.engine.providerEvent(s.provider,{type:'chunk',requestId:o.id,seq:0,text:'hello',outputTokens:999999});
  assert.equal(o.usage.output,5);
  await s.engine.providerEvent(s.provider,{type:'failed',requestId:o.id,message:'simulated failure'});
  assert.equal(o.status,'seller_failed');assert.equal(o.charge,'0.000000000000000000');assert.equal(o.released,'1.000000000000000000');assert.equal(o.settlement,'confirmed');
  assert.equal((await s.chain.getAccount(BUYER)).available,'100.000000000000000000');s.engine.close();
});
test('buyer cancel wins over later seller error and charges only accepted mock tokens',async()=>{
  const s=await setup();const o=await s.engine.create(BUYER,request);
  await s.engine.providerEvent(s.provider,{type:'chunk',requestId:o.id,seq:0,text:'你好🦄'});
  await Promise.all([s.engine.cancel(o.id,BUYER),s.engine.providerEvent(s.provider,{type:'failed',requestId:o.id})]);
  assert.equal(o.status,'buyer_cancelled');assert.equal(o.charge,'0.003000000000000000');assert.equal(o.released,'0.997000000000000000');
  await s.engine.cancel(o.id,BUYER);assert.equal((await s.chain.getAccount(BUYER)).available,'99.997000000000000000');s.engine.close();
});
test('seller failure wins over later buyer cancel',async()=>{
  const s=await setup();const o=await s.engine.create(BUYER,request);
  await s.engine.providerEvent(s.provider,{type:'chunk',requestId:o.id,seq:0,text:'abc'});
  await Promise.all([s.engine.providerEvent(s.provider,{type:'failed',requestId:o.id}),s.engine.cancel(o.id,BUYER)]);
  assert.equal(o.status,'seller_failed');assert.equal(o.charge,'0.000000000000000000');s.engine.close();
});
test('duplicate chunks are ignored and budget truncates at a Unicode code point',async()=>{
  const s=await setup();const o=await s.engine.create(BUYER,{...request,max_spend:'0.005'});
  await s.engine.providerEvent(s.provider,{type:'chunk',requestId:o.id,seq:0,text:'ab'});
  await s.engine.providerEvent(s.provider,{type:'chunk',requestId:o.id,seq:0,text:'ab'});
  await s.engine.providerEvent(s.provider,{type:'chunk',requestId:o.id,seq:1,text:'🦄你好world'});
  assert.equal(o.output,'ab🦄你好');assert.equal(o.usage.output,5);assert.equal(o.status,'budget_capped');assert.equal(o.charge,'0.005000000000000000');assert.equal(o.released,'0.000000000000000000');s.engine.close();
});
test('sequence gaps count as seller failure, not incomplete paid output',async()=>{
  const s=await setup();const o=await s.engine.create(BUYER,request);
  await s.engine.providerEvent(s.provider,{type:'chunk',requestId:o.id,seq:1,text:'lost start'});
  assert.equal(o.status,'seller_failed');assert.equal(o.charge,'0.000000000000000000');s.engine.close();
});
test('cache partitions input once and is isolated by buyer and provider',async()=>{
  const q={...quote,input:'1',cacheRead:'0.1',cacheWrite:'2'};const s=await setup(q);
  const run=async(buyer:string)=>{const o=await s.engine.create(buyer,{...request,cache:true});await s.engine.providerEvent(s.provider,{type:'completed',requestId:o.id,seq:0});return o;};
  const first=await run(BUYER);const next=await run(BUYER);
  assert.equal(first.usage.cacheWrite,mockTokens(JSON.stringify(request.messages)));assert.equal(first.usage.input,0);assert.equal(first.usage.cacheRead,0);
  assert.equal(next.usage.cacheRead,first.usage.cacheWrite);assert.equal(next.usage.cacheWrite,0);
  const other='0x3333333333333333333333333333333333333333';s.chain.fund(other);const another=await run(other);assert.equal(another.cacheMode,'write');s.engine.close();
});
test('chain authorization prevents concurrent overreservation',async()=>{
  const s=await setup();s.chain.fund(BUYER,'10','1.5');
  const results=await Promise.allSettled([s.engine.create(BUYER,request),s.engine.create(BUYER,request)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(s.chain.orders.size,1);s.engine.close();
});
test('settlement retries preserve outcome and do not infer seller failure',async()=>{
  const s=await setup();const original=s.chain.settle.bind(s.chain);let attempts=0;
  s.chain.settle=async input=>{if(++attempts===1)throw new Error('RPC temporarily unavailable');return original(input);};
  const o=await s.engine.create(BUYER,request);await s.engine.providerEvent(s.provider,{type:'chunk',requestId:o.id,seq:0,text:'abc'});
  await s.engine.providerEvent(s.provider,{type:'completed',requestId:o.id,seq:1});
  assert.equal(o.status,'completed');assert.equal(o.settlement,'failed');assert.equal(o.charge,'0.003000000000000000');
  await s.engine.retrySettlements();assert.equal(o.settlement,'confirmed');assert.equal(attempts,2);
  await s.engine.retrySettlements();assert.equal(attempts,2);s.engine.close();
});
test('restart refunds an in-flight order and never re-dispatches it',async()=>{
  const s=await setup();const o=await s.engine.create(BUYER,request);s.engine.close();
  const restarted=new Engine(s.chain,s.store);await restarted.recover();
  assert.equal(o.status,'platform_failed');assert.equal(o.charge,'0.000000000000000000');assert.equal(o.settlement,'confirmed');assert.equal(s.sent.length,1);restarted.close();
});
test('disconnect fails in-flight requests and removes dispatch capacity',async()=>{
  const s=await setup();const o=await s.engine.create(BUYER,request);await s.engine.removeProvider(s.provider.id,s.provider);
  assert.equal(o.status,'seller_failed');assert.equal(s.engine.models().length,0);s.engine.close();
});
test('ambiguous reservation is reconciled after late mining without ever dispatching',async()=>{
  const s=await setup();const original=s.chain.lock.bind(s.chain);let deferred:any;
  s.chain.lock=async input=>{deferred=input;throw new Error('RPC receipt timeout');};
  const o=await s.engine.create(BUYER,request);assert.equal(o.status,'reservation_unknown');assert.equal(o.reservationUncertain,true);assert.equal(s.sent.length,0);
  await original(deferred);await s.engine.retrySettlements();
  assert.equal(o.status,'platform_failed');assert.equal(o.settlement,'confirmed');assert.equal(o.charge,'0.000000000000000000');assert.equal(s.sent.length,0);assert.equal((await s.chain.getAccount(BUYER)).available,'100.000000000000000000');s.engine.close();
});
test('ambiguous reservation survives a failed follow-up query and router restart',async()=>{
  const s=await setup();const original=s.chain.lock.bind(s.chain);const query=s.chain.getOrder.bind(s.chain);let deferred:any;
  s.chain.lock=async input=>{deferred=input;throw new Error('Network unavailable');};
  s.chain.getOrder=async()=>{throw new Error('Network unavailable');};
  const o=await s.engine.create(BUYER,request);assert.equal(o.reservationUncertain,true);
  s.engine.close();await original(deferred);s.chain.getOrder=query;
  const restarted=new Engine(s.chain,s.store);await restarted.recover();assert.equal(o.settlement,'confirmed');assert.equal(o.charge,'0.000000000000000000');restarted.close();
});
test('direct buyer reclaim is reflected in the confirmed bill',async()=>{
  const s=await setup();const o=await s.engine.create(BUYER,request);
  s.chain.getOrder=async()=>({state:'refunded',charge:'0.000000000000000000',txHash:'memory:reclaim'});
  await s.engine.providerEvent(s.provider,{type:'chunk',requestId:o.id,seq:0,text:'charged estimate'});
  await s.engine.providerEvent(s.provider,{type:'completed',requestId:o.id,seq:1});
  assert.equal(o.status,'completed');assert.equal(o.charge,'0.000000000000000000');assert.equal(o.released,'1.000000000000000000');assert.equal(o.settlement,'confirmed');assert.equal(o.settlementTx,'memory:reclaim');s.engine.close();
});
