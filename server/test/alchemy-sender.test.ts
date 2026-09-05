import test from 'node:test';
import assert from 'node:assert/strict';
import type { Abi, Address, Hex } from 'viem';
import { AlchemySessionSender, alchemyReference, validateAlchemyCall, type AlchemyCliRunner } from '../src/evm-chain.js';
const market='0x1111111111111111111111111111111111111111' as Address;
const router='0x2222222222222222222222222222222222222222' as Address;
const hash=`0x${'a'.repeat(64)}` as Hex;
const abi=[{type:'function',name:'settle',stateMutability:'nonpayable',inputs:[],outputs:[]}] as Abi;
const confirmed={from:router,to:market,function:'settle',network:'monad-testnet',executionMode:'eoa-direct',sponsored:false,txHash:hash,callId:null,status:'success'};
const output=(value:unknown)=>({stdout:JSON.stringify(value)});

test('actual CLI direct EOA output is validated and serializes bigint tuple members',async()=>{
  let invoked:readonly string[]=[];
  const sender=new AlchemySessionSender(market,router,abi,{run:async args=>{invoked=args;return output(confirmed);}});
  assert.equal(await sender.send('settle',[hash,{input:10n,cacheRead:0n,cacheWrite:0n,output:5n},0]),hash);
  assert.equal(invoked[0],'--json');assert.equal(invoked[invoked.indexOf('--signer')+1],'session');
  assert.deepEqual(JSON.parse(invoked[invoked.indexOf('--args')+1]!),[hash,{input:'10',cacheRead:'0',cacheWrite:'0',output:'5'},0]);
  assert.ok(!invoked.some(arg=>arg.startsWith('--gas')));
});
test('unexpected from, network, mode or status cannot masquerade as a confirmed call',()=>{
  for(const change of [{from:market},{to:router},{network:'monad-mainnet'},{executionMode:'smart-wallet'},{status:'submitted'},{function:'withdraw'}])assert.throws(()=>validateAlchemyCall({...confirmed,...change},{market,router,functionName:'settle'}));
  assert.throws(()=>validateAlchemyCall({debug:{transactionHash:hash}},{market,router,functionName:'settle'}));
});
test('payable native deposits pass an exact human-readable MON value, not wei or a token approval',async()=>{
  let invoked:readonly string[]=[];
  const sender=new AlchemySessionSender(market,router,abi,{run:async args=>{invoked=args;return output({...confirmed,function:'deposit'});}});
  await sender.send('deposit',[],10_000_000_000_000_001n);
  assert.equal(invoked[invoked.indexOf('--value')+1],'0.010000000000000001');
  assert.equal(invoked[invoked.indexOf('--args')+1],'[]');
  await assert.rejects(sender.send('deposit',[],-1n),/negative/);
});
test('only documented operation-reference fields are interpreted as transaction IDs',()=>{
  assert.deepEqual(alchemyReference({txHash:hash,callId:null,status:'success'}),{txHash:hash,status:'success'});
  assert.deepEqual(alchemyReference({error:{data:{callId:'call-example',status:'pending'}}}),{callId:'call-example',status:'pending'});
  assert.deepEqual(alchemyReference({debug:{transactionHash:hash},callId:'bad\nid'}),{});
});
test('a CLI error with a submitted operation is polled and never resubmitted',async()=>{
  const calls:readonly string[][]=[];let count=0;
  const run:AlchemyCliRunner=async args=>{
    (calls as string[][]).push([...args]);
    if(args.includes('contract'))throw {stderr:JSON.stringify({error:{data:{callId:'call-example',status:'pending'}}})};
    return output({kind:'evm_operation',id:'call-example',network:'monad-testnet',status:++count===1?'pending':'confirmed',txHash:count===1?null:hash});
  };
  const sender=new AlchemySessionSender(market,router,abi,{run,wait:async()=>{},statusAttempts:3});
  assert.equal(await sender.send('settle',[hash]),hash);assert.equal(await sender.send('settle',[hash]),hash);
  assert.equal(calls.filter(args=>args.includes('contract')).length,1);assert.equal(calls.filter(args=>args.includes('status')).length,2);
});
test('unconfirmed operation survives timeout and a later call queries the same operation',async()=>{
  let sends=0;let mined=false;
  const sender=new AlchemySessionSender(market,router,abi,{statusAttempts:1,wait:async()=>{},run:async args=>{
    if(args.includes('contract')){sends++;throw {stdout:JSON.stringify({error:{data:{callId:'call-delayed'}}})};}
    return output({network:'monad-testnet',status:mined?'confirmed':'pending',txHash:mined?hash:null});
  }});
  await assert.rejects(sender.send('settle',[hash]),/still unconfirmed/);mined=true;
  assert.equal(await sender.send('settle',[hash]),hash);assert.equal(sends,1);
});
test('explicit reverts are not accepted and opaque child-process details remain private',async()=>{
  const failed=new AlchemySessionSender(market,router,abi,{run:async()=>{throw {stderr:JSON.stringify({error:{data:{txHash:hash,status:'reverted'}}})};}});
  await assert.rejects(failed.send('settle',[hash]),/reverted/);
  const opaque=new AlchemySessionSender(market,router,abi,{run:async()=>{throw new Error('SENSITIVE_SESSION_TOKEN');}});
  await assert.rejects(opaque.send('settle',[hash]),e=>e instanceof Error&&!e.message.includes('SENSITIVE')&&e.message.includes('uncertain'));
});
