import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../src/app.js';
import { Auth } from '../src/auth.js';
import { Engine } from '../src/engine.js';
import { MemoryChain } from '../src/chain.js';
import { Store } from '../src/store.js';
import type { TrustProxy } from '../src/runtime-config.js';

async function fixture(trustProxy?:TrustProxy) {
  const store=new Store();const engine=new Engine(new MemoryChain(),store);
  const server=createServer(createApp(engine,new Auth(store,'router.test'),{allowedOrigins:[],trustProxy}));
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();assert.ok(address&&typeof address!=='string');
  return {request:async(forwarded:string)=>{
    const response=await fetch(`http://127.0.0.1:${address.port}/auth/challenge`,{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':forwarded},body:JSON.stringify({wallet:'0x1111111111111111111111111111111111111111'})});
    await response.text();return response.status;
  },close:async()=>{engine.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}

test('untrusted forwarded addresses cannot bypass the default authentication limit',async()=>{
  const s=await fixture();try{
    for(let index=0;index<60;index++)assert.equal(await s.request(`198.51.100.${index+1}`),200);
    assert.equal(await s.request('203.0.113.10'),429);
  }finally{await s.close();}
});

test('explicit loopback proxy mode limits the resolved client IP and stops at the first untrusted hop',async()=>{
  const s=await fixture('loopback');try{
    for(let index=0;index<60;index++)assert.equal(await s.request('198.51.100.10'),200);
    assert.equal(await s.request('198.51.100.10'),429);
    assert.equal(await s.request('198.51.100.11'),200);
    assert.equal(await s.request('203.0.113.200, 198.51.100.10'),429);
  }finally{await s.close();}
});
