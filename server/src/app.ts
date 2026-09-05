import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Auth } from './auth.js';
import { Engine, HttpError, type Order } from './engine.js';
import { units } from './money.js';
import type { StoredCredential } from './store.js';
import type { TrustProxy } from './runtime-config.js';
import { staticWeb } from './static-web.js';
const requestSchema=z.object({model:z.string().min(1).max(100),messages:z.array(z.object({role:z.enum(['system','user','assistant']),content:z.string().max(32000)})).min(1).max(64),max_tokens:z.number().int().min(1).max(8192).default(256),max_spend:z.string().refine(v=>{try{return units(v)>0n;}catch{return false;}},'Expected a positive decimal amount with at most 6 decimal places'),provider_id:z.string().max(64).optional(),stream:z.boolean().default(false),cache:z.boolean().optional()}).strict();
const ready=(o:Order)=>!['locking','running'].includes(o.status)&&o.settlement!=='pending';
export function publicOrder(o:Order) {const {cacheKey,plannedUsage,lastSeq,...rest}=o;return {...rest,billConfirmed:o.settlement==='confirmed'};}
export function createApp(engine:Engine,auth:Auth,options:{allowedOrigins:string[];publicConfig?:Record<string,unknown>;trustProxy?:TrustProxy;webStaticDir?:string}) {
  const app=express();app.disable('x-powered-by');
  app.set('trust proxy',options.trustProxy==='loopback'?'loopback':false);
  app.use((req,res,next)=>{
    const origin=req.headers.origin;
    if(origin&&!options.allowedOrigins.includes(origin))return res.status(403).json({error:{message:'Origin is not allowed'}});
    if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
    res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, Idempotency-Key');res.setHeader('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');res.setHeader('Access-Control-Expose-Headers','X-Request-Id');
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    if(req.method==='OPTIONS')return res.sendStatus(204);next();
  });
  app.use(express.json({limit:'256kb'}));
  const asyncRoute=(fn:(req:Request,res:Response)=>Promise<any>)=>(req:Request,res:Response,next:NextFunction)=>{Promise.resolve(fn(req,res)).catch(next);};
  const identity=(req:Request)=>auth.authenticate(req.headers.authorization);
  const session=(req:Request)=>{const c=identity(req);auth.requireSession(c);return c;};
  const limited=new Map<string,{start:number;count:number}>();
  app.use('/auth',(req,res,next)=>{const key=req.ip??req.socket.remoteAddress??'unknown';const now=Date.now();for(const [ip,item] of limited)if(now-item.start>60000)limited.delete(ip);let item=limited.get(key);if(!item){if(limited.size>=10000)return res.status(429).json({error:{message:'Too many authentication clients'}});item={start:now,count:0};limited.set(key,item);}if(++item.count>60)return res.status(429).json({error:{message:'Too many authentication attempts'}});next();});
  app.get('/health',(_req,res)=>res.json({ok:true,chain_mode:engine.chain.mode,mock_inference:true,providers:engine.providers.size}));
  app.get('/config',(_req,res)=>res.json({chain_mode:engine.chain.mode,mock_inference:true,metering:'One Unicode code point equals one simulated token',...options.publicConfig}));
  app.post('/auth/challenge',(req,res,next)=>{try{res.json(auth.createChallenge(z.string().parse(req.body.wallet)));}catch(e){next(e);}});
  app.post('/auth/verify',asyncRoute(async(req,res)=>{const b=z.object({wallet:z.string(),nonce:z.string().max(128),signature:z.string().max(1024)}).parse(req.body);res.json(await auth.verify(b.wallet,b.nonce,b.signature));}));
  app.get('/account',asyncRoute(async(req,res)=>{const c=identity(req);res.json({wallet:c.wallet,credential_type:c.type,...await engine.chain.getAccount(c.wallet),chain_mode:engine.chain.mode});}));
  app.post('/api-keys',asyncRoute(async(req,res)=>{
    const c=session(req);const b=z.object({name:z.string().min(1).max(80).default('API key'),expires_in_days:z.number().int().min(1).max(30).default(7)}).parse(req.body??{});
    const account=await engine.chain.getAccount(c.wallet);
    if(units(account.authorized)===0n||account.authorizationExpiresAt<=Date.now()/1000)throw new HttpError(403,'Create an active on-chain spending grant before generating an API key');
    const issued=auth.issue(c.wallet,'api-key',b.name,Math.min(Date.now()+b.expires_in_days*86400000,account.authorizationExpiresAt*1000));
    res.status(201).json({...issued,warning:'Save this key now. The server stores only its hash. It cannot withdraw funds or create spending grants.'});
  }));
  app.get('/api-keys',(req,res,next)=>{try{const c=session(req);res.json({data:auth.list(c.wallet)});}catch(e){next(e);}});
  app.delete('/api-keys/:id',(req,res,next)=>{try{const c=session(req);auth.revoke(c.wallet,String(req.params.id));res.sendStatus(204);}catch(e){next(e);}});
  app.get('/v1/models',(_req,res)=>res.json({object:'list',data:engine.models(),mock:true}));
  app.get('/v1/requests',(req,res,next)=>{try{const c=identity(req);res.json({data:engine.list(c.wallet).map(publicOrder)});}catch(e){next(e);}});
  app.get('/v1/requests/:id',(req,res,next)=>{try{const c=identity(req);res.json(publicOrder(engine.get(String(req.params.id),c.wallet)));}catch(e){next(e);}});
  app.post('/v1/requests/:id/cancel',asyncRoute(async(req,res)=>{const c=identity(req);res.json(publicOrder(await engine.cancel(String(req.params.id),c.wallet)));}));
  app.post('/v1/chat/completions',asyncRoute(async(req,res)=>{
    const c:StoredCredential=identity(req);const input=requestSchema.parse(req.body);
    const idem=req.headers['idempotency-key'];if(idem&&(typeof idem!=='string'||idem.length>128||idem.length<1))throw new HttpError(400,'Invalid Idempotency-Key');
    const order=await engine.create(c.wallet,input,idem as string|undefined);res.setHeader('X-Request-Id',order.id);
    if(!input.stream){
      const done=await engine.waitForTerminal(order.id);
      return res.json({id:done.id,object:'chat.completion',created:Math.floor(done.createdAt/1000),model:done.model,choices:[{index:0,message:{role:'assistant',content:done.output},finish_reason:done.status==='completed'?'stop':done.status==='budget_capped'?'length':done.status}],usage:{prompt_tokens:done.usage.input+done.usage.cacheRead+done.usage.cacheWrite,completion_tokens:done.usage.output,total_tokens:Object.values(done.usage).reduce((a,b)=>a+b,0),...done.usage,mock:true},request:publicOrder(done)});
    }
    res.status(200);res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache, no-transform');res.setHeader('Connection','keep-alive');res.setHeader('X-Accel-Buffering','no');res.flushHeaders();
    const write=(payload:unknown,event?:string)=>{if(!res.writableEnded)res.write(`${event?`event: ${event}\n`:''}data: ${typeof payload==='string'?payload:JSON.stringify(payload)}\n\n`);};
    const delta=(text:string)=>write({id:order.id,object:'chat.completion.chunk',model:order.model,choices:[{index:0,delta:{content:text},finish_reason:null}]});
    let ended=false;
    const cleanup=()=>{engine.off('chunk',onChunk);engine.off('order',onOrder);clearInterval(keepAlive);};
    const end=(o:Order)=>{if(ended)return;ended=true;write({id:o.id,object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:o.status==='completed'?'stop':o.status==='budget_capped'?'length':o.status}]});write('[DONE]');cleanup();res.end();};
    const onChunk=(chunk:{id:string;text:string})=>{if(chunk.id===order.id)delta(chunk.text);};
    const onOrder=(o:Order)=>{if(o.id!==order.id)return;write(publicOrder(o),'request');if(ready(o))end(o);};
    const keepAlive=setInterval(()=>{if(!res.writableEnded)res.write(': keepalive\n\n');},15000);keepAlive.unref();
    engine.on('chunk',onChunk);engine.on('order',onOrder);res.on('close',cleanup);
    // A disconnected browser does not cancel the seller job or change who pays.
    write(publicOrder(order),'request');if(order.output)delta(order.output);if(ready(order))end(order);
  }));
  if(options.webStaticDir!==undefined)app.use(staticWeb(options.webStaticDir));
  app.use((error:any,_req:Request,res:Response,_next:NextFunction)=>{if(res.headersSent)return res.end();const status=error instanceof z.ZodError?400:error.status??500;res.status(status).json({error:{message:status===500?'Internal router error':error.message,details:error instanceof z.ZodError?error.issues:undefined}});if(status===500)console.error('Router error:',error.message);});
  return app;
}
