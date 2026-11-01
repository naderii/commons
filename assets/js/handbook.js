/* Linux Sysadmin Handbook — تعاملات سمت کلاینت
   ۱) چک‌لیست‌های ماندگار (+ ریست روزانه و «کپی گزارش»)
   ۲) فیلتر برگه تقلب
   ۳) نام کاربر واردشده (SSO) + دکمهٔ خروج — از /oauth2/userinfo در oauth2-proxy */
(function () {
  'use strict';

  var NS = 'hb:v1:';

  function getStorage() {
    try {
      var k = '__hb_test';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return window.localStorage;
    } catch (e) { return null; }
  }
  var ls = getStorage();

  function read(key) {
    if (!ls) return null;
    try { return JSON.parse(ls.getItem(key)); } catch (e) { return null; }
  }
  function write(key, val) {
    if (!ls) return;
    try { ls.setItem(key, JSON.stringify(val)); } catch (e) { /* پر یا ممنوع: بی‌صدا */ }
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  function copyText(text, done) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      done(ok);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else { fallback(); }
  }

  /* ───── ۱) چک‌لیست‌ها ───── */
  function initChecklist(root, ul, index) {
    var items = ul.querySelectorAll('li.task-list-item');
    if (!items.length) return;

    var box = root || ul;
    var daily = !!(root && root.getAttribute('data-hb-reset') === 'daily');
    var title = (root && root.getAttribute('data-hb-title')) ||
      (document.querySelector('h1') ? document.querySelector('h1').textContent.replace(/¶/g, '').trim() : 'چک‌لیست');
    var key = NS + location.pathname + '#' + index;
    var state = read(key) || { day: today(), done: {} };
    if (daily && state.day !== today()) state = { day: today(), done: {} };

    var rows = [];
    Array.prototype.forEach.call(items, function (li) {
      var input = li.querySelector('input[type="checkbox"]');
      if (!input) return;
      var label = li.textContent.replace(/\s+/g, ' ').trim();
      input.disabled = false;
      input.removeAttribute('disabled');
      rows.push({ li: li, input: input, label: label });
    });

    var bar = document.createElement('div');
    bar.className = 'hb-checklist__bar';
    var progress = document.createElement('span');
    progress.className = 'hb-checklist__progress';
    progress.setAttribute('aria-live', 'polite');
    var meter = document.createElement('span');
    meter.className = 'hb-checklist__meter';
    var fill = document.createElement('span');
    meter.appendChild(fill);
    var btnReset = document.createElement('button');
    btnReset.type = 'button';
    btnReset.className = 'hb-btn';
    btnReset.textContent = 'پاک‌کردن تیک‌ها';
    bar.appendChild(progress);
    bar.appendChild(meter);
    bar.appendChild(btnReset);

    var btnCopy = null;
    if (root) {
      btnCopy = document.createElement('button');
      btnCopy.type = 'button';
      btnCopy.className = 'hb-btn hb-btn--primary';
      btnCopy.textContent = 'کپی گزارش';
      bar.appendChild(btnCopy);
    }
    box.insertBefore(bar, box.firstChild);

    function render() {
      var n = 0;
      rows.forEach(function (r) {
        var on = !!state.done[r.label];
        r.input.checked = on;
        r.li.classList.toggle('is-done', on);
        if (on) n++;
      });
      progress.textContent = n + ' از ' + rows.length;
      fill.style.width = (rows.length ? Math.round(100 * n / rows.length) : 0) + '%';
      box.classList.toggle('is-complete', n === rows.length && n > 0);
    }
    function save() { state.day = today(); write(key, state); }

    rows.forEach(function (r) {
      /* چک‌باکس سفارشی Material عرض صفر دارد و با کلیک مستقیم کار نمی‌کند؛ کل سطر را کلیک‌پذیر می‌کنیم */
      r.li.classList.add('hb-clickable');
      r.li.addEventListener('click', function (e) {
        if (e.target.closest('a, button, input, label')) return;
        r.input.checked = !r.input.checked;
        r.input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      r.input.addEventListener('change', function () {
        if (r.input.checked) { state.done[r.label] = hhmm(new Date()); }
        else { delete state.done[r.label]; }
        save();
        render();
      });
    });

    btnReset.addEventListener('click', function () {
      if (Object.keys(state.done).length && !window.confirm('همهٔ تیک‌های این چک‌لیست پاک شود؟')) return;
      state = { day: today(), done: {} };
      save();
      render();
    });

    if (btnCopy) {
      btnCopy.addEventListener('click', function () {
        var now = new Date();
        var lines = [title + ' — ' + today() + ' ' + hhmm(now)];
        var n = 0;
        rows.forEach(function (r) {
          var t = state.done[r.label];
          if (t) { n++; lines.push('✅ ' + r.label + ' (' + t + ')'); }
          else { lines.push('⬜ ' + r.label + ' — انجام نشد/بررسی نشد'); }
        });
        lines.push('جمع: ' + n + '/' + rows.length);
        copyText(lines.join('\n'), function (ok) {
          var old = btnCopy.textContent;
          btnCopy.textContent = ok ? 'کپی شد ✓' : 'کپی ناموفق؛ دستی انتخاب کنید';
          window.setTimeout(function () { btnCopy.textContent = old; }, 2000);
        });
      });
    }

    if (!ls) {
      var note = document.createElement('p');
      note.className = 'hb-checklist__note';
      note.textContent = 'ذخیرهٔ محلی مرورگر در دسترس نیست؛ تیک‌ها فقط تا بستن صفحه می‌مانند.';
      box.insertBefore(note, bar.nextSibling);
    }
    render();
  }

  function initChecklists() {
    var index = 0;
    var seen = [];
    Array.prototype.forEach.call(document.querySelectorAll('.hb-checklist'), function (root) {
      var ul = root.querySelector('ul.task-list');
      if (!ul) return;
      seen.push(ul);
      initChecklist(root, ul, index++);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.md-typeset ul.task-list'), function (ul) {
      if (seen.indexOf(ul) !== -1) return;
      initChecklist(null, ul, index++);
    });
  }

  /* ───── ۲) فیلتر برگه تقلب ───── */
  function initFilter() {
    var host = document.getElementById('hb-filter');
    if (!host) return;
    var article = host.closest('.md-typeset') || document.querySelector('.md-content__inner');
    if (!article) return;

    var input = document.createElement('input');
    input.type = 'search';
    input.className = 'hb-filter__input';
    input.setAttribute('aria-label', 'فیلتر برگه تقلب');
    input.placeholder = host.getAttribute('data-placeholder') || 'فیلتر…';
    input.setAttribute('autocomplete', 'off');
    var empty = document.createElement('p');
    empty.className = 'hb-filter__empty';
    empty.hidden = true;
    empty.textContent = 'موردی پیدا نشد.';
    host.appendChild(input);
    host.appendChild(empty);

    var groups = [];
    var current = null;
    Array.prototype.forEach.call(article.children, function (el) {
      if (el === host || el.classList.contains('headerlink')) return;
      if (el.tagName === 'H2') { current = { els: [el], text: '' }; groups.push(current); }
      else if (current) { current.els.push(el); }
    });
    groups.forEach(function (g) {
      g.text = g.els.map(function (e) { return e.textContent; }).join(' ').toLowerCase();
    });

    function apply() {
      var q = input.value.trim().toLowerCase();
      var terms = q ? q.split(/\s+/) : [];
      var shown = 0;
      groups.forEach(function (g) {
        var ok = terms.every(function (t) { return g.text.indexOf(t) !== -1; });
        g.els.forEach(function (e) { e.hidden = !ok; });
        if (ok) shown++;
      });
      empty.hidden = shown !== 0;
    }
    input.addEventListener('input', apply);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { input.value = ''; apply(); }
    });
  }

  /* ───── ۳) نام کاربر و خروج (oauth2-proxy) ───── */
  // /oauth2/userinfo اطلاعات نشست فعلی را برمی‌گرداند.
  // /logout یک location در Nginx است که نشست oauth2-proxy
  // و نشست Keycloak را هر دو می‌بندد.
  var USERINFO_URL = '/oauth2/userinfo';
  var LOGOUT_URL = '/logout';

  function displayValue(value) {
    if (typeof value !== 'string') return '';
    var text = value.trim();
    var isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text);
    return isUuid ? '' : text;
  }

  function initUser() {
    var inner = document.querySelector('.md-header__inner');
    if (!inner || inner.querySelector('.hb-welcome') || !window.fetch) return;

    fetch(USERINFO_URL, { credentials: 'same-origin', cache: 'no-store', headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (info) {
        if (!info) return;

        var email = displayValue(info.email);

        // در خروجی فعلی شما، نام فارسی در email و شناسهٔ UUID در user است.
        // اگر بعدها نگاشت claimها اصلاح شود، name همچنان اولویت دارد.
        var name = displayValue(info.name) ||
          (email.indexOf('@') === -1 ? email : '') ||
          displayValue(info.preferredUsername) ||
          displayValue(info.preferred_username) ||
          email ||
          displayValue(info.user);

        if (!name) return;

        // سمت راست (اول هدر در RTL): «خوش آمدید، نام»
        var welcome = document.createElement('div');
        welcome.className = 'hb-welcome';
        welcome.title = email.indexOf('@') !== -1 ? email : name;

        var hello = document.createElement('span');
        hello.className = 'hb-welcome__hello';
        hello.textContent = 'خوش آمدید،';

        var who = document.createElement('bdi');
        who.className = 'hb-welcome__name';
        who.textContent = name;

        welcome.appendChild(hello);
        welcome.appendChild(who);

        // سمت چپ (آخرین آیتم هدر در RTL): دکمهٔ خروج
        var out = document.createElement('a');
        out.className = 'hb-logout-btn';
        out.href = LOGOUT_URL;
        out.setAttribute('role', 'button');
        out.setAttribute('aria-label', 'خروج از حساب ' + name);
        out.innerHTML =
          '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">' +
          '<path fill="currentColor" d="M16 17v-3H9v-4h7V7l5 5-5 5M14 2a2 2 0 0 1 2 2v2h-2V4H5v16h9v-2h2v2a2 2 0 0 1-2-2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9Z"/></svg>' +
          '<span class="hb-logout-btn__text">خروج</span>';

        var logo = inner.querySelector('.md-logo');
        if (logo && logo.nextSibling) inner.insertBefore(welcome, logo.nextSibling);
        else inner.insertBefore(welcome, inner.firstChild);
        inner.appendChild(out);
      })
      .catch(function () { /* خطای درخواست: سایت بدون نام کاربر هم کار می‌کند */ });
  }

  function boot() {
    initChecklists();
    initFilter();
    initUser();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
