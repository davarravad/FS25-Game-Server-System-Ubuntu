import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// The overview's model builder is plain browser JavaScript; load it the way the browser would and exercise it directly.
async function load() {
  const sandbox: any = {
    module: {exports: {}},
    stamp: (ts: number) => 'at ' + ts,
    bytes: (n: number) => n + ' B',
    nodeUrl: (node: {id: string}) => '/nodes/' + node.id,
    serverUrl: (node: {id: string}, server: {instance_id: string}) => '/servers/' + node.id + '/' + server.instance_id,
    nodeStatus: (node: any) => !node.enabled ? 'Disabled' : node.online ? 'Online' : 'Offline',
    serverStatus: (node: any, server: any) => !node.enabled ? 'Node disabled' : !node.online ? 'Host offline' : server.status
  };
  vm.createContext(sandbox);
  for (const file of ['startup-progress.js', 'overview.js']) vm.runInContext(await readFile('public/' + file, 'utf8'), sandbox);
  vm.runInContext('this.api = {overviewModel};', sandbox);
  // Results cross a vm realm boundary; a JSON round trip gives them this realm's arrays and objects.
  return ((...args: unknown[]) => JSON.parse(JSON.stringify(sandbox.api.overviewModel(...args)))) as (nodes: unknown, extras?: unknown, now?: number) => any;
}
const NOW = 1_000_000;
const host = (memory = 0.3, disk = 0.3) => ({scope: 'host', data: {cpu_percent: 12, memory_used_bytes: memory * 100, memory_limit_bytes: 100, disk_used_bytes: disk * 100, disk_limit_bytes: 100}});
const server = (id: string, status: string, extra: Record<string, unknown> = {}) => ({instance_id: id, server_name: 'Server ' + id, status, ...extra});
const node = (id: string, servers: unknown[], extra: Record<string, unknown> = {}) => ({id, name: 'Node ' + id, enabled: 1, online: true, last_seen: NOW, snapshot: {samples: [host()], servers}, ...extra});

test('a healthy fleet reads as running smoothly, with players and counts', async () => {
  const build = await load();
  const model = build([node('a', [server('s1', 'Online', {player_count: 3, player_capacity: 16, game_sampled_at: NOW - 10}), server('s2', 'Online', {player_count: 1, player_capacity: 16, game_sampled_at: NOW - 400})])], {}, NOW);
  assert.equal(model.state, 'ok');
  assert.equal(model.title, 'Everything is running smoothly');
  assert.deepEqual(model.issues, []);
  assert.equal(model.tiles[0].value, '3 / 16', 'Only fresh player counts are added up');
  assert.equal(model.tiles[1].value, '2 / 2');
  assert.equal(model.percent, 100);
});

test('offline nodes, failing servers and full disks are issues, worst first, and problems sort to the top of the server list', async () => {
  const build = await load();
  const model = build([
    node('a', [server('good', 'Online'), server('sick', 'Degraded'), server('stopped', 'Offline')], {snapshot: {samples: [host(0.9, 0.97)], servers: [server('good', 'Online'), server('sick', 'Degraded'), server('stopped', 'Offline')]}}),
    node('b', [server('far', 'Online')], {online: false, last_seen: NOW - 7200})
  ], {}, NOW);
  assert.equal(model.state, 'problem');
  assert.deepEqual(model.issues.map((i: any) => [i.state, i.title]), [['bad', 'Node a: Disk 97% full'], ['bad', 'Server sick: Degraded'], ['bad', 'Node b is offline'], ['warn', 'Node a: RAM 90% full']]);
  assert.equal(model.issues.filter((i: any) => i.state === 'bad').length, 3);
  assert.equal(model.title, '4 issues need attention');
  assert.deepEqual(model.servers.map((s: any) => s.name), ['Server sick', 'Server far', 'Server good', 'Server stopped'], 'Problems first, then the rest by name');
  assert.equal(model.servers.find((s: any) => s.name === 'Server stopped').state, 'quiet', 'A stopped server is quiet, not an issue');
  assert.equal(model.servers.find((s: any) => s.name === 'Server far').label, 'Host offline');
});

