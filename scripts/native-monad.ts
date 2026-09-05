/** Bounded native MON setup/smoke. Default is read-only; --execute authorizes the named testnet steps. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { encodeFunctionData, getAddress, type Abi, type Address, type Hex } from 'viem';
import { EvmChain, AlchemySessionSender, opaqueId } from '../server/src/evm-chain.js';
import { decimal, units, fee, type Usage } from '../server/src/money.js';

const root=new URL('../',import.meta.url);
const path=new URL('contracts/deployments/inferpool-native-monad-smoke.json',root);
const json=(url:URL)=>JSON.parse(readFileSync(url,'utf8'));
const deployment=json(new URL('contracts/deployments/inferpool-mon-native-testnet.json',root));
const signer=getAddress('0xAc801eEC099C65A605B809b98A09A62674614A08');
assert.equal(deployment.chainId,10143);assert.equal(getAddress(deployment.router),signer);assert.equal(deployment.asset.symbol,'MON');
const market=getAddress(deployment.market);
const abi=json(new URL('contracts/out/InferenceMarket.sol/InferenceMarket.json',root)).abi as Abi;
const chain=new EvmChain({mode:'monad-testnet',rpcUrl:deployment.rpcUrl,marketAddress:market,routerAddress:signer,abi});
await chain.ready();
const client=chain.client;
const read=(functionName:string,args:readonly unknown[]=[])=>client.readContract({address:market,abi,functionName,args});
const encode=(v:unknown)=>JSON.stringify(v,(_k,x)=>typeof x==='bigint'?x.toString():x,2)+'\n';
const report:any=existsSync(path)?json(path):{network:'monad-testnet',chainId:10143,market,wallet:signer,asset:{symbol:'MON',decimals:18,native:true},scope:'One existing session wallet acts as Router, buyer and seller. Setup deposits 0.01 test MON, grants at most 0.005 MON for 24 hours, and withdraws 0.001 MON after two bounded contract scenarios. This is not independent-wallet or browser proof.',actions:{},scenarios:{}};
assert.equal(getAddress(report.market),market);assert.equal(getAddress(report.wallet),signer);
const save=()=>{report.updatedAt=new Date().toISOString();writeFileSync(path,encode(report));};
const execute=process.argv.includes('--execute');
const model='mock-reasoner';
const prices={input:units('0.3'),cacheRead:units('0.03'),cacheWrite:units('0.375'),output:units('0.8')};
const minReserve=units('0.000001');
const sender=new AlchemySessionSender(market,signer,abi);

async function evidence(hash:Hex,functionName:string,args:readonly unknown[],value=0n){
  const [receipt,transaction]=await Promise.all([client.waitForTransactionReceipt({hash,timeout:90000}),client.getTransaction({hash})]);
  assert.equal(receipt.status,'success');assert.equal(getAddress(receipt.from),signer);assert.equal(getAddress(receipt.to!),market);
  assert.equal(transaction.value,value);assert.equal(transaction.input,encodeFunctionData({abi,functionName,args}));
  return {transactionHash:hash,receiptStatus:receipt.status,blockNumber:receipt.blockNumber.toString(),from:receipt.from,to:receipt.to,valueWei:value.toString(),gasLimit:transaction.gas.toString(),gasUsed:receipt.gasUsed.toString(),effectiveGasPrice:receipt.effectiveGasPrice.toString(),gasCostWei:(transaction.gas*receipt.effectiveGasPrice).toString(),explorerUrl:`https://testnet.monadscan.com/tx/${hash}`};
}
async function action(name:string,functionName:string,args:readonly unknown[],value=0n){
  const prior=report.actions[name];
  if(prior?.transactionHash)return evidence(prior.transactionHash,functionName,args,value);
  if(prior?.startedAt)throw new Error(`${name} has an uncertain submission; reconcile its on-chain state before retrying`);
  assert.ok(execute,'Use --execute for the explicitly bounded native MON setup/smoke');
  await client.simulateContract({address:market,abi,functionName,args,account:signer,value});
  const estimate=await client.estimateContractGas({address:market,abi,functionName,args,account:signer,value});
  const gasPrice=await client.getGasPrice();
  if(await client.getBalance({address:signer})<value+(estimate+estimate/10n)*gasPrice)throw new Error('Insufficient native MON including estimated gas');
  report.actions[name]={startedAt:new Date().toISOString(),functionName,args,valueWei:value.toString(),gasEstimate:estimate.toString()};save();
  const hash=await sender.send(functionName,args,value);
  report.actions[name].transactionHash=hash;save();
  Object.assign(report.actions[name],await evidence(hash,functionName,args,value));save();
  console.log(JSON.stringify({action:name,transactionHash:hash,status:'confirmed'}));
  return report.actions[name];
}
async function snapshot(){return {account:await chain.getAccount(signer),nativeWalletMON:decimal(await client.getBalance({address:signer})),marketBalanceWei:(await client.getBalance({address:market})).toString(),totalEscrowedWei:(await read('totalEscrowed') as bigint).toString(),totalLockedWei:(await read('totalLocked') as bigint).toString(),quote:await chain.getQuote(signer,model)};}

if(!execute){console.log(encode({mode:'read-only',market,asset:'MON',...await snapshot()}));}
else{
  assert.equal(await read('totalLocked'),0n,'Finish existing native reservations before setup/smoke');
  const q=await chain.getQuote(signer,model);
  if(!q||units(q.input)!==prices.input||units(q.cacheRead)!==prices.cacheRead||units(q.cacheWrite)!==prices.cacheWrite||units(q.output)!==prices.output||units(q.minReserve)!==minReserve){
    if(report.actions.quote?.transactionHash)throw new Error('Quote changed after setup; do not silently overwrite it');
    await action('quote','upsertQuote',[opaqueId(model),prices,minReserve,true]);
  }
  if(!report.actions.deposit?.transactionHash){
    assert.equal(await read('balances',[signer]),0n,'Bounded initial deposit requires an empty native account');
    await action('deposit','deposit',[],units('0.01'));
  }
  let grantId=await read('activeGrantId',[signer]) as bigint;
  if(grantId===0n){
    report.grantExpiresAt??=Number((await client.getBlock()).timestamp)+86400;save();
    await action('grant','authorizeRouter',[units('0.005'),BigInt(report.grantExpiresAt)]);
    grantId=await read('activeGrantId',[signer]) as bigint;
  }
  const grant=await read('getGrant',[signer,grantId]) as any;
  assert.equal(grant.totalLimit,units('0.005'));assert.equal(grant.revoked,false);assert.ok(grant.expiresAt>(await client.getBlock()).timestamp);
  report.setupVerifiedAt=new Date().toISOString();report.setup=await snapshot();save();
  if(process.argv.includes('--smoke')){
    const quote=(await chain.getQuote(signer,model))!;
    const usage:Usage={input:100,cacheRead:0,cacheWrite:0,output:100};
    for(const scenario of [{name:'success',outcome:0},{name:'seller_failed',outcome:3}]){
      const id=`inferpool-native-mon-v2-${scenario.name}`;const requestId=opaqueId(id);
      const entry=report.scenarios[scenario.name]??={id,requestId,budget:'0.001',usage,outcome:scenario.outcome};
      let order=await read('getOrder',[requestId]) as any;
      if(Number(order.state)===0){
        entry.availableBefore=(await read('balances',[signer]) as bigint).toString();
        entry.deadline??=Number((await client.getBlock()).timestamp)+600;save();
        await action(`reserve_${scenario.name}`,'reserve',[requestId,signer,signer,opaqueId(model),units('0.001'),BigInt(entry.deadline),BigInt(quote.version!)]);
        order=await read('getOrder',[requestId]) as any;
        assert.equal(Number(order.state),1);assert.equal(order.reserved,units('0.001'));
        assert.equal(await read('balances',[signer]),BigInt(entry.availableBefore)-units('0.001'));
      }
      if(Number(order.state)===1){
        assert.ok(order.deadline>(await client.getBlock()).timestamp,'Expired reservation must be reclaimed, never replayed');
        const chainUsage=Object.fromEntries(Object.entries(usage).map(([k,v])=>[k,BigInt(v)]));
        await action(`settle_${scenario.name}`,'settle',[requestId,chainUsage,scenario.outcome]);
      }
      order=await read('getOrder',[requestId]) as any;
      assert.equal(Number(order.state),2);assert.equal(Number(order.outcome),scenario.outcome);
      const charged=scenario.outcome===3?0n:fee(quote,usage);assert.equal(order.charged,charged);assert.equal(order.reserved,units('0.001'));
      assert.equal(getAddress(order.buyer),signer);assert.equal(getAddress(order.provider),signer);
      assert.equal(await read('balances',[signer]),BigInt(entry.availableBefore));
      entry.verified={chargedMON:decimal(charged),releasedMON:decimal(units('0.001')-charged),state:'settled',order};save();
    }
    if(!report.actions.withdraw?.transactionHash){
      const before={wallet:await client.getBalance({address:signer}),market:await client.getBalance({address:market}),escrow:await read('balances',[signer]) as bigint,total:await read('totalEscrowed') as bigint};
      report.withdrawBefore=before;save();
      const proof=await action('withdraw','withdraw',[units('0.001')]);
      const after={wallet:await client.getBalance({address:signer}),market:await client.getBalance({address:market}),escrow:await read('balances',[signer]) as bigint,total:await read('totalEscrowed') as bigint};
      assert.equal(after.wallet+BigInt(proof.gasCostWei),before.wallet+units('0.001'));
      assert.equal(after.market,before.market-units('0.001'));assert.equal(after.escrow,before.escrow-units('0.001'));assert.equal(after.total,before.total-units('0.001'));
      report.withdrawVerified={amountMON:'0.001',before,after};save();
    }
    report.smokeVerifiedAt=new Date().toISOString();
  }
  report.final=await snapshot();assert.equal(report.final.totalLockedWei,'0');save();
  console.log(encode({setup:'verified',smoke:report.smokeVerifiedAt?'verified':'not-run',evidence:path.pathname,final:report.final}));
}
