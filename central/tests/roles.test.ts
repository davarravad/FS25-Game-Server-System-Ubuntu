import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {digest} from '../src/security';
import {can, canSee, cleanPermissions, cleanServers, effectiveRole, legacyAccess, makeAccess, parseRole, publicAccess, roleId} from '../src/access';

const role = (over: Partial<Parameters<typeof makeAccess>[0][number]> = {}) => ({id: 'r', name: 'R', color: '#ffffff', position: 1, is_admin: false, permissions: [], all_servers: false, servers: [], created: 0, ...over}) as Parameters<typeof makeAccess>[0][number];

test('access unions roles and limits every permission to the servers a role covers', () => {
  const team = makeAccess([role({permissions: ['servers.view', 'servers.control'], servers: ['node-1/game-1']}), role({id: 's', permissions: ['servers.view', 'servers.backend'], servers: ['node-1/game-2']})]);
  assert.equal(can(team, 'servers.control', 'node-1', 'game-1'), true);
  assert.equal(can(team, 'servers.control', 'node-1', 'game-2'), false);
  assert.equal(can(team, 'servers.backend', 'node-1', 'game-2'), true);
  assert.equal(can(team, 'servers.backend', 'node-1', 'game-1'), false);
  assert.equal(canSee(team, 'node-1', 'game-3'), false);
  assert.equal(effectiveRole(team), 'operator');
  assert.equal(effectiveRole(makeAccess([])), 'pending');
  assert.equal(effectiveRole(makeAccess([role({permissions: []})])), 'pending');
  assert.equal(effectiveRole(makeAccess([role({is_admin: true})])), 'admin');
  assert.equal(can(makeAccess([role({is_admin: true})]), 'servers.console', 'any', 'thing'), true);
  assert.equal(can(makeAccess([role({permissions: ['servers.view'], all_servers: true})]), 'servers.control', 'node-1', 'game-1'), false);
  assert.deepEqual(publicAccess(team).servers, ['node-1/game-1', 'node-1/game-2']);
  assert.equal(effectiveRole(legacyAccess('operator')), 'operator');
  assert.equal(effectiveRole(legacyAccess('admin')), 'admin');
  assert.equal(effectiveRole(legacyAccess('pending')), 'pending');
});

test('role input is validated and always keeps View with any other permission', () => {
  assert.deepEqual(cleanPermissions(['servers.control']), ['servers.view', 'servers.control']);
  assert.deepEqual(cleanPermissions([]), []);
  assert.equal(cleanPermissions(['servers.control', 'nope']), null);
  assert.equal(cleanPermissions('servers.view'), null);
  assert.deepEqual(cleanServers(['node-1/game-2', 'node-1/game-1', 'node-1/game-1']), ['node-1/game-1', 'node-1/game-2']);
  assert.equal(cleanServers(['../etc/passwd']), null);
  assert.equal(roleId('Game Server Team!'), 'game-server-team');
  assert.deepEqual(parseRole({id: 'x', name: 'X', color: '#000000', position: 0, is_admin: 0, permissions: 'not json', all_servers: 0, servers: '[1,"a/b"]', created: 0}).servers, ['a/b']);
});

