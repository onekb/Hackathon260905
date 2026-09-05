'use client';
import '@getpara/react-sdk-lite/styles.css';
import { Environment, ParaProviderMin as ParaProvider, useModal, useWallet } from '@getpara/react-sdk-lite';
import { useParaViemClient } from '@getpara/react-core/evm/viem';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPublicClient, formatEther, http, isAddress, zeroAddress, type Address, type Hex } from 'viem';
import { chainFor, rpcFor, marketAbi } from '@/lib/contracts';
import type { MarketConfig, WalletAccess } from '@/lib/types';
export default function ParaWallet({ config, children }: { config: MarketConfig; children: (wallet: WalletAccess) => ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const configOverrides = useMemo(() => ({
    rpcUrl: rpcFor(config.chain_id),
    authConfig: { oAuthMethods: [], disableEmailLogin: false, disablePhoneLogin: true },
    externalWalletConfig: { wallets: [] },
    themeConfig: { mode: 'dark' as const, accentColor: '#b6f86a' },
  }), [config.chain_id]);
  const paraClientConfig = useMemo(() => ({
    apiKey: process.env.NEXT_PUBLIC_PARA_API_KEY!,
    env: Environment.BETA,
    opts: { configOverrides },
  }), [configOverrides]);
  // Para 3.18 Min otherwise enables every external wallet before its client exists.
  // Keep this synchronous fallback as well as the constructor/reactive overrides.
  const externalWalletConfig = useMemo(() => ({ wallets: [] }), []);
  return <QueryClientProvider client={queryClient}>
    <ParaProvider
      paraClientConfig={paraClientConfig}
      waitForReady={false}
      externalWalletConfig={externalWalletConfig}
      configOverrides={configOverrides}
    ><WalletBridge config={config}>{children}</WalletBridge></ParaProvider>
  </QueryClientProvider>;
}
function WalletBridge({config,children}:{config:MarketConfig;children:(wallet:WalletAccess)=>ReactNode}) {
  const {data:wallet} = useWallet(); const {openModal} = useModal();
  const chain=chainFor(config.chain_id);
  // The core hook uses a Para-backed LocalAccount and does not load external wallet connectors.
  const {viemClient} = useParaViemClient({walletClientConfig:{chain,transport:http(rpcFor(config.chain_id))}});
  const inFlight=useRef(false);
  const address=wallet?.address && isAddress(wallet.address) ? wallet.address as Address : undefined;
  const identity=`${address}:${config.chain_id}:${config.market_address}`;
  const latestIdentity=useRef(identity);
  useEffect(()=>{latestIdentity.current=identity;},[identity]);
  const access=useMemo<WalletAccess>(()=>({
    address,connect:()=>openModal(),
    signMessage:async message=>{
      const signer=viemClient?.account;
      if(!viemClient||!address||signer?.type!=='local'||signer.address.toLowerCase()!==address.toLowerCase())throw new Error('请先通过邮箱登录并等待钱包就绪');
      return await viemClient.signMessage({account:signer,message}) as Hex;
    },
    sendContract:async(target,functionName,args=[],options={})=>{
      const signer=viemClient?.account;
      if(!viemClient||!address||signer?.type!=='local'||signer.address.toLowerCase()!==address.toLowerCase())throw new Error('请先通过邮箱登录并等待钱包就绪');
      if(inFlight.current)throw new Error('请等待上一笔钱包操作完成');
      inFlight.current=true;
      try{
        const publicClient=createPublicClient({chain,transport:http(rpcFor(config.chain_id))});
        if(await publicClient.getChainId()!==config.chain_id)throw new Error('RPC 网络与目标测试网不一致');
        if(viemClient.chain?.id!==config.chain_id||await viemClient.getChainId()!==config.chain_id)throw new Error('钱包正在切换目标网络，请稍后重试');
        // Preserve the actual Para signer; a plain address here would select an unlocked JSON-RPC account.
        if(target!=='market')throw new Error('仅支持当前原生 MON 市场。');
        const targetAddress=config.market_address;
        if(!isAddress(targetAddress)||targetAddress===zeroAddress)throw new Error('目标市场合约配置无效。');
        const value=options.value??0n;
        if(value<0n||(value>0n&&functionName!=='deposit')||(functionName==='deposit'&&(value===0n||args.length!==0)))throw new Error('原生 MON 只能通过无参数 deposit() 随交易存入。');
        const native=await publicClient.readContract({address:targetAddress,abi:marketAbi,functionName:'IS_NATIVE_ASSET'});
        if(native!==true)throw new Error('目标不是原生 MON 市场，已停止交易。');
        const request={account:signer,address:targetAddress,abi:marketAbi,functionName,args,value};
        const estimate=await publicClient.estimateContractGas(request);
        const gas=(estimate*110n+99n)/100n;
        const [fees,balance]=await Promise.all([publicClient.estimateFeesPerGas({type:'eip1559'}),publicClient.getBalance({address})]);
        const gasReserve=gas*fees.maxFeePerGas;
        if(balance<value+gasReserve)throw new Error(`钱包 MON 不足：本次转入 ${formatEther(value)} MON，另需至少预留 ${formatEther(gasReserve)} MON 的 Gas 上限。请减少存款或补充测试 MON。`);
        if(latestIdentity.current!==identity)throw new Error('钱包或市场已切换，请重新发起操作。');
        const hash=await viemClient.writeContract({...request,...fees,chain,gas});
        const receipt=await publicClient.waitForTransactionReceipt({hash});
        if(receipt.status!=='success')throw new Error('交易执行失败，请查看钱包中的交易详情');
        return hash;
      }finally{inFlight.current=false;}
    }
  }),[address,viemClient,openModal,chain,config,identity]);
  // The ref is private to sendContract's event callback; rendering only passes the wallet methods.
  // eslint-disable-next-line react-hooks/refs
  return children(access);
}
