import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// The board's model builder is plain browser JavaScript; load it the way the browser would and exercise it directly.
async function load() {
  const sandbox: any = {module: {exports: {}}, stamp: (ts: number) => 'at ' + ts, nodeUrl: (node: {id: string}) => '/nodes/' + node.id};
  vm.createContext(sandbox);
  vm.runInContext((await readFile('public/server-status.js', 'utf8')) + '\nthis.api = {buildServerStatus};', sandbox);
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
