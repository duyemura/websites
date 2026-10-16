import { chromium } from 'playwright';
const targets = [
  ['https://torrance-training-lab-7da41b22.ploy.build/programs/drop-in', 'ours-dropin'],
  ['https://www.torrancetraininglab.com/programs/drop-in', 'source-dropin'],
];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
for (const [url, name] of targets) {
  try {
    await p.goto(url + (url.includes('?')?'':'?cb='+Date.now()), { waitUntil: 'networkidle', timeout: 60000 });
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `/tmp/cmp-${name}.png`, fullPage: true });
    console.log('shot', name);
  } catch(e){ console.log('ERR', name, e.message); }
}
await b.close();
