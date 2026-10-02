import { stdout } from 'node:process';
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'apps/web/dev-pages/extension-states');
const extensionAssets = resolve(root, 'apps/extension/public/assets');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const previewAssets = [
  'logo-panels/tracer-panel-center.png',
  'logo-panels/tracer-panel-left.png',
  'logo-panels/tracer-panel-right.png',
  'product-headphones.png',
  'purchase-receipt-detected.png',
  'tracer-empty-box.webp',
  'tracer-loading.webp',
  'tracer-outline.webp',
];
for (const asset of previewAssets) {
  const target = resolve(out, 'assets', asset);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(resolve(extensionAssets, asset), target);
}
const states = ['detecting', 'empty', 'incomplete', 'detected', 'review', 'protected', 'offline-saved', 'duplicate', 'items', 'items-paused', 'items-empty', 'detail', 'settings', 'clear-confirmation', 'watchlist', 'watchlist-saved', 'watchlist-duplicate', 'saved-items', 'saved-empty'];
const source = readFileSync(resolve(root, 'apps/extension/popup.html'), 'utf8');
const preview = `
<style>body{margin:0 auto;box-shadow:none}.preview-label{font:600 11px/1.2 system-ui;text-align:center;padding:9px;background:#fffdfa;color:#596777;letter-spacing:.02em}</style>
<script>
const state = new URLSearchParams(location.search).get('state') || 'detected';
document.title = 'Tracer · ' + state + ' preview';
const app = document.getElementById('app');
app.dataset.screen = state === 'items-empty' || state === 'items-paused' ? 'items' : state === 'clear-confirmation' ? 'settings' : state === 'offline-saved' ? 'protected' : state;
const set = (id,text) => {const el=document.getElementById(id);if(el)el.textContent=text;};
set('productName','Sony WH-1000XM5');set('summaryProductName','Sony WH-1000XM5');set('totalPaid','£349.99');set('summaryPaid','£349.99');set('retailer','John Lewis');set('windowValue','Known retailer eligibility');
set('detailName','Sony WH-1000XM5');
if(state==='incomplete'){set('stateTitle','A few details are missing.');set('stateCopy','Review the purchase details before protecting this item.');}
if(state==='offline-saved'){set('successTitle','Purchase saved');set('successCopy','Saved on this device. Monitoring will start automatically when it’s back online.');set('summaryStatus','Watching');}
if(state==='duplicate'){document.querySelectorAll('.success-hero h1').forEach(el=>el.textContent='Already protected.');}
if(state==='review'){document.getElementById('reviewPanel').dataset.visible='true';document.getElementById('reviewProductName').value='Sony WH-1000XM5';document.getElementById('reviewPrice').value='349.99';document.getElementById('reviewDate').value='2026-09-11T10:00';document.getElementById('reviewUrl').value='https://www.johnlewis.com/';}
if(state==='items'){set('itemsCount','1 item');document.getElementById('itemsList').innerHTML='<button class="item-row" data-alert="true" data-paused="false"><span><strong>Sony WH-1000XM5</strong><span>● Price dropped</span></span><em>£30</em><i>›</i></button>';}
if(state==='items-paused'){set('itemsCount','1 item');document.getElementById('itemsList').innerHTML='<button class="item-row" data-alert="false" data-paused="true"><span><strong>Sony WH-1000XM5</strong><span>● Paused</span></span><em></em><i>›</i></button>';}
if(state==='items-empty'){set('itemsCount','0 items');document.getElementById('itemsList').innerHTML='<div class="items-message"><strong>No protected purchases yet</strong><span>Protect a purchase after checkout to see it here.</span></div>';}
if(state==='detail'){
  const imageWrap=document.getElementById('detailImageWrap'), image=document.getElementById('detailImage');
  if(imageWrap&&image){imageWrap.hidden=false;image.src='/extension-states/assets/product-headphones.png';image.alt='Sony WH-1000XM5 product image';}
  const retailer=document.getElementById('detailRetailer');
  if(retailer){retailer.hidden=false;retailer.href='https://www.johnlewis.com';retailer.textContent='John Lewis · View store';}
  const retailerText=document.getElementById('detailRetailerText');if(retailerText)retailerText.hidden=true;
  document.getElementById('detailPaid').textContent='£349.99';
  document.getElementById('detailPaidDate').textContent='Ordered 22 Sep';
  document.getElementById('detailCurrentPrice').textContent='£319.99';
  document.getElementById('detailPriceNote').textContent='£30.00 less than you paid';
  document.getElementById('detailPriceCard').dataset.alert='true';
  document.getElementById('detailChartSummary').textContent='Last checked 22 Sep';
  document.getElementById('detailMonitoringInsight').textContent='Last checked 22 Sep';
  document.getElementById('detailMonitoringState').textContent='Automatic';
  document.getElementById('detailProductAction').href='https://www.johnlewis.com';
  document.getElementById('detailProductAction').hidden=false;
  document.getElementById('detailProductSummary').textContent='John Lewis';
  document.getElementById('detailAlertsSwitch').setAttribute('aria-checked','true');
  document.getElementById('detailAlertsSummary').textContent='On';
  const chart=document.getElementById('detailPriceChart');
  chart.innerHTML='<line class="chart-grid" x1="52" x2="310" y1="18" y2="18"/><line class="chart-grid" x1="52" x2="310" y1="60" y2="60"/><line class="chart-grid" x1="52" x2="310" y1="102" y2="102"/><text class="chart-axis-label" x="0" y="21">£360</text><text class="chart-axis-label" x="0" y="63">£340</text><text class="chart-axis-label" x="0" y="105">£320</text><path class="chart-area" d="M54 35 L110 42 L168 58 L222 79 L265 91 L307 96 L307 101 L54 101Z"/><path class="chart-line" d="M54 35 L110 42 L168 58 L222 79 L265 91 L307 96"/><circle class="chart-point chart-point--purchase" cx="54" cy="35" r="3.3"/><circle class="chart-point" cx="307" cy="96" r="2.8"/><text class="chart-axis-label" x="54" y="132">Mar</text><text class="chart-axis-label" x="180" y="132" text-anchor="middle">Jun</text><text class="chart-axis-label" x="307" y="132" text-anchor="end">Sep</text>';
}
if(state==='clear-confirmation'){document.getElementById('clearPurchasesPill').dataset.confirming='true';document.getElementById('clearConfirmation').hidden=false;}
const wireClearAction=(pillId,buttonId,confirmationId,cancelId,confirmId,messageId,onConfirm)=>{const pill=document.getElementById(pillId),button=document.getElementById(buttonId),confirmation=document.getElementById(confirmationId),cancel=document.getElementById(cancelId),confirm=document.getElementById(confirmId),message=document.getElementById(messageId);if(!pill||!button||!confirmation||!cancel||!confirm||!message)return;const hide=()=>{pill.dataset.confirming='false';button.setAttribute('aria-expanded','false');button.inert=false;confirmation.inert=true;confirm.disabled=false;cancel.disabled=false;button.disabled=false;message.dataset.error='false';};const show=()=>{message.textContent='This can’t be undone.';message.dataset.error='false';pill.dataset.confirming='true';button.setAttribute('aria-expanded','true');button.inert=true;confirmation.inert=false;confirm.focus();};button.addEventListener('click',show);cancel.addEventListener('click',hide);confirm.addEventListener('click',()=>{if(confirm.disabled)return;confirm.disabled=true;onConfirm();hide();});if(pill.dataset.confirming==='true'){confirmation.inert=false;button.inert=true;}};
wireClearAction('clearPurchasesPill','clearProtectedPurchases','clearConfirmation','cancelClearPurchases','confirmClearPurchases','clearConfirmationMessage',()=>{set('itemsCount','0 items');set('menuItemsCount','(0)');const list=document.getElementById('itemsList');if(list)list.innerHTML='<div class="items-message"><strong>No protected purchases</strong><span>Items you protect will appear here.</span></div>';});
wireClearAction('clearSavedPill','clearSavedItems','clearSavedConfirmation','cancelClearSaved','confirmClearSaved','clearSavedConfirmationMessage',()=>{set('itemsCount','0 items');const list=document.getElementById('itemsList');if(list)list.innerHTML='<div class="items-message"><strong>A place for your maybes.</strong><span>Open Tracer on a product page and choose Save to Tracer.</span></div>';});
if(state.startsWith('watchlist')) {
  app.dataset.screen='watchlist';
  document.getElementById('watchProduct').innerHTML='<img src="/extension-states/assets/product-headphones.png" alt=""><strong>Women’s Light beige/Gingham check Oversized flannel shirt | H&amp;M GB</strong><p>H&amp;M</p><p class="saved-price">£37.99 · price when saved</p>';
  if(state!=='watchlist') {
    set('watchHeading',state==='watchlist-duplicate'?'Already saved.':state==='watchlist'?'Save for later.':'Saved.');
    set('saveToTracer',state==='watchlist-duplicate'?'Already saved':'Saved');
    document.getElementById('saveToTracer').dataset.status=state==='watchlist-duplicate'?'existing':'saved';
    document.getElementById('saveToTracer').disabled=true;
    set('watchFeedback','Find it in Your items → Saved. Buy it, then protect your purchase with Tracer.');
    if(state==='watchlist-saved') {
      const burst=document.getElementById('watchlistConfetti');
      const pieces=[...document.getElementById('confetti').children].map(piece=>piece.cloneNode(true));
      burst.replaceChildren(...pieces);
      app.dataset.celebrate='true';
      setTimeout(()=>{app.dataset.celebrate='false';},1800);
    }
  }
}
if(state==='saved-items'||state==='saved-empty') {
  app.dataset.screen='items';
  document.getElementById('savedTab').setAttribute('aria-pressed','true');
  document.getElementById('protectedTab').setAttribute('aria-pressed','false');
  set('itemsCount',state==='saved-items'?'1 item':'0 items');
  document.getElementById('itemsList').innerHTML=state==='saved-empty'?'<div class="items-message"><strong>A place for your maybes.</strong><span>Open Tracer on a product page and choose Save to Tracer.</span></div>':'<article class="saved-row" data-has-image="true"><img src="/extension-states/assets/product-headphones.png" alt=""><div class="saved-copy"><strong>Sony WH-1000XM5</strong><p>johnlewis.com</p><p>£349.99 · price when saved</p></div><footer><a href="https://www.johnlewis.com" target="_blank" rel="noopener noreferrer" aria-label="Open item">Open item <span class="open-item-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M9 2h5v5M8 8l6-6M13 9v3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span></a><button type="button">Remove</button></footer></article>';
}
const label=document.createElement('div');label.className='preview-label';label.textContent='Design preview · '+state+' · sample data';document.body.prepend(label);
</script>`;
const previewSource = source
  .replaceAll('/assets/', '/extension-states/assets/')
  .replace('<script type="module" src="/src/popup.ts"></script>', preview);
