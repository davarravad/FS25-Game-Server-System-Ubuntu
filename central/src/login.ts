export function loginPage(pending: boolean): Response {
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in — Farm Servers</title><link rel="stylesheet" href="/style.css"><script src="/login.js" defer></script></head>
<body class="login-page"><main class="login-card"><h1>Farm Servers</h1><p>${pending ? 'Your account needs administrator or staff approval to access this site.' : 'Sign in with an approved administrator or staff account to continue.'}</p><a class="button" href="/auth/login">Sign in with Discord</a><button id="signout" hidden>Sign out</button><p id="login-message" role="status"></p></main></body></html>`, {
    headers: {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Vary':'Cookie'}
  });
}
