/** One bounded public MON request, with persisted idempotency and no credential output. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { getAddress, type Hex } from 'viem';
import { EvmChain, opaqueId } from '../server/src/evm-chain.js';
import { createAlchemyBuyerSessionAccount } from '../provider/src/signer.js';
import { units, fee, decimal } from '../server/src/money.js';
const root=new URL('../',import.meta.url);
const path=new URL('contracts/deployments/inferpool-native-api-smoke.json',root);
const readJson=(url:URL)=>JSON.parse(readFileSync(url,'utf8'));
const deployment=readJson(new URL('contracts/deployments/inferpool-mon-native-testnet.json',root));
const origin='https://demo.example.com';
const market=getAddress(deployment.market);const buyer=getAddress(deployment.router);
const chain=new EvmChain({mode:'monad-testnet',rpcUrl:deployment.rpcUrl,marketAddress:market,routerAddress:buyer});
await chain.ready();
const report:any=existsSync(path)?readJson(path):{network:'monad-testnet',chainId:10143,market,buyer,asset:'MON',idempotencyKey:'inferpool-native-public-api-v2-001',scope:'One public HTTPS/SSE request via existing Alchemy wallet; same wallet as Seller A. Does not establish browser or cross-wallet acceptance.'};
assert.equal(getAddress(report.market),market);assert.equal(getAddress(report.buyer),buyer);
const save=()=>writeFileSync(path,JSON.stringify(report,(_k,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');
const json=async(route:string,body?:unknown,token?:string,method?:string)=>{
  const response=await fetch(origin+route,{method:method??(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  if(!response.ok)throw new Error(`HTTP ${response.status} at ${route}`);
  return response.status===204?undefined:await response.json();
};
const config=await json('/config');assert.equal(getAddress(config.market_address),market);assert.equal(config.asset_symbol,'MON');assert.equal(config.asset_decimals,18);
if(!process.argv.includes('--execute')||report.verifiedAt){
  console.log(JSON.stringify({mode:'read-only',alreadyVerified:!!report.verifiedAt,market,config,account:await chain.getAccount(buyer)}));
}else{
  const account=await createAlchemyBuyerSessionAccount({routerUrl:origin});assert.equal(getAddress(account.address),buyer);
  const challenge=await json('/auth/challenge',{wallet:buyer});
  // Keep the signer's strict five-minute limit despite small server/client clock skew.
  const clockWait=Math.max(0,Number(challenge.expiresAt)-Date.now()-300_000+50);
  assert.ok(Number.isFinite(clockWait)&&clockWait<=5000,'Router clock differs too much from the local clock');
  if(clockWait)await new Promise(resolve=>setTimeout(resolve,clockWait));
  const signature=await account.signMessage({message:challenge.message});
  const session=await json('/auth/verify',{wallet:buyer,nonce:challenge.nonce,signature});
  let key:any;
  try{
    key=await json('/api-keys',{name:'Native MON acceptance',expires_in_days:1},session.token);
    const input={model:'mock-reasoner',messages:[{role:'user',content:'Explain the InferPool native MON settlement flow briefly.'}],max_tokens:128,max_spend:'0.001',provider_id:'seller-monad',stream:true};
    report.input=input;report.startedAt??=new Date().toISOString();report.before??=await chain.getAccount(buyer);save();
    const response=await fetch(origin+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key.token}`,'Idempotency-Key':report.idempotencyKey},body:JSON.stringify(input)});
    assert.equal(response.status,200);assert.match(response.headers.get('content-type')??'',/text\/event-stream/);
    const requestId=response.headers.get('x-request-id');assert.ok(requestId);
    if(report.requestId)assert.equal(requestId,report.requestId);report.requestId=requestId;save();
    assert.ok(response.body);const reader=response.body.getReader();const decoder=new TextDecoder();let stream='';let batches=0;let firstChunkAt:number|undefined;
    while(true){const part=await reader.read();if(part.done)break;batches++;firstChunkAt??=Date.now();stream+=decoder.decode(part.value,{stream:true});}
    stream+=decoder.decode();assert.ok(stream.includes('data: [DONE]'));assert.ok(stream.includes('chat.completion.chunk'));assert.ok(batches>1,'Public proxy should deliver incremental SSE, not one buffered response');
    const bill=await json(`/v1/requests/${requestId}`,undefined,key.token);assert.equal(bill.asset_symbol,'MON');assert.equal(bill.asset_decimals,18);assert.equal(getAddress(bill.market_address),market);assert.equal(bill.settlement,'confirmed');assert.ok(['completed','budget_capped'].includes(bill.status));assert.equal(bill.budget,decimal(units('0.001')));
    const order=await chain.client.readContract({address:market,abi:chain.abi,functionName:'getOrder',args:[opaqueId(requestId)]}) as any;
    assert.equal(Number(order.state),2);assert.equal(getAddress(order.buyer),buyer);assert.equal(getAddress(order.provider),buyer);assert.equal(order.reserved,units('0.001'));assert.equal(order.charged,fee(bill.quote,bill.usage));assert.equal(order.charged,units(bill.charge));
    const receipts:any={};
    for(const [name,hash] of Object.entries({lock:bill.lockTx,settlement:bill.settlementTx})){
      const r=await chain.client.getTransactionReceipt({hash:hash as Hex});const tx=await chain.client.getTransaction({hash:hash as Hex});
      assert.equal(r.status,'success');assert.equal(getAddress(r.to!),market);assert.equal(getAddress(r.from),buyer);assert.equal(tx.value,0n);
      receipts[name]={transactionHash:hash,status:r.status,blockNumber:r.blockNumber.toString(),gasCostWei:(tx.gas*r.effectiveGasPrice).toString(),explorerUrl:`https://testnet.monadscan.com/tx/${hash}`};
    }
    const replay=await fetch(origin+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key.token}`,'Idempotency-Key':report.idempotencyKey},body:JSON.stringify({...input,stream:false})});
    assert.equal(replay.status,200);const repeated:any=await replay.json();assert.equal(repeated.id,requestId);assert.equal(repeated.request.lockTx,bill.lockTx);assert.equal(repeated.request.settlementTx,bill.settlementTx);
    const after=await chain.getAccount(buyer);assert.equal(after.available,report.before.available);assert.equal(units(report.before.authorized)-units(after.authorized),units(bill.charge));
    report.bill=bill;report.receipts=receipts;report.after=after;report.sse={batches,firstChunkAt,finishedAt:Date.now(),incremental:true};report.idempotentReplayVerified=true;report.verifiedAt=new Date().toISOString();save();
  }finally{
    if(key){await json(`/api-keys/${key.id}`,undefined,session.token,'DELETE');report.temporaryKeyRevoked=true;save();}
  }
  console.log(JSON.stringify({verified:!!report.verifiedAt,requestId:report.requestId,charge:report.bill?.charge,asset:'MON',temporaryKeyRevoked:report.temporaryKeyRevoked,evidence:path.pathname}));
}
