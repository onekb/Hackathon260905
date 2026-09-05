import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('web/lib/abi', { recursive: true });
for (const name of ['DemoUSD', 'InferenceMarket']) {
  const artifact = JSON.parse(readFileSync(`contracts/out/${name}.sol/${name}.json`, 'utf8'));
  writeFileSync(`web/lib/abi/${name}.json`, JSON.stringify(artifact.abi, null, 2) + '\n');
}
console.log('Exported compiled business ABIs for the buyer UI');
