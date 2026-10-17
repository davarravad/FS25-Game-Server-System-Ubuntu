import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// The board's model builder is plain browser JavaScript; load it the way the browser would and exercise it directly.
async function load() {
  const sandbox: any = {module: {exports: {}}, stamp: (ts: number) => 'at ' + ts, nodeUrl: (node: {id: string}) => '/nodes/' + node.id};
  vm.createContext(sandbox);
  for (const file of ['startup-progress.js', 'server-status.js']) vm.runInContext(await readFile('public/' + file, 'utf8'), sandbox);
  vm.runInContext('this.api = {buildServerStatus};', sandbox);
  // Results cross a vm realm boundary; a JSON round trip gives them this realm's arrays and objects.
  return ((...args: unknown[]) => JSON.parse(JSON.stringify(sandbox.api.buildServerStatus(...args)))) as (report: unknown, live: unknown, node: unknown, server: unknown) => any;
}
const node = {id: 'node-1', online: true, last_seen: 100};
const server = {instance_id: 'game-1', server_name: 'First'};
const recreate = {label: 'Recreate server container', api: 'nodes/apply-updates', body: {node: 'node-1', instance_id: 'game-1'}, confirm: 'Recreate?'};
const live = (state: string, extra: Record<string, unknown> = {}) => ({metrics: {runtime_state: {state, label: state, detail: ''}, cpu_percent: 10, memory_percent: 20, disk_percent: 30, memory_used_bytes: 1073741824, memory_limit_bytes: 4294967296, disk_used_bytes: 5368709120, containers: [{service: 'fs25', name: 'game-1-fs25', status: 'running', running: true, health: 'healthy'}], ...extra}});
const report = (serverChecks: unknown[], nodeChecks: unknown[] = []) => ({nodes: [{id: 'node-1', checks: nodeChecks, servers: [{instance_id: 'game-1', checks: serverChecks}]}]});

test('a healthy server reads as all systems operational with nothing to fix', async () => {
  const build = await load();
  const model = build(report([{name: 'Container', group: 'containers', state: 'pass', detail: 'Running.'}, {name: 'VNC console', group: 'domains', state: 'pass', detail: 'console-fs25-0001.sargentweb.com resolves.', host: 'console-fs25-0001.sargentweb.com'}], [{name: 'Gateway reachable', group: 'node', state: 'pass', detail: 'ok'}]), live('online'), node, server);
  assert.equal(model.state, 'ok');
  assert.equal(model.title, 'All systems operational');
  assert.equal(model.percent, 100);
  assert.deepEqual(model.fixes, []);
  assert.deepEqual(model.groups.map((g: any) => g.id), ['runtime', 'containers', 'domains', 'node']);
  assert.match(model.groups[1].checks[0].detail, /Running\. \(game-1-fs25 · running · health: healthy\)/, 'Live container details join the readiness finding');
});

test('problems sort first, the verdict follows the worst finding, and a shared repair is offered once', async () => {
  const build = await load();
  const model = build(report([
    {name: 'Container', group: 'containers', state: 'pass', detail: 'Running.'},
    {name: 'Management network', group: 'containers', state: 'fail', detail: 'Not attached.', repair: recreate},
    {name: 'Admin ports', group: 'ports', state: 'fail', detail: 'Published publicly.', repair: recreate},
    {name: 'Game admin', group: 'domains', state: 'warn', detail: 'Waiting for DNS.', host: 'game-fs25-0001.sargentweb.com', repair: {label: 'Re-check DNS', api: 'readiness/repair', body: {node: 'node-1', action: 'provision-hostname', instance: 'game-1', kind: 'web'}}}
  ]), live('degraded'), node, server);
  assert.equal(model.state, 'problem');
  assert.equal(model.title, '4 things need fixing');
  const containers = model.groups.find((g: any) => g.id === 'containers');
  assert.equal(containers.state, 'fail');
  assert.deepEqual(containers.checks.map((c: any) => c.name), ['Management network', 'Container'], 'Failures come before passes');
  assert.deepEqual(model.fixes.map((f: any) => f.label), ['Restart server', 'Recreate server container', 'Re-check DNS'], 'Identical repairs run once');
  assert.equal(model.groups.find((g: any) => g.id === 'domains').checks[0].host, 'game-fs25-0001.sargentweb.com');
});

