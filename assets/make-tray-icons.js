#!/usr/bin/env node
// Draws the tray mark — the eight-ray spark, once per status colour.
//
// The tray icon is the only part of vibecheck that's on screen the whole
// time, so it carries the answer rather than sitting next to it: green while
// Claude is fine, amber and orange and red as that stops being true. Same
// spark the pill wears, cut down to survive sixteen pixels — the pill's own
// twelve-ray path turns to porridge at that size, and eight tapered rays
// with a solid hub don't.
//
// Colours are a shade deeper than the pill's. The pill only ever paints on
// its own near-black panel; a tray icon has to hold up on a white macOS
// menu bar too, and the pill's yellow disappears there.
//
// Not run at build time — it needs Inkscape, and the PNGs it writes are
// committed. Re-run it by hand if the mark changes:
//
//   node assets/make-tray-icons.js
//
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const OUT = __dirname;
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'vibecheck-icons-'));

const COLORS = {
  none: '#2fc186',
  minor: '#d69a10',
  major: '#e2762a',
  critical: '#e23c33',
  unknown: '#7f8797',
};

// Geometry, in a 16×16 box: eight rays from a solid hub, each one a wedge
// that tapers from w0 at the centre to a rounded w1 tip at radius R.
const N = 8;
const R = 7.3;
const W0 = 3.6;
const W1 = 1.6;
const HUB = 2;

function spark(color) {
  const c = 8;
  const rays = [];
  for (let i = 0; i < N; i++) {
    const a = (i * 2 * Math.PI) / N;
    const r = R - W1 / 2; // the tip's round cap reaches the rest of the way
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const px = -dy; // perpendicular, for the wedge's two sides
    const py = dx;
    const tx = c + dx * r;
    const ty = c + dy * r;
    const p = (x, y) => `${x.toFixed(2)},${y.toFixed(2)}`;
    rays.push(
      `<path d="M${p(c + px * W0 / 2, c + py * W0 / 2)}` +
        ` L${p(tx + px * W1 / 2, ty + py * W1 / 2)}` +
        ` A${W1 / 2},${W1 / 2} 0 0 0 ${p(tx - px * W1 / 2, ty - py * W1 / 2)}` +
        ` L${p(c - px * W0 / 2, c - py * W0 / 2)} Z"/>`
    );
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">\n` +
    `  <g fill="${color}">\n    ${rays.join('\n    ')}\n` +
    `    <circle cx="${c}" cy="${c}" r="${HUB}"/>\n  </g>\n</svg>\n`
  );
}

// @2x sits next to the base file and nativeImage picks it up by name.
for (const [state, color] of Object.entries(COLORS)) {
  const svg = path.join(TMP, `${state}.svg`);
  fs.writeFileSync(svg, spark(color));
  for (const [size, suffix] of [[16, ''], [32, '@2x']]) {
    const png = path.join(OUT, `tray-${state}${suffix}.png`);
    execFileSync('inkscape', ['--export-type=png', '-w', String(size), '-h', String(size), svg, '-o', png], {
      stdio: 'ignore',
    });
    console.log(path.relative(process.cwd(), png));
  }
}

// The green one doubles as the mark's source of truth for anything else
// that wants it — the readme, a website, a favicon.
fs.writeFileSync(path.join(OUT, 'spark.svg'), spark(COLORS.none));
fs.rmSync(TMP, { recursive: true, force: true });
