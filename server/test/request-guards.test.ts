import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine, type Order, type Provider, type RequestInput } from '../src/engine.js';
import { MemoryChain } from '../src/chain.js';
import { Store } from '../src/store.js';
import { parseTrustProxy } from '../src/runtime-config.js';
import { decimal, units } from '../src/money.js';

const A='0x1111111111111111111111111111111111111111';
const B='0x2222222222222222222222222222222222222222';
const C='0x3333333333333333333333333333333333333333';
const SELLER='0x4444444444444444444444444444444444444444';
const request:RequestInput={model:'mock',messages:[{role:'user',content:'hello'}],max_tokens:8,max_spend:'0.1'};
const quote={input:'1',cacheRead:'0.1',cacheWrite:'2',output:'3',minReserve:'0.001'};
const rejected=(status:number)=> (error:any)=>error.status===status;

async function fixture(disk=false,timeout=60000) {
  const directory=disk?mkdtempSync(join(tmpdir(),'inferpool-request-guards-')):undefined;
  const path=directory?join(directory,'orders.json'):undefined;
  const store=new Store(path);const chain=new MemoryChain();
  for(const buyer of [A,B,C])chain.fund(buyer);
  chain.quote(SELLER,request.model,quote);
  const engine=new Engine(chain,store,timeout);
  const provider:Provider={id:'seller',wallet:SELLER,name:'mock',model:request.model,quote,capacity:32,busy:0,mode:'normal',mock:true,send:()=>{}};
  await engine.addProvider(provider);
  return {engine,store,chain,provider,path,close:()=>{engine.close();if(directory)rmSync(directory,{recursive:true,force:true});}};
}
async function complete(s:Awaited<ReturnType<typeof fixture>>,buyer:string,key?:string) {
  const order=await s.engine.create(buyer,request,key);
  await s.engine.providerEvent(s.provider,{type:'completed',requestId:order.id,seq:0});
  assert.equal(order.settlement,'confirmed');return order;
}

test('proxy trust remains explicit and invalid values fail before startup',()=>{
  assert.equal(parseTrustProxy(undefined),'none');assert.equal(parseTrustProxy('none'),'none');assert.equal(parseTrustProxy('loopback'),'loopback');
  for(const value of ['true','1','127.0.0.1','*',''])assert.throws(()=>parseTrustProxy(value));
});

test('exhausted historical demo counts do not restrict wallet or global concurrency',async()=>{
  const s=await fixture(true);
  const history=Array.from({length:15},(_,index)=>({buyer:index<9?A:B,createdAt:Date.now()}));
  s.store.state.admissionHistory=history;s.store.save();
  try{
    const orders=await Promise.all([s.engine.create(A,request,'one'),s.engine.create(A,request,'two'),s.engine.create(A,request,'three'),s.engine.create(B,request,'four')]);
    assert.equal(orders.length,4);assert.ok(orders.every(order=>order.status==='running'));
    assert.equal(orders.filter(order=>order.buyer===A).length,3);assert.equal(s.chain.orders.size,4);
    assert.equal(s.provider.busy,4);assert.deepEqual(new Store(s.path).state.admissionHistory,history);
  }finally{s.close();}
});

test('a pending reservation is persisted and later same-wallet requests still proceed in order',async()=>{
  const s=await fixture(true);let release!:()=>void;const original=s.chain.lock.bind(s.chain);let locks=0;
  s.chain.lock=async input=>{if(++locks===1)await new Promise<void>(resolve=>{release=resolve;});return original(input);};
  let first:Promise<Order>|undefined;let second:Promise<Order>|undefined;
  try{
    first=s.engine.create(A,request,'pending');second=s.engine.create(A,request,'another');
    await new Promise(resolve=>setImmediate(resolve));
    const stored=Object.values(JSON.parse(readFileSync(s.path!,'utf8')).orders) as Order[];
    assert.equal(stored.length,1);assert.equal(stored[0]!.status,'locking');assert.equal(locks,1);
    release();const orders=await Promise.all([first,second]);
    assert.equal(locks,2);assert.ok(orders.every(order=>order.status==='running'));
    assert.equal((await s.engine.create(A,request,'pending')).id,orders[0]!.id);assert.equal(locks,2);
  }finally{release?.();await Promise.allSettled([first,second]);s.close();}
});

test('more than ten native requests and six per wallet remain available after restart without clearing replay history',async()=>{
  const s=await fixture(true);
  try{
    const first=await complete(s,A,'first');
    for(let index=1;index<12;index++)await complete(s,A,`request-${index}`);
    assert.equal(Object.keys(s.store.state.orders).length,12);assert.equal(s.chain.orders.size,12);
    s.engine.close();const restarted=new Engine(s.chain,new Store(s.path),60000);await restarted.addProvider({...s.provider,busy:0});
    try{
      assert.equal((await restarted.create(A,request,'first')).id,first.id);
      await assert.rejects(restarted.create(A,{...request,max_tokens:2},'first'),rejected(409));
      const next=await restarted.create(A,request,'after-restart');assert.equal(next.status,'running');
      assert.equal(s.chain.orders.size,13);assert.equal(Object.keys(new Store(s.path).state.orders).length,13);
      assert.equal(restarted.get(first.id,A).settlement,'confirmed');
    }finally{restarted.close();}
  }finally{s.close();}
});

