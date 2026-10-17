// Role-based access. A member holds any number of roles; their access is the union of every role.
// The Admin flag is full access. Every other permission applies only to the servers a role covers.
export const permissionGroups = [
  {id: 'servers', label: 'Game servers', items: [
    {id: 'servers.view', label: 'View status', detail: 'See the server, who is playing and whether it is running.'},
    {id: 'servers.control', label: 'Start, stop and restart', detail: 'Control the game server.'},
    {id: 'servers.backend', label: 'Backend reboot', detail: 'Restart the server’s backend services without a full restart.'},
    {id: 'servers.logs', label: 'View logs', detail: 'Read the server’s recent log output.'},
    {id: 'servers.panel', label: 'Open the game web panel', detail: 'Open the in-game admin web panel.'},
    {id: 'servers.credentials', label: 'See the web panel login', detail: 'Show the web panel username and password.'},
    {id: 'servers.console', label: 'Open the VNC console', detail: 'Remote desktop session for the server, including its VNC password.'}
  ]}
] as const;
export type Permission = typeof permissionGroups[number]['items'][number]['id'];
export const permissions: Permission[] = permissionGroups.flatMap(group => group.items.map(item => item.id));
export type RoleRecord = {id: string; name: string; color: string; position: number; is_admin: boolean; permissions: Permission[]; all_servers: boolean; servers: string[]; created: number};
export type RoleRow = {id: string; name: string; color: string; position: number; is_admin: number; permissions: string; all_servers: number; servers: string; created: number};
export type Access = {admin: boolean; roles: RoleRecord[]};
export const adminRoleId = 'admin';
const validPermission = (value: unknown): value is Permission => typeof value === 'string' && (permissions as string[]).includes(value);
export function parseRole(row: RoleRow): RoleRecord {
  let granted: unknown = [], servers: unknown = [];
  try { granted = JSON.parse(row.permissions); } catch { /* A malformed row grants nothing. */ }
  try { servers = JSON.parse(row.servers); } catch { /* A malformed row covers no servers. */ }
  return {
    id: row.id, name: row.name, color: row.color, position: row.position, is_admin: !!row.is_admin,
    permissions: Array.isArray(granted) ? granted.filter(validPermission) : [],
    all_servers: !!row.all_servers,
    servers: Array.isArray(servers) ? servers.filter((item): item is string => typeof item === 'string') : [],
    created: row.created
  };
}
export const serverKey = (node: string, instance: string) => node + '/' + instance;
export function makeAccess(roles: RoleRecord[], forceAdmin = false): Access {
  return {admin: forceAdmin || roles.some(role => role.is_admin), roles};
}
export function can(access: Access, permission: Permission, node: string, instance: string): boolean {
  if (access.admin) return true;
  const key = serverKey(node, instance);
  return access.roles.some(role => role.permissions.includes(permission) && (role.all_servers || role.servers.includes(key)));
}
// Seeing a server needs any permission on it; the role editor always pairs every other permission with View.
export function canSee(access: Access, node: string, instance: string): boolean {
  if (access.admin) return true;
  const key = serverKey(node, instance);
  return access.roles.some(role => role.permissions.length > 0 && (role.all_servers || role.servers.includes(key)));
}
export function hasAnyAccess(access: Access): boolean {
  return access.admin || access.roles.some(role => role.permissions.length > 0);
}
// Members created before roles existed (and no memberships yet) keep exactly what their old role allowed.
export function legacyAccess(legacyRole: string, forceAdmin = false): Access {
  if (forceAdmin || legacyRole === 'admin') return makeAccess([], true);
  const base = {color: '#99aab5', position: 99, is_admin: false, all_servers: true, servers: [], created: 0};
  if (legacyRole === 'operator') return makeAccess([{...base, id: 'legacy-staff', name: 'Staff', permissions: ['servers.view', 'servers.control']}]);
  if (legacyRole === 'viewer') return makeAccess([{...base, id: 'legacy-viewer', name: 'Viewer', permissions: ['servers.view']}]);
  return makeAccess([]);
}
// Compatibility view used by the older checks: admin, staff (limited access) or nobody yet.
export function effectiveRole(access: Access): 'admin' | 'operator' | 'pending' {
  return access.admin ? 'admin' : hasAnyAccess(access) ? 'operator' : 'pending';
}
export function validColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}
export function validRoleName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 40;
}
export function cleanPermissions(value: unknown): Permission[] | null {
  if (!Array.isArray(value) || value.length > permissions.length || !value.every(validPermission)) return null;
  const chosen = new Set<Permission>(value);
  if (chosen.size && !chosen.has('servers.view')) chosen.add('servers.view');
  return permissions.filter(item => chosen.has(item));
}
export function cleanServers(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 500) return null;
  if (!value.every(item => typeof item === 'string' && /^[a-z0-9][a-z0-9-]{0,62}\/[a-zA-Z0-9_-]{1,128}$/.test(item))) return null;
  return [...new Set(value as string[])].sort();
}
export function roleId(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'role';
}
// What a browser may know about the signed-in member.
export function publicAccess(access: Access) {
  return {
    admin: access.admin,
    roles: access.roles.map(role => ({id: role.id, name: role.name, color: role.color})),
    permissions: access.admin ? permissions : [...new Set(access.roles.flatMap(role => role.permissions))],
    allServers: access.admin || access.roles.some(role => role.permissions.length > 0 && role.all_servers),
    servers: access.admin ? [] : [...new Set(access.roles.filter(role => role.permissions.length > 0).flatMap(role => role.servers))]
  };
}
