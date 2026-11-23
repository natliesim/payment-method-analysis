// Wraps the built page (index.html, a body fragment) in a full HTML document for GitHub Pages: site/index.html.
import fs from 'node:fs';
const frag = fs.readFileSync('index.html', 'utf8');
const cut = frag.indexOf('<div class="page"');
if (cut < 0) throw new Error('Page body not found');
const head = frag.slice(0, cut).replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '');
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Payment methods across 42 markets in 2025, from Worldpay's Global Payments Report 2026, with World Bank Findex and IMF access data and a k-means grouping of markets.">
<style>body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
${head}</head>
<body>
${frag.slice(cut)}</body>
</html>
`;
fs.mkdirSync('site', { recursive: true });
fs.writeFileSync('site/index.html', html);
fs.writeFileSync('site/.nojekyll', '');
console.log('site/index.html', (html.length / 1024).toFixed(0) + ' KB');
