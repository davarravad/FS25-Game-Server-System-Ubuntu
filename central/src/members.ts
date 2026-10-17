import {readJson} from './security';
import {adminRoleId, cleanPermissions, cleanServers, parseRole, permissionGroups, roleId, validColor, validRoleName, type RoleRecord, type RoleRow} from './access';

type Environment = {DB: D1Database; BOOTSTRAP_ADMIN_ID: string};
type Actor = {user_id: string};
type Audit = (action: string, target: string) => Promise<void>;
type UserRow = {id: string; name: string; avatar_url: string | null; role: string; created: number; blocked: number};

const now = () => Math.floor(Date.now() / 1000);
const reply = (data: unknown, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});
const fail = (status: number, message: string) => reply({error: message}, status);
const discordId = (value: unknown): value is string => typeof value === 'string' && /^\d{17,20}$/.test(value);
const roleKey = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(value);
// Older callers send one account type; each maps onto the role that replaced it.
export const legacyRoleIds: Record<string, string[]> = {pending: [], viewer: ['viewer'], operator: ['game-server-team'], admin: [adminRoleId]};

async function loadRoles(env: Environment): Promise<RoleRecord[]> {
  return (await env.DB.prepare('SELECT * FROM roles ORDER BY position,name').all<RoleRow>()).results.map(parseRole);
}
async function serverCatalog(env: Environment) {
  const nodes = (await env.DB.prepare('SELECT id,name,snapshot FROM nodes WHERE enabled=1 ORDER BY name').all<{id: string; name: string; snapshot: string | null}>()).results;
  return nodes.map(node => {
    let servers: {instance_id: string; server_name: string}[] = [];
    try { servers = JSON.parse(node.snapshot || '{}').servers || []; } catch { /* An unreadable snapshot lists no servers. */ }
    return {id: node.id, name: node.name, servers: servers.filter(s => typeof s.instance_id === 'string').map(s => ({instance: s.instance_id, name: String(s.server_name || s.instance_id)}))};
  });
}
function hasAccess(roles: RoleRecord[]) {
  return roles.some(role => role.is_admin || role.permissions.length > 0);
}
async function memberships(env: Environment): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (const row of (await env.DB.prepare('SELECT user_id,role_id FROM user_roles').all<{user_id: string; role_id: string}>()).results) {
    map.set(row.user_id, [...(map.get(row.user_id) || []), row.role_id]);
  }
  return map;
}
async function listMembers(env: Environment) {
  const [roles, users, held, logins, requests] = await Promise.all([
    loadRoles(env),
    env.DB.prepare('SELECT id,name,avatar_url,role,created,blocked FROM users ORDER BY created DESC').all<UserRow>(),
    memberships(env),
    env.DB.prepare("SELECT actor,MAX(ts) AS ts FROM audit WHERE action='login' GROUP BY actor").all<{actor: string; ts: number}>(),
    env.DB.prepare('SELECT user_id,message,status,created FROM access_requests').all<{user_id: string; message: string; status: string; created: number}>()
  ]);
  const byId = new Map(roles.map(role => [role.id, role]));
  const lastLogin = new Map(logins.results.map(row => [row.actor, row.ts]));
  const requested = new Map(requests.results.map(row => [row.user_id, row]));
  const members = users.results.map(user => {
    const ids = [...new Set([...(held.get(user.id) || []), ...(user.id === env.BOOTSTRAP_ADMIN_ID ? [adminRoleId] : [])])].filter(id => byId.has(id));
    const request = requested.get(user.id);
    return {
      id: user.id, name: user.name, avatarUrl: user.avatar_url, created: user.created, blocked: !!user.blocked,
      lastLogin: lastLogin.get(user.id) ?? null, roles: ids, active: hasAccess(ids.map(id => byId.get(id)!)) || (!held.has(user.id) && ['admin', 'operator', 'viewer'].includes(user.role)),
      initialAdmin: user.id === env.BOOTSTRAP_ADMIN_ID,
      request: request ? {status: request.status, message: request.message, created: request.created} : null
    };
  });
  return {members, roles: roles.map(role => ({...role, members: members.filter(m => m.roles.includes(role.id)).length}))};
}

