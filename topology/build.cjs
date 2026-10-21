#!/usr/bin/env node
'use strict';
/* Builds dist/tourvisio-topology.html: one self-contained file (data, scripts, styles, icons, fonts).
 * Node only, no dependencies, deterministic (no timestamps). `--check` exits 1 when dist is stale. */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'dist', 'tourvisio-topology.html');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const RANGES = {
  latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  'latin-ext': 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
};

function fontFaces() {
  const out = ['/* Geist and Geist Mono: SIL Open Font License 1.1, Copyright (c) 2023 Vercel / basement.studio (assets/fonts/OFL.txt) */'];
  for (const [family, prefix] of [['Geist', 'geist'], ['Geist Mono', 'geist-mono']]) {
    for (const subset of ['latin-ext', 'latin']) {
      const b64 = fs.readFileSync(path.join(ROOT, 'assets', 'fonts', `${prefix}-${subset}.woff2`)).toString('base64');
      out.push(`@font-face{font-family:'${family}';font-style:normal;font-weight:100 900;font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${RANGES[subset]}}`);
    }
  }
  return out.join('\n');
}

function icons() {
  const j = JSON.parse(read('src/icons.json'));
  return Object.keys(j).sort().map((id) =>
    `<symbol id="i-${id}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${j[id]}</symbol>`).join('\n');
}

function build() {
  const data = JSON.parse(read('topology.json'));
  const json = JSON.stringify(data).replace(/</g, () => String.fromCharCode(92) + 'u003c');
  const scripts = read('src/geometry.js') + '\n' + read('src/app.js');
  if (/<\/script/i.test(scripts)) throw new Error('script contains </script');
  const css = read('src/styles.css').replace('__FONTS__', () => fontFaces());
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return read('src/index.template.html')
    .replace(/__TITLE__/g, () => esc(data.meta.title))
    .replace(/__SUBTITLE__/g, () => esc(data.meta.subtitle))
    .replace(/__DESCRIPTION__/g, () => esc(data.meta.description))
    .replace('__STYLES__', () => css)
    .replace('__ICONS__', () => icons())
    .replace('__DATA__', () => json)
    .replace('__SCRIPTS__', () => scripts);
}

module.exports = { build, OUT };

if (require.main === module) {
  const html = build();
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur !== html) { console.error('build --check: dist/tourvisio-topology.html is stale, run node topology/build.cjs'); process.exit(1); }
    console.log('build --check: dist is current');
  } else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, html);
    console.log(`built ${path.relative(process.cwd(), OUT)} (${Math.round(html.length / 1024)} KB)`);
  }
}
