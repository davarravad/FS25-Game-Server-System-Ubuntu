// Single source of truth for the cookie/consent notice. The Cookie Policy page, the browser
// consent component (/consent-config.json) and the drift tests all read this inventory, so a
// technology cannot be disclosed in one place and missing from another.
//
// Every entry was verified against the code that sets it (see docs/COOKIE-CONSENT.md). Add an
// entry here, in the same change that adds the technology; never the other way round. Anything
// with a category other than 'necessary' also needs a registered integration (consent.js) and
// must not load, set storage or send a request until the visitor has authorised it.

export type Category = 'necessary' | 'functional' | 'analytics' | 'marketing';
export const OPTIONAL_CATEGORIES = ['functional', 'analytics', 'marketing'] as const;

export interface InventoryEntry {
  name: string;
  kind: 'cookie' | 'request';
  provider: string;
  purpose: string;
  category: Category;
  host: string;
  party: 'first' | 'third';
  lifetime: string;
  // Where in the code the technology is set, for reviewers and the drift test.
  source: string;
}

export const inventory: InventoryEntry[] = [
  {
    name: '__Host-farmservers', kind: 'cookie', provider: 'This service', category: 'necessary', party: 'first',
    purpose: 'Keeps you signed in after Discord authorises your login. HttpOnly, Secure, SameSite=Lax.',
    host: 'farmservers.sargentweb.com (path /)', lifetime: '8 hours, or until you sign out', source: 'central/src/index.ts',
  },
  {
    name: '__Host-oauth', kind: 'cookie', provider: 'This service', category: 'necessary', party: 'first',
    purpose: 'Protects the Discord sign-in against forged requests. Deleted as soon as sign-in finishes.',
    host: 'farmservers.sargentweb.com (path /)', lifetime: '5 minutes', source: 'central/src/index.ts',
  },
  {
    name: '__Host-view', kind: 'cookie', provider: 'This service', category: 'necessary', party: 'first',
    purpose: 'Authorises one console or game-panel viewing session that an administrator opened. HttpOnly, Secure.',
    host: 'view-*.farmservers.sargentweb.com (path /)', lifetime: '15 minutes', source: 'central/src/index.ts',
  },
  {
    name: '__Host-consent', kind: 'cookie', provider: 'This service', category: 'necessary', party: 'first',
    purpose: 'Remembers the cookie choice you made, so you are not asked again. Only set if you save a choice.',
    host: 'The site you made the choice on (path /)', lifetime: '6 months', source: 'central/public/consent.js',
  },
  {
    name: 'PHPSESSID', kind: 'cookie', provider: 'This service (node panel)', category: 'necessary', party: 'first',
    purpose: 'Keeps you signed in to the web panel running on a server node. PHP default session cookie.',
    host: "Your node's own panel hostname", lifetime: 'Session (removed when you close the browser)', source: 'app/web/src/bootstrap.php',
  },
  {
    name: 'Game web panel session cookie', kind: 'cookie', provider: 'Farming Simulator dedicated server software', category: 'necessary', party: 'first',
    purpose: 'Keeps an administrator signed in to the game server’s built-in web panel. Cookie name and lifetime are set by the game software and have not been verified.',
    host: 'game-*.sargentweb.com and view-*.farmservers.sargentweb.com', lifetime: 'Set by the game software', source: 'central/src/index.ts (proxyViewer passes it through)',
  },
  {
    name: 'Discord avatar image', kind: 'request', provider: 'Discord Inc. (cdn.discordapp.com)', category: 'necessary', party: 'third',
    purpose: 'After you sign in, your browser loads your Discord profile picture so it can be shown in the header. Discord receives your IP address and browser details with that request.',
    host: 'cdn.discordapp.com', lifetime: 'No cookie set by this service', source: 'central/src/index.ts (Content-Security-Policy img-src)',
  },
];

export const USED_OPTIONAL = OPTIONAL_CATEGORIES.filter(c => inventory.some(e => e.category === c));

export const categoryInfo: Record<Category, {label: string; description: string}> = {
  necessary: {label: 'Strictly necessary', description: 'Needed for sign-in, security and the pages you ask for. These cannot be switched off.'},
  functional: {label: 'Functional', description: 'Optional convenience features or external services.'},
  analytics: {label: 'Analytics', description: 'Optional measurement of how the site is used.'},
  marketing: {label: 'Marketing', description: 'Optional advertising, conversion and remarketing technologies.'},
};

export interface ConsentEnv {APP_ORIGIN: string; PRIVACY_CONTACT?: string; CONSENT_KILL_SWITCH?: string}

export const OPERATOR = 'Sargent Interactive';

export function buildClientConfig(env: ConsentEnv, gpc: boolean) {
  return {
    siteId: new URL(env.APP_ORIGIN).hostname,
    schemaVersion: 1,
    noticeVersion: '2026-10-12',
    purposeVersion: '2026-10-12',
    decisionDays: 182,
    // Set CONSENT_KILL_SWITCH=1 to stop every optional integration without a redeploy of code.
    killSwitch: env.CONSENT_KILL_SWITCH === '1',
    gpc,
    policies: {cookie: '/cookie-policy', privacy: '/privacy-policy'},
    categories: (['necessary', ...USED_OPTIONAL] as Category[]).map(id => ({
      id, ...categoryInfo[id],
      items: inventory.filter(e => e.category === id).map(({name, provider, purpose, lifetime}) => ({name, provider, purpose, lifetime})),
    })),
  };
}
