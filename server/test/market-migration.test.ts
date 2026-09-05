import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, type MarketIdentity } from '../src/store.js';
import { Engine } from '../src/engine.js';
import { MemoryChain } from '../src/chain.js';

const oldMarket: MarketIdentity = {market_address:'0x1111111111111111111111111111111111111111',asset_symbol:'dUSD',asset_decimals:6};
const newMarket: MarketIdentity = {market_address:'0x2222222222222222222222222222222222222222',asset_symbol:'MON',asset_decimals:18};
const buyer='0x3333333333333333333333333333333333333333';
const oldOrder=()=>({id:'old',buyer,status:'completed',settlement:'confirmed',charge:'0.014160',budget:'0.100000',released:'0.085840',createdAt:Date.now(),deadline:1});

test('migration preserves original amounts, history, credentials and admission timestamps',()=>{
  const store=new Store();store.state.orders.old=oldOrder();store.state.cache.old=Date.now()+1000;
  store.state.idempotency[`${buyer}:same-key`]={id:'old',fingerprint:'old'};
  const before=JSON.stringify(store.state.orders.old);
  assert.throws(()=>store.bindMarket(newMarket),/original legacy market/);
  assert.equal(JSON.stringify(store.state.orders.old),before);
  store.bindMarket(newMarket,oldMarket);
  assert.deepEqual(store.state.orders.old,{...JSON.parse(before),...oldMarket});
  assert.equal(store.state.idempotency[`${buyer}:same-key`]?.id,'old');
  assert.deepEqual(store.state.cache,{});
  store.bindMarket(newMarket,oldMarket);
  assert.equal(store.state.orders.old.charge,'0.014160');
});

test('outstanding legacy funds block migration without partially changing old orders',()=>{
  for(const patch of [{status:'running'},{settlement:'pending'},{settlement:'failed'},{status:'reservation_unknown',reservationUncertain:true}]){
    const store=new Store();store.state.orders.old=oldOrder();store.state.orders.pending={...oldOrder(),id:'pending',...patch};
    const before=JSON.stringify(store.state);
    assert.throws(()=>store.bindMarket(newMarket,oldMarket),/outstanding legacy/);
    assert.equal(JSON.stringify(store.state),before);
  }
});

test('unknown market and inconsistent asset metadata fail closed',()=>{
  const store=new Store();store.state.market=oldMarket;
  assert.throws(()=>store.bindMarket(newMarket),/different market/);
  store.state.orders.old={...oldOrder(),...oldMarket,asset_symbol:'MON'};
  assert.throws(()=>store.bindMarket(newMarket,oldMarket),/unknown or inconsistent/);
});

test('new engine never recovers or cancels old dUSD on the MON contract; idempotency is separated',async()=>{
  const store=new Store();store.state.orders.old=oldOrder();
  store.state.idempotency[`${buyer}:same-key`]={id:'old',fingerprint:'old'};
  store.bindMarket(newMarket,oldMarket);
  const chain=Object.assign(new MemoryChain(),{market:newMarket.market_address});
  let reads=0;const read=chain.getOrder.bind(chain);chain.getOrder=async id=>{reads++;return read(id);};
  const engine=new Engine(chain,store);
  await engine.recover();assert.equal(reads,0);
  assert.equal(engine.list(buyer)[0]!.asset_symbol,'dUSD');
  await assert.rejects(engine.cancel('old',buyer),/legacy dUSD/);
  chain.fund(buyer,'1');chain.quote(buyer,'mock',{input:'0.3',cacheRead:'0.03',cacheWrite:'0.375',output:'0.8',minReserve:'0.000001'});
  const provider={id:'seller',wallet:buyer,name:'seller',model:'mock',quote:(await chain.getQuote(buyer,'mock'))!,capacity:1,busy:0,mode:'normal',mock:true as const,send:()=>{}};
  await engine.addProvider(provider);
  try{
    const input={model:'mock',messages:[{role:'user' as const,content:'hi'}],max_tokens:2,max_spend:'0.001'};
    await assert.rejects(engine.create(buyer,input,'same-key'),/legacy request old/);
    assert.equal(chain.orders.size,0);
    const order=await engine.create(buyer,input,'new-key');
    assert.notEqual(order.id,'old');assert.equal(order.asset_symbol,'MON');assert.equal(order.asset_decimals,18);assert.equal(order.market_address,newMarket.market_address);
    await engine.providerEvent(provider,{type:'completed',requestId:order.id,seq:0});
    assert.equal(order.settlement,'confirmed');assert.equal(store.state.orders.old.charge,'0.014160');
    assert.equal((await engine.create(buyer,input,'new-key')).id,order.id);
  }finally{engine.close();}
});
