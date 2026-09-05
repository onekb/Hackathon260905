import { foundry, monadTestnet } from 'viem/chains';
import token from './abi/DemoUSD.json';
import market from './abi/InferenceMarket.json';
import type { Abi } from 'viem';
import type { MarketConfig } from './types';
export const tokenAbi = token as Abi;
export const marketAbi = market as Abi;
export const chainFor = (id: number) => { if (id === 10143) return monadTestnet; if (id === 31337) return foundry; throw new Error('仅支持 Monad 测试网和本地 Anvil'); };
export const rpcFor = (id: number) => id === 31337 ? 'http://127.0.0.1:18545' : 'https://testnet-rpc.monad.xyz';
export const deployedConfig: MarketConfig = {
  chain_id: 10143, chain_mode: 'monad-testnet', mock_inference: true,
  token_address: '0x62701D69bD213e8F63c28465528931de208cE06E',
  market_address: '0x6F1b725DD3588cb5c8C3f72F614E80ebB2d82568',
};
