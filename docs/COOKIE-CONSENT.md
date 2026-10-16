# Cookie consent: audit, implementation and release checklist

Implements the Sargent Interactive *Cookie Consent Implementation Plan* (12 October 2026) for
`farmservers.sargentweb.com`. Audited and implemented 12 October 2026.

## 1. Audit result (plan section 3)

Searched the whole repository for analytics/tag-manager/pixel/heatmap/session-replay/ad SDKs, embeds
(iframes, video, maps, social), edge-injected integrations (Cloudflare Zaraz / Web Analytics), tracking
images, beacons, browser storage (`localStorage`, `sessionStorage`, IndexedDB, service workers) and
server-side forwarding. `central/wrangler.jsonc` has no Zaraz/Web Analytics binding.

**There is no optional tracking in this codebase.**

| Surface | Result |
| --- | --- |
| Central dashboard and sign-in page (`central/`) | Same-origin scripts only. CSP `script-src 'self'; connect-src 'self'`. No third-party scripts, fonts, iframes, preconnects. Only third party: `cdn.discordapp.com` avatar image after sign-in. No browser storage. |
| Node PHP panel (`app/web/`) | Same-origin scripts only. Only cookie is the PHP default `PHPSESSID` (`session_start`, no custom params, no `php.ini` override). |
| Viewer hosts (`game-*`, `console-*`, `view-*`) | Proxies the Farming Simulator web panel, which is vendor software (see open items). |
| Server-side | No analytics forwarding. `scheduled()` only purges expired rows. |

Verified inventory: [`central/src/consent-config.ts`](../central/src/consent-config.ts) (single source used by the
Cookie Policy page, the browser component and the tests).

Because nothing optional exists, the plan's "show only categories actually used" rule means the **banner is
hidden**: asking for consent to nothing would be misleading. Policies, footer links, the Cookie Settings
dialog and the enforcement machinery are in place so the first optional technology cannot ship uncontrolled.

## 2. What was implemented

| Plan deliverable | Where |
| --- | --- |
| Policies at `/cookie-policy`, `/privacy-policy` (public, no sign-in) | `central/src/policies.ts`, routed in `central/src/index.ts` |
| Footer links + **Cookie Settings** | Sign-in page (`login.ts`), dashboard (`public/index.html`), policy pages. Node panel sidebar links to the policies (`app/web/src/sidebar.php`) |
| Consent state: validation, expiry, versions, site binding, fail-closed | `central/public/consent.js` (`FarmConsentCore.validate`) |
| Banner (Accept All / Reject Optional / Customize, equal prominence, no close, no preselection) and preference center (native modal `<dialog>`: focus trap, Esc, focus restore) | `consent.js`; shown only when an optional category exists |
| Integration registry with idempotent `start/stop/cleanup`, GPC and kill-switch gating | `consent.js` (`FarmConsent.register`) |
| GPC | Browser `navigator.globalPrivacyControl` and server `Sec-GPC` (via `/consent-config.json`); beats an older marketing acceptance for sale/share integrations |
| Per-hostname decisions | `__Host-consent` cookie is host-only by construction; `siteId` is validated |
| Kill switch | `CONSENT_KILL_SWITCH=1` Worker variable |
| Tests | `central/tests/consent.test.ts` (8 tests, in `npm test`) |

Decision cookie: `__Host-consent`, 6 months (configurable, `decisionDays`), `Secure; SameSite=Lax`, only written
when a visitor saves a choice. No server-side receipt log was added: with no optional processing there is
nothing to evidence, and logging would itself be new data collection. Add a signed receipt endpoint with
the first optional integration, together with the retention schedule the plan asks for.

### Adding an optional technology later (the only allowed path)

1. Add it to `inventory` in `consent-config.ts` with a non-`necessary` category.
2. Register it with `FarmConsent.register({id, category, start, stop, cleanup, saleShareOrTargetedAds?, reloadOnWithdraw?})`.
   It must have no other loading path (no tag in a template, no plugin, no edge injection).
3. Bump `noticeVersion`/`purposeVersion` (re-prompts, per the plan) and update the Privacy Policy text.
4. Update `consent.test.ts` (the "nothing optional is deployed" test fails on purpose until you do) and add a
   server-side check using `Sec-GPC` and the consent receipt if it forwards data from the Worker.
