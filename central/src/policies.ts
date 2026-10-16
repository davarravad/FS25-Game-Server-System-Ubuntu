import {OPERATOR, USED_OPTIONAL, buildClientConfig, categoryInfo, inventory, type ConsentEnv} from './consent-config';

const esc = (value: string) => value.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c] as string));
const EFFECTIVE = '12 October 2026';

function contact(env: ConsentEnv): string {
  const value = (env.PRIVACY_CONTACT || '').trim();
  if (!value) return 'A privacy contact has not been configured for this site yet.';
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) ? `<a href="mailto:${esc(value)}">${esc(value)}</a>` : esc(value);
}

function inventoryTable(): string {
  const rows = inventory.map(e => `<tr><th scope="row">${esc(e.name)}</th><td>${esc(e.provider)}</td><td>${esc(e.purpose)}</td><td>${esc(categoryInfo[e.category].label)}</td><td>${esc(e.host)}</td><td>${e.party === 'first' ? 'First party' : 'Third party'}</td><td>${esc(e.lifetime)}</td></tr>`);
  return `<div class="policy-table-wrap" tabindex="0" role="region" aria-label="Cookie and similar technology inventory"><table class="policy-table"><thead><tr><th scope="col">Name</th><th scope="col">Provider</th><th scope="col">Purpose</th><th scope="col">Category</th><th scope="col">Host / path</th><th scope="col">Party</th><th scope="col">Browser lifetime</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function cookiePolicy(env: ConsentEnv): string {
  const optional = USED_OPTIONAL.length > 0;
  return `<h1>Cookie Policy</h1>
<p class="policy-meta">${esc(new URL(env.APP_ORIGIN).hostname)} · Effective ${EFFECTIVE}</p>
<h2>Who we are</h2>
<p>This site is operated by ${esc(OPERATOR)}. Privacy contact: ${contact(env)}</p>
<h2>What this policy covers</h2>
<p>Cookies are small files a website stores in your browser. We also describe similar technologies, such as requests your browser makes to another company’s servers when you use the site.</p>
<h2>Summary</h2>
<p>${optional
    ? 'This site uses strictly necessary technologies and, only if you choose to allow them, optional ones listed below.'
    : '<strong>This site uses only strictly necessary cookies.</strong> It does not use analytics, advertising, tracking pixels, session replay, social media widgets or other optional technologies, so there is nothing to opt in to. If that ever changes, optional technologies will stay switched off until you allow them, and this page will be updated first.'}</p>
<h2>What we use</h2>
${inventoryTable()}
<p>Cookie lifetime is how long your browser keeps the cookie. It is different from how long we keep related records; see the Privacy Policy for that.</p>
<h2>Your choices</h2>
<p>${optional
    ? 'You can accept all optional categories, reject them, or choose which to allow, and change your mind at any time with <strong>Cookie Settings</strong> in the page footer. Closing the banner does not count as agreement. Withdrawing consent stops optional technologies from running again; we cannot delete cookies that other companies have set on their own domains or data they already received.'
    : 'Strictly necessary cookies cannot be switched off in the site because the service cannot work without them. <strong>Cookie Settings</strong> in the page footer shows this information at any time.'}</p>
<h2>Browser controls</h2>
<p>You can delete or block cookies in your browser settings. If you block the necessary cookies above you will not be able to sign in. Clearing cookies does not erase information we already hold about your account.</p>
<h2>Global Privacy Control</h2>
<p>If your browser sends a Global Privacy Control signal, we treat it as an opt-out of the sale or sharing of personal information and of targeted advertising. This site does not sell or share personal information or show targeted advertising.</p>
<h2>Third-party content</h2>
<p>After you sign in, your browser loads your Discord profile picture directly from Discord. The game server web panel is software supplied with Farming Simulator and is shown inside this service; it may set its own session cookie, listed above. Our infrastructure provider, Cloudflare, delivers this site and may process request details such as your IP address in doing so.</p>
<h2>Changes</h2>
<table class="policy-table"><thead><tr><th scope="col">Date</th><th scope="col">Change</th></tr></thead><tbody><tr><td>${EFFECTIVE}</td><td>First version, based on an audit of the deployed code.</td></tr></tbody></table>`;
}

function privacyPolicy(env: ConsentEnv): string {
  return `<h1>Privacy Policy</h1>
<p class="policy-meta">${esc(new URL(env.APP_ORIGIN).hostname)} · Effective ${EFFECTIVE}</p>
<h2>Who is responsible</h2>
<p>${esc(OPERATOR)} operates this control panel for Farming Simulator servers. Individual game communities that use it may be responsible for their own members’ information. Privacy contact: ${contact(env)}</p>
<h2>Who can sign in</h2>
<p>The site is for approved staff only. Visitors who are not signed in only see the sign-in page and these policies. We store nothing about anonymous visitors in our database. Our infrastructure provider, Cloudflare, processes request details such as your IP address to deliver the page and keeps operational logs.</p>
<h2>What we collect, why, and for how long</h2>
<table class="policy-table"><thead><tr><th scope="col">Information</th><th scope="col">Source</th><th scope="col">Purpose</th><th scope="col">Kept</th></tr></thead><tbody>
<tr><th scope="row">Discord user ID, username, profile picture link</th><td>Discord, when you sign in (the “identify” permission only)</td><td>Identify you, show your name and picture, apply your membership role</td><td>Until the account is removed by an administrator</td></tr>
<tr><th scope="row">Membership role and approval or blocked status</th><td>Administrators</td><td>Decide what you may see and do</td><td>Until the account is removed</td></tr>
<tr><th scope="row">Sign-in session (stored only as a one-way hash)</th><td>Created at sign-in</td><td>Keep you signed in</td><td>8 hours, then deleted</td></tr>
<tr><th scope="row">Activity log: your Discord ID, the action and the server it applied to, with time</th><td>Actions you take in the panel</td><td>Security and accountability</td><td>90 days</td></tr>
<tr><th scope="row">Which notifications you have read</th><td>You</td><td>Hide notifications you have seen</td><td>90 days</td></tr>
</tbody></table>
<h2>Cookies and tracking</h2>
<p>We use only strictly necessary cookies and no analytics or advertising. Details, names and lifetimes are in the <a href="/cookie-policy">Cookie Policy</a>.</p>
<h2>Who receives information</h2>
<p>Discord (sign-in and profile picture) and Cloudflare (hosting, network delivery and database storage). We do not sell personal information or share it for advertising.</p>
<h2>Your rights</h2>
<p>Depending on where you live you may have rights to access, correct or delete your information, or to object to or restrict its use. Contact us using the details above. To remove your account, ask an administrator or contact us.</p>`;
}

export function policyPage(kind: 'cookie' | 'privacy', env: ConsentEnv): Response {
  const title = kind === 'cookie' ? 'Cookie Policy' : 'Privacy Policy';
  const body = kind === 'cookie' ? cookiePolicy(env) : privacyPolicy(env);
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Farm Servers</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="stylesheet" href="/style.css"><script src="/consent.js" defer></script></head>
<body class="policy-page"><main class="policy-card"><a href="/" class="policy-home"><img src="/fs-farmservers-logo.svg" width="252" height="48" alt="FS FarmServers home"></a>
${body}
<footer class="site-footer"><a href="/cookie-policy">Cookie Policy</a><a href="/privacy-policy">Privacy Policy</a><button type="button" class="link-button" data-consent-open>Cookie Settings</button></footer></main></body></html>`, {
    headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'},
  });
}

// Public (no sign-in) consent and policy routes. Policies must stay reachable without consent or login.
export function publicConsentRoute(path: string, request: Request, env: ConsentEnv): Response | null {
  const clean = path.replace(/\/$/, '');
  if (clean === '/cookie-policy') return policyPage('cookie', env);
  if (clean === '/privacy-policy') return policyPage('privacy', env);
  if (clean === '/consent-config.json') {
    // Sec-GPC is per request, so this response is never cached or shared between visitors.
    return new Response(JSON.stringify(buildClientConfig(env, request.headers.get('Sec-GPC') === '1')), {
      headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Sec-GPC'},
    });
  }
  return null;
}
