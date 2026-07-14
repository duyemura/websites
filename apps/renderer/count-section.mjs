import fs from 'fs';
import * as cheerio from 'cheerio';
const html = fs.readFileSync('/Users/dan/pushpress/websites/apps/renderer/dist/about/index.html', 'utf8');
const $ = cheerio.load(html);
$('script,style,noscript,iframe,[aria-hidden="true"]').remove();
const section = $('section').filter((_, el) => {
  const h = $(el).find('h1,h2,h3').first().text().trim();
  return h.toLowerCase().includes('our coaching team');
}).first();
const heading = section.find('h1,h2,h3').first().text().trim();
const fullText = section.text().replace(/\s+/g, ' ').trim();
const bodyText = fullText.replace(heading, '').trim();
const count = bodyText.split(/\s+/).filter(Boolean).length;
console.log('heading:', heading);
console.log('bodyText:', bodyText.slice(0, 200));
console.log('count:', count);
