#!/usr/bin/env node
/* Bundle three + addons into vendor/three-bundle.js (classic script, window.THREE).
   Committed so a fresh clone runs with `npx serve .` and no build step. */
const { execSync } = require('child_process');
const fs = require('fs');
fs.mkdirSync('vendor', { recursive: true });
execSync('npx esbuild three-bundle.mjs --bundle --minify --format=iife --outfile=vendor/three-bundle.js', { stdio: 'inherit' });
const kb = (fs.statSync('vendor/three-bundle.js').size / 1024).toFixed(0);
console.log(`vendor/three-bundle.js (${kb} KB)`);
