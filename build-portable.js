#!/usr/bin/env node
/* Build the self-contained portable NetMap3D.html by inlining style.css and
   every <script src> (three.js libs + app.js) referenced by index.html. */
const fs = require('fs');
const path = require('path');

const root = __dirname;
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// 1) inline the stylesheet
html = html.replace(/<link rel="stylesheet" href="style\.css">/,
  () => '<style>\n' + fs.readFileSync(path.join(root, 'style.css'), 'utf8') + '\n</style>');

// 2) inline every <script src="..."></script>
html = html.replace(/[ \t]*<script src="([^"]+)"><\/script>/g, (m, src) => {
  const file = path.join(root, src.replace(/^\.\//, ''));
  const code = fs.readFileSync(file, 'utf8');
  return '<script>\n' + code + '\n</script>';
});

const out = path.join(root, 'NetMap3D.html');
fs.writeFileSync(out, html, 'utf8');
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`Wrote ${out} (${kb} KB)`);
