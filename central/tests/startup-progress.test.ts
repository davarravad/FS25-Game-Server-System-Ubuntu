import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// The page parser is plain browser JavaScript; load it the way the browser would and exercise it directly.
async function load() {
  const sandbox: any = {module: {exports: {}}};
  vm.createContext(sandbox);
  vm.runInContext((await readFile('public/startup-progress.js', 'utf8')) + '\nthis.api = {parseStartup, startupSteps};', sandbox);
  return sandbox.api as {parseStartup: (log: string, runtime?: unknown) => any; startupSteps: string[][]};
}
const line = (message: string, time = '2026-10-16 21:00:00') => `[${time}] ${message}`;
const log = (...messages: string[]) => messages.map(message => line(message)).join('\n');

test('a server that was created but never started waits for its first start', async () => {
  const {parseStartup} = await load();
  const result = parseStartup(log('Console: Server created.'), {state: 'offline', containers: []});
  assert.equal(result.state, 'idle');
  assert.equal(result.firstTime, true);
  assert.equal(result.percent, 0);
  assert.equal(result.steps.length, 7);
});

test('each stage of a first start is reported as it happens', async () => {
  const {parseStartup} = await load();
  const starting = ['Console: Server created.', 'Console: Server marked as starting...'];
  const building = parseStartup(log(...starting, 'Console: Building the game runtime image. This only happens the first time on a node and can take several minutes.'), {state: 'offline', containers: []});
  assert.equal(building.state, 'running');assert.equal(building.firstTime, true);
  assert.equal(building.current, 1);
  assert.equal(building.steps[0].state, 'done');assert.equal(building.steps[1].state, 'active');assert.equal(building.steps[2].state, 'pending');
  assert.match(building.steps[1].detail, /several minutes/);

  const containers = parseStartup(log(...starting, 'Console: Game runtime image ready.', 'Console: Starting containers...'), {state: 'offline', containers: []});
  assert.equal(containers.current, 2);

  const booting = parseStartup(log(...starting, 'Console: Game runtime image ready.', 'Console: Starting containers...', 'Console: Containers started. Waiting for the game to boot...'), {state: 'booting', containers: [{running: true}]});
  assert.equal(booting.current, 3);assert.equal(booting.steps[3].state, 'active');

  const game = parseStartup(log(...starting, 'Console: Containers started. Waiting for the game to boot...', 'Verifying files...', 'Verification complete.', 'Starting server with version 1.24.0.0...'), {state: 'booting', containers: [{running: true}]});
  assert.equal(game.current, 4);

  const panel = parseStartup(log(...starting, 'Starting server with version 1.24.0.0...', 'Waiting for webserver to come up...', 'Checking if FS25 control panel is online - Attempt 3'), {state: 'online', containers: [{running: true}]});
  assert.equal(panel.state, 'running');assert.equal(panel.current, 5);
  assert.match(panel.steps[5].detail, /attempt 3/);
  assert.ok(panel.percent > 50 && panel.percent < 100);

  const online = parseStartup(log(...starting, 'Waiting for webserver to come up...', '[Webserver]: Now accessible using: http://10.0.0.2:8000', 'Console: Server marked as running...'), {state: 'online', containers: [{running: true}]});
  assert.equal(online.state, 'online');assert.equal(online.percent, 100);
  assert.ok(online.steps.every((step: {state: string}) => step.state === 'done'));
});

test('failures stop on the step that failed and say why', async () => {
  const {parseStartup} = await load();
  const failed = parseStartup(log('Console: Server marked as starting...', 'Console: Building the game runtime image. This only happens the first time on a node and can take several minutes.', 'Console: Runtime image build failed: no space left on device'), {state: 'offline', containers: []});
  assert.equal(failed.state, 'failed');
  assert.equal(failed.steps[1].state, 'error');
  assert.match(failed.steps[1].detail, /no space left on device/);
  assert.equal(parseStartup(log('Console: Server marked as starting...', 'Console: Runtime image build failed: boom'), {state: 'booting', containers: [{running: true}]}).steps[1].state, 'error');
  const missing = parseStartup(log('Console: Server marked as starting...', 'Console: Containers started. Waiting for the game to boot...', 'Console: Missing dedicatedServer.exe for port 10823 at /x'), {state: 'booting', containers: [{running: true}]});
  assert.equal(missing.state, 'failed');assert.equal(missing.steps[4].state, 'error');assert.equal(JSON.stringify(missing.steps.slice(0, 4).map((step: {state: string}) => step.state)), JSON.stringify(['done', 'done', 'done', 'done']));
});

test('stopped servers, restarts and rotated logs are handled', async () => {
  const {parseStartup} = await load();
  assert.equal(parseStartup(log('Console: Server marked as starting...', 'Console: Server marked as offline...'), {state: 'offline', containers: []}).state, 'stopped');
  // A restart of a server that has already run is not described as first-time setup.
  const restart = parseStartup(log('Console: Server marked as starting...', '[Webserver]: Now accessible using: http://x', 'Console: Server marked as running...', 'Console: Server marked as starting...', 'Console: Starting containers...'), {state: 'booting', containers: [{running: true}]});
  assert.equal(restart.state, 'running');assert.equal(restart.firstTime, false);
  // The log keeps only its recent lines: with no start marker the live state decides.
  assert.equal(parseStartup(log('some unrelated line'), {state: 'online', containers: [{running: true}]}).state, 'online');
  assert.equal(parseStartup('', {state: 'offline', containers: []}).state, 'idle');
});
