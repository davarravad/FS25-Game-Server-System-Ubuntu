export const roles = ['pending', 'viewer', 'operator', 'admin'] as const;
export type Role = typeof roles[number];
export function allowed(role: string, required: Role): boolean {
  return roles.indexOf(role as Role) >= roles.indexOf(required);
}
export function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
}
export async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
export function cookieValue(request: Request, name: string): string {
  const values = (request.headers.get('Cookie') || '').split(';').map(s => s.trim()).filter(s => s.startsWith(name + '='));
  return values.length === 1 ? values[0].slice(name.length + 1) : '';
}
export function cookie(name: string, value: string, seconds: number): string {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
}
export function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,62}$/.test(value);
}
export function validScope(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}
// True for a dotted-quad IPv4 literal that is not private, loopback, link-local or multicast/reserved —
// i.e. an address that is plausibly reachable from the public internet.
export function publicIPv4(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const parts = m.slice(1).map(Number);
  if (parts.some(p => p > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // RFC 6598 carrier-grade NAT (Starlink, cellular, some cable/fiber ISPs)
  return true;
}
export function safeMetrics(value: unknown): Record<string, number | null> {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.fromEntries(['cpu_percent','memory_used_bytes','memory_limit_bytes','disk_used_bytes','disk_limit_bytes','network_in_bytes_sec','network_out_bytes_sec','uptime_seconds'].map(key => {
    const n = source[key];
    return [key, typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e18 ? n : null];
  }));
}
export async function hmacHex(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message))), b => b.toString(16).padStart(2, '0')).join('');
}
export async function readJson(request: Request, limit = 262144): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing body');
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error('Body too large');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const result: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Expected object');
  return result as Record<string, unknown>;
}