test('a stopped server offers a start, and high resource use is flagged', async () => {
  const build = await load();
  const stopped = build(report([]), live('offline', {containers: []}), node, server);
  const runtime = stopped.groups[0].checks;
  assert.equal(runtime.length, 1, 'No resource line while the server is stopped');
  assert.deepEqual(runtime[0].repair, {label: 'Start server', api: 'action', body: {node: 'node-1', instance_id: 'game-1', action: 'start'}});
  const busy = build(report([]), live('online', {memory_percent: 91}), node, server);
  assert.equal(busy.groups[0].checks.find((c: any) => c.name === 'Resources').state, 'warn');
  assert.equal(busy.state, 'attention');
  assert.equal(busy.title, '1 thing needs attention');
  const hostNode = {...node, snapshot: {samples: [{scope: 'host', data: {cpu_percent: 21.4}}]}};
  const overall = build(report([]), live('online', {cpu_percent: 999}), hostNode, server).groups[0].checks.find((c: any) => c.name === 'Resources');
  assert.equal(overall.state, 'pass', 'A container CPU total across cores never raises a finding');
  assert.match(overall.detail, /^Host CPU 21% · RAM/);
  assert.doesNotMatch(overall.detail, /999/, 'The per-core total is not shown');
  assert.doesNotMatch(busy.groups[0].checks.find((c: any) => c.name === 'Resources').detail, /CPU/, 'No CPU figure until the host reports one');
});

test('before the first check finishes, only live information is shown; an offline node is a problem with a link to it', async () => {
  const build = await load();
  const early = build(null, live('online'), node, server);
  assert.equal(early.checked, false);
  assert.deepEqual(early.groups.map((g: any) => g.id), ['runtime', 'node']);
  const offline = build(null, null, {...node, online: false}, server);
  assert.equal(offline.state, 'problem');
  assert.equal(offline.groups.find((g: any) => g.id === 'node').checks[0].repair.href, '/nodes/node-1');
});

test('during first-time setup the board reports status only, with no repairs, until the server has come online once', async () => {
  const build = await load();
  const findings = report([{name: 'VNC console', group: 'domains', state: 'warn', detail: 'Hostname not created yet.', repair: {label: 'Provision hostname now', api: 'readiness/repair', body: {node: 'node-1'}}}]);
  const neverStarted = {...live('offline', {containers: []}), log_output: 'Console: Server created.'};
  const setup = build(findings, neverStarted, node, server);
  assert.equal(setup.setup, true);
  assert.equal(setup.state, 'setup');
  assert.equal(setup.title, 'Setting up this server');
  assert.deepEqual(setup.fixes, []);
  assert.ok(setup.groups.every((g: any) => g.checks.every((c: any) => !c.repair)), 'No repair buttons while setting up');
  assert.equal(setup.groups.find((g: any) => g.id === 'domains').checks[0].state, 'warn', 'The status itself is still shown');
  const building = build(findings, {...live('booting'), log_output: '[2026-10-17 09:59:00] Console: Server created.\n[2026-10-17 10:00:00] Console: Server marked as starting\n[2026-10-17 10:00:05] Building the game runtime image'}, node, server);
  assert.equal(building.setup, true, 'A first start still building is part of setup');
  const rotated = build(findings, {...live('offline', {containers: []}), log_output: '[2026-10-17 11:00:00] Console: Server marked as offline'}, node, server);
  assert.equal(rotated.setup, false, 'A log that no longer reaches back to creation is an old server, not a new one');
  const ran = build(findings, {...live('offline', {containers: []}), log_output: '[2026-10-17 10:00:00] Console: Server marked as running\n[2026-10-17 11:00:00] Console: Server marked as offline'}, node, server);
  assert.equal(ran.setup, false, 'A server that has run before gets its repairs back');
  assert.equal(ran.state, 'attention');
  assert.equal(ran.fixes.length, 2, 'Provision hostname and Start server');
});

test('a node that cannot inspect its containers is a note on the board, not a finding on every server', async () => {
  const build = await load();
  const inspection = {name: 'Server inspection', group: 'node', state: 'warn', detail: 'The node answered without a container report (HTTP 200). It sent text/html: "<!doctype html>".', repair: {label: 'Queue update', api: 'distribution/updates', body: {node: 'node-1'}}};
  const model = build(report([{name: 'VNC console', group: 'domains', state: 'pass', detail: 'ok'}], [inspection, {name: 'Gateway reachable', group: 'node', state: 'pass', detail: 'ok'}]), live('online'), node, server);
  assert.equal(model.state, 'ok', 'It does not turn the verdict to attention');
  assert.equal(model.title, 'All systems operational');
  assert.deepEqual(model.fixes, [], 'Nor does it offer an update as a fix');
  assert.equal(model.groups.flatMap((g: any) => g.checks).some((c: any) => c.name === 'Server inspection'), false);
  assert.deepEqual(model.notes, [inspection.detail]);
  assert.deepEqual(build(null, live('online'), node, server).notes, []);
});
