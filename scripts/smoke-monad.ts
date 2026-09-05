import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { getAddress, type Hex } from 'viem';
import { opaqueId } from '../server/src/evm-chain.js';
import { decimal, fee, units, type Usage } from './legacy-money.js';
import { monadContext, model, prices, minReserve, readJson, saveJson, receiptEvidence } from './setup-monad.js';

const evidencePath=new URL('../contracts/deployments/inferpool-smoke-monad.json',import.meta.url);
const ctx=await monadContext();
const read=(functionName:string,args:readonly unknown[]=[])=>ctx.client.readContract({address:ctx.market,abi:ctx.marketAbi,functionName,args});
const quote=await ctx.chain.getQuote(ctx.signer,model);assert.ok(quote,'Run setup-monad.ts first');
for(const key of Object.keys(prices) as (keyof typeof prices)[])assert.equal(units(quote[key]),prices[key]);assert.equal(units(quote.minReserve),minReserve);
let report:any;try{report=readJson(evidencePath);}catch{report={network:'monad-testnet',chainId:10143,token:ctx.token,market:ctx.market,wallet:ctx.signer,model,mockInference:true,scope:'Real Monad testnet contract smoke test. Buyer, seller and router are the SAME existing session wallet. This is not proof of two independent seller nodes or a complete UI flow.',scenarios:{}};}
assert.equal(getAddress(report.market),ctx.market);assert.equal(getAddress(report.wallet),ctx.signer);
const checkpoint=()=>{report.updatedAt=new Date().toISOString();saveJson(evidencePath,report);};
const usage:Usage={input:100,cacheRead:0,cacheWrite:0,output:100};
for(const scenario of [{name:'success',outcome:0 as const},{name:'seller_failed',outcome:3 as const}]){
  const id=`inferpool-monad-smoke-v1-${scenario.name}`;let entry=report.scenarios[scenario.name];
  if(!entry){entry={requestId:id,onchainRequestId:opaqueId(id),outcome:scenario.outcome,budget:'0.100000',usage,quote};report.scenarios[scenario.name]=entry;checkpoint();}
  const initial=await read('getOrder',[opaqueId(id)]) as any;
  if(Number(initial.state)===0){
    const block=await ctx.client.getBlock();entry.deadline=Number(block.timestamp)+600;
    entry.before={available:(await read('balances',[ctx.signer]) as bigint).toString(),totalLocked:(await read('totalLocked') as bigint).toString(),account:await ctx.chain.getAccount(ctx.signer)};checkpoint();
    const reserved=await ctx.chain.lock({id,buyer:ctx.signer,seller:ctx.signer,model,budget:entry.budget,quote,deadline:entry.deadline});
    entry.reserve=await receiptEvidence(ctx,reserved.txHash as Hex);checkpoint();
    console.log(JSON.stringify({scenario:scenario.name,action:'reserve',transactionHash:reserved.txHash}));
    const locked=await read('getOrder',[opaqueId(id)]) as any;assert.equal(Number(locked.state),1);assert.equal(locked.reserved,units('0.1'));
    assert.equal(await read('balances',[ctx.signer]),BigInt(entry.before.available)-units('0.1'));
    entry.afterReserve={order:locked,account:await ctx.chain.getAccount(ctx.signer)};checkpoint();
  }
  const current=await read('getOrder',[opaqueId(id)]) as any;
  if(Number(current.state)===1){
    if(current.deadline<=(await ctx.client.getBlock()).timestamp)throw new Error(`Smoke reservation ${id} expired; reclaim it directly instead of retrying settlement`);
    const charge=scenario.outcome===3?'0.000000':decimal(fee(quote,usage));
    const settled=await ctx.chain.settle({id,usage,outcome:scenario.outcome,charge});
    entry.settle=await receiptEvidence(ctx,settled.txHash as Hex);checkpoint();
    console.log(JSON.stringify({scenario:scenario.name,action:'settle',transactionHash:settled.txHash,charge}));
  }
  const final=await read('getOrder',[opaqueId(id)]) as any;
  assert.equal(Number(final.state),2);assert.equal(Number(final.outcome),scenario.outcome);assert.equal(final.charged,scenario.outcome===3?0n:fee(quote,usage));assert.equal(final.reserved,units('0.1'));
  assert.equal(getAddress(final.buyer),ctx.signer);assert.equal(getAddress(final.provider),ctx.signer);assert.deepEqual(final.usage,{input:100n,cacheRead:0n,cacheWrite:0n,output:100n});
  const afterBalance=await read('balances',[ctx.signer]) as bigint;
  if(entry.before)assert.equal(afterBalance,BigInt(entry.before.available),'The same wallet receives its own seller earnings; available balance returns to its pre-reserve value');
  entry.verified={chainState:'Settled',outcome:scenario.outcome,charged:decimal(final.charged),released:decimal(BigInt(final.reserved)-BigInt(final.charged)),order:final,availableAfter:decimal(afterBalance),grantAfter:await read('getGrant',[ctx.signer,final.grantId]),sameWalletBalanceExplanation:'The buyer and seller are identical for this smoke test, so fees consume spending authorization but are credited back to the same escrow account.'};checkpoint();
}
report.verifiedAt=new Date().toISOString();report.final={account:await ctx.chain.getAccount(ctx.signer),quote:await ctx.chain.getQuote(ctx.signer,model),totalLocked:(await read('totalLocked') as bigint).toString(),nativeBalanceWei:(await ctx.client.getBalance({address:ctx.signer})).toString()};assert.equal(report.final.totalLocked,'0');checkpoint();
console.log(JSON.stringify({smoke:'passed',evidence:fileURLToPath(evidencePath),successCharge:report.scenarios.success.verified.charged,sellerFailedCharge:report.scenarios.seller_failed.verified.charged,final:report.final}));
