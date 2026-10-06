/* comprobare.com homepage: hero, live measuring demo, Marking slider, scroll story */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var SVGNS = 'http://www.w3.org/2000/svg';
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function fmt(v, d) { return window.CMP && CMP.formatNum ? CMP.formatNum(v, d) : v.toFixed(d); }

  /* ════ HERO ═══════════════════════════════════════ */
  (function hero() {
    var hero = $('.hero');
    if (!hero) return;
    // self-drawing blueprint
    if (!reduce) {
      $$('.hero-blueprint path').forEach(function (p, i) {
        var len = Math.ceil(p.getTotalLength ? p.getTotalLength() : 1200);
        p.style.setProperty('--len', len);
        p.style.setProperty('--d', (0.25 + i * 0.16) + 's');
      });
      hero.classList.add('js-draw');
    }
    var grid = $('.hero-grid-bg');
    var tilt = $('#hero-tilt');
    var glare = $('.hero-glare');
    if (reduce || !finePointer) return;
    var raf = 0, mx = 0.5, my = 0.5;
    hero.addEventListener('pointermove', function (e) {
      var r = hero.getBoundingClientRect();
      mx = (e.clientX - r.left) / r.width;
      my = (e.clientY - r.top) / r.height;
      if (!raf) raf = requestAnimationFrame(apply);
    });
    hero.addEventListener('pointerleave', function () { mx = 0.62; my = 0.4; if (!raf) raf = requestAnimationFrame(apply); });
    function apply() {
      raf = 0;
      grid.style.setProperty('--gx', (mx * 100) + '%');
      grid.style.setProperty('--gy', (my * 100) + '%');
      tilt.style.setProperty('--ry', (-8 + (mx - 0.5) * 14).toFixed(2) + 'deg');
      tilt.style.setProperty('--rx', (4 - (my - 0.5) * 9).toFixed(2) + 'deg');
      glare.style.setProperty('--glx', (mx * 100) + '%');
      glare.style.setProperty('--gly', (my * 100) + '%');
    }
  })();

  /* ════ MARQUEE ════════════════════════════════════ */
  $$('.marquee').forEach(function (m) {
    var track = $('.marquee-track', m);
    track.innerHTML += track.innerHTML; // seamless loop
    $$('span', track).slice(track.children.length / 2).forEach(function (s) { s.setAttribute('aria-hidden', 'true'); });
    m.style.setProperty('--dur', (m.getAttribute('data-speed') || 50) + 's');
    track.style.setProperty('--dur', (m.getAttribute('data-speed') || 50) + 's');
  });

  /* ════ LIVE DEMO ══════════════════════════════════ */
  var DRAWINGS = {
    building: {
      ppm: 80, scale: 'scale 1:50 · unit m', ghost: [[520, 60], [900, 60], [900, 300], [520, 300]],
      ghostName: 'Bedroom',
      hint: { area: 'Click the corners of a room, then the first point again. The area appears once the shape is closed.', length: 'Click along a wall, then double-click or press Finish to get the length.', count: 'Click every door or window you want to count.' },
      draw: function (g) {
        // walls
        [
          'M100 60 H900 V540 H100 Z', 'M520 60 V170 M520 230 V540', 'M520 300 H600 M660 300 H900', 'M700 300 V400 M700 460 V540'
        ].forEach(function (d) { el('path', { d: d, class: 'dw dw-wall' }, g); });
        // windows
        [[180, 60, 320, 60], [640, 60, 800, 60], [900, 120, 900, 240], [100, 200, 100, 380], [240, 540, 400, 540]].forEach(function (w) {
          var v = w[0] === w[2];
          for (var o = -4; o <= 4; o += 4) {
            el('line', v ? { x1: w[0] + o, y1: w[1], x2: w[2] + o, y2: w[3], class: 'dw dw-thin' } : { x1: w[0], y1: w[1] + o, x2: w[2], y2: w[3] + o, class: 'dw dw-thin' }, g);
          }
        });
        // doors (leaf + swing)
        [['M520 170 L460 170', 'M460 170 A60 60 0 0 0 520 230'], ['M600 300 L600 240', 'M600 240 A60 60 0 0 1 660 300'], ['M700 400 L760 400', 'M760 400 A60 60 0 0 1 700 460'], ['M820 540 L820 480', 'M820 480 A60 60 0 0 1 880 540']].forEach(function (d) {
          el('path', { d: d[0], class: 'dw dw-thin' }, g); el('path', { d: d[1], class: 'dw dw-thin dw-dash' }, g);
        });
        // furniture
        ['M120 80 h170 v40 h-130 v110 h-40 Z', 'M130 420 h170 v70 h-170 Z', 'M150 430 h150 M150 480 h150', 'M690 110 h150 v170 h-150 Z', 'M690 140 h150', 'M540 470 h140 v55 h-140 Z', 'M640 320 a20 18 0 1 0 1 0', 'M560 320 h44 v40 h-44 Z', 'M380 280 a46 46 0 1 0 1 0'].forEach(function (d) {
          el('path', { d: d, class: 'dw dw-thin' }, g);
        });
        // dimensions
        el('path', { d: 'M100 30 H900 M100 22 V38 M900 22 V38', class: 'dw dw-dim' }, g);
        el('text', { x: 500, y: 24, class: 'dw-dimtxt' }, g).textContent = '10.00';
        el('path', { d: 'M960 60 V540 M952 60 H968 M952 540 H968', class: 'dw dw-dim' }, g);
        el('text', { x: 978, y: 304, class: 'dw-dimtxt', transform: 'rotate(-90 978 304)' }, g).textContent = '6.00';
        [['LIVING ROOM', 300, 340], ['KITCHEN', 210, 160], ['BEDROOM', 710, 200], ['BATH', 610, 420], ['HALL', 800, 360]].forEach(function (t) {
          el('text', { x: t[1], y: t[2], class: 'dw-txt', 'text-anchor': 'middle' }, g).textContent = t[0];
        });
      },
      snaps: [[100, 60], [520, 60], [900, 60], [100, 540], [520, 540], [700, 540], [900, 540], [520, 300], [700, 300], [900, 300], [520, 170], [520, 230], [600, 300], [660, 300], [700, 400], [700, 460], [180, 60], [320, 60], [640, 60], [800, 60], [900, 120], [900, 240], [100, 200], [100, 380], [240, 540], [400, 540], [820, 540], [880, 540]]
    },
    boat: {
      ppm: 90, scale: 'scale 1:20 · unit m', ghost: [[465, 85], [465, 370], [250, 370]],
      ghostName: 'Mainsail',
      hint: { area: 'Trace a sail or the hull, then click the first point again to get the area.', length: 'Click along the sheer line or the mast, then double-click or press Finish.', count: 'Click the cleats, hatches or winches you want to count.' },
      draw: function (g) {
        ['M120 400 L900 385 L870 450 L700 470 L450 476 L250 468 L140 455 Z', 'M430 476 L410 560 L520 560 L510 474', 'M180 462 L165 535 L190 535 L205 465', 'M470 385 L470 70', 'M465 85 L465 370 L250 370 Z', 'M478 100 L850 380 L560 372 Z', 'M330 393 L360 352 L560 348 L600 389', 'M470 72 L895 386', 'M470 72 L140 400'].forEach(function (d, i) {
          el('path', { d: d, class: 'dw' + (i > 6 ? ' dw-thin' : '') }, g);
        });
        el('path', { d: 'M60 455 H960', class: 'dw dw-cyan dw-dash' }, g);
        el('text', { x: 70, y: 447, class: 'dw-txt-y' }, g).textContent = 'DWL';
        el('text', { x: 300, y: 300, class: 'dw-txt-y' }, g).textContent = 'MAIN SAIL';
        el('text', { x: 600, y: 330, class: 'dw-txt-y' }, g).textContent = 'JIB (100%)';
        [[390, 368], [520, 366], [700, 392], [250, 398]].forEach(function (p) { el('rect', { x: p[0] - 6, y: p[1] - 4, width: 12, height: 8, class: 'dw dw-thin' }, g); });
        el('path', { d: 'M120 590 H900 M120 582 V598 M900 582 V598', class: 'dw dw-dim' }, g);
        el('text', { x: 510, y: 584, class: 'dw-dimtxt' }, g).textContent = 'LOA 8.67';
      },
      snaps: [[120, 400], [900, 385], [870, 450], [700, 470], [450, 476], [250, 468], [140, 455], [430, 476], [410, 560], [520, 560], [510, 474], [180, 462], [165, 535], [190, 535], [205, 465], [470, 385], [470, 70], [465, 85], [465, 370], [250, 370], [478, 100], [850, 380], [560, 372], [330, 393], [360, 352], [560, 348], [600, 389], [895, 386], [390, 368], [520, 366], [700, 392], [250, 398]]
    },
    frame: {
      ppm: 40, scale: 'scale 1:100 · unit m', ghost: [[100, 300], [500, 180], [900, 300]],
      ghostName: 'Gable',
      hint: { area: 'Trace a wall, the gable or an opening, then click the first point again to get the area.', length: 'Click node to node along a steel member, then double-click or press Finish.', count: 'Click every node, bolt group or column base you want to count.' },
      draw: function (g) {
        el('path', { d: 'M100 540 V300 L500 180 L900 300 V540', class: 'dw' }, g);
        el('path', { d: 'M100 300 H900', class: 'dw' }, g);
        var x, yTop;
        for (x = 200; x <= 800; x += 100) {
          yTop = x <= 500 ? 300 - (x - 100) * 0.3 : 180 + (x - 500) * 0.3;
          el('path', { d: 'M' + x + ' 300 V' + yTop, class: 'dw dw-thin' }, g);
        }
        for (x = 100; x < 900; x += 100) {
          var a = x, b = x + 100;
          var ya = a <= 500 ? 300 - (a - 100) * 0.3 : 180 + (a - 500) * 0.3;
          var yb = b <= 500 ? 300 - (b - 100) * 0.3 : 180 + (b - 500) * 0.3;
          el('path', { d: b <= 500 ? 'M' + a + ' 300 L' + b + ' ' + yb : 'M' + a + ' ' + ya + ' L' + b + ' 300', class: 'dw dw-thin' }, g);
        }
        el('path', { d: 'M420 540 V400 H580 V540', class: 'dw' }, g);
        el('path', { d: 'M180 380 H300 V440 H180 Z M700 380 H820 V440 H700 Z', class: 'dw' }, g);
        el('path', { d: 'M60 540 H940', class: 'dw dw-cyan' }, g);
        for (x = 70; x < 940; x += 22) el('path', { d: 'M' + x + ' 552 l12 -12', class: 'dw dw-thin' }, g);
        el('path', { d: 'M100 580 H900 M100 572 V588 M900 572 V588', class: 'dw dw-dim' }, g);
        el('text', { x: 500, y: 574, class: 'dw-dimtxt' }, g).textContent = '20.00';
        el('path', { d: 'M50 300 V540 M42 300 H58 M42 540 H58', class: 'dw dw-dim' }, g);
        el('text', { x: 36, y: 420, class: 'dw-dimtxt', transform: 'rotate(-90 36 420)' }, g).textContent = '6.00';
        el('text', { x: 500, y: 470, class: 'dw-txt', 'text-anchor': 'middle' }, g).textContent = 'DOOR';
      },
      snaps: (function () {
        var s = [[100, 540], [900, 540], [100, 300], [900, 300], [500, 180], [420, 540], [420, 400], [580, 400], [580, 540], [180, 380], [300, 380], [300, 440], [180, 440], [700, 380], [820, 380], [820, 440], [700, 440]];
        for (var x = 200; x <= 800; x += 100) { s.push([x, 300]); s.push([x, x <= 500 ? 300 - (x - 100) * 0.3 : 180 + (x - 500) * 0.3]); }
        return s;
      })()
    }
  };
  var COLORS = { area: '#f59e0b', length: '#4ade80', count: '#c084fc' };

  (function demo() {
    var root = $('#demo');
    if (!root) return;
    var svg = $('#demo-svg'), hint = $('#demo-hint'), toast = $('#demo-toast');
    var listEl = $('#dp-list'), emptyEl = $('#dp-empty');
    var drawingLayer = el('g', {}, svg);
    var snapLayer = el('g', {}, svg);
    var doneLayer = el('g', {}, svg);
    var liveLayer = el('g', {}, svg);
    var ring = el('circle', { r: 11, class: 'snap-ring' }, svg);
    var ghost = el('g', { class: 'ghost', opacity: 0 }, svg);
    el('path', { d: 'M0 0 L0 22 L6 16 L10 26 L14 24 L10 15 L18 15 Z' }, ghost);

    var state = { drawing: 'building', tool: 'area', pts: [], hover: null, countItem: null };
    var store = {}; // results per drawing
    var counters = { area: 0, length: 0, count: 0 };
    var userTouched = false, ghostRunning = false, ghostCancel = null;

    function results() { return store[state.drawing] || (store[state.drawing] = []); }
    function D() { return DRAWINGS[state.drawing]; }

    function renderDrawing() {
      drawingLayer.innerHTML = ''; snapLayer.innerHTML = ''; doneLayer.innerHTML = ''; liveLayer.innerHTML = '';
      var g = el('g', { class: 'drawing' }, drawingLayer);
      D().draw(g);
      requestAnimationFrame(function () { g.classList.add('show'); });
      D().snaps.forEach(function (p) { el('circle', { cx: p[0], cy: p[1], r: 3, class: 'snap-dot' }, snapLayer); });
      $('#demo-scale').textContent = D().scale;
      results().forEach(drawResult);
      renderPanel(false);
      setHint();
    }

    function setHint() { hint.textContent = D().hint[state.tool]; }

    function svgPoint(e) {
      var pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      var p = pt.matrixTransform(svg.getScreenCTM().inverse());
      return [p.x, p.y];
    }
    function snapPx() { var m = svg.getScreenCTM(); return 22 / (m ? m.a : 1); }
    function snap(p) {
      var best = null, bd = snapPx();
      D().snaps.forEach(function (s) { var d = Math.hypot(s[0] - p[0], s[1] - p[1]); if (d < bd) { bd = d; best = s; } });
      // also close the polygon on its first point
      if (state.tool === 'area' && state.pts.length > 2) {
        var f = state.pts[0], df = Math.hypot(f[0] - p[0], f[1] - p[1]);
        if (df < snapPx() * 1.2) return { p: f.slice(), snapped: true, closes: true };
      }
      return best ? { p: best.slice(), snapped: true } : { p: p, snapped: false };
    }

    function polyArea(pts) {
      var a = 0;
      for (var i = 0; i < pts.length; i++) { var j = (i + 1) % pts.length; a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]; }
      return Math.abs(a / 2);
    }
    function polyLen(pts) { var l = 0; for (var i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; }
    function centroid(pts) {
      var x = 0, y = 0; pts.forEach(function (p) { x += p[0]; y += p[1]; });
      return [x / pts.length, y / pts.length];
    }
    function m2(px) { return px / (D().ppm * D().ppm); }
    function m(px) { return px / D().ppm; }

    function drawLive() {
      liveLayer.innerHTML = '';
      var pts = state.pts.slice();
      if (state.hover && pts.length) pts.push(state.hover);
      if (state.tool === 'area' && pts.length) {
        el('polygon', { points: pts.map(String).join(' '), class: 'm-area live' }, liveLayer);
        // like the app: no running number while tracing, the result appears once the shape is closed
        state.pts.forEach(function (p, i) { el('circle', { cx: p[0], cy: p[1], r: i === 0 ? 6 : 4.5, class: 'm-pt a' + (i === 0 ? ' first' : '') }, liveLayer); });
      } else if (state.tool === 'length' && pts.length) {
        el('polyline', { points: pts.map(String).join(' '), class: 'm-length live' }, liveLayer);
        state.pts.forEach(function (p) { el('circle', { cx: p[0], cy: p[1], r: 4.5, class: 'm-pt l' }, liveLayer); });
      }
    }

    function drawResult(r) {
      var g = el('g', { 'data-id': r.id }, doneLayer);
      if (r.type === 'area') {
        el('polygon', { points: r.pts.map(String).join(' '), class: 'm-area' + (r.fresh ? ' done' : '') }, g);
        var c = centroid(r.pts);
        el('text', { x: c[0], y: c[1] - 9, class: 'm-label a small' }, g).textContent = r.name;
        el('text', { x: c[0], y: c[1] + 10, class: 'm-label a' }, g).textContent = fmt(r.value, 2) + ' m²';
      } else if (r.type === 'length') {
        el('polyline', { points: r.pts.map(String).join(' '), class: 'm-length' }, g);
        var a = r.pts[r.pts.length - 2], b = r.pts[r.pts.length - 1];
        el('text', { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 - 14, class: 'm-label l' }, g).textContent = fmt(r.value, 2) + ' m';
      } else {
        r.pts.forEach(function (p, i) {
          var cg = el('g', { class: 'm-count' }, g);
          el('circle', { cx: p[0], cy: p[1], r: 13 }, cg);
          el('text', { x: p[0], y: p[1] }, cg).textContent = i + 1;
        });
      }
      r.fresh = false;
    }

    function addResult(type, pts, name) {
      var n = ++counters[type];
      var r = {
        id: type + n + '-' + Date.now(), type: type, pts: pts,
        name: name || ({ area: 'Area ', length: 'Length ', count: 'Count ' })[type] + n,
        value: type === 'area' ? m2(polyArea(pts)) : type === 'length' ? m(polyLen(pts)) : pts.length,
        fresh: true
      };
      results().push(r);
      drawResult(r);
      renderPanel(r.id);
      return r;
    }

    var shown = { area: 0, length: 0, items: 0 };
    function tween(elm, from, to, dec, unit) {
      cancelAnimationFrame(elm._raf);
      if (reduce || from === to) { elm.textContent = fmt(to, dec) + unit; return; }
      var t0 = performance.now();
      (function f(now) {
        var p = Math.min(1, (now - t0) / 600), e = 1 - Math.pow(1 - p, 3);
        elm.textContent = fmt(from + (to - from) * e, dec) + unit;
        if (p < 1) elm._raf = requestAnimationFrame(f);
      })(t0);
    }
    function renderPanel(flashId) {
      var rs = results();
      listEl.innerHTML = '';
      rs.forEach(function (r, i) {
        var li = document.createElement('li');
        li.className = 'dp-item' + (r.id === flashId ? ' flash' : '');
        li.style.setProperty('--c', COLORS[r.type]);
        var val = r.type === 'area' ? 'Area: ' + fmt(r.value, 2) + ' m²' : r.type === 'length' ? 'Length: ' + fmt(r.value, 2) + ' m' : 'Count: ' + r.value + ' pcs';
        li.innerHTML = '<b></b><span></span><button type="button" aria-label="Delete">×</button>';
        li.querySelector('b').textContent = (i + 1) + '. ' + r.name;
        li.querySelector('span').textContent = val;
        li.querySelector('button').addEventListener('click', function () { removeResult(r.id); });
        listEl.appendChild(li);
      });
      if (flashId) { var last = listEl.lastElementChild; if (last) last.scrollIntoView({ block: 'nearest' }); }
      emptyEl.style.display = rs.length ? 'none' : '';
      $('#dp-count').textContent = rs.length;
      var ta = 0, tl = 0, ti = 0;
      rs.forEach(function (r) { if (r.type === 'area') ta += r.value; else if (r.type === 'length') tl += r.value; else ti += r.value; });
      tween($('#dp-area'), shown.area, ta, 2, ' m²'); shown.area = ta;
      tween($('#dp-length'), shown.length, tl, 2, ' m'); shown.length = tl;
      tween($('#dp-items'), shown.items, ti, 0, ' pcs'); shown.items = ti;
    }
    function removeResult(id) {
      store[state.drawing] = results().filter(function (r) { return r.id !== id; });
      var g = doneLayer.querySelector('[data-id="' + id + '"]');
      if (g) g.remove();
      renderPanel(false);
    }

    var toastTimer;
    function say(msg, ms) {
      toast.textContent = msg; toast.classList.add('show');
      clearTimeout(toastTimer); toastTimer = setTimeout(function () { toast.classList.remove('show'); }, ms || 2600);
    }

    var firstDone = false;
    function finish() {
      if (state.tool === 'area' && state.pts.length >= 3) {
        var r = addResult('area', state.pts.slice());
        celebrate(r, fmt(r.value, 2) + ' m²');
      } else if (state.tool === 'length' && state.pts.length >= 2) {
        var r2 = addResult('length', state.pts.slice());
        celebrate(r2, fmt(r2.value, 2) + ' m');
      } else if (state.tool === 'count' && state.countItem) {
        say(state.countItem.value + ' counted. Pick another tool or keep clicking to start a new count.');
        state.countItem = null;
      }
      state.pts = []; state.hover = null; drawLive();
    }
    function celebrate(r, txt) {
      if (ghostRunning) return;
      if (!firstDone) {
        firstDone = true;
        say('Nice. ' + r.name + ' is ' + txt + '. That\'s exactly how the app does it.', 3400);
        var rect = svg.getBoundingClientRect();
        if (window.CMP && CMP.confetti) CMP.confetti(rect.left + rect.width / 2, rect.top + rect.height / 2, { count: 90, power: 8 });
      } else {
        say(r.name + ': ' + txt);
      }
    }

    function addPoint(p, closes) {
      if (state.tool === 'count') {
        if (!state.countItem) {
          state.countItem = addResult('count', [p]);
        } else {
          state.countItem.pts.push(p);
          state.countItem.value = state.countItem.pts.length;
          var g = doneLayer.querySelector('[data-id="' + state.countItem.id + '"]');
          if (g) g.remove();
          drawResult(state.countItem);
          renderPanel(state.countItem.id);
        }
        return;
      }
      if (closes) { finish(); return; }
      var last = state.pts[state.pts.length - 1];
      if (last && last[0] === p[0] && last[1] === p[1]) {
        if (state.tool === 'length' && state.pts.length >= 2) finish();
        return;
      }
      state.pts.push(p);
      drawLive();
    }

    // pointer handling
    svg.addEventListener('pointermove', function (e) {
      if (ghostRunning) return;
      var s = snap(svgPoint(e));
      state.hover = s.p;
      ring.setAttribute('cx', s.p[0]); ring.setAttribute('cy', s.p[1]);
      ring.classList.toggle('on', s.snapped);
      drawLive();
    });
    svg.addEventListener('pointerleave', function () { state.hover = null; ring.classList.remove('on'); drawLive(); });
    svg.addEventListener('pointerenter', function () { svg.classList.add('show-snaps'); });
    svg.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      stopGhost();
      userTouched = true;
      var s = snap(svgPoint(e));
      addPoint(s.p, s.closes);
    });
    svg.addEventListener('dblclick', function (e) { e.preventDefault(); finish(); });
    svg.addEventListener('contextmenu', function (e) { e.preventDefault(); undo(); });

    function undo() {
      if (state.pts.length) { state.pts.pop(); drawLive(); return; }
      var rs = results();
      if (state.countItem && state.countItem.pts.length > 1) {
        state.countItem.pts.pop(); state.countItem.value--;
        var g = doneLayer.querySelector('[data-id="' + state.countItem.id + '"]');
        if (g) g.remove();
        drawResult(state.countItem); renderPanel(false);
      } else if (rs.length) removeResult(rs[rs.length - 1].id);
    }
    $('#demo-undo').addEventListener('click', function () { stopGhost(); undo(); });
    $('#demo-finish').addEventListener('click', function () { stopGhost(); finish(); });
    $('#dp-clear').addEventListener('click', function () {
      stopGhost();
      store[state.drawing] = []; state.pts = []; state.countItem = null;
      doneLayer.innerHTML = ''; drawLive(); renderPanel(false);
    });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { finish(); }
      else if (e.key === 'Escape') { state.pts = []; drawLive(); }
      else if (e.key === 'Backspace') { e.preventDefault(); undo(); }
    });

    $$('.tool[data-tool]').forEach(function (b) {
      b.addEventListener('click', function () {
        stopGhost();
        if (state.pts.length) finish();
        state.countItem = null;
        state.tool = b.getAttribute('data-tool');
        $$('.tool[data-tool]').forEach(function (x) { var on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
        setHint();
      });
    });
    $$('.seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        stopGhost();
        state.pts = []; state.countItem = null;
        state.drawing = b.getAttribute('data-drawing');
        $$('.seg-btn').forEach(function (x) { var on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', on ? 'true' : 'false'); });
        renderDrawing();
        if (!results().length && !reduce) setTimeout(function () { runGhost(true); }, 900);
      });
    });

    /* ghost cursor: shows how it's done, then hands over */
    function stopGhost() {
      if (!ghostRunning) return;
      ghostRunning = false;
      if (ghostCancel) ghostCancel();
      ghost.setAttribute('opacity', 0);
    }
    function runGhost(short) {
      if (reduce || ghostRunning) return;
      var target = D().ghost.slice();
      var name = D().ghostName;
      var prevTool = state.tool;
      if (prevTool !== 'area') $$('.tool[data-tool="area"]')[0].click();
      ghostRunning = true;
      var cancelled = false, timers = [];
      ghostCancel = function () { cancelled = true; timers.forEach(clearTimeout); state.pts = []; drawLive(); };
      var pos = [target[0][0] - 160, target[0][1] + 140];
      ghost.setAttribute('transform', 'translate(' + pos + ')');
      ghost.setAttribute('opacity', 1);
      var seq = target.concat([target[0]]);
      var i = 0;
      function moveTo(p, done) {
        var from = pos.slice(), t0 = performance.now(), dur = short ? 520 : 760;
        (function f(now) {
          if (cancelled) return;
          var k = Math.min(1, (now - t0) / dur), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          pos = [from[0] + (p[0] - from[0]) * e, from[1] + (p[1] - from[1]) * e];
          ghost.setAttribute('transform', 'translate(' + pos + ')');
          state.hover = pos.slice(); drawLive();
          if (k < 1) requestAnimationFrame(f); else done();
        })(t0);
      }
      function ripple(p) {
        var c = el('circle', { cx: p[0], cy: p[1], r: 4, class: 'ghost-ripple' }, svg);
        var t0 = performance.now();
        (function f(now) {
          var k = Math.min(1, (now - t0) / 450);
          c.setAttribute('r', 4 + k * 20); c.setAttribute('opacity', 1 - k);
          if (k < 1) requestAnimationFrame(f); else c.remove();
        })(t0);
      }
      function step() {
        if (cancelled) return;
        if (i >= seq.length) {
          timers.push(setTimeout(function () {
            if (cancelled) return;
            ghost.setAttribute('opacity', 0);
            ghostRunning = false; state.hover = null;
            say('Your turn. Pick a tool and click the corners.', 3600);
          }, 500));
          return;
        }
        var p = seq[i];
        moveTo(p, function () {
          ripple(p);
          if (i === seq.length - 1) {
            var r = addResult('area', state.pts.slice(), name);
            state.pts = []; state.hover = null; drawLive();
            say(name + ': ' + fmt(r.value, 2) + ' m²', 2000);
          } else { state.pts.push(p.slice()); drawLive(); }
          i++;
          timers.push(setTimeout(step, short ? 160 : 260));
        });
      }
      timers.push(setTimeout(step, 300));
    }

    renderDrawing();
    if ('IntersectionObserver' in window) {
      var seen = false;
      new IntersectionObserver(function (en, obs) {
        if (en[0].isIntersecting && !seen) {
          seen = true; obs.disconnect();
          if (!userTouched) setTimeout(function () { if (!userTouched) runGhost(false); }, 700);
        }
      }, { threshold: 0.5 }).observe(svg);
    }
  })();

  /* ════ MARKING COMPARE SLIDER ═════════════════════ */
  (function compare() {
    var box = $('#compare');
    if (!box) return;
    var pos = 50, dragging = false;
    function set(p) {
      pos = Math.max(0, Math.min(100, p));
      box.style.setProperty('--pos', pos + '%');
      box.setAttribute('aria-valuenow', Math.round(pos));
    }
    function fromEvent(e) { var r = box.getBoundingClientRect(); set((e.clientX - r.left) / r.width * 100); }
    box.addEventListener('pointerdown', function (e) {
      dragging = true; box.classList.add('dragging', 'touched'); stopIntro();
      box.setPointerCapture(e.pointerId); fromEvent(e);
    });
    box.addEventListener('pointermove', function (e) { if (dragging) fromEvent(e); });
    box.addEventListener('pointerup', function () { dragging = false; box.classList.remove('dragging'); });
    box.addEventListener('pointercancel', function () { dragging = false; box.classList.remove('dragging'); });
    box.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End') {
        e.preventDefault(); stopIntro(); box.classList.add('touched');
        set(k === 'Home' ? 0 : k === 'End' ? 100 : pos + (k === 'ArrowLeft' ? -5 : 5));
      }
    });
    var introRaf = 0;
    function stopIntro() { cancelAnimationFrame(introRaf); introRaf = -1; }
    function intro() {
      if (reduce || introRaf === -1) return;
      var keys = [[0, 50], [900, 12], [2000, 88], [2900, 50]], t0 = performance.now();
      (function f(now) {
        if (introRaf === -1) return;
        var t = now - t0, i = 0;
        while (i < keys.length - 1 && t > keys[i + 1][0]) i++;
        if (i >= keys.length - 1) { set(50); return; }
        var a = keys[i], b = keys[i + 1], k = (t - a[0]) / (b[0] - a[0]);
        var e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        set(a[1] + (b[1] - a[1]) * e);
        introRaf = requestAnimationFrame(f);
      })(t0);
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en, obs) {
        if (en[0].isIntersecting) { obs.disconnect(); setTimeout(intro, 400); }
      }, { threshold: 0.55 }).observe(box);
    }
  })();

  /* ════ SCROLL STORY ═══════════════════════════════ */
  (function story() {
    var steps = $$('.story-step');
    var view = $('.story-view');
    if (!steps.length || !view) return;
    var layers = {};
    $$('.story-layer').forEach(function (l) { layers[l.getAttribute('data-layer')] = l; });
    var progress = $('#story-progress');
    var current = -1;

    function apply(i) {
      if (i === current) return;
      current = i;
      steps.forEach(function (s, k) { s.classList.toggle('active', k === i); });
      progress.style.width = ((i + 1) / steps.length * 100) + '%';
      var s = steps[i];
      var which = s.getAttribute('data-img');
      var f = s.getAttribute('data-focus').split(',').map(Number);
      var W = view.clientWidth, H = view.clientHeight;
      Object.keys(layers).forEach(function (key) {
        var layer = layers[key];
        var on = key === which;
        layer.style.opacity = on ? 1 : 0;
        layer.classList.toggle('on', on);
        if (!on) return;
        var sc = Math.min(1 / f[2], 1 / f[3]) * 0.82;
        // cap the zoom so the screenshot never gets upscaled past its real resolution
        var img = $('img', layer), dpr = Math.min(window.devicePixelRatio || 1, 2);
        var maxSc = img && img.naturalWidth ? Math.max(1, img.naturalWidth / (W * dpr) * 1.15) : 1.7;
        sc = Math.max(1, Math.min(sc, 1.9, maxSc));
        var cx = f[0] + f[2] / 2, cy = f[1] + f[3] / 2;
        var tx = W / 2 - cx * W * sc, ty = H / 2 - cy * H * sc;
        tx = Math.min(0, Math.max(W - W * sc, tx));
        ty = Math.min(0, Math.max(H - H * sc, ty));
        layer.style.transform = 'translate(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px) scale(' + sc.toFixed(3) + ')';
        layer.style.setProperty('--s', sc.toFixed(3));
        var foc = $('.story-focus', layer);
        var full = f[2] >= 0.6 && f[3] >= 0.6;
        foc.classList.toggle('on', !full);
        foc.style.left = (f[0] * 100) + '%'; foc.style.top = (f[1] * 100) + '%';
        foc.style.width = (f[2] * 100) + '%'; foc.style.height = (f[3] * 100) + '%';
      });
    }
    if ('IntersectionObserver' in window) {
      var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) apply(steps.indexOf(en.target)); });
      }, { rootMargin: window.matchMedia('(max-width: 900px)').matches ? '-68% 0px -22% 0px' : '-45% 0px -45% 0px' });
      steps.forEach(function (s) { obs.observe(s); });
    }
    steps.forEach(function (s, i) { s.addEventListener('click', function () { apply(i); }); });
    window.addEventListener('resize', function () { var c = current; current = -1; apply(Math.max(0, c)); });
    // apply once images have layout
    requestAnimationFrame(function () { apply(0); });
  })();
})();
