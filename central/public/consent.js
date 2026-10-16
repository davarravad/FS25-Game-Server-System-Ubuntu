/* Consent component: state validation, integration registry, banner and preference center.
 *
 * Optional integrations (anything that is not strictly necessary) must have NO other loading path:
 * they are registered here and nothing else may add their script, pixel, iframe or SDK to a page.
 * If this file or its configuration fails to load, nothing optional ever starts (fail closed).
 *
 * Nothing optional is deployed on this site today, so the banner stays hidden and the preference
 * center only explains that. Register an integration with FarmConsent.register({...}) and add it
 * to central/src/consent-config.ts in the same change.
 */
(function (root) {
  'use strict';
  var COOKIE = '__Host-consent';
  var OPTIONAL = ['functional', 'analytics', 'marketing'];
  var DECISIONS = ['accept_all', 'reject_optional', 'custom'];
  var HEX32 = /^[a-f0-9]{32}$/;
  var SKEW_MS = 5 * 60 * 1000;

  function validate(raw, cfg, now) {
    var s;
    try { s = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return null; }
    if (!s || typeof s !== 'object' || Array.isArray(s) || !cfg) return null;
    if (s.siteId !== cfg.siteId || s.schemaVersion !== cfg.schemaVersion) return null;
    if (s.noticeVersion !== cfg.noticeVersion || s.purposeVersion !== cfg.purposeVersion) return null;
    if (DECISIONS.indexOf(s.decision) < 0 || typeof s.receiptId !== 'string' || !HEX32.test(s.receiptId)) return null;
    var decided = Date.parse(s.decidedAt), expires = Date.parse(s.expiresAt);
    if (typeof s.decidedAt !== 'string' || typeof s.expiresAt !== 'string' || isNaN(decided) || isNaN(expires)) return null;
    if (decided > now + SKEW_MS || expires <= now || expires - decided > cfg.decisionDays * 86400000 + SKEW_MS) return null;
    if (!s.categories || typeof s.categories !== 'object' || Array.isArray(s.categories)) return null;
    var categories = {};
    for (var key in s.categories) {
      if (!Object.prototype.hasOwnProperty.call(s.categories, key)) continue;
      if (OPTIONAL.indexOf(key) < 0 || typeof s.categories[key] !== 'boolean') return null;
    }
    OPTIONAL.forEach(function (c) { categories[c] = s.categories[c] === true; });
    return {
      siteId: s.siteId, schemaVersion: s.schemaVersion, noticeVersion: s.noticeVersion, purposeVersion: s.purposeVersion,
      categories: categories, decision: s.decision, decidedAt: s.decidedAt, expiresAt: s.expiresAt, receiptId: s.receiptId
    };
  }

  function build(cfg, categories, decision, now, receiptId) {
    var clean = {};
    OPTIONAL.forEach(function (c) { clean[c] = categories[c] === true; });
    return {
      siteId: cfg.siteId, schemaVersion: cfg.schemaVersion, noticeVersion: cfg.noticeVersion, purposeVersion: cfg.purposeVersion,
      categories: clean, decision: decision, decidedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + cfg.decisionDays * 86400000).toISOString(), receiptId: receiptId
    };
  }

  // The illustrative contract from the plan: category consent AND no applicable privacy opt-out.
  function mayStart(integration, state, cfg) {
    return !!state && !!cfg && !cfg.killSwitch && OPTIONAL.indexOf(integration.category) >= 0 &&
      state.categories[integration.category] === true &&
      !(integration.saleShareOrTargetedAds && cfg.gpc === true);
  }

  function createRegistry(getState, getConfig, onWithdrawReload) {
    var entries = {};
    function reconcile() {
      var state = getState(), cfg = getConfig();
      Object.keys(entries).forEach(function (id) {
        var e = entries[id], want = mayStart(e.integration, state, cfg);
        try {
          if (want && !e.running) { e.running = true; e.integration.start(); }
          else if (!want && e.running) {
            e.running = false;
            e.integration.stop(); e.integration.cleanup();
            // Executed vendor code cannot be reliably unloaded; reload a clean page when it says so.
            if (e.integration.reloadOnWithdraw) onWithdrawReload();
          }
        } catch (err) { e.running = false; }
      });
    }
    return {
      register: function (integration) {
        if (!integration || typeof integration.id !== 'string' || OPTIONAL.indexOf(integration.category) < 0 ||
          ['start', 'stop', 'cleanup'].some(function (f) { return typeof integration[f] !== 'function'; })) {
          throw new Error('Invalid consent integration');
        }
        if (entries[integration.id]) throw new Error('Consent integration already registered: ' + integration.id);
        entries[integration.id] = { integration: integration, running: false };
        reconcile();
      },
      reconcile: reconcile,
      running: function () { return Object.keys(entries).filter(function (id) { return entries[id].running; }); }
    };
  }

  var core = { validate: validate, build: build, mayStart: mayStart, createRegistry: createRegistry, COOKIE: COOKIE, OPTIONAL: OPTIONAL };
  root.FarmConsentCore = core;
  if (typeof document === 'undefined' || !document.createElement) return;

  /* ---- Browser wiring ---- */
  var cfg = null, state = null, reloadPending = false;
  var registry = createRegistry(function () { return state; }, function () { return cfg; }, function () { reloadPending = true; });

  function readCookie() {
    try {
      var parts = document.cookie.split(';');
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i].trim();
        if (p.indexOf(COOKIE + '=') === 0) return decodeURIComponent(p.slice(COOKIE.length + 1));
      }
    } catch (e) { /* unreadable storage means no decision */ }
    return null;
  }
  function writeCookie(value, seconds) {
    document.cookie = COOKIE + '=' + encodeURIComponent(value) + '; Path=/; Secure; SameSite=Lax; Max-Age=' + seconds;
  }
  function receipt() {
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function usedOptional() {
    return cfg.categories.filter(function (c) { return OPTIONAL.indexOf(c.id) >= 0; });
  }
  function decide(decision, categories) {
    var next = build(cfg, categories, decision, Date.now(), receipt());
    try { writeCookie(JSON.stringify(next), cfg.decisionDays * 86400); } catch (e) { next = build(cfg, {}, 'reject_optional', Date.now(), receipt()); }
    state = next;
    registry.reconcile();
    closeBanner();
    if (reloadPending) { location.reload(); }
  }
  function acceptAll() { var all = {}; usedOptional().forEach(function (c) { all[c.id] = true; }); decide('accept_all', all); }
  function rejectOptional() { decide('reject_optional', {}); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k]; else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }
  function button(label, onclick, cls) {
    var b = el('button', { type: 'button', 'class': 'button consent-button ' + (cls || ''), text: label });
    b.addEventListener('click', onclick);
    return b;
  }
  function links() {
    return el('p', { 'class': 'consent-links' }, [
      el('a', { href: cfg.policies.cookie, text: 'Cookie Policy' }), document.createTextNode(' · '),
      el('a', { href: cfg.policies.privacy, text: 'Privacy Policy' })
    ]);
  }

  var banner = null, dialog = null;
  function closeBanner() { if (banner) { banner.remove(); banner = null; } }

  function showBanner() {
    if (banner || !usedOptional().length) return;
    // Equal prominence for Accept and Reject, all on the first layer, no close button, no preselection.
    banner = el('section', { 'class': 'consent-banner', 'aria-label': 'Cookie preferences' }, [
      el('h2', { text: 'Cookie preferences' }),
      el('p', { text: 'We use necessary cookies to keep this website working. With your permission, we also use optional technologies listed in our Cookie Policy. You can accept all optional categories, reject them, or choose your preferences. You can change your choice at any time through Cookie Settings.' }),
      links(),
      el('div', { 'class': 'consent-actions' }, [button('Accept All', acceptAll), button('Reject Optional', rejectOptional), button('Customize', openSettings)])
    ]);
    document.body.appendChild(banner);
  }

  function openSettings() {
    if (!cfg) { location.assign('/cookie-policy'); return; }
    if (dialog) dialog.remove();
    var optional = usedOptional(), boxes = {};
    var body = [el('h2', { id: 'consent-title', text: 'Cookie Settings' })];
    cfg.categories.forEach(function (c) {
      var head = [el('h3', { text: c.label }), el('p', { text: c.description })];
      if (c.id === 'necessary') head.push(el('p', { 'class': 'consent-fixed', text: 'Always on' }));
      else {
        var box = el('input', { type: 'checkbox', id: 'consent-' + c.id });
        box.checked = !!(state && state.categories[c.id]);
        boxes[c.id] = box;
        head.push(el('label', { 'for': 'consent-' + c.id }, [box, document.createTextNode(' Allow ' + c.label.toLowerCase())]));
      }
      if (c.items.length) head.push(el('ul', {}, c.items.map(function (i) {
        return el('li', { text: i.name + ' — ' + i.purpose + ' (' + i.provider + '; ' + i.lifetime + ')' });
      })));
      body.push(el('section', {}, head));
    });
    if (!optional.length) body.push(el('p', { text: 'This site does not use any optional cookies or similar technologies, so there is nothing to opt in or out of.' }));
    if (cfg.gpc) body.push(el('p', { 'class': 'consent-gpc', text: 'Global Privacy Control signal detected: it is treated as an opt-out of sale/sharing and targeted advertising, and a general acceptance does not override it.' }));
    body.push(links());
    var actions = [];
    if (optional.length) {
      actions.push(button('Save Preferences', function () {
        var chosen = {}, any = false;
        optional.forEach(function (c) { chosen[c.id] = boxes[c.id].checked; any = any || boxes[c.id].checked; });
        decide(any ? 'custom' : 'reject_optional', chosen); close();
      }));
      actions.push(button('Accept All', function () { acceptAll(); close(); }));
      actions.push(button('Reject Optional', function () { rejectOptional(); close(); }));
    }
    actions.push(button('Close', function () { close(); }, 'consent-secondary'));
    body.push(el('div', { 'class': 'consent-actions' }, actions));
    dialog = el('dialog', { 'class': 'consent-dialog', 'aria-labelledby': 'consent-title' }, body);
    function close() { if (dialog) { dialog.close(); dialog.remove(); dialog = null; } }
    document.body.appendChild(dialog);
    // The native modal dialog traps focus, closes on Escape (leaving choices unchanged) and restores focus.
    dialog.addEventListener('close', function () { if (dialog) { dialog.remove(); dialog = null; } });
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
  }

  document.addEventListener('click', function (event) {
    var target = event.target && event.target.closest ? event.target.closest('[data-consent-open]') : null;
    if (target) { event.preventDefault(); openSettings(); }
  });

  fetch('/consent-config.json', { credentials: 'omit', cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('config'); return r.json(); })
    .then(function (loaded) {
      cfg = loaded;
      state = validate(readCookie(), cfg, Date.now());
      // GPC from the browser wins even if the server header was not seen (e.g. a cached shell).
      if (root.navigator && root.navigator.globalPrivacyControl === true) cfg.gpc = true;
      registry.reconcile();
      if (!state && !cfg.killSwitch) showBanner();
    })
    .catch(function () { cfg = null; state = null; });

  root.FarmConsent = {
    register: registry.register,
    open: openSettings,
    state: function () { return state; },
    running: registry.running
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
