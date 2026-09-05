import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { isAddress, verifyMessage } from 'viem';
import { z } from 'zod';
import { challenge } from './auth.js';
import { Engine, type Provider } from './engine.js';
import { units } from './money.js';
const amount=z.string().refine(v=>{try{units(v);return true;}catch{return false;}},'Invalid amount');
const authentication=z.object({type:z.literal('auth'),address:z.string().refine(isAddress),signature:z.string().max(1024),mock:z.literal(true),provider:z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),name:z.string().min(1).max(80).optional(),modelId:z.string().min(1).max(100),capacity:z.number().int().min(1).max(32),mode:z.enum(['normal','timeout','fail-before','fail-mid','cache-hit']).optional(),pricing:z.object({input:amount,cacheRead:amount,cacheWrite:amount,output:amount,minReserve:amount})})});
export function attachProviderHub(server:Server,engine:Engine,domain:string) {
  const wss=new WebSocketServer({server,path:'/provider',maxPayload:131072});
  wss.on('connection',(socket:WebSocket)=>{
    const c=challenge(domain,'provider');let pending=true;let provider:Provider|undefined;let lastHeartbeat=Date.now();
    const send=(message:unknown)=>{if(socket.readyState!==WebSocket.OPEN)throw new Error('Provider disconnected');socket.send(JSON.stringify(message));};
    send({type:'challenge',...c});
    const authTimeout=setTimeout(()=>{if(pending)socket.close(4001,'Authentication required');},15000);authTimeout.unref();
    const heartbeat=setInterval(()=>{if(Date.now()-lastHeartbeat>30000)socket.close(4002,'Heartbeat expired');},10000);heartbeat.unref();
    let chain=Promise.resolve();
    socket.on('message',data=>{chain=chain.then(async()=>{
      let event;try{event=JSON.parse(data.toString());}catch{socket.close(4003,'Invalid JSON');return;}
      if(!provider){
        if(!pending)return;pending=false;clearTimeout(authTimeout);
        const parsed=authentication.safeParse(event);
        if(!parsed.success||c.expiresAt<Date.now()){socket.close(4001,'Invalid authentication');return;}
        const auth=parsed.data;
        const valid=await verifyMessage({address:auth.address as `0x${string}`,message:c.message,signature:auth.signature as `0x${string}`});
        if(!valid){socket.close(4001,'Invalid signature');return;}
        const quote=await engine.chain.getQuote(auth.address,auth.provider.modelId);
        if(!quote){send({type:'rejected',message:'Publish an active model quote on the configured chain before connecting'});socket.close(4004,'No on-chain quote');return;}
        // On-chain values are authoritative; display and dispatch never depend on self-reported pricing.
        provider={id:auth.provider.id,wallet:auth.address.toLowerCase(),name:auth.provider.name??auth.provider.id,model:auth.provider.modelId,quote,capacity:auth.provider.capacity,busy:0,mode:auth.provider.mode??'normal',mock:true,send};
        await engine.addProvider(provider);
        if(socket.readyState!==WebSocket.OPEN){await engine.removeProvider(provider.id,provider);return;}
        send({type:'authenticated',providerId:provider.id,quote,mock:true});return;
      }
      if(event.type==='heartbeat'){
        lastHeartbeat=Date.now();
        if(['normal','timeout','fail-before','fail-mid','cache-hit'].includes(event.mode))provider.mode=event.mode;
        send({type:'heartbeat_ack',at:Date.now()});return;
      }
      if(typeof event.requestId==='string'&&event.requestId.length<=64&&['started','chunk','completed','failed','cancelled'].includes(event.type))await engine.providerEvent(provider,event);
    }).catch(error=>{try{send({type:'rejected',message:String(error.message??error).slice(0,300)});}catch{}socket.close(4003,'Protocol error');});});
    socket.on('close',()=>{clearTimeout(authTimeout);clearInterval(heartbeat);if(provider)void engine.removeProvider(provider.id,provider);});
    socket.on('error',()=>{});
  });
  return wss;
}
