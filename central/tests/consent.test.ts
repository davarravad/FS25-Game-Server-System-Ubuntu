import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import worker from '../src/index';
import {buildClientConfig, inventory, OPTIONAL_CATEGORIES, USED_OPTIONAL} from '../src/consent-config';
import {loginPage} from '../src/login';

const ORIGIN = 'https://farmservers.sargentweb.com';
const env = {APP_ORIGIN: ORIGIN, DB: {prepare: () => ({bind: () => ({first: async () => null})})}} as never;

// consent.js is a classic browser script; run it in a bare context (no document) to reach the core.
async function loadCore() {
  const context: Record<string, unknown> = {};
  vm.runInNewContext(await readFile('public/consent.js', 'utf8'), context);
  return context.FarmConsentCore as any;
}

const cfg = {siteId: 'farmservers.sargentweb.com', schemaVersion: 1, noticeVersion: 'n1', purposeVersion: 'p1', decisionDays: 182, killSwitch: false, gpc: false};
const NOW = Date.parse('2026-10-12T12:00:00Z');
const good = (over: Record<string, unknown> = {}) => ({
  siteId: cfg.siteId, schemaVersion: 1, noticeVersion: 'n1', purposeVersion: 'p1',
  categories: {functional: false, analytics: true, marketing: false}, decision: 'custom',
  decidedAt: new Date(NOW - 1000).toISOString(), expiresAt: new Date(NOW + 100 * 86400000).toISOString(),
  receiptId: 'a'.repeat(32), ...over,
});

test('valid decisions are accepted and everything else leaves optional tracking off', async () => {
  const core = await loadCore();
  const state = core.validate(JSON.stringify(good()), cfg, NOW);
  assert.equal(state.categories.analytics, true);
  assert.equal(state.categories.marketing, false);
  const bad: Record<string, unknown> = {
    'missing': null, 'malformed json': '{nope', 'array': [], 'other site': good({siteId: 'other.example'}),
    'schema changed': good({schemaVersion: 2}), 'notice changed': good({noticeVersion: 'n2'}), 'purpose changed': good({purposeVersion: 'p2'}),
    'expired': good({expiresAt: new Date(NOW - 1).toISOString()}), 'future dated': good({decidedAt: new Date(NOW + 3600000).toISOString()}),
    'lifetime too long': good({expiresAt: new Date(NOW + 400 * 86400000).toISOString()}),
    'unknown category': good({categories: {analytics: true, necessary: true}}), 'non boolean category': good({categories: {analytics: 'yes'}}),
    'bad receipt': good({receiptId: 'short'}), 'bad decision': good({decision: 'maybe'}), 'bad timestamp': good({decidedAt: 'yesterday'}),
  };
  for (const [name, value] of Object.entries(bad)) assert.equal(core.validate(value, cfg, NOW), null, name);
});

test('mayStart needs category consent, honours GPC for sale/share flows and the kill switch', async () => {
  const core = await loadCore();
  const state = core.validate(good({categories: {functional: false, analytics: true, marketing: true}}), cfg, NOW);
  const analytics = {category: 'analytics'}, ads = {category: 'marketing', saleShareOrTargetedAds: true}, functional = {category: 'functional'};
  assert.equal(core.mayStart(analytics, state, cfg), true);
  assert.equal(core.mayStart(functional, state, cfg), false);
  assert.equal(core.mayStart(ads, state, cfg), true);
  assert.equal(core.mayStart(ads, state, {...cfg, gpc: true}), false, 'GPC beats an old marketing acceptance');
  assert.equal(core.mayStart(analytics, state, {...cfg, gpc: true}), true, 'GPC does not block non sale/share analytics');
  assert.equal(core.mayStart(analytics, state, {...cfg, killSwitch: true}), false);
  assert.equal(core.mayStart(analytics, null, cfg), false);
  assert.equal(core.mayStart({category: 'necessary'}, state, cfg), false, 'only the registry-listed optional categories can start');
});

test('registry starts once, never before a valid decision, and tears down on withdrawal', async () => {
  const core = await loadCore();
  let state: unknown = null, config: unknown = null, reloads = 0;
  const registry = core.createRegistry(() => state, () => config, () => { reloads++; });
  const calls: string[] = [];
  registry.register({id: 'stats', category: 'analytics', start: () => calls.push('start'), stop: () => calls.push('stop'), cleanup: () => calls.push('cleanup'), reloadOnWithdraw: true});
  assert.deepEqual(calls, [], 'registered before configuration/consent loads: nothing starts');
  config = cfg; registry.reconcile();
  assert.deepEqual(calls, [], 'configuration without a decision: still nothing');
  state = core.validate(good(), cfg, NOW);
  registry.reconcile(); registry.reconcile();
  assert.deepEqual(calls, ['start'], 'idempotent start');
  state = core.validate(good({categories: {analytics: false}, decision: 'reject_optional'}), cfg, NOW);
  registry.reconcile(); registry.reconcile();
  assert.deepEqual(calls, ['start', 'stop', 'cleanup']);
  assert.equal(reloads, 1);
  assert.deepEqual([...registry.running()], []);
  assert.throws(() => registry.register({id: 'stats', category: 'analytics', start() {}, stop() {}, cleanup() {}}), /already registered/);
  assert.throws(() => registry.register({id: 'x', category: 'necessary', start() {}, stop() {}, cleanup() {}}), /Invalid/);
  assert.throws(() => registry.register({id: 'y', category: 'analytics', start() {}}), /Invalid/);
});

