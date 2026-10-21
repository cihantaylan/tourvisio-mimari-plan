#!/usr/bin/env node
'use strict';
/* Checks topology.json (schema, references, placement), the content rules, the layout geometry and that
 * dist/tourvisio-topology.html is current. Prints "verify: OK" and exits 0, or lists every problem and exits 1. */
const fs = require('fs');
const path = require('path');
const { build, OUT } = require('./build.cjs');
const Geo = require('./src/geometry.js');

const ROOT = __dirname;
const errors = [];
const warnings = [];
const fail = (m) => errors.push(m);

const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'topology.json'), 'utf8'));
const icons = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'icons.json'), 'utf8'));

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const uniq = (list, what) => {
  const seen = new Set();
  for (const id of list) { if (seen.has(id)) fail(`${what}: duplicate id "${id}"`); seen.add(id); }
  return seen;
};

// meta
for (const k of ['title', 'subtitle', 'description']) if (!isStr(data.meta && data.meta[k])) fail(`meta.${k} is required`);

// zones, planes, tiers
const zoneIds = uniq((data.zones || []).map((z) => z.id), 'zones');
for (const z of data.zones || []) if (!isStr(z.label) || !isStr(z.text)) fail(`zone ${z.id}: label and text are required`);
for (const need of ['public', 'internal', 'external', 'future']) if (!zoneIds.has(need)) fail(`zones: "${need}" is missing`);
const planeIds = uniq((data.planes || []).map((p) => p.id), 'planes');
const tierIds = uniq((data.tiers || []).map((t) => t.id), 'tiers');
const tierById = {};
for (const t of data.tiers || []) {
  tierById[t.id] = t;
  if (!planeIds.has(t.plane)) fail(`tier ${t.id}: unknown plane "${t.plane}"`);
  if (!isStr(t.label)) fail(`tier ${t.id}: label is required`);
  if (!Array.isArray(t.cols) || !t.cols.length || !t.cols.every(isNum)) fail(`tier ${t.id}: cols must be a number list`);
}

// nodes
const nodeIds = uniq((data.nodes || []).map((n) => n.id), 'nodes');
const nodeById = {};
for (const n of data.nodes || []) nodeById[n.id] = n;
const taken = new Map();
for (const n of data.nodes || []) {
  const w = `node ${n.id}`;
  for (const k of ['name', 'label', 'icon', 'tier', 'zone', 'role', 'summary', 'access', 'scale']) if (!isStr(n[k])) fail(`${w}: "${k}" is required`);
  if (!Array.isArray(n.tech) || !n.tech.length || !n.tech.every(isStr)) fail(`${w}: tech must be a non-empty string list`);
  if (!Array.isArray(n.readme) || !n.readme.length || !n.readme.every(isStr)) fail(`${w}: readme must be a non-empty string list`);
  if (isStr(n.icon) && !icons[n.icon]) fail(`${w}: unknown icon "${n.icon}"`);
  if (!zoneIds.has(n.zone)) fail(`${w}: unknown zone "${n.zone}"`);
  if (!tierById[n.tier]) { fail(`${w}: unknown tier "${n.tier}"`); continue; }
  if (isStr(n.label) && n.label.length > 24) fail(`${w}: label longer than 24 characters does not fit a tile`);
  if (n.kind === 'group') {
    if (!isStr(n.caption)) fail(`${w}: group needs a caption`);
    if (!(data.nodes || []).some((k) => k.parent === n.id)) fail(`${w}: group has no children`);
    continue;
  }
  if (!isNum(n.col) || !isNum(n.row)) { fail(`${w}: col and row must be numbers`); continue; }
  if (!tierById[n.tier].cols.some((c) => Math.abs(c - n.col) < 0.5)) fail(`${w}: col ${n.col} is outside tier "${n.tier}" columns`);
  const spot = `${tierById[n.tier].plane}:${n.col}:${n.row}`;
  if (taken.has(spot)) fail(`${w}: shares grid position ${spot} with ${taken.get(spot)}`);
  taken.set(spot, n.id);
  if (n.parent) {
    const p = nodeById[n.parent];
    if (!p || p.kind !== 'group') fail(`${w}: parent "${n.parent}" is not a group`);
    else if (p.tier !== n.tier) fail(`${w}: tier differs from its parent group`);
  }
}

// edges
const edgeIds = uniq((data.edges || []).map((e) => e.id), 'edges');
const edgeById = {};
const pairs = new Set();
for (const e of data.edges || []) {
  edgeById[e.id] = e;
  const w = `edge ${e.id}`;
  if (!nodeIds.has(e.from)) fail(`${w}: unknown from "${e.from}"`);
  if (!nodeIds.has(e.to)) fail(`${w}: unknown to "${e.to}"`);
  if (e.from === e.to) fail(`${w}: from and to are the same`);
  if (!isStr(e.label) || !isStr(e.detail)) fail(`${w}: label and detail are required`);
  if (e.kind !== undefined && !['data', 'control', 'future'].includes(e.kind)) fail(`${w}: kind must be data, control or future`);
  const pk = `${e.from}>${e.to}`;
  if (pairs.has(pk)) fail(`${w}: duplicate connection ${pk}`);
  pairs.add(pk);
}

