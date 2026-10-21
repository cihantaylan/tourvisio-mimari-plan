/* Geometry for the topology map: grid layout, isometric projection and edge routing.
 * Pure functions, no DOM. Exposed as the global `TopoGeo` (browser) and module.exports (node).
 *
 * Every node sits on a plane (a flat slab) at a grid position (col, row). The same layout is projected twice:
 * "3d" tilts the planes (yaw and tilt) and extrudes tiles, "2d" is the flat top view of the same grid.
 * Edges are routed in plane space (orthogonal lanes) and projected; edges between planes are screen-space curves.
 */
(function (root) {
  'use strict';

  var D2R = Math.PI / 180;
  var MODES = {
    '3d': {
      yaw: 12 * D2R, K: 0.47, colW: 182, rowH: 126, tw: 88, td: 50, h: 11, slab: 20, gap: 62,
      gPad: { back: 62, front: 20, side: 18 }, gz: 6, edgeZ: 3, planePad: { u: 8, back: 34, front: 34 }
    },
    '2d': {
      yaw: 0, K: 1, colW: 190, rowH: 96, tw: 136, td: 60, h: 0, slab: 0, gap: 74,
      gPad: { back: 40, front: 14, side: 12 }, gz: 0, edgeZ: 0, planePad: { u: 8, back: 36, front: 20 }
    }
  };

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  function layout(data, modeName) {
    var C = MODES[modeName], cs = Math.cos(C.yaw), sn = Math.sin(C.yaw);
    var byId = {}, planes = {}, order = [];
    data.nodes.forEach(function (n) { byId[n.id] = n; });
    data.planes.forEach(function (p) { planes[p.id] = { id: p.id, label: p.label, yoff: 0 }; order.push(planes[p.id]); });

    function P(pid, u, v, z) {
      return [u * cs - v * sn, (u * sn + v * cs) * C.K - (z || 0) + planes[pid].yoff];
    }

    // 1. node rectangles in plane space
    var R = {};
    data.nodes.forEach(function (n) {
      if (n.kind === 'group') return;
      var pl = planeOfTier(data, n.tier), cu = n.col * C.colW, cv = n.row * C.rowH;
      R[n.id] = { id: n.id, plane: pl, cu: cu, cv: cv, u0: cu - C.tw / 2, u1: cu + C.tw / 2, v0: cv - C.td / 2, v1: cv + C.td / 2, base: n.parent ? C.gz : 0, group: false };
    });
    data.nodes.forEach(function (n) {
      if (n.kind !== 'group') return;
      var kids = data.nodes.filter(function (k) { return k.parent === n.id; }).map(function (k) { return R[k.id]; });
      var u0 = Math.min.apply(null, kids.map(function (k) { return k.u0; })) - C.gPad.side;
      var u1 = Math.max.apply(null, kids.map(function (k) { return k.u1; })) + C.gPad.side;
      var v0 = Math.min.apply(null, kids.map(function (k) { return k.v0; })) - C.gPad.back;
      var v1 = Math.max.apply(null, kids.map(function (k) { return k.v1; })) + C.gPad.front;
      R[n.id] = { id: n.id, plane: kids[0].plane, cu: (u0 + u1) / 2, cv: (v0 + v1) / 2, u0: u0, u1: u1, v0: v0, v1: v1, base: 0, group: true };
    });
    Object.keys(R).forEach(function (id) { R[id].top = R[id].base + (R[id].group ? C.gz : C.h); });

    // 2. plane extents from tiers and node rectangles
    var ext = {};
    order.forEach(function (p) { ext[p.id] = { u0: 1e9, u1: -1e9, v0: 1e9, v1: -1e9 }; });
    var tierBands = [];
    data.tiers.forEach(function (t) {
      var e = ext[t.plane], a = (Math.min.apply(null, t.cols) - 0.5) * C.colW, b = (Math.max.apply(null, t.cols) + 0.5) * C.colW;
      e.u0 = Math.min(e.u0, a); e.u1 = Math.max(e.u1, b);
      tierBands.push({ id: t.id, label: t.label, plane: t.plane, u0: a, u1: b });
    });
    Object.keys(R).forEach(function (id) {
      var r = R[id], e = ext[r.plane];
      e.v0 = Math.min(e.v0, r.v0); e.v1 = Math.max(e.v1, r.v1);
    });
    order.forEach(function (p) {
      var e = ext[p.id];
      e.u0 -= C.planePad.u; e.u1 += C.planePad.u; e.v0 -= C.planePad.back; e.v1 += C.planePad.front;
    });

    // 3. stack planes vertically on screen
    var cursor = 0;
    order.forEach(function (p, i) {
      p.yoff = 0;
      var e = ext[p.id], ys = [P(p.id, e.u0, e.v0, 0)[1], P(p.id, e.u1, e.v0, 0)[1], P(p.id, e.u0, e.v1, 0)[1], P(p.id, e.u1, e.v1, 0)[1]];
      var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
      p.yoff = (i === 0 ? 0 : cursor + C.gap) - minY;
      cursor = maxY + p.yoff + C.slab + (C.slab ? 0 : 22);
      p.ext = e;
    });

    return { C: C, cs: cs, sn: sn, P: P, R: R, planes: planes, order: order, tierBands: tierBands, byId: byId, mode: modeName };
  }

  function planeOfTier(data, tierId) {
    for (var i = 0; i < data.tiers.length; i++) if (data.tiers[i].id === tierId) return data.tiers[i].plane;
    return data.planes[0].id;
  }

  /* ---------- edge routing ---------- */

  function dist(a, b) { var dx = b[0] - a[0], dy = b[1] - a[1]; return Math.sqrt(dx * dx + dy * dy); }
  function toward(a, b, d) { var l = dist(a, b) || 1; return [a[0] + (b[0] - a[0]) / l * d, a[1] + (b[1] - a[1]) / l * d]; }
  function f1(n) { return Math.round(n * 10) / 10; }

  /* Rounded orthogonal path in screen space. */
  function roundedPath(pts, r) {
    var d = 'M' + f1(pts[0][0]) + ' ' + f1(pts[0][1]);
    for (var i = 1; i < pts.length - 1; i++) {
      var a = pts[i - 1], b = pts[i], c = pts[i + 1], rr = Math.min(r, dist(a, b) / 2, dist(b, c) / 2);
      var p1 = toward(b, a, rr), p2 = toward(b, c, rr);
      d += 'L' + f1(p1[0]) + ' ' + f1(p1[1]) + 'Q' + f1(b[0]) + ' ' + f1(b[1]) + ' ' + f1(p2[0]) + ' ' + f1(p2[1]);
    }
    var l = pts[pts.length - 1];
    return d + 'L' + f1(l[0]) + ' ' + f1(l[1]);
  }

  function dedupe(pts) {
    var out = [];
    pts.forEach(function (p) { var l = out[out.length - 1]; if (!l || dist(l, p) > 0.5) out.push(p); });
    return out;
  }

  /* Returns { id, from, to, pts (screen polyline), d (svg path), tip:{x,y,a}, mid:{x,y}, cross } per edge.
   * `labelTop(id)` gives the screen y just above a node's label (used by edges that land on a platform tile). */
  function routeEdges(data, L, labelTop) {
    var C = L.C, R = L.R, P = L.P, out = {};
    var lanes = {};   // gutter x -> edge ids sharing it, spread into parallel lanes
    var slots = {};   // group id -> cross-plane edge ids, spread along its front edge

    var sameCache = {};
    data.edges.forEach(function (e) {
      var A = R[e.from], B = R[e.to];
      if (A.plane === B.plane) {
        var key = Math.round(gutterX(A.cu <= B.cu ? A : B, A.cu <= B.cu ? B : A, C));
        (lanes[key] = lanes[key] || []).push(e.id);
        sameCache[e.id] = key;
      } else {
        [A, B].forEach(function (n) { if (n.group) (slots[n.id] = slots[n.id] || []).push(e.id); });
      }
    });

    function otherX(gid, eid) {
      var e = data.edges.filter(function (x) { return x.id === eid; })[0], o = R[e.from === gid ? e.to : e.from];
      return P(o.plane, o.cu, o.cv, 0)[0];
    }
    Object.keys(slots).forEach(function (gid) { slots[gid].sort(function (p, q) { return otherX(gid, p) - otherX(gid, q); }); });

    // screen point where a cross-plane edge touches `node`
    function endPoint(node, other, eid) {
      var below = L.planes[node.plane].yoff > L.planes[other.plane].yoff;
      if (node.group) {
        var list = slots[node.id], i = list.indexOf(eid), margin = 26, span = (node.u1 - node.u0) - 2 * margin;
        return P(node.plane, node.u0 + margin + (list.length > 1 ? span * i / (list.length - 1) : span / 2), node.v1, 0);
      }
      if (below) return [P(node.plane, node.cu, node.cv, 0)[0], labelTop(node.id)];   // land just above the label
      return P(node.plane, node.cu, node.v1, 0);                                       // front face, bottom
    }

    data.edges.forEach(function (e) {
      var A = R[e.from], B = R[e.to], r = { id: e.id, from: e.from, to: e.to };
      if (A.plane === B.plane) {
        if (Math.abs(A.cu - B.cu) < 1) {   // same column: straight along the depth axis
          var u = A.cu, back = A.cv > B.cv;
          r.pts = (back ? [[u, A.v0], [u, B.v1 + 2]] : [[u, A.v1], [u, B.v0 - 2]]).map(function (q) { return P(A.plane, q[0], q[1], C.edgeZ); });
        } else {
          var fwd = A.cu <= B.cu, S = fwd ? A : B, T = fwd ? B : A;   // route left to right, flip afterwards
          var vs = anchorV(S, T), ve = anchorV(T, S), gx = gutterX(S, T, C), pl;
          var lo = Math.min(vs, ve) - 8, hi = Math.max(vs, ve) + 8, blocker = null;
          Object.keys(R).forEach(function (id) {
            var o = R[id];
            if (o.group || o.plane !== S.plane || o.u0 < S.u1 - 1 || o.u1 > T.u0 + 1 || o.v1 < lo || o.v0 > hi) return;
            if (!blocker || o.v1 > blocker.v1) blocker = o;
          });
          if (blocker) {   // a tile sits on the straight path: pass in front of it
            var dv = blocker.v1 + 20, lx = S.u1 + 20;
            pl = [[S.u1, vs], [lx, vs], [lx, dv], [T.u0 - 2, dv]];
          } else {
            var list = lanes[sameCache[e.id]];
            gx += (list.indexOf(e.id) - (list.length - 1) / 2) * 9;
            pl = [[S.u1, vs]];
            if (Math.abs(vs - ve) > 0.5) pl.push([gx, vs], [gx, ve]);
            pl.push([T.u0 - 2, ve]);
          }
          r.pts = pl.map(function (q) { return P(S.plane, q[0], q[1], C.edgeZ); });
          if (!fwd) r.pts.reverse();
        }
      } else {
        var pa = endPoint(A, B, e.id), pb = endPoint(B, A, e.id), dy = (pb[1] - pa[1]) * 0.55;
        r.cross = true;
        r.bez = [pa, [pa[0], pa[1] + dy], [pb[0], pb[1] - dy], pb];
      }
      out[e.id] = r;
    });

    // finalise: path, tip, midpoint
    Object.keys(out).forEach(function (id) {
      var r = out[id];
      if (r.bez) {
        var b = r.bez;
        r.d = 'M' + f1(b[0][0]) + ' ' + f1(b[0][1]) + 'C' + f1(b[1][0]) + ' ' + f1(b[1][1]) + ' ' + f1(b[2][0]) + ' ' + f1(b[2][1]) + ' ' + f1(b[3][0]) + ' ' + f1(b[3][1]);
        var t = 0.5, mt = 1 - t;
        r.mid = {
          x: mt * mt * mt * b[0][0] + 3 * mt * mt * t * b[1][0] + 3 * mt * t * t * b[2][0] + t * t * t * b[3][0],
          y: mt * mt * mt * b[0][1] + 3 * mt * mt * t * b[1][1] + 3 * mt * t * t * b[2][1] + t * t * t * b[3][1]
        };
        r.tip = { x: b[3][0], y: b[3][1], a: Math.atan2(b[3][1] - b[2][1], b[3][0] - b[2][0]) };
        r.pts = [b[0], b[3]];
        r.len = dist(b[0], b[3]);
      } else {
        r.pts = dedupe(r.pts);
        r.d = roundedPath(r.pts, 10);
        var n = r.pts.length, last = r.pts[n - 1], prev = r.pts[n - 2];
        r.tip = { x: last[0], y: last[1], a: Math.atan2(last[1] - prev[1], last[0] - prev[0]) };
        // label spot: middle of the longest segment
        var best = 0, bi = 0;
        for (var i = 0; i < n - 1; i++) { var dd = dist(r.pts[i], r.pts[i + 1]); if (dd > best) { best = dd; bi = i; } }
        r.mid = { x: (r.pts[bi][0] + r.pts[bi + 1][0]) / 2, y: (r.pts[bi][1] + r.pts[bi + 1][1]) / 2 };
        r.len = best;
      }
    });
    return out;
  }

  /* Vertical anchor on `self` facing `other`: a group is entered at the row of the node it talks to. */
  function anchorV(self, other) {
    if (self.group && !other.group) return clamp(other.cv, self.v0 + 12, self.v1 - 12);
    return self.cv;
  }

  function gutterX(S, T, C) {
    var s = S.cu <= T.cu ? S : T, t = S.cu <= T.cu ? T : S;
    var span = t.u0 - s.u1;
    // adjacent columns: middle of the gap; further apart: just before the target
    return span <= C.colW ? s.u1 + span / 2 : t.u0 - 26;
  }

  var api = { MODES: MODES, layout: layout, routeEdges: routeEdges, roundedPath: roundedPath };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TopoGeo = api;
})(typeof window !== 'undefined' ? window : this);
