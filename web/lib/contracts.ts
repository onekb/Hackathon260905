import { foundry, monadTestnet } from 'viem/chains';
import market from './abi/InferenceMarket.json';
import type { Abi } from 'viem';
import type { MarketConfig } from './types';
export const marketAbi = market as Abi;
export const chainFor = (id: number) => { if (id === 10143) return monadTestnet; if (id === 31337) return foundry; throw new Error('仅支持 Monad 测试网和本地 Anvil'); };
export const rpcFor = (id: number) => id === 31337 ? 'http://127.0.0.1:18545' : 'https://testnet-rpc.monad.xyz';
export const deployedConfig: MarketConfig = {
  chain_id: 10143, chain_mode: 'monad-testnet', mock_inference: true,
  asset_symbol: 'MON', asset_decimals: 18,
  market_address: '0x142a4904307244Bed0cECD72dE8329A253333182',
};