// flows
uniq((data.flows || []).map((f) => f.id), 'flows');
for (const f of data.flows || []) {
  const w = `flow ${f.id}`;
  if (!isStr(f.name) || !isStr(f.summary)) fail(`${w}: name and summary are required`);
  if (!Array.isArray(f.steps) || !f.steps.length) { fail(`${w}: steps are required`); continue; }
  f.steps.forEach((s, i) => {
    const sw = `${w} step ${i + 1}`;
    if (!isStr(s.text)) fail(`${sw}: text is required`);
    if ((s.edge ? 1 : 0) + (s.node ? 1 : 0) !== 1) fail(`${sw}: exactly one of edge or node`);
    if (s.edge && !edgeIds.has(s.edge)) fail(`${sw}: unknown edge "${s.edge}"`);
    if (s.node && !nodeIds.has(s.node)) fail(`${sw}: unknown node "${s.node}"`);
    if (s.reverse && !s.edge) fail(`${sw}: reverse needs an edge`);
  });
}
const flowIds = new Set((data.flows || []).map((f) => f.id));
for (const need of ['search', 'list', 'token', 'auth', 'deploy']) if (!flowIds.has(need)) fail(`flows: "${need}" is missing`);

// connectivity: every node has an edge, or sits inside a group that has one
const touched = new Set();
for (const e of data.edges || []) { touched.add(e.from); touched.add(e.to); }
for (const n of data.nodes || []) if (n.kind !== 'group' && !touched.has(n.id) && !touched.has(n.parent)) fail(`node ${n.id}: has no connection`);

// geometry: both projections must lay out, route every edge and keep tiles apart
if (!errors.length) {
  for (const mode of ['3d', '2d']) {
    const L = Geo.layout(data, mode);
    const routes = Geo.routeEdges(data, L, () => 0);
    for (const e of data.edges) {
      const r = routes[e.id];
      if (!r || !r.d || /NaN|undefined/.test(r.d)) fail(`${mode}: edge ${e.id} has no valid route`);
    }
    const rects = Object.values(L.R).filter((r) => !r.group);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (a.plane === b.plane && a.u0 < b.u1 && a.u1 > b.u0 && a.v0 < b.v1 && a.v1 > b.v0) fail(`${mode}: tiles ${a.id} and ${b.id} overlap`);
      }
    }
  }
}

// content rules
const forbidden = [['em dash', new RegExp(String.fromCharCode(0x2014))], ['legacy product name', new RegExp(['jax', 'suite'].join(''), 'i')]];
const scanned = [['topology.json', fs.readFileSync(path.join(ROOT, 'topology.json'), 'utf8')]];
if (fs.existsSync(OUT)) scanned.push(['dist/tourvisio-topology.html', fs.readFileSync(OUT, 'utf8')]);
for (const f of ['build.cjs', 'verify.cjs', 'README.md', 'src/app.js', 'src/geometry.js', 'src/styles.css', 'src/index.template.html', 'src/icons.json']) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) scanned.push([f, fs.readFileSync(p, 'utf8')]);
}
for (const [name, text] of scanned) for (const [label, re] of forbidden) if (re.test(text)) fail(`${name}: contains ${label}`);

// no external requests in the built page
if (fs.existsSync(OUT)) {
  const html = fs.readFileSync(OUT, 'utf8');
  const external = [/\b(?:src|href|action)\s*=\s*["']\s*(?:https?:)?\/\//i, /url\(\s*["']?(?:https?:)?\/\//i, /@import/i, /\bfetch\s*\(/, /XMLHttpRequest/, /<link[^>]+rel=["']?(?:stylesheet|preload|prefetch)/i, /<script[^>]+src=/i];
  for (const re of external) if (re.test(html)) fail(`dist: external reference matches ${re}`);
}

// dist freshness
if (!fs.existsSync(OUT)) fail('dist/tourvisio-topology.html is missing, run node topology/build.cjs');
else if (fs.readFileSync(OUT, 'utf8') !== build()) fail('dist/tourvisio-topology.html is stale, run node topology/build.cjs');

// README headings (warning only: the plan is edited elsewhere)
const readme = path.join(ROOT, '..', 'README.md');
if (fs.existsSync(readme)) {
  const heads = new Set(fs.readFileSync(readme, 'utf8').split('\n').filter((l) => /^#{2,4} /.test(l))
    .map((l) => l.replace(/^#+\s+/, '').replace(/^\d+[a-z]?\.?\d*\.?\s+/, '').replace(/`/g, '').trim()));
  for (const n of data.nodes) for (const r of n.readme || []) if (!heads.has(r)) warnings.push(`node ${n.id}: README section "${r}" not found in ../README.md headings`);
}

for (const w of warnings) console.warn(`verify: warning: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`verify: ${e}`);
  console.error(`verify: FAILED (${errors.length} problem${errors.length === 1 ? '' : 's'})`);
  process.exit(1);
}
console.log(`verify: OK (${data.nodes.length} nodes, ${data.edges.length} edges, ${data.flows.length} flows)`);
