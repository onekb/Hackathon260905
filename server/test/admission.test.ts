import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine, type Order, type Provider, type RequestInput } from '../src/engine.js';
import { MemoryChain } from '../src/chain.js';
import { Store } from '../src/store.js';
import { parseDemoAdmission, parseTrustProxy, type DemoAdmission } from '../src/runtime-config.js';
import { decimal, units } from '../src/money.js';

const A='0x1111111111111111111111111111111111111111';
const B='0x2222222222222222222222222222222222222222';
const C='0x3333333333333333333333333333333333333333';
const SELLER='0x4444444444444444444444444444444444444444';
const request:RequestInput={model:'mock',messages:[{role:'user',content:'hello'}],max_tokens:8,max_spend:'0.1'};
const quote={input:'1',cacheRead:'0.1',cacheWrite:'2',output:'3',minReserve:'0.001'};
const policy=(newOrdersEnabled=true):DemoAdmission=>({startMs:Date.now()-86400000,newOrdersEnabled});
const rejected=(status:number)=> (error:any)=>error.status===status;

async function fixture(admission:DemoAdmission|undefined=policy(),disk=false) {
  const directory=disk?mkdtempSync(join(tmpdir(),'inferpool-admission-')):undefined;
  const path=directory?join(directory,'orders.json'):undefined;
  const store=new Store(path);const chain=new MemoryChain();
  for(const buyer of [A,B,C])chain.fund(buyer);
  chain.quote(SELLER,request.model,quote);
  const engine=new Engine(chain,store,60000,admission);
  const provider:Provider={id:'seller',wallet:SELLER,name:'mock',model:request.model,quote,capacity:32,busy:0,mode:'normal',mock:true,send:()=>{}};
  await engine.addProvider(provider);
  return {engine,store,chain,provider,path,close:()=>{engine.close();if(directory)rmSync(directory,{recursive:true,force:true});}};
}
async function complete(s:Awaited<ReturnType<typeof fixture>>,buyer:string,key?:string) {
  const order=await s.engine.create(buyer,request,key);
  await s.engine.providerEvent(s.provider,{type:'completed',requestId:order.id,seq:0});
  assert.equal(order.settlement,'confirmed');return order;
}

test('demo and proxy configuration are explicit and fail closed before startup',()=>{
  assert.equal(parseDemoAdmission({}),undefined);
  assert.equal(parseDemoAdmission({DEMO_ADMISSION_ENABLED:'false'}),undefined);
  const env={DEMO_ADMISSION_ENABLED:'true',DEMO_ADMISSION_START_UTC:'2026-09-05T00:00:00Z'};
  assert.deepEqual(parseDemoAdmission(env,Date.parse('2026-09-05T01:00:00Z')),{startMs:Date.parse(env.DEMO_ADMISSION_START_UTC),newOrdersEnabled:true});
  assert.equal(parseDemoAdmission({...env,DEMO_NEW_ORDERS_ENABLED:'false'},Date.parse('2026-09-05T01:00:00Z'))?.newOrdersEnabled,false);
  for(const values of [{DEMO_ADMISSION_ENABLED:'yes'},{DEMO_ADMISSION_ENABLED:'true'}, {...env,DEMO_ADMISSION_START_UTC:'2026-02-30T00:00:00Z'}, {...env,DEMO_ADMISSION_START_UTC:'2026-09-05T00:00:00+00:00'}, {...env,DEMO_ADMISSION_START_UTC:'2099-01-01T00:00:00Z'}, {...env,DEMO_NEW_ORDERS_ENABLED:'0'}, {DEMO_NEW_ORDERS_ENABLED:'false'}])assert.throws(()=>parseDemoAdmission(values));
  assert.equal(parseTrustProxy(undefined),'none');assert.equal(parseTrustProxy('none'),'none');assert.equal(parseTrustProxy('loopback'),'loopback');
  for(const value of ['true','1','127.0.0.1','*',''])assert.throws(()=>parseTrustProxy(value));
});

test('local flow remains unrestricted when demo admission is absent',async()=>{
  const s=await fixture();const local=new Engine(s.chain,s.store,60000);await local.addProvider(s.provider);
  try {const orders=await Promise.all([local.create(A,request),local.create(A,request),local.create(A,request)]);assert.equal(orders.length,3);assert.equal(s.chain.orders.size,3);}finally{local.close();s.close();}
});

test('wallet and global concurrency checks serialize competing new requests before any extra lock',async()=>{
  const s=await fixture();try{
    const wallet=await Promise.allSettled([s.engine.create(A,request),s.engine.create(A,request)]);
    assert.equal(wallet.filter(result=>result.status==='fulfilled').length,1);assert.equal(s.chain.orders.size,1);
    const global=await Promise.allSettled([s.engine.create(B,request),s.engine.create(C,request)]);
    assert.equal(global.filter(result=>result.status==='fulfilled').length,1);assert.equal(s.chain.orders.size,2);
    assert.equal((await s.chain.getAccount(C)).available,decimal(units('100')));
  }finally{s.close();}
});

test('a locking request consumes its persisted attempt and blocks another same-wallet lock',async()=>{
  const s=await fixture(policy(),true);let release!:()=>void;const original=s.chain.lock.bind(s.chain);let locks=0;
  s.chain.lock=async input=>{locks++;await new Promise<void>(resolve=>{release=resolve;});return original(input);};
  try{
    const first=s.engine.create(A,request,'pending');const second=s.engine.create(A,request,'another');
    const rejectedSecond=assert.rejects(second,rejected(429));
    await new Promise(resolve=>setImmediate(resolve));
    const stored=Object.values(JSON.parse(readFileSync(s.path!,'utf8')).orders) as Order[];
    assert.equal(stored.length,1);assert.equal(stored[0]!.status,'locking');assert.equal(locks,1);
    release();await first;await rejectedSecond;assert.equal(locks,1);
  }finally{s.close();}
});

