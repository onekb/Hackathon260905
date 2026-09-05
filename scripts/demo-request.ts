import { readFileSync } from 'node:fs';
const { apiKey } = JSON.parse(readFileSync('.local/demo-credentials.json', 'utf8'));
const response = await fetch('http://127.0.0.1:8787/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ model: 'mock-reasoner', messages: [{ role: 'user', content: '演示按用量计费与剩余预算释放' }], max_spend: '0.1', max_tokens: 1000, provider_id: 'seller-1', stream: true, cache: process.argv.includes('--cache') }),
});
if (!response.ok || !response.body) throw new Error(`Request failed (${response.status}): ${await response.text()}`);
for await (const chunk of response.body as any) process.stdout.write(Buffer.from(chunk));
