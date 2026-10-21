const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { findHardcodedColors, checkColors } = require('../tools/check-colors.cjs');

test('all application CSS colors come from the palette, loaded first, with defined variables', () => {
  const result = checkColors(path.join(__dirname, '..'));
  assert.deepEqual(result.errors, []);
  assert.ok(result.files >= 13);
});

test('palette enforcement catches gradients, alpha colors, named colors and variable fallbacks', () => {
  for (const source of [
    '.panel { color: #abc; }',
    '.panel { box-shadow: 0 2px #0007; }',
    '.panel { background: linear-gradient(var(--panel), #123456); }',
    '.panel { border-color: rgba(1, 2, 3, 0.5); }',
    '.panel { color: hsl(210 30% 40%); }',
    '.panel { color: oklch(60% 0.1 200); }',
    '.panel { color: color(display-p3 1 0 0); }',
    '.panel { color: rebeccapurple; }',
    '.panel { fill: transparent; }',
    '.panel { color: var(--missing, white); }',
    ':root { --local-color: red; }',
  ])
    assert.ok(findHardcodedColors(source).length > 0, source);
});

test('palette enforcement understands CSS syntax rather than mistaking selectors or strings for colors', () => {
  const source = `
    /* red and #fff in explanatory comments are not declarations. */
    #abc.red { color: var(--ink); border-color: currentColor; white-space: nowrap; }
    .hint::after { content: "white #fff rgb(1,2,3)"; }
    .icon { filter: url(#red); }
    .panel { background: linear-gradient(var(--button-bg-top), var(--button-bg-bottom)); }
  `;
  assert.deepEqual(findHardcodedColors(source), []);
});
