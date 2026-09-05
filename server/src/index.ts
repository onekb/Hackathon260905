import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { Auth } from './auth.js';
import { MemoryChain, type ChainAdapter } from './chain.js';
import { Engine } from './engine.js';
import { attachProviderHub } from './provider-hub.js';
import { Store } from './store.js';
import { parseDemoAdmission, parseTrustProxy } from './runtime-config.js';
import { resolveWebStaticDir } from './static-web.js';
async function main() {
  // Validate public-demo controls before wallet/RPC initialization or restart recovery can act.
  const admission=parseDemoAdmission(process.env);const trustProxy=parseTrustProxy(process.env.ROUTER_TRUST_PROXY);
  const webStaticDir=resolveWebStaticDir(process.env.WEB_STATIC_DIR);
  const mode=process.env.CHAIN_MODE??'anvil';let chain:ChainAdapter;
  if(mode==='memory') {
    if(process.env.ALLOW_MEMORY_CHAIN!=='true')throw new Error('Memory mode is test-only. Set ALLOW_MEMORY_CHAIN=true explicitly; it does not create blockchain transactions.');
    chain=new MemoryChain();
  } else {
    const {createEvmChainFromEnv}=await import('./evm-chain.js');chain=await createEvmChainFromEnv();
  }
  const port=Number(process.env.PORT??8787);const publicUrl=process.env.ROUTER_PUBLIC_URL??`http://localhost:${port}`;
  const domain=new URL(publicUrl).host;
  const store=new Store(resolve(process.env.ROUTER_STATE_PATH??'.local/router-state.json'));
  const engine=new Engine(chain,store,Number(process.env.REQUEST_TIMEOUT_MS??30000),admission);
  await engine.recover();
  const app=createApp(engine,new Auth(store,domain),{trustProxy,webStaticDir,allowedOrigins:(process.env.ALLOWED_ORIGINS??'http://localhost:5173,http://localhost:3000').split(',').map(s=>s.trim()).filter(Boolean),publicConfig:{...engine.marketIdentity,chain_id:chain.mode==='monad-testnet'?10143:31337}});
  const server=createServer(app);const wss=attachProviderHub(server,engine,domain);
  const retry=setInterval(()=>{void engine.retrySettlements();},15000);retry.unref();
  server.listen(port,process.env.HOST??'127.0.0.1',()=>console.log(`Router ${publicUrl}; chain=${chain.mode}; inference=MOCK Unicode tokens`));
  const close=()=>{clearInterval(retry);engine.close();wss.close();server.close();};process.once('SIGINT',close);process.once('SIGTERM',close);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
