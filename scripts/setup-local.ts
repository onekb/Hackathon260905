import { mkdirSync, writeFileSync } from 'node:fs';
import { deployFixture, rpcUrl } from '../tests/fixture.js';

const f = await deployFixture();
mkdirSync('.local', { recursive: true, mode: 0o700 });
const config = { chainMode: 'anvil', chainId: 31337, rpcUrl, token: f.token, market: f.market, router: f.router, buyer: f.buyer, sellerA: f.sellerA, sellerB: f.sellerB, model: f.model, mockInference: true };
writeFileSync('.local/deployment.json', JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
writeFileSync('.local/router.env', `CHAIN_MODE=anvil\nRPC_URL=${rpcUrl}\nMARKET_ADDRESS=${f.market}\nTOKEN_ADDRESS=${f.token}\nROUTER_ADDRESS=${f.router}\nROUTER_PUBLIC_URL=http://127.0.0.1:8787\nROUTER_STATE_PATH=.local/router-state.json\n`, { mode: 0o600 });
console.log(JSON.stringify({ message: 'Local Anvil contracts deployed. This is not a Monad deployment.', ...config }, null, 2));
