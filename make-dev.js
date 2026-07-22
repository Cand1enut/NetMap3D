// Dev-only loader: same page as index.html but with cache-busted asset URLs, so
// a browser can't serve a stale app.js while testing. Not part of the product.
const fs = require('fs');
const t = Date.now();
const html = fs.readFileSync('index.html', 'utf8')
  .replace(/href="style\.css"/, `href="style.css?t=${t}"`)
  .replace(/src="\.\/vendor\/three-bundle\.js"/, `src="./vendor/three-bundle.js?t=${t}"`)
  .replace(/src="\.\/app\.js"/, `src="./app.js?t=${t}"`);
fs.writeFileSync('dev.html', html);
console.log('dev.html ' + t);
