import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import { Auth } from '../src/auth.js';
import { Store } from '../src/store.js';
// Public test-only fixture; never funded outside local tests.
const account=privateKeyToAccount('0x0000000000000000000000000000000000000000000000000000000000000001');
test('wallet challenges are domain-bound, one-use, and credentials persist only hashes',async()=>{
  const store=new Store();const auth=new Auth(store,'localhost:8787');const c=auth.createChallenge(account.address);
  assert.match(c.message,/localhost:8787/);const signature=await account.signMessage({message:c.message});
  const session=await auth.verify(account.address,c.nonce,signature);
  assert.equal(auth.authenticate(`Bearer ${session.token}`).type,'session');
  assert.ok(!JSON.stringify(store.state).includes(session.token));assert.ok(!JSON.stringify(store.state).includes(c.nonce));
  await assert.rejects(auth.verify(account.address,c.nonce,signature));
});
test('API keys cannot manage permissions and revocation blocks further access',()=>{
  const auth=new Auth(new Store(),'localhost');const key=auth.issue(account.address,'api-key','demo',Date.now()+10000);
  const c=auth.authenticate(`Bearer ${key.token}`);assert.throws(()=>auth.requireSession(c));
  auth.revoke(account.address.toLowerCase(),key.id);assert.throws(()=>auth.authenticate(`Bearer ${key.token}`));
});
