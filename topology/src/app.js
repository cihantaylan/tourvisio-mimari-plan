/* TourVisio topology viewer. Builds the scene with TopoGeo and wires the interface. No network, no dependencies. */
(function () {
  'use strict';

  var DATA = JSON.parse(document.getElementById('topo-data').textContent);
  var Geo = window.TopoGeo;
  var $ = function (id) { return document.getElementById(id); };
  var NS = 'http://www.w3.org/2000/svg';

  var nodeById = {}, edgeById = {}, flowById = {}, zoneById = {}, tierById = {}, kids = {};
  DATA.nodes.forEach(function (n) { nodeById[n.id] = n; if (n.parent) (kids[n.parent] = kids[n.parent] || []).push(n.id); });
  DATA.edges.forEach(function (e) { edgeById[e.id] = e; });
  DATA.flows.forEach(function (f) { flowById[f.id] = f; });
  DATA.zones.forEach(function (z) { zoneById[z.id] = z; });
  DATA.tiers.forEach(function (t) { tierById[t.id] = t; });

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function f1(n) { return Math.round(n * 10) / 10; }
  function pts(list) { return list.map(function (p) { return f1(p[0]) + ',' + f1(p[1]); }).join(' '); }
  function owner(id) { return nodeById[id].parent || id; }
  function inGroup(id, gid) { return id === gid || nodeById[id].parent === gid; }

  var state = { view: 'map', proj: '3d', sel: null, edge: null, flow: null, step: 0, hover: null, theme: 'auto' };
  var scenes = {}, scene = null, view = null, user = { moved: false };
  var isMobile = false;

  /* ---------- scene ---------- */

  function wrap(text, max) {
    var words = text.split(' '), lines = [], cur = '';
    words.forEach(function (w) {
      if (cur && (cur + ' ' + w).length > max) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
    });
    if (cur) lines.push(cur);
    return lines;
  }

  function buildScene(mode) {
    if (scenes[mode]) return scenes[mode];
    var L = Geo.layout(DATA, mode), C = L.C, P = L.P, is3 = mode === '3d';
    var S = { mode: mode, L: L, info: {}, tierBoxes: [], bounds: { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 }, parts: { plane: '', group: '', node: '' } };
    function grow(x, y) { var b = S.bounds; b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y); }

    // planes
    var planeSvg = '';
    L.order.forEach(function (p, pi) {
      var e = p.ext, pid = p.id;
      var Q = function (u, v, z) { var q = P(pid, u, v, z); grow(q[0], q[1]); return q; };
      var top = [Q(e.u0, e.v0, 0), Q(e.u1, e.v0, 0), Q(e.u1, e.v1, 0), Q(e.u0, e.v1, 0)];
      if (is3) {
        var s = -C.slab;
        planeSvg += '<polygon class="plane-front" points="' + pts([Q(e.u0, e.v1, 0), Q(e.u1, e.v1, 0), Q(e.u1, e.v1, s), Q(e.u0, e.v1, s)]) + '"/>';
        planeSvg += '<polygon class="plane-right" points="' + pts([Q(e.u1, e.v0, 0), Q(e.u1, e.v1, 0), Q(e.u1, e.v1, s), Q(e.u1, e.v0, s)]) + '"/>';
        planeSvg += '<polygon class="plane-top" points="' + pts(top) + '"/>';
      } else {
        planeSvg += '<rect class="plane-top" x="' + f1(top[0][0]) + '" y="' + f1(top[0][1]) + '" width="' + f1(top[1][0] - top[0][0]) + '" height="' + f1(top[3][1] - top[0][1]) + '" rx="14"/>';
      }
      var bi = 0;
      L.tierBands.filter(function (t) { return t.plane === pid; }).forEach(function (t) {
        if (bi % 2 === 0) planeSvg += '<polygon class="band" points="' + pts([P(pid, t.u0, e.v0, 0), P(pid, t.u1, e.v0, 0), P(pid, t.u1, e.v1, 0), P(pid, t.u0, e.v1, 0)]) + '"/>';
        if (bi > 0) { var a = P(pid, t.u0, e.v0, 0), b = P(pid, t.u0, e.v1, 0); planeSvg += '<path class="band-sep" d="M' + f1(a[0]) + ' ' + f1(a[1]) + 'L' + f1(b[0]) + ' ' + f1(b[1]) + '"/>'; }
        var c = is3 ? P(pid, (t.u0 + t.u1) / 2, e.v1, -C.slab / 2) : P(pid, (t.u0 + t.u1) / 2, e.v0 + 21, 0);
        S.tierBoxes.push({ x0: c[0] - t.label.length * 4.2, x1: c[0] + t.label.length * 4.2, y0: c[1] - 9, y1: c[1] + 9 });
        planeSvg += '<text class="tier-label" x="' + f1(c[0]) + '" y="' + f1(c[1] + 4) + '">' + esc(t.label) + '</text>';
        bi++;
      });
      var mid = P(pid, e.u0, (e.v0 + e.v1) / 2, 0), tx = mid[0] - 16;
      grow(tx - 14, mid[1]);
      planeSvg += '<text class="plane-title" text-anchor="middle" transform="translate(' + f1(tx) + ' ' + f1(mid[1]) + ') rotate(-90)">' + esc(p.label) + '</text>';
    });
    S.parts.plane = planeSvg;

    // nodes
    var order = DATA.nodes.slice().sort(function (a, b) {
      var ra = L.R[a.id], rb = L.R[b.id];
      var pa = L.planes[ra.plane].yoff, pb = L.planes[rb.plane].yoff;
      if (pa !== pb) return pa - pb;
      return (ra.cv - rb.cv) || (ra.cu - rb.cu);
    });
    var groupSvg = '', nodeSvg = '';
    order.forEach(function (n) {
      var r = L.R[n.id], pid = r.plane, zc = 'zone-' + n.zone + (n.zone === 'future' ? ' future' : '');
      var info = S.info[n.id] = { n: n, r: r };
      var q = function (u, v, z) { var p = P(pid, u, v, z); grow(p[0], p[1]); return p; };
      if (n.kind === 'group') {
        var g = '<g class="gnode ' + zc + '" data-gid="' + n.id + '">';
        if (is3) {
          var A = q(r.u0, r.v0, r.top), B = q(r.u1, r.v0, r.top), Cc = q(r.u1, r.v1, r.top), D = q(r.u0, r.v1, r.top);
          var Db = q(r.u0, r.v1, 0), Cb = q(r.u1, r.v1, 0), Bb = q(r.u1, r.v0, 0);
          g += '<polygon class="g-front" points="' + pts([D, Cc, Cb, Db]) + '"/><polygon class="g-side" points="' + pts([B, Cc, Cb, Bb]) + '"/><polygon class="g-top" points="' + pts([A, B, Cc, D]) + '"/>';
          var bx = q(r.cu, r.v0, r.top);
          g += '<text class="nlabel" x="' + f1(bx[0]) + '" y="' + f1(bx[1] - 22) + '" style="font-size:13.5px">' + esc(n.label) + '</text>';
          g += '<text class="nsub" x="' + f1(bx[0]) + '" y="' + f1(bx[1] - 8) + '">' + esc(n.caption) + '</text>';
          grow(bx[0] - 120, bx[1] - 36);
          info.ring = [A, B, Bb, Cb, Db, D];
        } else {
          var o = q(r.u0, r.v0, 0);
          g += '<rect class="g-top" x="' + f1(o[0]) + '" y="' + f1(o[1]) + '" width="' + f1(r.u1 - r.u0) + '" height="' + f1(r.v1 - r.v0) + '" rx="14"/>';
          g += '<text class="nlabel l2d" x="' + f1(o[0] + 14) + '" y="' + f1(o[1] + 18) + '" style="font-size:13px">' + esc(n.label) + '</text>';
          g += '<text class="nsub" text-anchor="start" style="text-anchor:start" x="' + f1(o[0] + 14) + '" y="' + f1(o[1] + 32) + '">' + esc(n.caption) + '</text>';
          q(r.u1, r.v1, 0);
        }
        groupSvg += g + '</g>';
        return;
      }
      var lines, lblBase, g2 = '<g class="node ' + zc + '" data-node="' + n.id + '" tabindex="0" role="button" aria-label="' + esc(n.name + ', ' + n.role) + '">';
      if (is3) {
        var top = r.top, base = r.base;
        var a = q(r.u0, r.v0, top), b = q(r.u1, r.v0, top), c = q(r.u1, r.v1, top), d = q(r.u0, r.v1, top);
        var db = q(r.u0, r.v1, base), cb = q(r.u1, r.v1, base), bb = q(r.u1, r.v0, base);
        var sh = [q(r.u0, r.v0, base), bb, cb, db].map(function (p) { return [p[0] + 5, p[1] + 3]; });
        g2 += '<polygon class="shadow" points="' + pts(sh) + '"/>';
        g2 += '<polygon class="t-front" points="' + pts([d, c, cb, db]) + '"/><polygon class="t-side" points="' + pts([b, c, cb, bb]) + '"/><polygon class="t-top" points="' + pts([a, b, c, d]) + '"/>';
        g2 += '<polygon class="ring" points="' + pts([a, b, bb, cb, db, d]) + '"/>';
        var ctr = P(pid, r.cu, r.cv, top);
        g2 += '<use class="ic" href="#i-' + n.icon + '" x="' + f1(ctr[0] - 12) + '" y="' + f1(ctr[1] - 12.5) + '" width="24" height="24"/>';
        var back = P(pid, r.cu, r.v0, top);
        lblBase = back[1] - 7;
        g2 += '<text class="nlabel" x="' + f1(ctr[0]) + '" y="' + f1(lblBase) + '">' + esc(n.label) + '</text>';
        info.box = { x0: Math.min(a[0], d[0], db[0]) - 2, x1: Math.max(b[0], c[0], cb[0]) + 2, y0: lblBase - 12, y1: Math.max(db[1], cb[1]) + 2 };
        var half = n.label.length * 3.4; info.box.x0 = Math.min(info.box.x0, ctr[0] - half); info.box.x1 = Math.max(info.box.x1, ctr[0] + half);
        grow(ctr[0] - half, lblBase - 14);
        info.labelTop = lblBase - 14;
        info.anchor = ctr;
      } else {
        var o2 = q(r.u0, r.v0, 0), w = r.u1 - r.u0, h = r.v1 - r.v0;
        q(r.u1, r.v1, 0);
        g2 += '<rect class="ring" x="' + f1(o2[0] - 2) + '" y="' + f1(o2[1] - 2) + '" width="' + f1(w + 4) + '" height="' + f1(h + 4) + '" rx="12"/>';
        g2 += '<rect class="card" x="' + f1(o2[0]) + '" y="' + f1(o2[1]) + '" width="' + f1(w) + '" height="' + f1(h) + '" rx="10"/>';
        g2 += '<use class="ic" href="#i-' + n.icon + '" x="' + f1(o2[0] + 10) + '" y="' + f1(o2[1] + h / 2 - 12) + '" width="24" height="24"/>';
        lines = wrap(n.label, 15);
        lines.forEach(function (ln, i) {
          g2 += '<text class="nlabel l2d" x="' + f1(o2[0] + 42) + '" y="' + f1(o2[1] + h / 2 + 4 - (lines.length - 1) * 7 + i * 14) + '" style="stroke-width:0">' + esc(ln) + '</text>';
        });
        info.box = { x0: o2[0], x1: o2[0] + w, y0: o2[1], y1: o2[1] + h };
        info.labelTop = o2[1] - 6;
        info.anchor = [o2[0] + w / 2, o2[1] + h / 2];
      }
      nodeSvg += g2 + '</g>';
    });
    S.parts.group = groupSvg; S.parts.node = nodeSvg;

    // edges
    S.routes = Geo.routeEdges(DATA, L, function (id) { return S.info[id].labelTop; });
    var edgeSvg = '';
    var ordered = DATA.edges.slice().sort(function (a, b) { return (a.kind === 'future' ? 0 : 1) - (b.kind === 'future' ? 0 : 1); });
    ordered.forEach(function (e) {
      var r = S.routes[e.id];
      r.pts.forEach(function (p) { grow(p[0], p[1]); });
      var tri = function (t) { return '<path class="arrow" d="M0 0L-9.5-4.6L-9.5 4.6Z" transform="translate(' + f1(t.x) + ' ' + f1(t.y) + ') rotate(' + f1(t.a * 180 / Math.PI) + ')"/>'; };
      var tail = r.cross ? { x: r.pts[0][0], y: r.pts[0][1], a: Math.atan2(r.bez[0][1] - r.bez[1][1], r.bez[0][0] - r.bez[1][0]) }
        : { x: r.pts[0][0], y: r.pts[0][1], a: Math.atan2(r.pts[0][1] - r.pts[1][1], r.pts[0][0] - r.pts[1][0]) };
      edgeSvg += '<g class="edge ' + (e.kind || 'data') + '" data-edge="' + e.id + '"><path class="hit" d="' + r.d + '"/><path class="line" d="' + r.d + '"/>' +
        '<g class="fwd">' + tri(r.tip) + '</g><g class="bk" style="display:none">' + tri(tail) + '</g></g>';
    });
    S.parts.edge = edgeSvg;
    var m = 46, b = S.bounds;
    S.vb = { x: b.x0 - m, y: b.y0 - m, w: b.x1 - b.x0 + 2 * m, h: b.y1 - b.y0 + 2 * m };
    scenes[mode] = S;
    return S;
  }

  /* ---------- state helpers ---------- */

  function edgesOf(id) {
    var ids = [id].concat(kids[id] || []);
    return DATA.edges.filter(function (e) { return ids.indexOf(e.from) >= 0 || ids.indexOf(e.to) >= 0; });
  }
  function relatedOf(id) {
    var es = edgesOf(id), nodes = {}, edges = {};
    nodes[id] = 1; (kids[id] || []).forEach(function (k) { nodes[k] = 1; });
    if (nodeById[id].parent) nodes[nodeById[id].parent] = 1;
    es.forEach(function (e) { edges[e.id] = 1; nodes[e.from] = 1; nodes[e.to] = 1; });
    return { nodes: nodes, edges: edges };
  }
  function flowSets(f) {
    var nodes = {}, edges = {};
    f.steps.forEach(function (s) {
      if (s.edge) { var e = edgeById[s.edge]; edges[e.id] = 1; nodes[e.from] = 1; nodes[e.to] = 1; } else nodes[s.node] = 1;
    });
    Object.keys(nodes).forEach(function (id) { if (nodeById[id].parent) nodes[nodeById[id].parent] = 1; });
    return { nodes: nodes, edges: edges };
  }
  function curStep() { return state.flow ? flowById[state.flow].steps[state.step] : null; }
  function nm(id) { return nodeById[id].name; }

  function applyClasses() {
    var focus = null;
    if (state.flow) focus = flowSets(flowById[state.flow]);
    else if (state.sel) { focus = relatedOf(state.sel); }
    else if (state.edge) { var e0 = edgeById[state.edge], fs = { nodes: {}, edges: {} }; fs.edges[e0.id] = 1; fs.nodes[e0.from] = 1; fs.nodes[e0.to] = 1; Object.keys(fs.nodes).forEach(function (id) { if (nodeById[id].parent) fs.nodes[nodeById[id].parent] = 1; }); focus = fs; }
    var hov = !focus && state.hover ? relatedOf(state.hover) : null;
    var cs = curStep();
    var curEdge = cs && cs.edge ? cs.edge : null, curNode = cs && cs.node ? cs.node : null;
    var root = $('canvas');
    root.querySelectorAll('.node').forEach(function (el) {
      var id = el.getAttribute('data-node');
      el.classList.toggle('dim', !!focus && !focus.nodes[id]);
      el.classList.toggle('sel', state.sel === id || curNode === id);
      el.classList.toggle('hov', !!hov && hov.nodes[id] && state.hover === id);
      el.setAttribute('aria-pressed', state.sel === id ? 'true' : 'false');
    });
    root.querySelectorAll('.gnode').forEach(function (el) {
      var id = el.getAttribute('data-gid');
      el.classList.toggle('dim', !!focus && !focus.nodes[id]);
    });
    root.querySelectorAll('.edge').forEach(function (el) {
      var id = el.getAttribute('data-edge');
      var on = (focus && focus.edges[id]) || (hov && hov.edges[id]) || state.edge === id;
      el.classList.toggle('dim', !!focus && !focus.edges[id]);
      el.classList.toggle('hl', !!on && curEdge !== id);
      var isCur = curEdge === id, rev = isCur && cs.reverse;
      el.classList.toggle('cur', isCur);
      el.classList.toggle('rev', !!rev);
      el.querySelector('.fwd').style.display = rev ? 'none' : '';
      el.querySelector('.bk').style.display = rev ? '' : 'none';
    });
    updateOverlay();
    $('hint').textContent = hintText();
  }

  function hintText() {
    if (state.flow) return '';
    if (state.sel) return nm(state.sel) + ' seçili. Bağlandığı bileşenler vurgulandı; Esc ile temizleyin.';
    if (state.edge) return 'Bağlantı: ' + nm(edgeById[state.edge].from) + ' → ' + nm(edgeById[state.edge].to) + '. Esc ile temizleyin.';
    return 'Bir bileşene tıklayın ya da yukarıdan bir akış seçin. Sürükleyerek kaydırın, tekerlekle yakınlaştırın.';
  }

  /* ---------- overlay: pills and step badges ---------- */

  function overlap(a, b) { return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0; }

  function updateOverlay() {
    var S = scene, g = $('overlay');
    if (!g) return;
    var html = '', placed = [], blocks = S.tierBoxes.slice();
    Object.keys(S.info).forEach(function (id) { if (S.info[id].box) blocks.push(S.info[id].box); });
    var cs = curStep();
    function spots(r) {
      var list = [];
      if (r.cross) { [0.5, 0.4, 0.6, 0.3, 0.7].forEach(function (t) { var b = r.bez, mt = 1 - t; list.push({ x: mt * mt * mt * b[0][0] + 3 * mt * mt * t * b[1][0] + 3 * mt * t * t * b[2][0] + t * t * t * b[3][0], y: mt * mt * mt * b[0][1] + 3 * mt * mt * t * b[1][1] + 3 * mt * t * t * b[2][1] + t * t * t * b[3][1] }); }); return list; }
      var segs = [];
      for (var i = 0; i < r.pts.length - 1; i++) { var a = r.pts[i], b = r.pts[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]); segs.push({ a: a, b: b, l: l }); }
      segs.sort(function (p, q) { return q.l - p.l; });
      segs.forEach(function (s) { [0.5, 0.35, 0.65].forEach(function (t) { if (s.l > 30) list.push({ x: s.a[0] + (s.b[0] - s.a[0]) * t, y: s.a[1] + (s.b[1] - s.a[1]) * t }); }); });
      return list;
    }
    function place(r, w, h, force) {
      var ss = spots(r), i, box;
      for (i = 0; i < ss.length; i++) {
        box = { x0: ss[i].x - w / 2, x1: ss[i].x + w / 2, y0: ss[i].y - h / 2, y1: ss[i].y + h / 2 };
        var hit = blocks.some(function (b) { return overlap(box, b); }) || placed.some(function (b) { return overlap(box, b); });
        if (!hit) { placed.push(box); return ss[i]; }
      }
      if (force && ss.length) {
        var p = ss[0]; placed.push({ x0: p.x - w / 2, x1: p.x + w / 2, y0: p.y - h / 2, y1: p.y + h / 2 }); return p;
      }
      return null;
    }

    if (state.flow) {
      var f = flowById[state.flow], byEdge = {};
      f.steps.forEach(function (s, i) { if (s.edge) (byEdge[s.edge] = byEdge[s.edge] || []).push(i); });
      Object.keys(byEdge).forEach(function (id) {
        var idx = byEdge[id], r = S.routes[id], text = idx.map(function (i) { return i + 1; }).join('·');
        var w = 12 + text.length * 7.2, p = place(r, w + 4, 22, true);
        var isCur = idx.indexOf(state.step) >= 0, past = !isCur && idx.every(function (i) { return i < state.step; });
        html += '<g class="badge' + (isCur ? ' cur' : '') + (past ? ' past' : '') + '" data-step="' + idx[0] + '"><rect x="' + f1(p.x - w / 2) + '" y="' + f1(p.y - 10) + '" width="' + f1(w) + '" height="20" rx="10"/><text x="' + f1(p.x) + '" y="' + f1(p.y + 4) + '">' + text + '</text></g>';
      });
    } else {
      var focusId = state.sel ? relatedOf(state.sel) : (state.hover ? relatedOf(state.hover) : null);
      var order = DATA.edges.slice().sort(function (a, b) { return (focusId && focusId.edges[b.id] ? 1 : 0) - (focusId && focusId.edges[a.id] ? 1 : 0); });
      order.forEach(function (e) {
        if (focusId && !focusId.edges[e.id] && !(state.edge === e.id)) return;
        var r = S.routes[e.id], force = !!focusId || state.edge === e.id, txt = force ? e.label : (e.short || e.label), w = txt.length * 6.1 + 14;
        var p = place(r, w + 2, 18, false);
        if (!p && force) { txt = e.short || e.label; w = txt.length * 6.1 + 14; p = place(r, w + 2, 18, true); }
        if (!p) return;
        html += '<g class="pill' + (force ? ' hl' : '') + '"><rect x="' + f1(p.x - w / 2) + '" y="' + f1(p.y - 9) + '" width="' + f1(w) + '" height="18" rx="9"/><text x="' + f1(p.x) + '" y="' + f1(p.y + 3.6) + '">' + esc(txt) + '</text></g>';
      });
    }
    g.innerHTML = html;
  }

  /* ---------- map rendering and camera ---------- */

  function renderMap() {
    scene = buildScene(state.proj);
    var S = scene;
    $('canvas').innerHTML = '<svg id="svg" xmlns="' + NS + '" role="group" aria-label="Topoloji haritası" preserveAspectRatio="xMidYMid meet"><g id="scene">' +
      S.parts.plane + S.parts.group + S.parts.edge + S.parts.node + '<g id="overlay"></g></g></svg>';
    fit();
    applyClasses();
  }

  function fit() {
    user.moved = false;
    var el = $('canvas'), W = el.clientWidth || 1000, H = el.clientHeight || 600, b = scene.vb;
    var padT = state.flow ? 108 : 56, padB = state.flow ? 24 : 56, s = Math.min(W / b.w, (H - padT - padB) / b.h);
    var cy = padT + (H - padT - padB) / 2;
    view = { x: b.x + b.w / 2 - W / (2 * s), y: b.y + b.h / 2 - cy / s, w: W / s, h: H / s };
    setView();
  }
  function setView() {
    var svg = $('svg'); if (!svg) return;
    svg.setAttribute('viewBox', f1(view.x) + ' ' + f1(view.y) + ' ' + f1(view.w) + ' ' + f1(view.h));
  }
  function toScene(px, py) {
    var el = $('canvas'), W = el.clientWidth, H = el.clientHeight, s = Math.min(W / view.w, H / view.h);
    return { x: view.x + (px - (W - view.w * s) / 2) / s, y: view.y + (py - (H - view.h * s) / 2) / s, s: s };
  }
  function zoomAt(px, py, k) {
    var p = toScene(px, py), nw = view.w / k, nh = view.h / k;
    var fitW = scene.vb.w * 3;
    if (nw > fitW || nw < scene.vb.w / 6) return;
    view = { x: p.x - (p.x - view.x) / k, y: p.y - (p.y - view.y) / k, w: nw, h: nh };
    user.moved = true; setView();
  }

  function wireCanvas() {
    var el = $('canvas'), drag = null, dragged = false;
    el.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var r = el.getBoundingClientRect();
      zoomAt(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-ev.deltaY * 0.0015));
    }, { passive: false });
    el.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      drag = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y, id: ev.pointerId };
      dragged = false;
    });
    el.addEventListener('pointermove', function (ev) {
      if (!drag) { hoverAt(ev.target); return; }
      var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (!dragged && Math.hypot(dx, dy) < 5) return;
      if (!dragged) { dragged = true; el.classList.add('drag'); try { el.setPointerCapture(drag.id); } catch (e) { /* ignore */ } }
      var s = toScene(0, 0).s;
      view.x = drag.vx - dx / s; view.y = drag.vy - dy / s; user.moved = true; setView();
    });
    function end() { drag = null; el.classList.remove('drag'); setTimeout(function () { dragged = false; }, 0); }
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', function () { if (!drag && state.hover) { state.hover = null; applyClasses(); } });
    el.addEventListener('click', function (ev) {
      if (dragged) return;
      var n = ev.target.closest && ev.target.closest('[data-node]'), g = ev.target.closest && ev.target.closest('[data-gid]'), e = ev.target.closest && ev.target.closest('[data-edge]'), b = ev.target.closest && ev.target.closest('.badge');
      if (b) { setStep(+b.getAttribute('data-step')); return; }
      if (n) selectNode(n.getAttribute('data-node'));
      else if (g) selectNode(g.getAttribute('data-gid'));
      else if (e) { state.edge = e.getAttribute('data-edge'); state.sel = null; if (state.flow) { var i = flowById[state.flow].steps.findIndex(function (s) { return s.edge === state.edge; }); if (i >= 0) state.step = i; } sync(); }
      else if (!state.flow) { state.sel = null; state.edge = null; sync(); }
    });
    el.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') {
        var n = ev.target.closest && ev.target.closest('[data-node]');
        if (n) { ev.preventDefault(); selectNode(n.getAttribute('data-node')); }
      }
    });
    function hoverAt(t) {
      var n = t.closest && t.closest('[data-node]'), id = n ? n.getAttribute('data-node') : (t.closest && t.closest('[data-gid]') ? t.closest('[data-gid]').getAttribute('data-gid') : null);
      if (id !== state.hover) { state.hover = id; applyClasses(); }
    }
    $('zin').onclick = function () { var r = el.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1.25); };
    $('zout').onclick = function () { var r = el.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 0.8); };
    $('zfit').onclick = fit;
  }

  /* ---------- selection, flows ---------- */

  function selectNode(id) {
    state.sel = state.sel === id ? null : id; state.edge = null; state.flow = null;
    sync();
  }
  function setFlow(id) {
    if (state.flow === id) id = null;
    state.flow = id; state.step = 0; state.sel = null; state.edge = null;
    sync();
  }
  function setStep(i) {
    if (!state.flow) return;
    var n = flowById[state.flow].steps.length;
    state.step = Math.max(0, Math.min(n - 1, i));
    state.sel = null; state.edge = null;
    sync();
  }
  function clearAll() {
    if (state.sel || state.edge) { state.sel = null; state.edge = null; }
    else if (state.flow) { state.flow = null; }
    sync();
  }

  function sync() {
    renderChips(); renderPanel(); renderStepbar(); renderList();
    if (!isMobile && scene && $('svg')) applyClasses();
    writeHash();
    if (!user.moved && !isMobile) fit();
  }

  /* ---------- chips, panel, step bar ---------- */

  function renderChips() {
    $('flowchips').innerHTML = DATA.flows.map(function (f) {
      return '<button class="chip" type="button" data-flow="' + f.id + '" aria-pressed="' + (state.flow === f.id) + '" title="' + esc(f.summary) + '">' + esc(f.name) + '<span class="n">' + f.steps.length + '</span></button>';
    }).join('');
  }

  function zoneChip(id) { var z = zoneById[id]; return '<span class="zone z-' + id + '"><i></i>' + esc(z.label) + '</span>'; }
  function relList(items) {
    if (!items.length) return '<p class="rd" style="color:var(--fg3)">Yok.</p>';
    return '<ul class="rel">' + items.map(function (it) {
      return '<li><button type="button" data-node="' + it.node + '" data-edge-hl="' + it.edge.id + '"><span class="rn">' + esc(nm(it.node)) + '</span><span class="rp">' + esc(it.edge.label) + '</span><span class="rd">' + esc(it.edge.detail) + '</span></button></li>';
    }).join('') + '</ul>';
  }

  function renderPanel() {
    var p = $('panel'), html = '';
    var closeBtn = '<button class="iconbtn close" type="button" id="pclose" aria-label="Kapat"><svg aria-hidden="true"><use href="#i-close"/></svg></button>';
    if (state.sel) {
      var n = nodeById[state.sel], ids = [n.id].concat(kids[n.id] || []);
      var es = edgesOf(n.id);
      var callers = es.filter(function (e) { return ids.indexOf(e.to) >= 0 && ids.indexOf(e.from) < 0; }).map(function (e) { return { node: e.from, edge: e }; });
      var deps = es.filter(function (e) { return ids.indexOf(e.from) >= 0 && ids.indexOf(e.to) < 0; }).map(function (e) { return { node: e.to, edge: e }; });
      html += closeBtn + zoneChip(n.zone) + '<h2>' + esc(n.name) + '</h2><p class="role">' + esc(n.role) + '</p><p>' + esc(n.summary) + '</p>';
      if (n.parent) html += '<p style="color:var(--fg3);font-size:12.5px">Bağlı olduğu servis: <button class="linkbtn" data-node="' + n.parent + '">' + esc(nm(n.parent)) + '</button></p>';
      html += '<h3>Teknoloji</h3><div class="tags">' + n.tech.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') + '</div>';
      html += '<h3>Erişim bölgesi</h3><p>' + esc(n.access) + '</p><h3>Ölçek</h3><p>' + esc(n.scale) + '</p>';
      if (n.parts) html += '<h3>İçeriği</h3><ul class="parts">' + n.parts.map(function (x) { return '<li><b>' + esc(x.name) + ':</b> ' + esc(x.text) + '</li>'; }).join('') + '</ul>';
      if (kids[n.id]) html += '<h3>Modüller</h3><ul class="rel">' + kids[n.id].map(function (k) { return '<li><button type="button" data-node="' + k + '"><span class="rn">' + esc(nm(k)) + '</span><span class="rd">' + esc(nodeById[k].role) + '</span></button></li>'; }).join('') + '</ul>';
      if (n.keys) html += '<h3>' + esc(n.keysTitle || 'Ayrıntılar') + '</h3><dl class="kv">' + n.keys.map(function (k) { return '<dt>' + esc(k.k) + '</dt><dd>' + esc(k.v) + '</dd>'; }).join('') + '</dl>';
      if (n.facts) html += '<dl class="kv" style="margin-top:12px">' + n.facts.map(function (k) { return '<dt>' + esc(k.k) + '</dt><dd>' + esc(k.v) + '</dd>'; }).join('') + '</dl>';
      html += '<h3>Kullanan (çağıranlar)</h3>' + relList(callers) + '<h3>Bağımlılıkları (çağırdıkları)</h3>' + relList(deps);
      var fl = DATA.flows.filter(function (f) { return f.steps.some(function (s) { return (s.edge && ids.indexOf(edgeById[s.edge].from) >= 0) || (s.edge && ids.indexOf(edgeById[s.edge].to) >= 0) || (s.node && ids.indexOf(s.node) >= 0); }); });
      if (fl.length) html += '<h3>Katıldığı akışlar</h3><div class="flows" style="flex-wrap:wrap">' + fl.map(function (f) { return '<button class="chip" type="button" data-flow="' + f.id + '">' + esc(f.name) + '</button>'; }).join('') + '</div>';
      html += '<h3>İlgili README bölümü</h3><div class="tags">' + n.readme.map(function (t) { return '<span class="tag" style="font-family:var(--font)">' + esc(t) + '</span>'; }).join('') + '</div>';
    } else if (state.edge) {
      var e = edgeById[state.edge];
      html += closeBtn + '<span class="tag">' + (e.kind === 'control' ? 'kontrol' : e.kind === 'future' ? 'ileride' : 'veri') + '</span><h2>' + esc(nm(e.from)) + ' → ' + esc(nm(e.to)) + '</h2><p class="role">' + esc(e.label) + '</p><p>' + esc(e.detail) + '</p>' +
        '<h3>Uçlar</h3><ul class="rel"><li><button type="button" data-node="' + e.from + '"><span class="rn">' + esc(nm(e.from)) + '</span><span class="rd">Çağıran</span></button></li><li><button type="button" data-node="' + e.to + '"><span class="rn">' + esc(nm(e.to)) + '</span><span class="rd">Çağrılan</span></button></li></ul>';
    }
    if (!html) { p.hidden = true; p.innerHTML = ''; return; }
    p.hidden = false; p.innerHTML = html;
    p.scrollTop = 0;
  }

  function renderStepbar() {
    var b = $('stepbar');
    if (!state.flow) { b.hidden = true; return; }
    var f = flowById[state.flow], s = f.steps[state.step], n = f.steps.length;
    b.hidden = false;
    var ed = s.edge ? (s.reverse ? nm(edgeById[s.edge].to) + ' → ' + nm(edgeById[s.edge].from) : nm(edgeById[s.edge].from) + ' → ' + nm(edgeById[s.edge].to)) : nm(s.node);
    b.innerHTML = '<button type="button" id="sprev" aria-label="Önceki adım"' + (state.step === 0 ? ' disabled' : '') + '><svg aria-hidden="true"><use href="#i-prev"/></svg></button>' +
      '<span class="sn">' + (state.step + 1) + ' / ' + n + '</span><div class="st"><b>' + esc(f.name) + ' · ' + esc(ed) + '</b>' + esc(s.text) + '</div>' +
      '<button type="button" id="snext" aria-label="Sonraki adım"' + (state.step === n - 1 ? ' disabled' : '') + '><svg aria-hidden="true"><use href="#i-next"/></svg></button>' +
      '<button type="button" class="x" id="sexit">Çık</button>';
    $('sr').textContent = 'Adım ' + (state.step + 1) + ' / ' + n + ': ' + s.text;
  }

  /* ---------- mobile list ---------- */

  function renderList() {
    var el = $('maplist'); if (!el) return;
    var html = '';
    if (state.flow) {
      var f = flowById[state.flow];
      html += '<h2>' + esc(f.name) + '</h2><p style="margin:0 0 12px;color:var(--fg2)">' + esc(f.summary) + '</p><ol class="steps">' + f.steps.map(function (s, i) {
        var ed = s.edge ? (s.reverse ? nm(edgeById[s.edge].to) + ' → ' + nm(edgeById[s.edge].from) : nm(edgeById[s.edge].from) + ' → ' + nm(edgeById[s.edge].to)) : nm(s.node);
        return '<li><button type="button" data-step="' + i + '"' + (i === state.step ? ' aria-current="step"' : '') + '><span class="num">' + (i + 1) + '</span><span class="tx">' + esc(s.text) + '<span class="ed">' + esc(ed) + '</span></span></button></li>';
      }).join('') + '</ol>';
    } else {
      var last = '';
      DATA.nodes.filter(function (n) { return n.kind !== 'group'; }).sort(function (a, b) { return DATA.tiers.indexOf(tierById[a.tier]) - DATA.tiers.indexOf(tierById[b.tier]); }).forEach(function (n) {
        var t = tierById[n.tier], pl = DATA.planes.filter(function (p) { return p.id === t.plane; })[0];
        if (t.id !== last) { html += '<h2>' + esc(pl.label) + ' · ' + esc(t.label) + '</h2>'; last = t.id; }
        html += '<button class="lcard zone-' + n.zone + (n.zone === 'future' ? ' future' : '') + '" type="button" data-node="' + n.id + '"><span class="li"><svg aria-hidden="true"><use href="#i-' + n.icon + '"/></svg></span><span><b>' + esc(n.name) + '</b><span>' + esc(n.role) + '</span></span></button>';
      });
    }
    el.innerHTML = html;
  }

  /* ---------- pages ---------- */

  function renderPages() {
    var rows = DATA.nodes.map(function (n) {
      var t = tierById[n.tier], pre = n.parent ? '<span style="color:var(--fg3)">· </span>' : '';
      return '<tr data-node="' + n.id + '"><td><span class="nm">' + pre + esc(n.name) + '</span><span class="rl">' + esc(n.role) + '</span></td><td>' + esc(t.label) + '</td><td>' + zoneChip(n.zone) + '</td><td class="col-hide">' + esc(n.tech.join(', ')) + '</td><td class="col-hide">' + esc(n.readme.join('; ')) + '</td></tr>';
    }).join('');
    $('components').innerHTML = '<h2>Bileşenler</h2><p class="lead">Haritadaki her bileşen: rolü, katmanı, erişim bölgesi, teknolojisi ve planın ilgili bölümü. Satıra tıklayınca haritada seçilir.</p>' +
      '<table><thead><tr><th>Bileşen</th><th>Katman</th><th>Bölge</th><th class="col-hide">Teknoloji</th><th class="col-hide">README bölümü</th></tr></thead><tbody>' + rows + '</tbody></table>';

    $('flowspage').innerHTML = '<h2>Akışlar</h2><p class="lead">Beş temel akış, numaralı adımlarıyla. Haritada göstermek için kartın düğmesini kullanın.</p>' + DATA.flows.map(function (f) {
      return '<div class="fcard"><h3>' + esc(f.name) + '</h3><p>' + esc(f.summary) + '</p><ol>' + f.steps.map(function (s) {
        var ed = s.edge ? (s.reverse ? nm(edgeById[s.edge].to) + ' → ' + nm(edgeById[s.edge].from) : nm(edgeById[s.edge].from) + ' → ' + nm(edgeById[s.edge].to)) : nm(s.node);
        return '<li>' + esc(s.text) + ' <span class="ed">' + esc(ed) + '</span></li>';
      }).join('') + '</ol><button class="chip" type="button" data-showflow="' + f.id + '">Haritada göster</button></div>';
    }).join('');

    function line(cls, dash, w) { return '<svg viewBox="0 0 70 26" aria-hidden="true"><path d="M4 13H62" stroke="var(--edge)" stroke-width="' + w + '" stroke-dasharray="' + dash + '" stroke-linecap="round" fill="none"/><path d="M62 8.5 70 13 62 17.5z" fill="var(--edge)"/></svg>'; }
    function swatch(z) { return '<svg viewBox="0 0 70 26" aria-hidden="true" class="zone-' + z + (z === 'future' ? ' future' : '') + '"><polygon class="t-front" points="8,16 52,16 52,23 8,23"/><polygon class="t-side" points="52,6 60,6 60,23 52,16"/><polygon class="t-top" points="8,6 52,6 52,16 8,16" style="stroke-dasharray:' + (z === 'future' ? '3 2' : 'none') + '"/></svg>'; }
    $('about').innerHTML = '<div class="about"><h2>Hakkında</h2><p class="lead">' + esc(DATA.meta.description) + ' Harita, planın ("README.md") dağıtım ve akış bölümlerinin etkileşimli özetidir; içerik tek bir veri dosyasından (topology.json) üretilir.</p>' +
      '<h3>Erişim bölgesi renkleri</h3><div class="legend">' + DATA.zones.map(function (z) { return '<div class="lg">' + swatch(z.id) + '<b>' + esc(z.label) + '</b><span>' + esc(z.text) + '</span></div>'; }).join('') + '</div>' +
      '<h3>Çizgiler</h3><div class="legend"><div class="lg">' + line('d', 'none', 1.7) + '<b>Veri yolu</b><span>İstek ve veri trafiği. Ok, çağıranı çağrılana bağlar.</span></div><div class="lg">' + line('c', '1.5 4.5', 2) + '<b>Kontrol</b><span>Secret enjeksiyonu, telemetri, deploy gibi yönetim akışları.</span></div><div class="lg">' + line('f', '6 5', 1.5) + '<b>İleride</b><span>Bugün olmayan, sonradan eklenecek bağlantı.</span></div></div>' +
      '<h3>Nasıl okunur</h3><ul><li>İki düzlem vardır: üstte çalışma zamanı (sütunlar soldan sağa istemciden dış servise), altta platform ve operasyon.</li><li>Bir bileşeni seçince yalnız ona bağlı olanlar vurgulanır; panelde "Kullanan" ve "Bağımlılıkları" listelenir.</li><li>Akış düğmeleri numaralı adımları gösterir. Aynı bağlantı birden çok adımda geçiyorsa numaralar birleşik yazılır (örnek 5·6·9).</li><li>3D ve 2D aynı yerleşimin iki izdüşümüdür. Dar ekranlarda (900 px altı) liste görünümü kullanılır.</li></ul>' +
      '<h3>Klavye</h3><ul><li><span class="kbd">3</span> <span class="kbd">2</span> 3D ve 2D görünüm</li><li><span class="kbd">←</span> <span class="kbd">→</span> seçili akışta önceki ve sonraki adım</li><li><span class="kbd">Esc</span> seçimi, sonra akışı temizler</li><li><span class="kbd">Tab</span> ve <span class="kbd">Enter</span> bileşenler arasında gezinme ve seçme</li></ul>' +
      '<h3>Bağlantı adresi</h3><ul><li>Adres çubuğundaki bölüm seçimi saklar: <span class="kbd">#view=2d&amp;flow=search&amp;step=3&amp;node=redis</span></li></ul>' +
      '<p class="note">Yazı tipi Geist ve Geist Mono, SIL Open Font License 1.1 kapsamındadır (c) Vercel ve basement.studio. Sayfa tek dosyadır, dış istek yapmaz.</p></div>';
  }

  /* ---------- tabs, hash, theme, keys ---------- */

  function showView() {
    var v = state.view;
    ['map', 'components', 'flows', 'about'].forEach(function (id) {
      $('view-' + id).classList.toggle('on', id === v);
      var t = $('tab-' + id); t.setAttribute('aria-selected', id === v ? 'true' : 'false'); t.tabIndex = id === v ? 0 : -1;
    });
    $('mapbar').style.display = v === 'map' ? '' : 'none';
    document.body.setAttribute('data-view', v);
    document.querySelectorAll('#projseg button').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-proj') === state.proj ? 'true' : 'false'); });
    if (v === 'map' && !isMobile) { if (!$('svg') || !scene || scene.mode !== state.proj) renderMap(); else fit(); }
  }

  function writeHash() {
    var parts = [];
    var v = state.view === 'map' ? state.proj : state.view;
    parts.push('view=' + v);
    if (state.flow) { parts.push('flow=' + state.flow); parts.push('step=' + (state.step + 1)); }
    if (state.sel) parts.push('node=' + state.sel);
    try { history.replaceState(null, '', '#' + parts.join('&')); } catch (e) { /* file:// in some browsers */ }
  }
  function readHash() {
    var h = location.hash.replace(/^#/, ''), o = {};
    state.flow = null; state.sel = null; state.edge = null; state.step = 0;
    h.split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) o[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
    if (o.view === '3d' || o.view === '2d') { state.view = 'map'; state.proj = o.view; }
    else if (o.view === 'components' || o.view === 'flows' || o.view === 'about') state.view = o.view;
    if (o.flow && flowById[o.flow]) { state.flow = o.flow; var s = parseInt(o.step, 10); state.step = isNaN(s) ? 0 : Math.max(0, Math.min(flowById[o.flow].steps.length - 1, s - 1)); }
    if (o.node && nodeById[o.node] && !state.flow) state.sel = o.node;
  }

  function goView(v) {
    state.view = v; showView(); writeHash();
  }

  function setTheme(t) {
    state.theme = t;
    var root = document.documentElement;
    if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
    try { if (t === 'auto') localStorage.removeItem('tvtopo-theme'); else localStorage.setItem('tvtopo-theme', t); } catch (e) { /* storage blocked */ }
    var ic = t === 'light' ? 'sun' : t === 'dark' ? 'moon' : 'auto', lbl = t === 'light' ? 'Tema: açık' : t === 'dark' ? 'Tema: koyu' : 'Tema: sistem';
    $('theme').innerHTML = '<svg aria-hidden="true"><use href="#i-' + ic + '"/></svg>';
    $('theme').setAttribute('aria-label', lbl); $('theme').title = lbl;
  }

  function checkMobile() {
    var m = window.innerWidth < 900;
    if (m !== isMobile) { isMobile = m; if (!m && state.view === 'map') { renderMap(); } }
  }

  function wire() {
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      var tab = t.closest('[data-view]'); if (tab && tab.classList.contains('tab')) { goView(tab.getAttribute('data-view')); return; }
      var pj = t.closest('#projseg [data-proj]'); if (pj) { state.proj = pj.getAttribute('data-proj'); state.view = 'map'; showView(); writeHash(); return; }
      var fc = t.closest('[data-flow]'); if (fc) { state.view = 'map'; showView(); setFlow(fc.getAttribute('data-flow')); return; }
      var sf = t.closest('[data-showflow]'); if (sf) { state.view = 'map'; state.flow = null; showView(); setFlow(sf.getAttribute('data-showflow')); return; }
      var st = t.closest('[data-step]'); if (st && !t.closest('#canvas')) { setStep(+st.getAttribute('data-step')); return; }
      if (t.closest('#sprev')) { setStep(state.step - 1); return; }
      if (t.closest('#snext')) { setStep(state.step + 1); return; }
      if (t.closest('#sexit')) { state.flow = null; sync(); return; }
      if (t.closest('#pclose')) { if (state.sel || state.edge) { state.sel = null; state.edge = null; } else state.flow = null; sync(); return; }
      if (t.closest('#theme')) { setTheme(state.theme === 'auto' ? 'light' : state.theme === 'light' ? 'dark' : 'auto'); return; }
      var nd = t.closest('#panel [data-node], #maplist [data-node], #components [data-node]');
      if (nd) { var id = nd.getAttribute('data-node'); state.view = 'map'; state.flow = null; state.sel = id; state.edge = null; showView(); sync(); return; }
    });
    document.querySelectorAll('.tab').forEach(function (b) {
      b.addEventListener('keydown', function (ev) {
        var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab')), i = tabs.indexOf(b);
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') { ev.preventDefault(); var nx = tabs[(i + (ev.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; nx.focus(); goView(nx.getAttribute('data-view')); }
      });
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (ev.key === 'Escape') { if (state.view === 'map') { clearAll(); } return; }
      if (state.view !== 'map') return;
      var inTabs = ev.target.closest && ev.target.closest('.tabs');
      if (ev.key === 'ArrowRight' && state.flow && !inTabs) { ev.preventDefault(); setStep(state.step + 1); }
      else if (ev.key === 'ArrowLeft' && state.flow && !inTabs) { ev.preventDefault(); setStep(state.step - 1); }
      else if (ev.key === '3' && !isMobile) { state.proj = '3d'; showView(); writeHash(); }
      else if (ev.key === '2' && !isMobile) { state.proj = '2d'; showView(); writeHash(); }
    });
    window.addEventListener('resize', function () { checkMobile(); if (!isMobile && !user.moved && $('svg')) fit(); });
    window.addEventListener('hashchange', function () { readHash(); showView(); sync(); });
  }

  function init() {
    var saved = null; try { saved = localStorage.getItem('tvtopo-theme'); } catch (e) { /* ignore */ }
    setTheme(saved === 'light' || saved === 'dark' ? saved : 'auto');
    isMobile = window.innerWidth < 900;
    readHash();
    renderPages(); wireCanvas(); wire();
    showView(); renderChips(); renderPanel(); renderStepbar(); renderList();
    if (!isMobile) { if ($('svg')) applyClasses(); }
    writeHash();
  }

  init();
})();
