export function loginPage(pending: boolean): Response {
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in — Farm Servers</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="stylesheet" href="/style.css"><script src="/login.js" defer></script></head>
<body class="login-page"><main class="login-card"><h1>${pending ? 'Membership pending' : 'Farm Servers'}</h1><p>${pending ? 'You are signed in. Your membership is pending administrator approval.' : 'Sign in with Discord to join. New members start pending approval.'}</p>${pending ? '' : '<a class="button" href="/auth/login">Sign in with Discord</a>'}<button id="signout" hidden>Sign out</button><p id="login-message" role="status"></p></main></body></html>`, {
    headers: {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Vary':'Cookie'}
  });
}
