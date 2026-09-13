const discordIcon='<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.2.4a18 18 0 0 1 4.5 2.3 15.4 15.4 0 0 0-15.4 0A18 18 0 0 1 8.8 3.4L8.6 3a19.7 19.7 0 0 0-4.9 1.4C.6 9.1-.2 13.6.2 18a19.9 19.9 0 0 0 6 3l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12 0l.5.4a12.9 12.9 0 0 1-2 1L17.8 21a19.8 19.8 0 0 0 6-3c.5-5.1-.8-9.6-3.5-13.6ZM8 15.3c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Zm8 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Z"/></svg>';

export function loginPage(pending: boolean): Response {
  const body = pending
    ? '<h1>Membership pending</h1><p>You are signed in. Your membership is pending administrator approval. This page checks for approval automatically.</p>'
    : '<h1>Welcome back</h1><p>Sign in with Discord to manage your Farming Simulator fleet. New members start pending approval.</p><a class="button login-discord" href="/auth/login">'+discordIcon+'<span>Sign in with Discord</span></a>';
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in — Farm Servers</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="stylesheet" href="/style.css"><script src="/login.js" defer></script></head>
<body class="login-page"><main class="login-card"><img class="login-logo" src="/fs-farmservers-logo.svg" width="252" height="48" alt="FS FarmServers"><p class="login-tagline">Your operations center</p>${body}<button id="signout" hidden>Sign out</button><p id="login-message" role="status"></p><p class="login-footer">Farm Sim · Control plane</p></main></body></html>`, {
    headers: {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Vary':'Cookie'}
  });
}