test('six daily attempts persist across restart; replay does not consume a slot and a new key cannot reset quota',async()=>{
  const config=policy();const s=await fixture(config,true);try{
    const first=await complete(s,A,'first');
    for(let index=1;index<6;index++)await complete(s,A,`request-${index}`);
    assert.equal((await s.engine.create(A,request,'first')).id,first.id);
    assert.equal(Object.keys(s.store.state.orders).length,6);
    s.engine.close();const reloadedStore=new Store(s.path);const restarted=new Engine(s.chain,reloadedStore,60000,config);await restarted.addProvider({...s.provider,busy:0});
    try{
      assert.equal((await restarted.create(A,request,'first')).id,first.id);
      await assert.rejects(restarted.create(A,request,'brand-new-api-key-request'),rejected(429));
      assert.equal(s.chain.orders.size,6);assert.equal(Object.keys(new Store(s.path).state.orders).length,6);
    }finally{restarted.close();}
  }finally{s.close();}
});

test('global ten-attempt limit rejects racing eleventh work regardless of buyer or restart',async()=>{
  const config=policy();const s=await fixture(config,true);try{
    for(let index=0;index<5;index++)await complete(s,A);
    for(let index=0;index<4;index++)await complete(s,B);
    const results=await Promise.allSettled([s.engine.create(B,request,'tenth'),s.engine.create(C,request,'eleventh')]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(Object.keys(s.store.state.orders).length,10);assert.equal(s.chain.orders.size,10);
    s.engine.close();const restarted=new Engine(s.chain,new Store(s.path),60000,config);await restarted.addProvider({...s.provider,busy:0});
    try{await assert.rejects(restarted.create(C,request,'after-restart'),rejected(429));assert.equal(s.chain.orders.size,10);}finally{restarted.close();}
  }finally{s.close();}
});

test('a failed reservation attempt counts, and uncertain funding retains wallet concurrency',async()=>{
  const s=await fixture();s.chain.lock=async()=>{throw new Error('ambiguous test lock');};
  try{
    for(let index=0;index<6;index++){
      const order=await s.engine.create(A,request,`failure-${index}`);assert.equal(order.status,'reservation_unknown');
      await assert.rejects(s.engine.create(A,request,`while-unknown-${index}`),rejected(429));
      order.deadline=Math.floor(Date.now()/1000)-1;await s.engine.retrySettlements();
      assert.equal(order.status,'lock_failed');assert.equal(order.charge,decimal(0n));
    }
    await assert.rejects(s.engine.create(A,request,'seventh'),rejected(429));assert.equal(Object.keys(s.store.state.orders).length,6);assert.equal(s.chain.orders.size,0);
  }finally{s.close();}
});

test('failed or pending settlement retains concurrency until successful recovery',async()=>{
  const s=await fixture();const original=s.chain.settle.bind(s.chain);s.chain.settle=async()=>{throw new Error('test RPC unavailable');};
  try{
    const order=await s.engine.create(A,request);await s.engine.providerEvent(s.provider,{type:'completed',requestId:order.id,seq:0});
    assert.equal(order.settlement,'failed');await assert.rejects(s.engine.create(A,request),rejected(429));
    s.chain.settle=original;await s.engine.retrySettlements();assert.equal(order.settlement,'confirmed');
    await s.engine.create(A,request);assert.equal(s.chain.orders.size,2);
  }finally{s.close();}
});

test('manual new-order disable preserves queries, exact replay, cancellation and settlement recovery',async()=>{
  const s=await fixture();try{
    const order=await s.engine.create(A,request,'existing');s.engine.close();
    const disabled=new Engine(s.chain,s.store,60000,{...policy(),newOrdersEnabled:false});
    try{
      assert.equal(disabled.get(order.id,A).id,order.id);assert.equal(disabled.list(A).length,1);
      assert.equal((await disabled.create(A,request,'existing')).id,order.id);
      await assert.rejects(disabled.create(A,{...request,max_tokens:2},'existing'),rejected(409));
      await assert.rejects(disabled.create(B,request,'new'),rejected(503));
      const original=s.chain.settle.bind(s.chain);s.chain.settle=async()=>{throw new Error('retry test');};
      await disabled.cancel(order.id,A);assert.equal(order.status,'buyer_cancelled');assert.equal(order.settlement,'failed');
      s.chain.settle=original;await disabled.retrySettlements();assert.equal(order.settlement,'confirmed');assert.equal(s.chain.orders.size,1);
    }finally{disabled.close();}
  }finally{s.close();}
});

test('fixed epoch excludes earlier counts but never earlier unresolved orders; UTC dates define daily quota',async()=>{
  const config=policy();const s=await fixture(config);try{
    const first=await complete(s,A,'before-epoch');
    first.createdAt=config.startMs-1;
    for(let index=0;index<6;index++)await complete(s,A,`today-${index}`);
    await assert.rejects(s.engine.create(A,request,'today-seventh'),rejected(429));
    const sameDay=Object.values(s.store.state.orders).find((o:Order)=>o.id!==first.id) as Order;
    sameDay.createdAt=Math.floor(Date.now()/86400000)*86400000-1;
    await complete(s,A,'new-utc-day-slot');
    first.status='reservation_unknown';first.settlement='failed';
    await assert.rejects(s.engine.create(A,request,'old-unresolved'),rejected(429));
  }finally{s.close();}
});