writeFileSync(`${out}/popup.html`, previewSource);

const cards = states.map((state) => `
  <article class="state-card">
    <div class="state-heading">
      <h2>${state.replace('-', ' ')}</h2>
      <a href="/extension-states/popup.html?state=${state}" target="_blank">Open full size</a>
    </div>
    <div class="popup-frame"><iframe title="Tracer ${state} state" loading="lazy" src="/extension-states/popup.html?state=${state}"></iframe></div>
  </article>`).join('');

writeFileSync(`${out}/index.html`, `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Tracer extension · all states</title>
  <style>
    *{box-sizing:border-box}
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#141716;background:#faf8f3}
    body{margin:0;min-width:320px;background:#faf8f3}
    header{max-width:1540px;margin:0 auto;padding:54px 34px 34px;display:flex;align-items:end;justify-content:space-between;gap:24px}
    header img{display:block;width:122px;height:auto}
    h1{font:500 clamp(38px,5vw,72px)/.95 Georgia,serif;letter-spacing:-.045em;margin:28px 0 12px}
    header p{color:#34495c;margin:0;font-size:15px}
    .count{border:1px solid #ffffff80;background:#ffffff8f;border-radius:999px;padding:10px 15px;white-space:nowrap;box-shadow:0 8px 30px #264b7012}
    main{max-width:1540px;margin:0 auto;padding:0 34px 80px;display:grid;grid-template-columns:repeat(auto-fit,minmax(286px,1fr));gap:30px 22px;align-items:start}
    .state-card{min-width:0}
    .state-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 4px 11px}
    h2{font-size:13px;line-height:1;text-transform:capitalize;letter-spacing:.04em;margin:0}
    a{color:#283c4e;font-size:12px;text-decoration:none;border-bottom:1px solid #283c4e55}
    .popup-frame{position:relative;height:466px;border:1px solid #fff;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 18px 52px #264b7024;transform:translateZ(0)}
    iframe{width:380px;height:640px;border:0;transform:scale(.73);transform-origin:top left;background:#faf8f3}
    @media(min-width:1300px){main{grid-template-columns:repeat(4,1fr)}.popup-frame{height:453px}iframe{transform:scale(.71)}}
    @media(max-width:680px){header{align-items:start;flex-direction:column;padding:34px 18px 24px}main{padding:0 18px 60px;grid-template-columns:1fr}.popup-frame{height:566px}iframe{transform:scale(.89)}}
  </style>
</head>
<body>
  <header>
    <div><img src="/assets/landing-b/tracer-wordmark-outline-transparent.png" alt="Tracer" /><h1>Extension states</h1><p>Every popup state, using the refreshed Landing B visual language.</p></div>
    <div class="count">${states.length} states</div>
  </header>
  <main>${cards}</main>
</body>
</html>`);
stdout.write(`${out}\n`);