5. The CSP in `index.ts` (`script-src 'self'`, `connect-src 'self'`) will block the vendor until you widen it deliberately.

## 3. Test evidence (plan section 10)

Automated (`cd central && npm test`, 47/47 pass, `tsc --noEmit` clean):
valid/expired/future/corrupt/version-changed/other-site/unknown-category state rejected; GPC beats old marketing
acceptance; kill switch; start-once and teardown on withdrawal; nothing starts before configuration + decision;
policies reachable without sign-in; `Sec-GPC` seen by the server; inventory cookie names exist in the code that
sets them; every public page loads only same-origin resources; no browser-storage APIs in the shipped scripts.

Manual in a clean browser profile (local server using the real policy output, `consent.js` and `style.css`):
first visit made 4 same-origin requests (stylesheet, logo, `consent.js`, config), set 0 cookies, showed no banner;
Cookie Settings dialog opens modally, Esc closes it and returns focus to the footer button; with a *fake* analytics
category the banner showed three equal first-layer actions and no close button, nothing started pre-choice, Accept
All started the fake integration once, the choice survived navigation without a second start, and unticking +
Save stopped and cleaned it up and stored `reject_optional`.

Not tested: visual placement of the footer on the sign-in page and dashboard (markup and script presence only), screen reader, mobile devices, JS-disabled, real CDN/cache behaviour, the node PHP panel (no PHP on this
machine; the change there is one static `<p>` and a CSS rule), and no production deployment was made.

## 4. Open items before publishing

1. **Privacy contact.** Set `PRIVACY_CONTACT` (Worker variable). Until then both policies say no contact is configured.
2. **Controller identity.** Policies name "Sargent Interactive" as operator. Confirm, and confirm how community-run
   servers should be described (the plan warns against assuming Sargent Interactive controls every activity).
3. **Counsel/owner review** of both policies, applicability by jurisdiction, and the rights text (plan section 8).
4. **Game web panel (vendor software).** `docker/fs25-runtime/.../web_data/js/frontend.js` contains an AddThis loader
   (`http://s7.addthis.com/...`) that runs only on `newsArticle.php`, and `all.js` bundles the Facebook SDK. The panel
   templates come from the game, so it was not possible to confirm from the repo whether any panel page loads them.
   Capture the network traffic of a live `game-*` panel. If either appears, block it (a CSP on proxied panel HTML,
   or patch the template) before the policies are published. The game panel's own cookie name/lifetime is also unverified.
5. **Cloudflare.** Confirm the zone does not add its own cookies (for example bot-management) and none are injected at the edge.
6. **Child audience.** Gaming community panels are staff-only here, but confirm no site is directed at children.
7. **Viewer and node hostnames** (`game-*`, `console-*`, `view-*`, node tunnels) do not serve the Cookie Settings
   footer; the policy links point visitors to the main site.

## 5. Per-site release checklist (plan section 11)

```text
Website/domain:            farmservers.sargentweb.com
Technical owner:           ____
Policy owner:              ____
Component version:         consent.js, schemaVersion 1
Notice/purpose version:    2026-10-12 / 2026-10-12
Inventory verified on:     2026-10-12 (code audit); live traffic capture pending (open items 4, 5)
Tests completed on:        2026-10-12 (automated + local manual)
Approval/reference:        ____

[x] All tracking/SDK/embed loading paths inventoried (code); live capture pending
[x] Optional tracking blocked before consent (none exists; CSP blocks third-party scripts)
[x] Accept, Reject and Customize available on first layer (when an optional category exists)
[x] Optional categories off by default
[x] Choice persists with configured scope and expiry
[x] Withdrawal stops future browser tracking (no server-side tracking exists)
[x] GPC/applicable privacy opt-outs enforced separately
[ ] Cookie and Privacy Policies match deployed practices   (needs owner review + PRIVACY_CONTACT)
[x] Footer Cookie Settings available on dashboard, sign-in and policy pages
[x] Login and navigation work with no consent given
[ ] Clean-profile network/storage tests pass on the deployed site
[ ] Mobile and accessibility checks pass
[ ] Minimal consent evidence and retention configured   (deferred until an optional integration exists)
[ ] Legal applicability/classification items reviewed
[x] Kill switch ready (CONSENT_KILL_SWITCH=1); rollback leaves optional tracking off
```
