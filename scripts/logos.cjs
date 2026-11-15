// Cuts each brand logo out of the report PDF into assets/logos/<slug>.png.
// Usage: node scripts/logos.cjs <report.pdf>   (needs pdftocairo, playwright, python3 + Pillow)
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const brands = JSON.parse(fs.readFileSync('data/brands.json', 'utf8'));
const slug = s => s.toLowerCase().replace(/&/g, 'and').normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Logo tile grid on every market page, in PDF points.
const COLS = [[491, 562.6], [566, 637.4]], ROWS = [[53.8, 73.9], [77.8, 98.4]];
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-'));
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 900, height: 300 }, deviceScaleFactor: 5 });
  const done = new Set();
  for (const [pg, names] of Object.entries(brands.pages)) {
    if (names.every(n => done.has(n))) continue;
    const svgFile = path.join(tmp, pg + '.svg');
    execFileSync('pdftocairo', ['-svg', '-f', pg, '-l', pg, process.argv[2], svgFile]);
    // Drop the full-page photos, keep small raster logos.
    const svg = fs.readFileSync(svgFile, 'utf8').replace(/<image[\s\S]*?\/>/g, m => (+(m.match(/width="([\d.]+)"/) || [0, 0])[1] > 600 ? '' : m));
    await page.setContent('<body style="margin:0;background:#fff">' + svg);
    for (let i = 0; i < names.length; i++) {
      if (done.has(names[i])) continue;
      const [x0, x1] = COLS[i % 2], [y0, y1] = ROWS[Math.floor(i / 2)];
      await page.screenshot({ path: `assets/logos/${slug(names[i])}.png`, clip: { x: x0 + 1, y: y0, width: x1 - x0 - 2, height: y1 - y0 } });
      done.add(names[i]);
    }
    fs.unlinkSync(svgFile);
  }
  await b.close();
  // Trim the white margin and cap the size.
  execFileSync('python3', ['-c', `
import glob
from PIL import Image, ImageChops
for f in glob.glob('assets/logos/*.png'):
    im = Image.open(f).convert('RGB')
    box = ImageChops.difference(im, Image.new('RGB', im.size, 'white')).getbbox()
    if box: im = im.crop(box)
    im.thumbnail((170, 52), Image.LANCZOS)
    im.save(f, optimize=True)
`]);
  console.log(done.size, 'logos');
})();
