import { createHash, randomBytes } from 'node:crypto';
import { isAddress, verifyMessage } from 'viem';
import { HttpError } from './engine.js';
import { Store, type StoredCredential } from './store.js';
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function challenge(domain: string, purpose: 'buyer'|'provider', wallet?: string) {
  const nonce=randomBytes(24).toString('hex'); const expiresAt=Date.now()+300000;
  const message=`InferPool ${purpose} authentication\nDomain: ${domain}\n${wallet?`Wallet: ${wallet.toLowerCase()}\n`:''}Nonce: ${nonce}\nExpires: ${expiresAt}\nThis signature authenticates this session only. It does not authorize token transfers.`;
  return {nonce,message,expiresAt};
}
export class Auth {
  private nonces=new Map<string,{wallet:string;message:string;expiresAt:number}>();
  constructor(readonly store:Store,readonly domain:string) {}
  createChallenge(wallet:string) {
    if(!isAddress(wallet)) throw new HttpError(400,'Invalid wallet address');
    for(const [key,value] of this.nonces) if(value.expiresAt<Date.now()) this.nonces.delete(key);
    if(this.nonces.size>=10000) throw new HttpError(429,'Too many authentication challenges');
    const c=challenge(this.domain,'buyer',wallet);this.nonces.set(digest(c.nonce),{wallet:wallet.toLowerCase(),message:c.message,expiresAt:c.expiresAt});return c;
  }
  async verify(wallet:string,nonce:string,signature:string) {
    const key=digest(nonce);const c=this.nonces.get(key);this.nonces.delete(key);
    if(!c||c.expiresAt<Date.now()||c.wallet!==wallet.toLowerCase()) throw new HttpError(401,'Invalid, expired or already used challenge');
    let valid=false;try{valid=await verifyMessage({address:wallet as `0x${string}`,message:c.message,signature:signature as `0x${string}`});}catch{}
    if(!valid)throw new HttpError(401,'Invalid wallet signature');
    return this.issue(c.wallet,'session','Wallet session',Date.now()+86400000);
  }
  issue(wallet:string,type:'session'|'api-key',name:string,expiresAt:number) {
    const token=`${type==='api-key'?'ipk':'ips'}_${randomBytes(32).toString('base64url')}`;const hash=digest(token);
    this.store.state.credentials[hash]={hash,wallet:wallet.toLowerCase(),type,name,preview:`${token.slice(0,8)}…${token.slice(-4)}`,createdAt:Date.now(),expiresAt,...(type==='api-key'&&this.store.state.market?{market_address:this.store.state.market.market_address}:{})};this.store.save();
    return {token,id:hash,wallet:wallet.toLowerCase(),expiresAt};
  }
  authenticate(header:string|undefined):StoredCredential {
    if(!header?.startsWith('Bearer '))throw new HttpError(401,'Bearer authentication required');
    const c=this.store.state.credentials[digest(header.slice(7))];
    if(!c||c.revokedAt||c.expiresAt<=Date.now())throw new HttpError(401,'Invalid or expired credential');return c;
  }
  requireSession(c:StoredCredential):void {if(c.type!=='session')throw new HttpError(403,'Wallet session required; API keys cannot manage permissions or credentials');}
  requireCurrentMarket(c:StoredCredential):void {if(c.type==='api-key'&&(!this.store.state.market||!c.market_address||c.market_address.toLowerCase()!==this.store.state.market.market_address.toLowerCase()))throw new HttpError(403,'API key does not belong to this MON market. Create a new key with the wallet session.');}
  list(wallet:string) {return Object.values(this.store.state.credentials).filter(c=>c.wallet===wallet&&c.type==='api-key').map(({hash,...rest})=>({...rest,id:hash}));}
  revoke(wallet:string,id:string) {const c=this.store.state.credentials[id];if(!c||c.wallet!==wallet||c.type!=='api-key')throw new HttpError(404,'API key not found');c.revokedAt=Date.now();this.store.save();}
}
