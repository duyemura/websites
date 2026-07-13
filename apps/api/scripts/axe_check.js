const { chromium } = require('playwright');

const URL = process.argv[2] || 'https://13abc1ed-preview.mygymseo.com/';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(URL);
  await page.waitForLoadState('networkidle');
  await page.addScriptTag({ url: 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.9.1/axe.min.js' });
  await page.waitForFunction(() => typeof window.axe !== 'undefined');
  const results = await page.evaluate(() => {
    return new Promise((resolve) => {
      window.axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } }, (err, res) => {
        if (err) return resolve([]);
        resolve(res.violations);
      });
    });
  });
  console.log('URL:', URL);
  console.log('color-contrast violations:', results.length);
  for (const v of results) {
    console.log(v.id, v.impact, v.description);
    for (const node of v.nodes.slice(0, 5)) {
      console.log('  target:', node.target.join(' > '));
      console.log('  html:', node.html.slice(0, 200));
      console.log('  fg/bg:', node.any[0]?.data?.fgColor, '/', node.any[0]?.data?.bgColor);
    }
  }
  await browser.close();
})();