test('roles: new members see only a request, team members are limited to their servers and cannot reach admin features', async () => {
  const origin = 'https://farmservers.sargentweb.com', owner = '513527870258151439', team = '111111111111111111', newcomer = '222222222222222222';
  const mf = new Miniflare(convertV4MiniflareOptions({workers: [{name: 'roles', modules: true, scriptPath: 'dist/index.js', compatibilityDate: '2026-09-09', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], bindings: {APP_ORIGIN: origin, BOOTSTRAP_ADMIN_ID: owner, DISCORD_CLIENT_SECRET: 'test', DISCORD_CLIENT_ID: 'test'}}]}));
  try {
    const db = await mf.getD1Database('DB');
    for (const file of (await readdir('migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await readFile('migrations/' + file, 'utf8'));
    const time = Math.floor(Date.now() / 1000);
    for (const [id, name] of [[owner, 'Owner'], [team, 'Ann'], [newcomer, 'Bob']]) await db.prepare("INSERT INTO users(id,name,role,created) VALUES(?,?, 'pending',?)").bind(id, name, time).run();
    await db.prepare("INSERT INTO user_roles(user_id,role_id) VALUES(?, 'admin')").bind(owner).run();
    const snapshot = (servers: string[]) => JSON.stringify({servers: servers.map(id => ({instance_id: id, server_name: 'Server ' + id, status: 'running'}))});
    await db.prepare('INSERT INTO nodes(id,name,token_hash,snapshot,last_seen) VALUES(?,?,?,?,?)').bind('node-1', 'Node one', 'h1', snapshot(['game-1', 'game-2']), time).run();
    await db.prepare('INSERT INTO nodes(id,name,token_hash,snapshot,last_seen) VALUES(?,?,?,?,?)').bind('node-2', 'Node two', 'h2', snapshot(['game-3']), time).run();
    const headersFor = async (name: string, user: string) => {
      await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await digest(name), user, name + '-csrf', time + 3600).run();
      return {Cookie: '__Host-farmservers=' + name, Origin: origin, 'X-CSRF-Token': name + '-csrf', 'Content-Type': 'application/json'};
    };
    const admin = await headersFor('owner', owner), visitor = await headersFor('newcomer', newcomer);
    const call = (path: string, headers: Record<string, string>, body?: unknown) => mf.dispatchFetch(origin + path, {method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body)});
    const json = async (response: Response) => await response.json() as any;
    const action = (headers: Record<string, string>, node: string, instance: string, what: string) => call('/api/action', headers, {node, instance_id: instance, action: what});

    // A new member with no roles can sign in and ask for access, and nothing else.
    const me = await json(await call('/api/me', visitor));
    assert.equal(me.role, 'pending');assert.deepEqual(me.access.permissions, []);assert.equal(me.request, null);
    for (const path of ['/api/nodes', '/api/members', '/api/roles', '/api/notifications']) assert.equal((await call(path, visitor)).status, 403, path);
    assert.equal((await call('/api/access-request', visitor, {message: 'I run the Riverbend farm'})).status, 200);
    assert.equal((await json(await call('/api/me', visitor))).request.status, 'open');
    assert.equal((await call('/api/access-request', admin, {})).status, 409);

    // An administrator sees the request and builds a role that covers one server.
    assert.equal((await json(await call('/api/access-requests', admin))).requests[0].id, newcomer);
    assert.equal((await call('/api/access-requests/resolve', admin, {id: newcomer, action: 'approve', roles: []})).status, 422);
    assert.equal((await call('/api/roles', admin, {name: 'Farm A', color: 'green', permissions: [], all_servers: false, servers: []})).status, 422);
    const created = await call('/api/roles', admin, {name: 'Farm A', color: '#47d8b0', permissions: ['servers.control'], all_servers: false, servers: ['node-1/game-1']});
    assert.equal(created.status, 200);const farm = (await json(created)).id as string;assert.equal(farm, 'farm-a');
    assert.equal((await call('/api/roles', admin, {name: 'farm a', color: '#47d8b0', permissions: [], all_servers: true, servers: []})).status, 409);
    const roles = (await json(await call('/api/roles', admin))).roles as {id: string; permissions: string[]; members: number}[];
    assert.deepEqual(roles.find(r => r.id === farm)?.permissions, ['servers.view', 'servers.control']);
    assert.deepEqual(roles.map(r => r.id).slice(0, 3), ['admin', 'game-server-team', 'viewer']);

    assert.equal((await call('/api/access-requests/resolve', admin, {id: newcomer, action: 'approve', roles: [farm]})).status, 200);
    assert.equal((await json(await call('/api/access-requests', admin))).requests.length, 0);
    assert.equal((await json(await call('/api/me', visitor))).role, 'operator');

    // Their view of the fleet is limited to the one server their role covers.
    const visible = (await json(await call('/api/nodes', visitor))).nodes as {id: string; snapshot: {servers: {instance_id: string}[]}}[];
    assert.deepEqual(visible.map(n => [n.id, n.snapshot.servers.map(s => s.instance_id)]), [['node-1', ['game-1']]]);
    assert.notEqual((await action(visitor, 'node-1', 'game-1', 'start')).status, 403);
    for (const [node, instance, what] of [['node-1', 'game-2', 'start'], ['node-2', 'game-3', 'restart'], ['node-1', 'game-1', 'backend_reboot'], ['node-1', 'game-1', 'logs']]) assert.equal((await action(visitor, node, instance, what)).status, 403, node + instance + what);
    for (const path of ['/api/members', '/api/roles', '/api/history?node=node-1', '/api/manage?node=node-1&operation=inventory', '/api/users']) assert.equal((await call(path, visitor)).status, 403, path);
    assert.equal((await call('/api/members/roles', visitor, {id: newcomer, roles: ['admin']})).status, 403);
    assert.equal((await call('/api/roles', visitor, {name: 'Self', color: '#ffffff', is_admin: true, permissions: [], all_servers: true, servers: []})).status, 403);
    assert.equal((await call('/api/launch?node=node-1&kind=web&instance=game-1', visitor, {})).status, 403);
    assert.equal((await call('/api/server-credentials?node=node-1&instance=game-1', visitor)).status, 403);

    // Granting more to the role takes effect immediately, still only for its own server.
    assert.equal((await call('/api/roles', admin, {id: farm, name: 'Farm A', color: '#47d8b0', permissions: ['servers.control', 'servers.backend', 'servers.logs', 'servers.panel', 'servers.credentials'], all_servers: false, servers: ['node-1/game-1']})).status, 200);
    for (const what of ['backend_reboot', 'logs']) assert.notEqual((await action(visitor, 'node-1', 'game-1', what)).status, 403, what);
    assert.equal((await action(visitor, 'node-1', 'game-2', 'backend_reboot')).status, 403);
    assert.notEqual((await call('/api/launch?node=node-1&kind=web&instance=game-1', visitor, {})).status, 403);
    assert.equal((await call('/api/launch?node=node-1&kind=web&instance=game-2', visitor, {})).status, 403);
    assert.equal((await call('/api/launch?node=node-1&kind=vnc&instance=game-1', visitor, {})).status, 403);
    assert.equal((await call('/api/launch?node=node-1&kind=panel', visitor, {})).status, 403);
    assert.notEqual((await call('/api/server-credentials?node=node-1&instance=game-1', visitor)).status, 403);
    assert.equal((await call('/api/server-credentials?node=node-1&instance=game-2', visitor)).status, 403);

    // Roles combine, profiles are readable, and the safeguards hold.
    assert.equal((await call('/api/members/roles', admin, {id: newcomer, roles: [farm, 'game-server-team']})).status, 200);
    assert.deepEqual((await json(await call('/api/nodes', visitor))).nodes.map((n: {id: string}) => n.id), ['node-1', 'node-2']);
    const profile = await json(await call('/api/members?id=' + newcomer, admin));
    assert.deepEqual(profile.member.roles.sort(), [farm, 'game-server-team'].sort());assert.equal(profile.member.active, true);
    // The initial administrator always keeps Admin; any other administrator cannot demote themselves.
    assert.deepEqual((await json(await call('/api/members/roles', admin, {id: owner, roles: []}))).roles, ['admin']);
    assert.equal((await call('/api/members/roles', admin, {id: team, roles: ['admin']})).status, 200);
    const second = await headersFor('team', team);
    assert.equal((await call('/api/me', second).then(json)).role, 'admin');
    assert.equal((await call('/api/members/roles', second, {id: team, roles: ['viewer']})).status, 409);
    assert.equal((await call('/api/members/roles', admin, {id: newcomer, roles: ['missing']})).status, 422);
    assert.equal((await call('/api/roles/delete', admin, {id: 'admin'})).status, 409);
    assert.equal((await call('/api/roles', admin, {id: 'admin', name: 'Admin', color: '#e74c3c', is_admin: false, permissions: [], all_servers: true, servers: []})).status, 200);
    assert.equal((await db.prepare("SELECT is_admin FROM roles WHERE id='admin'").first<{is_admin: number}>())?.is_admin, 1);

    // Removing the last role sends the member back to the request screen; they cannot fall back to old access.
    assert.equal((await call('/api/members/roles', admin, {id: newcomer, roles: []})).status, 200);
    assert.equal((await json(await call('/api/me', visitor))).role, 'pending');
    assert.equal((await call('/api/nodes', visitor)).status, 403);
    assert.equal((await call('/api/members/roles', admin, {id: newcomer, roles: [farm]})).status, 200);
    assert.equal((await call('/api/roles/delete', admin, {id: farm})).status, 200);
    assert.equal((await json(await call('/api/me', visitor))).role, 'pending');
    assert.equal((await db.prepare('SELECT role FROM users WHERE id=?').bind(newcomer).first<{role: string}>())?.role, 'pending');

    // A declined request can be made again; unblocking returns a member to pending.
    await call('/api/access-request', visitor, {});
    assert.equal((await call('/api/access-requests/resolve', admin, {id: newcomer, action: 'deny'})).status, 200);
    assert.equal((await json(await call('/api/me', visitor))).request.status, 'denied');
    assert.equal((await call('/api/access-request', visitor, {message: 'Please reconsider'})).status, 200);
    assert.equal((await json(await call('/api/me', visitor))).request.status, 'open');
    assert.equal((await call('/api/members/roles', admin, {id: team, roles: ['game-server-team']})).status, 200);
    assert.equal((await call('/api/users/block', admin, {id: team, blocked: true})).status, 200);
    assert.equal((await call('/api/users/block', admin, {id: team, blocked: false})).status, 200);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM user_roles WHERE user_id=?').bind(team).first<{n: number}>())?.n, 0);
    assert.ok((await json(await call('/api/audit?action=member.roles', admin))).events.length > 0);
    assert.equal((await call('/api/members', admin)).status, 200);
  } finally { await mf.dispose(); }
});