// Replaces a member's roles. Everything that grants access is validated here so no caller can bypass it.
async function setRoles(env: Environment, actor: Actor, audit: Audit, id: string, requested: string[], mode: 'replace' | 'add') {
  const known = new Set((await loadRoles(env)).map(role => role.id));
  if (!requested.every(role => known.has(role))) return fail(422, 'One of those roles no longer exists');
  const user = await env.DB.prepare('SELECT id FROM users WHERE id=?').bind(id).first();
  if (!user) return fail(404, 'Member not found');
  const current = (await env.DB.prepare('SELECT role_id FROM user_roles WHERE user_id=?').bind(id).all<{role_id: string}>()).results.map(row => row.role_id);
  let next = mode === 'add' ? [...new Set([...current, ...requested])] : [...new Set(requested)];
  if (id === env.BOOTSTRAP_ADMIN_ID && !next.includes(adminRoleId)) next = [adminRoleId, ...next];
  if (id === actor.user_id && current.includes(adminRoleId) && !next.includes(adminRoleId)) return fail(409, 'You cannot remove your own Admin role');
  const statements = [
    env.DB.prepare('DELETE FROM user_roles WHERE user_id=?').bind(id),
    ...next.map(role => env.DB.prepare('INSERT INTO user_roles(user_id,role_id) VALUES(?,?)').bind(id, role)),
    // The pre-roles account type is cleared so removing every role can never fall back to old access.
    ...(next.length ? [] : [env.DB.prepare("UPDATE users SET role='pending' WHERE id=?").bind(id)]),
    ...(next.length ? [env.DB.prepare('DELETE FROM access_requests WHERE user_id=?').bind(id)] : [])
  ];
  await env.DB.batch(statements);
  await audit('member.roles', id + ': ' + (next.join(', ') || 'no roles'));
  return reply({ok: true, roles: next});
}

export async function requestAccess(env: Environment, userId: string, body: Record<string, unknown>, audit: Audit) {
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 300) : '';
  const stamp = now();
  await env.DB.prepare("INSERT INTO access_requests(user_id,message,status,created,updated) VALUES(?,?, 'open',?,?) ON CONFLICT(user_id) DO UPDATE SET message=excluded.message,status='open',created=CASE WHEN access_requests.status='open' THEN access_requests.created ELSE excluded.created END,updated=excluded.updated").bind(userId, message, stamp, stamp).run();
  await audit('access.request', userId);
  return reply({status: 'open'});
}
export async function requestStatus(env: Environment, userId: string): Promise<{status: string; message: string} | null> {
  return env.DB.prepare('SELECT status,message FROM access_requests WHERE user_id=?').bind(userId).first<{status: string; message: string}>();
}

