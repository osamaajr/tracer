import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(out, '../../..');
const dependencyRoot = process.env.TRACER_RENDER_DEPENDENCIES;
if (!dependencyRoot) throw new Error('Set TRACER_RENDER_DEPENDENCIES to the bundled Node package directory.');
const { chromium } = await import(pathToFileURL(resolve(dependencyRoot, 'playwright/index.mjs')).href);
const source = JSON.parse(await readFile(resolve(out, 'sources.json'), 'utf8'));
const data = async (path, mime) => `data:${mime};base64,${(await readFile(path)).toString('base64')}`;
const font = await data(resolve(root, 'apps/web/src/assets/landing-b/AnthropicSerif-Roman-Web.woff2'), 'font/woff2');
const logo = await data(resolve(root, 'apps/web/src/assets/landing-b/tracer-wordmark-outline-transparent.webp'), 'image/webp');
const designs = [
  { name: '01-morning-desk', headline: 'Shop now.<br>Decide later.', text: 'Save the things you like.<br>Come back when you’re ready.', size: 74, left:672, top:280, width:544, align:'left', logoLeft:672, logoTop:48, logoWidth:224, bodySize:27, gap:28 },
  { name: '02-worth-the-wait', headline: 'Worth the wait.', text: 'Get notified when Tracer finds a lower price.', size: 74, left:160, top:122, width:960, align:'center', logoLeft:64, logoTop:35, logoWidth:190, bodySize:25, gap:16 },
  { name: '03-found-it', headline: 'Found it?<br>Save it.', text: 'All your favourite products together.<br>Saved for later. Watched for price drops.', size: 82, left:325, top:238, width:630, align:'center', logoLeft:64, logoTop:48, logoWidth:224, bodySize:24, gap:22 },
  { name: '04-still-watching', headline: 'Bought it?<br>Still watching.', text: 'Protect your purchase.<br>Stay alert to later price drops.', size: 62, left:812, top:290, width:404, align:'left', logoLeft:812, logoTop:48, logoWidth:224, bodySize:26, gap:28 },
];
await mkdir(resolve(out, 'backgrounds'), { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const manifest = [];
try {
  for (let i = 0; i < designs.length; i++) {
    const design = designs[i];
    const localBackground = resolve(out, 'backgrounds', `${design.name}.png`);
    const sourceBackground = resolve(out, source[i].path);
    if (sourceBackground !== localBackground) await copyFile(sourceBackground, localBackground);
    const background = await data(localBackground, 'image/png');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      @font-face { font-family:'Tracer B Reference Serif'; src:url('${font}') format('woff2'); font-weight:300 800; font-style:normal; font-display:block; }
      * { box-sizing:border-box; } html,body { width:1280px; height:800px; margin:0; overflow:hidden; }
      body { color:#171613; background:#faf8f3; font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; font-synthesis:none; -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility; }
      .art { width:1280px; height:800px; position:relative; overflow:hidden; }
      .background { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
      .logo { position:absolute; left:${design.logoLeft}px; top:${design.logoTop}px; width:${design.logoWidth}px; height:auto; }
      .copy { position:absolute; left:${design.left}px; top:${design.top}px; width:${design.width}px; text-align:${design.align}; }
      h1 { font-family:'Tracer B Reference Serif',Charter,Georgia,serif; font-weight:400; font-kerning:normal; letter-spacing:-.02em; font-size:${design.size}px; line-height:1.04; margin:0; }
      p { font-family:'Tracer B Reference Serif',Charter,Georgia,serif; font-weight:400; font-kerning:normal; font-size:${design.bodySize}px; line-height:1.4; letter-spacing:-.02em; margin:${design.gap}px 0 0; color:#2e2b26; }
    </style></head><body><main class="art"><img class="background" src="${background}" alt=""><img class="logo" src="${logo}" alt="Tracer"><div class="copy"><h1>${design.headline}</h1><p>${design.text}</p></div></main></body></html>`;
    await writeFile(resolve(out, `${design.name}.html`), html);
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
    const metrics = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      const p = document.querySelector('.copy');
      const box = p.getBoundingClientRect();
      const typography = [...document.querySelectorAll('h1,p,.notification-label')].map(el => {
        const style = getComputedStyle(el);
        return { text:el.textContent, family:style.fontFamily, weight:style.fontWeight, kerning:style.fontKerning, synthesis:style.fontSynthesis };
      });
      const exactFont = typography.every(style => style.family.startsWith('"Tracer B Reference Serif"') && style.weight === '400' && style.kerning === 'normal' && style.synthesis === 'none');
      return { fontLoaded: document.fonts.check('76px "Tracer B Reference Serif"'), exactFont, typography, font: getComputedStyle(h1).fontFamily, right: box.right, bottom: box.bottom, textFits: p.scrollWidth <= p.clientWidth };
    });
    if (!metrics.fontLoaded || !metrics.exactFont || !metrics.textFits || metrics.bottom > 736 || metrics.right > 1216) throw new Error(`Layout failed: ${design.name} ${JSON.stringify(metrics)}`);
    await page.screenshot({ path: resolve(out, `${design.name}.png`), omitBackground:false });
    manifest.push({ name:design.name, width:1280, height:800, headline:design.headline.replaceAll('<br>', ' '), ...metrics });
    console.log(`${design.name}: 1280×800, source font loaded, layout fits`);
  }
  await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
} finally { await browser.close(); }
