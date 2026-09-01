// 由 media/icon.svg 生成扩展用的 PNG（128 / 256）。
// 运行：node scripts/gen-icon.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'media', 'icon.svg'), 'utf8');

for (const size of [128, 256]) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
    font: { loadSystemFonts: true },
  });
  const png = resvg.render().asPng();
  const name = size === 128 ? 'icon.png' : `icon@${size}.png`;
  writeFileSync(join(root, 'media', name), png);
  console.log(`media/${name}  ${png.length} bytes`);
}