test('administrators see a server in first-time setup with its progress, and a failed setup becomes an issue', async () => {
  const build = await load();
  const nodes = [node('a', [server('new', 'Offline'), server('broken', 'Offline')])];
  const progress = new Map<string, unknown>([
    ['a/new', {setup: true, parsed: {state: 'running', firstTime: true, percent: 43, current: 2, detail: '', steps: [{label: 'Start requested'}, {label: 'Preparing the game software'}, {label: 'Starting containers'}, {label: 'Preparing server files'}, {label: 'Starting the game server'}, {label: 'Waiting for the game panel'}, {label: 'Online'}]}}],
    ['a/broken', {setup: true, parsed: {state: 'failed', firstTime: true, percent: 14, current: 1, detail: 'Runtime image build failed', steps: [{label: 'Start requested'}, {label: 'Preparing the game software'}]}}]
  ]);
  const model = build(nodes, {progress}, NOW);
  assert.equal(model.setup.length, 2);
  const active = model.setup.find((s: any) => s.title === 'Server new');
  assert.equal(active.state, 'active');
  assert.equal(active.percent, 43);
  assert.match(active.detail, /^First-time setup: Starting containers \(step 3 of 7\)$/);
  assert.equal(model.setup.find((s: any) => s.title === 'Server broken').state, 'failed');
  assert.ok(model.issues.some((i: any) => i.title === 'Server broken: setup needs attention'));
  assert.equal(model.servers.find((s: any) => s.name === 'Server new').label, 'Setting up');
  assert.equal(model.servers.find((s: any) => s.name === 'Server new').state, 'setup');
  const onlySetup = build(nodes.map(n => ({...n, snapshot: {...n.snapshot, servers: [server('new', 'Offline')]}})), {progress: new Map([['a/new', progress.get('a/new')]])}, NOW);
  assert.equal(onlySetup.state, 'setup');
  assert.equal(onlySetup.title, '1 item being set up');
});

test('game files that are missing, syncing or failed are reported from the game status', async () => {
  const build = await load();
  const nodes = [node('a', []), node('b', []), node('c', []), node('d', [])];
  const game = {
    nodes: [{id: 'a', status: 'ready'}, {id: 'b', status: 'empty'}, {id: 'c', status: 'empty'}, {id: 'd', status: 'ready'}],
    jobs: [{node_id: 'c', kind: 'sync', status: 'running', done_bytes: 50, total_bytes: 200, detail: 'Copying'}, {node_id: 'd', kind: 'sync', status: 'failed', detail: 'Checksum mismatch'}],
    wanted: []
  };
  const model = build(nodes, {game}, NOW);
  assert.deepEqual(model.issues.map((i: any) => i.title).sort(), ['Node b needs game files', 'Node d: game file sync failed']);
  assert.equal(model.setup.length, 1);
  assert.equal(model.setup[0].percent, 25);
  assert.match(model.setup[0].detail, /Syncing · Copying/);
});

test('unread updates and requests are listed, but not what the overview already shows live', async () => {
  const build = await load();
  const notices = [
    {id: 'release:v1.0.2', title: 'Release available', detail: 'd', href: '/setup', read: false},
    {id: 'offline:a:1', title: 'Node a is offline', detail: 'd', href: '/nodes/a', read: false},
    {id: 'access:1:2', title: 'Someone requested access', detail: 'd', href: '/users', read: true}
  ];
  const model = build([node('a', [])], {notices}, NOW);
  assert.deepEqual(model.headsUp.map((n: any) => n.title), ['Release available']);
  const empty = build([], {}, NOW);
  assert.equal(empty.state, 'idle');
  assert.equal(empty.title, 'No nodes yet');
});
