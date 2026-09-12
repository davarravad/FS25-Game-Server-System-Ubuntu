const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const decode = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
async function key(secret: string) {
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('Node token encryption key is not configured');
  return crypto.subtle.importKey('raw', Uint8Array.from(secret.match(/../g)!, h => parseInt(h, 16)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function sealToken(secret: string, id: string, token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:new TextEncoder().encode(id)}, await key(secret), new TextEncoder().encode(token));
  return encode(iv) + '.' + encode(new Uint8Array(encrypted));
}
export async function openToken(secret: string, id: string, value: string) {
  const [iv, encrypted] = value.split('.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM', iv:decode(iv), additionalData:new TextEncoder().encode(id)}, await key(secret), decode(encrypted)));
}
