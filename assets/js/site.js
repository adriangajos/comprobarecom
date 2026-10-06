/* comprobare.com shared behaviour: nav, reveal, counters, lightbox, confetti, cookies */
(function () {
  'use strict';
  var doc = document.documentElement;
  doc.classList.remove('no-js');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.CMP = window.CMP || {};
  CMP.reduceMotion = reduceMotion;

  /* ── Nav ─────────────────────────────────────────── */
  var nav = document.querySelector('.site-nav');
  if (nav) {
    var onScroll = function () { nav.classList.toggle('scrolled', window.scrollY > 8); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
  var burger = document.getElementById('nav-burger');
  var navLinks = document.getElementById('nav-links');
  if (burger && navLinks) {
    burger.addEventListener('click', function () {
      var open = navLinks.classList.toggle('open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    navLinks.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        navLinks.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
      });
    });
  }
  // Highlight the nav link of the section in view
  var navAnchors = navLinks ? Array.prototype.slice.call(navLinks.querySelectorAll('a[href^="#"]')) : [];
  if (navAnchors.length && 'IntersectionObserver' in window) {
    var byId = {};
    navAnchors.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var secObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        navAnchors.forEach(function (a) { a.classList.remove('active'); });
        var a = byId[en.target.id];
        if (a) a.classList.add('active');
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(byId).forEach(function (id) { var s = document.getElementById(id); if (s) secObs.observe(s); });
  }

  /* ── Count-up numbers ────────────────────────────── */
  function formatNum(v, dec) {
    var parts = v.toFixed(dec).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return parts.join('.');
  }
  CMP.formatNum = formatNum;
  var counted = new WeakSet();
  function startCount(el) {
    if (counted.has(el)) return;
    counted.add(el);
    var target = parseFloat(el.getAttribute('data-count'));
    var dec = parseInt(el.getAttribute('data-decimals') || '0', 10);
    var delay = parseInt(el.getAttribute('data-delay') || '0', 10);
    if (isNaN(target)) return;
    if (reduceMotion) { el.textContent = formatNum(target, dec); return; }
    var dur = parseInt(el.getAttribute('data-duration') || '1500', 10);
    setTimeout(function () {
      var t0 = performance.now();
      (function tick(now) {
        var p = Math.min(1, (now - t0) / dur);
        el.textContent = formatNum(target * (1 - Math.pow(1 - p, 4)), dec);
        if (p < 1) requestAnimationFrame(tick);
      })(t0);
    }, delay);
  }
  CMP.startCount = startCount;

  /* ── Reveal on scroll ────────────────────────────── */
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add('visible');
        if (en.target.hasAttribute('data-count')) startCount(en.target);
        en.target.querySelectorAll('[data-count]').forEach(startCount);
        io.unobserve(en.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -5% 0px' });
    document.querySelectorAll('.reveal, [data-count]').forEach(function (el) { io.observe(el); });
  } else {
    document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('visible'); });
  }

  /* ── Spotlight cards (cursor glow) ───────────────── */
  document.querySelectorAll('[data-spotlight]').forEach(function (card) {
    card.addEventListener('pointermove', function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });

  /* ── Lightbox ────────────────────────────────────── */
  var lbItems = Array.prototype.slice.call(document.querySelectorAll('[data-lightbox]'));
  if (lbItems.length) {
    var lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('aria-label', 'Screenshot viewer');
    lb.innerHTML =
      '<div class="lightbox-stage"><img alt="" /></div>' +
      '<p class="lightbox-cap"></p>' +
      '<button class="lb-btn lb-close" type="button" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '<button class="lb-btn lb-prev" type="button" aria-label="Previous"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>' +
      '<button class="lb-btn lb-next" type="button" aria-label="Next"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>';
    document.body.appendChild(lb);
    var stage = lb.querySelector('.lightbox-stage');
    var lbImg = lb.querySelector('img');
    var lbCap = lb.querySelector('.lightbox-cap');
    var idx = 0, zoomed = false, lastFocus = null;

    var show = function (i) {
      idx = (i + lbItems.length) % lbItems.length;
      var el = lbItems[idx];
      var src = el.getAttribute('data-lightbox') || el.currentSrc || el.src;
      lbImg.src = src;
      lbImg.alt = el.getAttribute('alt') || '';
      lbCap.textContent = el.getAttribute('data-caption') || el.getAttribute('alt') || '';
      setZoom(false);
      lbImg.onload = function () { stage.classList.toggle('no-zoom', maxZoom() < 1.15); };
      // restart the entry animation
      lbImg.style.animation = 'none'; void lbImg.offsetWidth; lbImg.style.animation = '';
    };
    // never zoom past the image's own pixels, otherwise it turns blurry
    var maxZoom = function () {
      var w = lbImg.getBoundingClientRect().width || 1;
      return Math.min(2.2, lbImg.naturalWidth / w);
    };
    var setZoom = function (z, e) {
      if (z && maxZoom() < 1.15) z = false;
      zoomed = z;
      stage.classList.toggle('zoomed', z);
      if (!z) { lbImg.style.transform = ''; return; }
      panTo(e);
    };
    var panTo = function (e) {
      if (!zoomed) return;
      var r = stage.getBoundingClientRect();
      var px = e ? (e.clientX - r.left) / r.width : 0.5;
      var py = e ? (e.clientY - r.top) / r.height : 0.5;
      lbImg.style.transformOrigin = (px * 100) + '% ' + (py * 100) + '%';
      lbImg.style.transform = 'scale(' + maxZoom() + ')';
    };
    var open = function (i) {
      lastFocus = document.activeElement;
      show(i);
      lb.classList.add('open');
      document.body.style.overflow = 'hidden';
      lb.querySelector('.lb-close').focus();
    };
    var close = function () {
      lb.classList.remove('open');
      document.body.style.overflow = '';
      if (lastFocus) lastFocus.focus();
    };
    lbItems.forEach(function (el, i) {
      if (!el.hasAttribute('tabindex') && el.tagName !== 'A' && el.tagName !== 'BUTTON') el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.addEventListener('click', function (e) { e.preventDefault(); open(i); });
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(i); } });
    });
    stage.addEventListener('click', function (e) { e.stopPropagation(); setZoom(!zoomed, e); });
    stage.addEventListener('pointermove', panTo);
    lb.addEventListener('click', close);
    lb.querySelector('.lb-close').addEventListener('click', function (e) { e.stopPropagation(); close(); });
    lb.querySelector('.lb-prev').addEventListener('click', function (e) { e.stopPropagation(); show(idx - 1); });
    lb.querySelector('.lb-next').addEventListener('click', function (e) { e.stopPropagation(); show(idx + 1); });
    if (lbItems.length < 2) { lb.querySelector('.lb-prev').hidden = true; lb.querySelector('.lb-next').hidden = true; }
    document.addEventListener('keydown', function (e) {
      if (!lb.classList.contains('open')) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') show(idx - 1);
      else if (e.key === 'ArrowRight') show(idx + 1);
      else if (e.key === 'Tab') {
        // keep focus inside the dialog
        var f = Array.prototype.slice.call(lb.querySelectorAll('button:not([hidden])'));
        var i = f.indexOf(document.activeElement);
        e.preventDefault();
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
    });
  }

  /* ── Confetti ────────────────────────────────────── */
  var COLORS = ['#0078d4', '#4fc3f7', '#f59e0b', '#4ade80', '#c084fc', '#ffffff'];
  CMP.confetti = function (x, y, opts) {
    if (reduceMotion) return;
    opts = opts || {};
    var count = opts.count || 140;
    var canvas = document.createElement('canvas');
    canvas.className = 'confetti-canvas';
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    document.body.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    var parts = [];
    for (var i = 0; i < count; i++) {
      var ang = (opts.spread ? -Math.PI / 2 + (Math.random() - 0.5) * opts.spread : Math.random() * Math.PI * 2);
      var sp = 4 + Math.random() * (opts.power || 9);
      parts.push({
        x: x, y: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - (opts.spread ? 3 : 2),
        w: 5 + Math.random() * 6, h: 3 + Math.random() * 5, r: Math.random() * 6,
        vr: (Math.random() - 0.5) * 0.35, c: COLORS[(Math.random() * COLORS.length) | 0],
        shape: Math.random() < 0.25 ? 'line' : 'rect', life: 0
      });
    }
    var t0 = performance.now();
    (function frame(now) {
      var el = now - t0;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      parts.forEach(function (p) {
        p.vy += 0.22; p.vx *= 0.985; p.vy *= 0.985;
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - el / 2600);
        ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.c; ctx.strokeStyle = p.c;
        if (p.shape === 'rect') ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        else { ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-p.w, 0); ctx.lineTo(p.w, 0); ctx.stroke(); }
        ctx.restore();
      });
      if (el < 2700) requestAnimationFrame(frame); else canvas.remove();
    })(t0);
  };
  // Fireworks on every download button (the download itself carries on normally)
  document.querySelectorAll('[data-download]').forEach(function (a) {
    a.addEventListener('click', function () {
      var r = a.getBoundingClientRect();
      CMP.confetti(r.left + r.width / 2, r.top + r.height / 2, { count: 160, spread: Math.PI * 1.1, power: 12 });
    });
  });

  /* ── Legal docs: table of contents ───────────────── */
  var tocBox = document.querySelector('.doc-toc');
  var docBody = document.querySelector('.doc');
  if (tocBox && docBody) {
    var heads = docBody.querySelectorAll('h2');
    var links = [];
    heads.forEach(function (h, i) {
      if (!h.id) h.id = 's' + (i + 1);
      var a = document.createElement('a');
      a.href = '#' + h.id;
      a.textContent = h.textContent.replace(/^\s*\d+[.)]?\s*/, '');
      tocBox.appendChild(a);
      links.push(a);
    });
    if ('IntersectionObserver' in window) {
      var tocObs = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          links.forEach(function (l) { l.classList.toggle('active', l.getAttribute('href') === '#' + en.target.id); });
        });
      }, { rootMargin: '-20% 0px -70% 0px' });
      heads.forEach(function (h) { tocObs.observe(h); });
    }
  }

  /* ── Cookie consent ──────────────────────────────── */
  (function () {
    var KEY = 'comprobare-cookie-consent';
    function applyConsent(v) {
      window.comprobareConsent = v;
      // Non-essential cookies (e.g. analytics) must load ONLY when v === 'accepted'.
      // TODO: when adding analytics, gate its loader here: if (v === 'accepted') { loadAnalytics(); }
    }
    var saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) {}
    if (saved) { applyConsent(saved); return; }
    var bar = document.createElement('div');
    bar.className = 'cookie-bar';
    bar.id = 'cookie-notice';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'Cookie consent');
    bar.innerHTML =
      '<div class="cookie-inner">' +
      '<p>We use cookies. Essential ones keep the site running and, if you agree, analytics cookies help us see how the site is used so we can improve it.</p>' +
      '<div class="cookie-actions">' +
      '<a href="privacy.html">Privacy policy</a>' +
      '<button class="btn btn-ghost btn-sm" type="button" id="cookie-reject">Reject non-essential</button>' +
      '<button class="btn btn-primary btn-sm" type="button" id="cookie-accept">Accept all</button>' +
      '</div></div>';
    document.body.appendChild(bar);
    bar.classList.add('show');
    function choose(v) {
      try { localStorage.setItem(KEY, v); } catch (e) {}
      applyConsent(v);
      bar.classList.remove('show');
    }
    bar.querySelector('#cookie-accept').addEventListener('click', function () { choose('accepted'); });
    bar.querySelector('#cookie-reject').addEventListener('click', function () { choose('rejected'); });
  })();
})();
