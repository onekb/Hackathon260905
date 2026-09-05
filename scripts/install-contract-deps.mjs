import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const dependencies = [
  { name: 'openzeppelin-contracts', version: '5.4.0', url: 'https://github.com/OpenZeppelin/openzeppelin-contracts/archive/refs/tags/v5.4.0.tar.gz', sha256: 'b89829be48bc501051002191733268a93ef6e238a4bb65d8fd1cbdf3969050d1' },
  { name: 'forge-std', version: '1.9.7', url: 'https://github.com/foundry-rs/forge-std/archive/refs/tags/v1.9.7.tar.gz', sha256: '45157353ab49eab01d294565866731e599b32401757229689ee459aa26b7ee94' },
];
for (const dep of dependencies) {
  const target = resolve('contracts/lib', dep.name);
  if (await stat(target).catch(() => null)) { console.log(`${dep.name}: existing dependency preserved`); continue; }
  const temporary = await mkdtemp(join(tmpdir(), 'inferpool-deps-'));
  try {
    const response = await fetch(dep.url);
    if (!response.ok) throw new Error(`Cannot download ${dep.name}: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== dep.sha256) throw new Error(`Archive checksum mismatch for ${dep.name}`);
    const archive = join(temporary, 'source.tar.gz');
    await writeFile(archive, bytes);
    await mkdir(target, { recursive: true });
    await execute('tar', ['-xzf', archive, '--strip-components=1', '-C', target]);
    console.log(`${dep.name}@${dep.version}: installed with verified archive checksum`);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
