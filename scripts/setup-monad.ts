import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getAddress, type Abi, type Address, type Hex } from 'viem';
import { AlchemySessionSender, EvmChain, opaqueId } from '../server/src/evm-chain.js';
import { decimal, units } from '../server/src/money.js';

const root=new URL('../',import.meta.url);
const encode=(value:unknown)=>JSON.stringify(value,(_k,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
export const setupPath=new URL('contracts/deployments/inferpool-setup-monad.json',root);
export const readJson=(url:URL)=>JSON.parse(readFileSync(url,'utf8'));
export const saveJson=(url:URL,value:unknown)=>writeFileSync(url,encode(value));
export const expectedSigner=getAddress('0xac801eec099c65a605b809b98a09a62674614a08');
export const model='mock-reasoner';
export const prices={input:units('30'),cacheRead:units('3'),cacheWrite:units('37.5'),output:units('80')};
export const minReserve=units('0.0001');
export async function monadContext() {
  const deployment=readJson(new URL('contracts/deployments/inferpool-monad-testnet.json',root));
  if(deployment.chainId!==10143||getAddress(deployment.router)!==expectedSigner)throw new Error('Deployment must be Monad testnet with the explicitly authorized session router');
  const market=getAddress(deployment.market);const token=getAddress(deployment.token);
  const marketAbi=readJson(new URL('contracts/out/InferenceMarket.sol/InferenceMarket.json',root)).abi as Abi;
  const tokenAbi=readJson(new URL('contracts/out/DemoUSD.sol/DemoUSD.json',root)).abi as Abi;
  const chain=new EvmChain({mode:'monad-testnet',rpcUrl:deployment.rpcUrl,marketAddress:market,routerAddress:expectedSigner,abi:marketAbi});
  await chain.ready();
  const client=chain.client;
  if(getAddress(await client.readContract({address:market,abi:marketAbi,functionName:'token'}) as Address)!==token)throw new Error('Market token differs from the verified deployment');
  if(!await client.readContract({address:token,abi:tokenAbi,functionName:'IS_DEMO_ASSET'}))throw new Error('Setup may operate only on the self-issued demonstration asset');
  return {deployment,market,token,marketAbi,tokenAbi,chain,client,signer:expectedSigner};
}
export type MonadContext=Awaited<ReturnType<typeof monadContext>>;
export async function receiptEvidence(ctx:MonadContext,hash:Hex) {
  const [receipt,transaction]=await Promise.all([ctx.client.waitForTransactionReceipt({hash,confirmations:1}),ctx.client.getTransaction({hash})]);
  if(receipt.status!=='success'||getAddress(receipt.from)!==ctx.signer)throw new Error(`Transaction did not succeed from the authorized session: ${hash}`);
  return {transactionHash:hash,blockNumber:receipt.blockNumber.toString(),receiptStatus:receipt.status,from:receipt.from,to:receipt.to,gasLimit:transaction.gas.toString(),gasUsed:receipt.gasUsed.toString(),effectiveGasPrice:receipt.effectiveGasPrice.toString(),monadGasLimitCostWei:(transaction.gas*receipt.effectiveGasPrice).toString(),explorerUrl:`https://testnet.monadscan.com/tx/${hash}`};
}
export async function sessionCall(ctx:MonadContext,address:Address,abi:Abi,functionName:string,args:readonly unknown[]) {
  await ctx.client.simulateContract({address,abi,functionName,args,account:ctx.signer});
  const estimate=await ctx.client.estimateContractGas({address,abi,functionName,args,account:ctx.signer});
  const sender=new AlchemySessionSender(address,ctx.signer,abi);
  const hash=await sender.send(functionName,args);
  const evidence={function:functionName,gasEstimate:estimate.toString(),gasLimitControl:'Alchemy CLI estimates the final gas limit; no unsupported override is supplied.',...await receiptEvidence(ctx,hash)};
  console.log(JSON.stringify({action:functionName,transactionHash:hash,status:'confirmed'}));
  return evidence;
}
export async function setupMonad() {
  const ctx=await monadContext();
  let journal:any;try{journal=readJson(setupPath);}catch{journal={network:'monad-testnet',chainId:10143,wallet:ctx.signer,token:ctx.token,market:ctx.market,scope:'Single existing session wallet; test assets only; no new private key generated',transactions:{}};}
  if(getAddress(journal.wallet)!==ctx.signer||getAddress(journal.token)!==ctx.token||getAddress(journal.market)!==ctx.market)throw new Error('Existing setup evidence refers to different deployed contracts');
  const checkpoint=()=>{journal.updatedAt=new Date().toISOString();saveJson(setupPath,journal);};
  const readToken=(functionName:string,args:readonly unknown[]=[])=>ctx.client.readContract({address:ctx.token,abi:ctx.tokenAbi,functionName,args});
  const readMarket=(functionName:string,args:readonly unknown[]=[])=>ctx.client.readContract({address:ctx.market,abi:ctx.marketAbi,functionName,args});
  const claimed=await readToken('hasClaimed',[ctx.signer]);
  if(!claimed){
    if(await readToken('FAUCET_AMOUNT')!==units('1000'))throw new Error('Unexpected faucet amount');
    journal.transactions.faucet=await sessionCall(ctx,ctx.token,ctx.tokenAbi,'faucet',[]);checkpoint();
  }
  const balance=await readMarket('balances',[ctx.signer]) as bigint;
  const target=units('10');
  if(balance<target){
    if(await readMarket('totalLocked') as bigint > 0n)throw new Error('Setup will not deposit while market orders are locked; wait for existing orders to settle');
    if(journal.transactions.deposit)throw new Error('The initial bounded deposit was already confirmed. Setup will not automatically replenish funds spent or withdrawn later.');
    const missing=target-balance;
    if(await readToken('balanceOf',[ctx.signer]) as bigint < missing)throw new Error('Insufficient dUSD for the bounded 10 dUSD deposit');
    const allowance=await readToken('allowance',[ctx.signer,ctx.market]) as bigint;
    if(allowance<missing){journal.transactions.approve=await sessionCall(ctx,ctx.token,ctx.tokenAbi,'approve',[ctx.market,missing]);checkpoint();}
    journal.transactions.deposit=await sessionCall(ctx,ctx.market,ctx.marketAbi,'deposit',[missing]);checkpoint();
  }
  const block=await ctx.client.getBlock();
  const grantId=await readMarket('activeGrantId',[ctx.signer]) as bigint;
  const grant=grantId>0n?await readMarket('getGrant',[ctx.signer,grantId]) as any:null;
  if(grant&&grant.totalLimit>target)throw new Error('Existing grant exceeds this setup script’s 10 dUSD scope; it will not silently replace it');
  if(!grant||grant.revoked||grant.expiresAt<=block.timestamp+600n){
    journal.transactions.authorizeRouter=await sessionCall(ctx,ctx.market,ctx.marketAbi,'authorizeRouter',[target,block.timestamp+86400n]);checkpoint();
  }
  const quote=await readMarket('getQuote',[ctx.signer,opaqueId(model)]) as any;
  if(!quote.active||quote.minReserve!==minReserve||(Object.keys(prices) as (keyof typeof prices)[]).some(key=>quote.prices[key]!==prices[key])){
    journal.transactions.upsertQuote=await sessionCall(ctx,ctx.market,ctx.marketAbi,'upsertQuote',[opaqueId(model),prices,minReserve,true]);checkpoint();
  }
  const finalId=await readMarket('activeGrantId',[ctx.signer]) as bigint;
  journal.readBack={walletTokenBalance:decimal(await readToken('balanceOf',[ctx.signer]) as bigint),escrowAvailable:decimal(await readMarket('balances',[ctx.signer]) as bigint),hasClaimed:await readToken('hasClaimed',[ctx.signer]),grantId:finalId.toString(),grant:await readMarket('getGrant',[ctx.signer,finalId]),quote:await ctx.chain.getQuote(ctx.signer,model),nativeBalanceWei:(await ctx.client.getBalance({address:ctx.signer})).toString()};
  checkpoint();
  const local=new URL('.local/',root);mkdirSync(local,{recursive:true,mode:0o700});
  const statePath=fileURLToPath(new URL('monad-router-state.json',local));
  writeFileSync(new URL('monad-router.env',local),`CHAIN_MODE=monad-testnet\nRPC_URL=${ctx.deployment.rpcUrl}\nMARKET_ADDRESS=${ctx.market}\nTOKEN_ADDRESS=${ctx.token}\nROUTER_ADDRESS=${ctx.signer}\nROUTER_PUBLIC_URL=http://127.0.0.1:8787\nROUTER_STATE_PATH=${statePath}\n`,{mode:0o600});
  console.log(JSON.stringify({setup:'complete',evidence:fileURLToPath(setupPath),account:await ctx.chain.getAccount(ctx.signer),quote:journal.readBack.quote}));
  return ctx;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)setupMonad().catch(error=>{console.error(error.message);process.exitCode=1;});