// Administrator-only endpoints for members, roles and access requests. Returns null for any other path.
export async function membersApi(request: Request, env: Environment, url: URL, actor: Actor, audit: Audit): Promise<Response | null> {
  const path = url.pathname, method = request.method;
  if (path === '/api/members' && method === 'GET') {
    const id = url.searchParams.get('id');
    const data = await listMembers(env);
    if (!id) return reply({...data, catalog: await serverCatalog(env), permissionGroups});
    if (!discordId(id)) return fail(422, 'Invalid member');
    const member = data.members.find(item => item.id === id);
    if (!member) return fail(404, 'Member not found');
    const activity = (await env.DB.prepare('SELECT ts,action,target FROM audit WHERE actor=? ORDER BY id DESC LIMIT 15').bind(id).all()).results;
    const changes = (await env.DB.prepare("SELECT a.ts,a.action,a.target,a.actor,u.name AS actor_name FROM audit a LEFT JOIN users u ON u.id=a.actor WHERE a.target LIKE ? ESCAPE '\\' ORDER BY a.id DESC LIMIT 10").bind(id + '%').all()).results;
    return reply({member, roles: data.roles, permissionGroups, activity, changes});
  }
  if (path === '/api/members/roles' && method === 'POST') {
    const body = await readJson(request, 4096);
    if (!discordId(body.id) || !Array.isArray(body.roles) || body.roles.length > 25 || !body.roles.every(roleKey)) return fail(422, 'Invalid member or roles');
    return setRoles(env, actor, audit, body.id, body.roles as string[], 'replace');
  }
  if (path === '/api/users' && method === 'POST') {
    // Older single-role form: kept so existing integrations continue to work.
    const body = await readJson(request, 4096);
    if (!discordId(body.id) || typeof body.role !== 'string' || !(body.role in legacyRoleIds)) return fail(422, 'Invalid user or role');
    if (body.id === env.BOOTSTRAP_ADMIN_ID) return fail(409, 'The initial administrator is managed in Worker configuration');
    if (body.id === actor.user_id) return fail(409, 'You cannot change your own role');
    return setRoles(env, actor, audit, body.id, legacyRoleIds[body.role], 'replace');
  }
  if (path === '/api/users/create' && method === 'POST') {
    const body = await readJson(request, 4096);
    const ids = Array.isArray(body.roles) ? body.roles : typeof body.role === 'string' && body.role in legacyRoleIds ? legacyRoleIds[body.role] : null;
    if (!discordId(body.id) || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100 || !ids || ids.length > 25 || !ids.every(roleKey)) return fail(422, 'Invalid Discord ID, name or roles');
    const known = new Set((await loadRoles(env)).map(role => role.id));
    if (!ids.every((role: string) => known.has(role))) return fail(422, 'One of those roles no longer exists');
    const created = await env.DB.prepare("INSERT INTO users(id,name,role,created) VALUES(?,?, 'pending',?) ON CONFLICT(id) DO NOTHING RETURNING id").bind(body.id, body.name.trim(), now()).first();
    if (!created) return fail(409, 'This user already exists');
    if (ids.length) await env.DB.batch(ids.map((role: string) => env.DB.prepare('INSERT OR IGNORE INTO user_roles(user_id,role_id) VALUES(?,?)').bind(body.id, role)));
    await audit('user.create', body.id as string);
    return reply({ok: true});
  }
  if (path === '/api/roles' && method === 'GET') {
    const data = await listMembers(env);
    return reply({roles: data.roles, catalog: await serverCatalog(env), permissionGroups});
  }
  if (path === '/api/roles' && method === 'POST') {
    const body = await readJson(request, 32768);
    if (!validRoleName(body.name) || !validColor(body.color)) return fail(422, 'Give the role a name (up to 40 characters) and a colour');
    const permissions = cleanPermissions(body.permissions ?? []), servers = cleanServers(body.servers ?? []);
    if (!permissions || !servers || typeof body.all_servers !== 'boolean') return fail(422, 'Invalid permissions or servers');
    const name = body.name.trim(), color = body.color.toLowerCase();
    const clash = await env.DB.prepare('SELECT id FROM roles WHERE lower(name)=lower(?) AND id IS NOT ?').bind(name, typeof body.id === 'string' ? body.id : null).first();
    if (clash) return fail(409, 'Another role already uses that name');
    if (typeof body.id === 'string') {
      if (!roleKey(body.id)) return fail(422, 'Invalid role');
      const existing = await env.DB.prepare('SELECT is_admin FROM roles WHERE id=?').bind(body.id).first<{is_admin: number}>();
      if (!existing) return fail(404, 'Role not found');
      // The built-in Admin role always keeps full access; every other role may be changed freely.
      const isAdmin = body.id === adminRoleId ? 1 : body.is_admin === true ? 1 : 0;
      if (existing.is_admin && !isAdmin && body.id !== adminRoleId) {
        const others = await env.DB.prepare('SELECT COUNT(*) AS count FROM roles WHERE is_admin=1 AND id!=?').bind(body.id).first<{count: number}>();
        if (!others?.count) return fail(409, 'At least one role must keep Admin access');
      }
      await env.DB.prepare('UPDATE roles SET name=?,color=?,is_admin=?,permissions=?,all_servers=?,servers=? WHERE id=?').bind(name, color, isAdmin, JSON.stringify(permissions), body.all_servers ? 1 : 0, JSON.stringify(servers), body.id).run();
      await audit('role.update', body.id);
      return reply({ok: true, id: body.id});
    }
    // "new" is the editor's route for a role that does not exist yet.
    const base = roleId(name) === 'new' ? 'new-role' : roleId(name);
    let id = base;
    for (let attempt = 2; await env.DB.prepare('SELECT id FROM roles WHERE id=?').bind(id).first(); attempt++) id = base.slice(0, 36) + '-' + attempt;
    const position = ((await env.DB.prepare('SELECT COALESCE(MAX(position),0) AS top FROM roles').first<{top: number}>())?.top ?? 0) + 1;
    await env.DB.prepare('INSERT INTO roles(id,name,color,position,is_admin,permissions,all_servers,servers,created) VALUES(?,?,?,?,?,?,?,?,?)').bind(id, name, color, position, body.is_admin === true ? 1 : 0, JSON.stringify(permissions), body.all_servers ? 1 : 0, JSON.stringify(servers), now()).run();
    await audit('role.create', id);
    return reply({ok: true, id});
  }
  if (path === '/api/roles/delete' && method === 'POST') {
    const body = await readJson(request, 1024);
    if (!roleKey(body.id)) return fail(422, 'Invalid role');
    if (body.id === adminRoleId) return fail(409, 'The Admin role cannot be deleted');
    if (!await env.DB.prepare('SELECT id FROM roles WHERE id=?').bind(body.id).first()) return fail(404, 'Role not found');
    const held = (await env.DB.prepare('SELECT user_id FROM user_roles WHERE role_id=?').bind(body.id).all<{user_id: string}>()).results.map(row => row.user_id);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM user_roles WHERE role_id=?').bind(body.id),
      env.DB.prepare('DELETE FROM roles WHERE id=?').bind(body.id),
      ...held.map(id => env.DB.prepare("UPDATE users SET role='pending' WHERE id=? AND id NOT IN (SELECT user_id FROM user_roles)").bind(id))
    ]);
    await audit('role.delete', body.id);
    return reply({ok: true, removedFrom: held.length});
  }
  if (path === '/api/access-requests' && method === 'GET') {
    const rows = (await env.DB.prepare("SELECT r.user_id AS id,u.name,u.avatar_url AS avatarUrl,r.message,r.created FROM access_requests r JOIN users u ON u.id=r.user_id WHERE r.status='open' AND u.blocked=0 ORDER BY r.created").all()).results;
    return reply({requests: rows});
  }
  if (path === '/api/access-requests/resolve' && method === 'POST') {
    const body = await readJson(request, 4096);
    if (!discordId(body.id) || !['approve', 'deny'].includes(String(body.action))) return fail(422, 'Invalid request');
    if (!await env.DB.prepare('SELECT user_id FROM access_requests WHERE user_id=?').bind(body.id).first()) return fail(404, 'That request is no longer open');
    if (body.action === 'deny') {
      await env.DB.prepare("UPDATE access_requests SET status='denied',updated=? WHERE user_id=?").bind(now(), body.id).run();
      await audit('access.deny', body.id);
      return reply({ok: true});
    }
    if (!Array.isArray(body.roles) || !body.roles.length || body.roles.length > 25 || !body.roles.every(roleKey)) return fail(422, 'Choose at least one role to approve this request');
    const result = await setRoles(env, actor, audit, body.id, body.roles as string[], 'add');
    if (result.ok) await audit('access.approve', body.id);
    return result;
  }
  return null;
}
