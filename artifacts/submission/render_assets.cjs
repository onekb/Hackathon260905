// Render our SVG files without opening or automating a browser.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require(process.env.INFERPOOL_SHARP_MODULE || 'sharp');
const directory = __dirname;
(async () => {
  for (const [name, width, height] of [['inferpool-logo', 512, 512], ['inferpool-project-overview', 1600, 900]]) {
    const input = path.join(directory, `${name}.svg`);
    const output = path.join(directory, `${name}.png`);
    await sharp(fs.readFileSync(input)).resize(width, height).png().toFile(output);
    const metadata = await sharp(output).metadata();
    if (metadata.width !== width || metadata.height !== height) throw new Error(`Wrong size for ${name}`);
    console.log(`${name}.png: ${metadata.width} × ${metadata.height}, alpha=${metadata.hasAlpha}`);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