test('seller capacity still rejects competing requests before an extra reservation',async()=>{
  const s=await fixture();s.provider.capacity=2;
  try{
    const results=await Promise.allSettled([s.engine.create(A,request),s.engine.create(A,request),s.engine.create(B,request)]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,2);
    const failure=results.find(result=>result.status==='rejected') as PromiseRejectedResult;
    assert.equal(failure.reason.status,409);assert.match(failure.reason.message,/capacity/);
    assert.equal(s.chain.orders.size,2);assert.equal(s.provider.busy,2);
    assert.equal((await s.chain.getAccount(B)).available,decimal(units('100')));
  }finally{s.close();}
});

test('available balance and spending authorization still prevent concurrent overreservation',async()=>{
  for(const [balance,allowance] of [['0.15','10'],['10','0.15']] as const){
    const s=await fixture();s.chain.fund(A,balance,allowance);
    try{
      const results=await Promise.allSettled([s.engine.create(A,request),s.engine.create(A,request)]);
      assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
      const failure=results.find(result=>result.status==='rejected') as PromiseRejectedResult;
      assert.equal(failure.reason.status,402);assert.equal(s.chain.orders.size,1);
      assert.equal((await s.chain.getAccount(A)).available,decimal(units(balance)-units(request.max_spend)));
    }finally{s.close();}
  }
});

test('expired authorization and quote or input budgets still reject before any lock',async()=>{
  const s=await fixture();
  try{
    const account=s.chain.accounts.get(A)!;account.expiresAt=Math.floor(Date.now()/1000)-1;
    await assert.rejects(s.engine.create(A,request),rejected(402));
    s.chain.fund(A);
    await assert.rejects(s.engine.create(A,{...request,max_spend:'0'}),rejected(400));
    await assert.rejects(s.engine.create(A,{...request,max_spend:'0.0001'}),rejected(409));
    s.chain.quote(SELLER,request.model,{...quote,input:'1000000'});
    await assert.rejects(s.engine.create(A,request),rejected(409));
    s.chain.quotes.clear();await assert.rejects(s.engine.create(A,request),rejected(409));
    assert.equal(s.chain.orders.size,0);assert.deepEqual(s.store.state.orders,{});
  }finally{s.close();}
});

test('failed settlement does not impose a wallet quota and can recover alongside a later cancellation',async()=>{
  const s=await fixture();const original=s.chain.settle.bind(s.chain);s.chain.settle=async()=>{throw new Error('test RPC unavailable');};
  try{
    const first=await s.engine.create(A,request,'first');await s.engine.providerEvent(s.provider,{type:'completed',requestId:first.id,seq:0});
    assert.equal(first.settlement,'failed');
    const next=await s.engine.create(A,request,'next');assert.equal(next.status,'running');assert.equal(s.chain.orders.size,2);
    assert.equal(s.engine.get(first.id,A).id,first.id);assert.equal(s.engine.list(A).length,2);
    assert.equal((await s.engine.create(A,request,'first')).id,first.id);
    s.chain.settle=original;await s.engine.retrySettlements();assert.equal(first.settlement,'confirmed');
    await s.engine.cancel(next.id,A);assert.equal(next.status,'buyer_cancelled');assert.equal(next.settlement,'confirmed');
    await s.engine.cancel(next.id,A);assert.equal(s.chain.orders.size,2);
  }finally{s.close();}
});

test('ambiguous locks remain recorded and recover without an artificial wallet quota',async()=>{
  const s=await fixture();s.chain.lock=async()=>{throw new Error('ambiguous test lock');};
  try{
    const orders=await Promise.all([s.engine.create(A,request,'unknown-a'),s.engine.create(A,request,'unknown-b')]);
    assert.ok(orders.every(order=>order.status==='reservation_unknown'));assert.equal(s.provider.busy,0);
    assert.equal((await s.engine.create(A,request,'unknown-a')).id,orders[0]!.id);assert.equal(Object.keys(s.store.state.orders).length,2);
    for(const order of orders)order.deadline=Math.floor(Date.now()/1000)-1;
    await s.engine.retrySettlements();assert.ok(orders.every(order=>order.status==='lock_failed'&&order.charge===decimal(0n)));
    assert.equal(s.chain.orders.size,0);
  }finally{s.close();}
});

test('seller timeout still refunds an unfinished request',async()=>{
  const s=await fixture(false,20);
  let deadline:NodeJS.Timeout|undefined;
  try{
    const order=await s.engine.create(A,request);
    await Promise.race([s.engine.waitForTerminal(order.id),new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(new Error('Seller timeout did not complete')),1000);})]);
    assert.equal(order.status,'seller_failed');assert.equal(order.charge,decimal(0n));assert.equal(order.settlement,'confirmed');
    assert.equal((await s.chain.getAccount(A)).available,decimal(units('100')));
  }finally{clearTimeout(deadline);s.close();}
});
