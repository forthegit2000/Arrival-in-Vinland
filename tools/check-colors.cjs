/** Keep application CSS colors in one palette. Uses the existing CSS parser. */
const fs = require('node:fs');
const path = require('node:path');
const { parsers } = require('prettier/plugins/postcss');

const PALETTE = 'style/color-palette.css';
const COLOR_FUNCTIONS = new Set([
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
  'device-cmyk',
]);
const NAMED_COLORS = new Set(
  `
  aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue
  blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk
  crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki
  darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen
  darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue
  dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite
  gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki
  lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow
  lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray
  lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine
  mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen
  mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy
  oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise
  palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown
  royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue
  slategray slategrey snow springgreen steelblue tan teal thistle tomato transparent turquoise
  violet wheat white whitesmoke yellow yellowgreen
`
    .trim()
    .split(/\s+/),
);

function visit(node, callback) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) visit(child, callback);
    return;
  }
  callback(node);
  // Strings and URL references are not CSS color values (for example url(#red)).
  if (node.type === 'value-string' || (node.type === 'value-func' && node.value === 'url')) return;
  for (const [key, value] of Object.entries(node)) {
    if (!['source', 'raws'].includes(key) && value && typeof value === 'object')
      visit(value, callback);
  }
}

function findHardcodedColors(source) {
  const problems = [];
  const tree = parsers.css.parse(source);
  visit(tree, (node) => {
    if (node.type !== 'css-decl') return;
    const line = node.source.start.line;
    visit(node.value, (value) => {
      const text = String(value.value || '').toLowerCase();
      if (
        (value.type === 'value-func' && COLOR_FUNCTIONS.has(text)) ||
        (value.type === 'value-word' && (value.isHex || NAMED_COLORS.has(text)))
      ) {
        problems.push({ line, property: node.prop, color: value.value });
      }
    });
  });
  return problems;
}

function cssFiles(directory, prefix = '') {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ['node_modules', 'vendor'].includes(entry.name)) continue;
    const relative = prefix + entry.name;
    if (entry.isDirectory())
      files.push(...cssFiles(path.join(directory, entry.name), relative + '/'));
    else if (entry.name.endsWith('.css')) files.push(relative);
  }
  return files.sort();
}

function checkColors(rootDirectory) {
  const errors = [],
    definitions = new Set(),
    references = [];
  const files = cssFiles(rootDirectory);
  for (const file of files) {
    const source = fs.readFileSync(path.join(rootDirectory, file), 'utf8');
    if (file !== PALETTE) {
      for (const problem of findHardcodedColors(source))
        errors.push(
          `${file}:${problem.line}: ${problem.property} uses ${problem.color}; use a palette variable.`,
        );
    }
    visit(parsers.css.parse(source), (node) => {
      if (node.type !== 'css-decl') return;
      if (node.prop.startsWith('--')) definitions.add(node.prop);
      for (const match of node.value.text.matchAll(/var\(\s*(--[\w-]+)/g))
        references.push({ file, name: match[1], line: node.source.start.line });
    });
  }
  for (const reference of references)
    if (!definitions.has(reference.name))
      errors.push(`${reference.file}:${reference.line}: undefined CSS variable ${reference.name}.`);
  const html = fs.readFileSync(path.join(rootDirectory, 'index.html'), 'utf8');
  const firstStylesheet = [...html.matchAll(/<link\b[^>]*href="([^"]+\.css)"/g)][0]?.[1];
  if (firstStylesheet !== PALETTE)
    errors.push(`index.html must load ${PALETTE} before other stylesheets.`);
  return { files: files.length, errors };
}

if (require.main === module) {
  const result = checkColors(path.join(__dirname, '..'));
  if (result.errors.length) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
  } else console.log(`Color palette check passed for ${result.files} stylesheets.`);
}
module.exports = { findHardcodedColors, checkColors };
