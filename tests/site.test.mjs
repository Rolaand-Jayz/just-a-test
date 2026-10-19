import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const js = readFileSync(new URL('../script.js', import.meta.url), 'utf8');

test('all local referenced website resources exist', () => {
  const resources = [...html.matchAll(/(?:href|src)="(\.\/[^"]+)"/g)].map(m => m[1].split('?')[0]);
  for (const resource of resources) {
    if(resource==='./staff') assert.ok(existsSync(new URL('../app/ui/index.html', import.meta.url)), 'portal route must have an HTML page');
    else assert.ok(existsSync(new URL('..' + resource.slice(1), import.meta.url)), resource + ' must exist');
  }
  assert.ok(resources.includes('./styles.css'));
  assert.ok(resources.includes('./script.js'));
  assert.ok(resources.includes('./favicon.svg'));
});

test('local hash links point to valid IDs', () => {
  const allIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const fragments = [...html.matchAll(/\bhref="#([^"]+)"/g)].map(m => m[1]);
  assert.ok(fragments.length >= 25);
  for (const fragment of fragments) assert.ok(allIds.has(fragment), '#' + fragment + ' must exist');
});

test('accessible images and buttons have labels or text', () => {
  const images = [...html.matchAll(/<img\b[^>]*>/g)].map(m => m[0]);
  assert.ok(images.length >= 4, 'at least four authentic company images');
  for (const img of images) {
    assert.match(img, /\balt="[^"]+"/, img);
    assert.match(img, /images\.squarespace-cdn\.com/, 'use genuine company imagery');
  }
  assert.match(html, /class="skip-link"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-controls="mobile-menu"/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /\[hidden\]\{display:none!important\}/);
});

test('real quote integration and contact information are preserved', () => {
  assert.match(html, /portal\.smartmoving\.com\/embedded\/\?companyId=fdb2a393-d42d-414e-9045-b456011ed124/);
  assert.match(html, /branchId=c8c3d508-60bc-44ca-828b-b456011ed219/);
  assert.match(html, /\+18066786972/);
  assert.match(html, /rescue1movers@gmail\.com/);
  assert.match(html, /<iframe[^>]*title=/);
  assert.ok(!/lorem ipsum|example\.com|YOUR_API_KEY|fake testimonial/i.test(html));
});

test('all opening new tabs use rel=noopener and noreferrer', () => {
  const external = [...html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)];
  assert.ok(external.length >= 2);
  for (const [link] of external) {
    assert.match(link, /rel="[^"]*noopener[^"]*"/);
    assert.match(link, /rel="[^"]*noreferrer[^"]*"/);
  }
});

test('SEO metadata and structured company data are valid', () => {
  assert.match(html, /<meta name="description"/);
  assert.match(html, /rel="canonical"/);
  assert.match(html, /property="og:image"/);
  const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]+?)<\/script>/);
  assert.ok(jsonLd, 'structured data script exists');
  const entity = JSON.parse(jsonLd[1]);
  assert.equal(entity['@type'], 'MovingCompany');
  assert.equal(entity.telephone, '+1-806-678-6972');
  assert.equal(entity.address.addressLocality, 'Amarillo');
  assert.ok(entity.areaServed.some(place => place.name === 'Canyon'));
});

test('planner is browser-local and offers useful interaction', () => {
  assert.match(js, /localStorage\.setItem/);
  assert.match(js, /new FormData\(form\)/);
  assert.match(js, /window\.print\(\)/);
  assert.match(js, /progressBar\.style\.width/);
  assert.match(html, /No account, no email, no nonsense/);
  assert.match(html, /id="planner-form"/);
  assert.match(html, /id="planner-output" hidden/);
});

test('mobile and reduced-motion layouts exist', () => {
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /@media\(max-width:390px\)/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css, /@media print/);
});