test('a throwing integration does not stay marked as running', async () => {
  const core = await loadCore();
  const registry = core.createRegistry(() => core.validate(good(), cfg, NOW), () => cfg, () => {});
  registry.register({id: 'broken', category: 'analytics', start() { throw new Error('boom'); }, stop() {}, cleanup() {}});
  assert.deepEqual([...registry.running()], []);
});

test('policy pages, consent config and consent.js are public and need no sign-in', async () => {
  for (const path of ['/cookie-policy', '/privacy-policy', '/cookie-policy/']) {
    const response = await worker.fetch(new Request(ORIGIN + path), env, {} as never);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('Content-Type') || '', /text\/html/);
    assert.match(response.headers.get('Content-Security-Policy') || '', /script-src 'self'/);
    const html = await response.text();
    assert.match(html, /data-consent-open/);
    assert.match(html, /href="\/privacy-policy"/);
  }
  const config = await worker.fetch(new Request(ORIGIN + '/consent-config.json'), env, {} as never);
  assert.equal(config.headers.get('Cache-Control'), 'no-store');
  const body = await config.json() as any;
  assert.equal(body.siteId, 'farmservers.sargentweb.com');
  assert.equal(body.gpc, false);
  assert.deepEqual(body.categories.map((c: any) => c.id), ['necessary', ...USED_OPTIONAL]);
  const gpc = await worker.fetch(new Request(ORIGIN + '/consent-config.json', {headers: {'Sec-GPC': '1'}}), env, {} as never);
  assert.equal((await gpc.json() as any).gpc, true, 'server sees Sec-GPC');
});

test('the Cookie Policy lists every inventoried technology and escapes the contact', async () => {
  const withContact = {...(env as object), PRIVACY_CONTACT: '<b>x</b>@example.com'} as never;
  const html = await (await worker.fetch(new Request(ORIGIN + '/cookie-policy'), withContact, {} as never)).text();
  for (const entry of inventory) assert.ok(html.includes(entry.name.replace(/&/g, '&amp;')), entry.name);
  assert.ok(!html.includes('<b>x</b>'), 'contact is HTML escaped');
  const bare = await (await worker.fetch(new Request(ORIGIN + '/privacy-policy'), env, {} as never)).text();
  assert.match(bare, /has not been configured/);
  const mail = await (await worker.fetch(new Request(ORIGIN + '/privacy-policy'), {...(env as object), PRIVACY_CONTACT: 'privacy@example.com'} as never, {} as never)).text();
  assert.match(mail, /mailto:privacy@example\.com/);
});

test('inventory cookie names exist in the code that sets them, and the kill switch reaches the client', async () => {
  for (const entry of inventory.filter(e => e.kind === 'cookie' && /^[A-Za-z_-]+$/.test(e.name))) {
    const file = entry.source.replace(/ \(.*\)$/, '').replace(/^central\//, '');
    const path = file.startsWith('app/') ? '../' + file : file;
    assert.ok((await readFile(path, 'utf8')).includes(entry.name === 'PHPSESSID' ? 'session_start' : entry.name), `${entry.name} not found in ${file}`);
  }
  assert.equal(buildClientConfig({APP_ORIGIN: ORIGIN, CONSENT_KILL_SWITCH: '1'}, false).killSwitch, true);
  assert.equal(buildClientConfig({APP_ORIGIN: ORIGIN}, false).killSwitch, false);
});

test('nothing optional is deployed: pages load only same-origin resources and no browser storage', async () => {
  // Allowlist approach: every script, stylesheet, image or frame URL on the public/sign-in pages is same-origin.
  const pages = [await readFile('public/index.html', 'utf8'), await loginPage(false).text(), await (await worker.fetch(new Request(ORIGIN + '/cookie-policy'), env, {} as never)).text()];
  for (const html of pages) {
    for (const [, url] of html.matchAll(/\b(?:src|href|action)="([^"]+)"/g)) {
      if (/^(?:https?:)?\/\//i.test(url)) assert.match(url, /^https:\/\/farmservers\.sargentweb\.com\//, 'external resource: ' + url);
    }
    assert.ok(!/<iframe|<link[^>]+rel="(?:preconnect|prefetch|preload|dns-prefetch)"/i.test(html));
  }
  assert.equal(OPTIONAL_CATEGORIES.some(c => USED_OPTIONAL.includes(c)), USED_OPTIONAL.length > 0);
  assert.equal(USED_OPTIONAL.length, 0, 'adding an optional technology requires a consent integration, tests and a policy update');
  for (const file of ['app.js', 'account.js', 'live.js', 'login.js', 'management.js', 'consent.js']) {
    assert.doesNotMatch(await readFile('public/' + file, 'utf8'), /localStorage|sessionStorage|indexedDB|sendBeacon|serviceWorker/, file);
  }
});
