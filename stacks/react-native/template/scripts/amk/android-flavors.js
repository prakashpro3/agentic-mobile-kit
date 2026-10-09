#!/usr/bin/env node
// Lists the Android app's product flavors, one per line, from android/app/build.gradle (or .kts).
// No output: the app has no flavors. Exit 2: it has several flavor dimensions, so a build variant
// has to be named in full (for example devFree).
'use strict';
const fs = require('fs');

const file = ['android/app/build.gradle', 'android/app/build.gradle.kts'].find(f => fs.existsSync(f));
const text = (file ? fs.readFileSync(file, 'utf8') : '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// the body of `name { … }`, found by matching braces (Gradle blocks nest)
function block(t, name) {
  const m = new RegExp(`(^|\\W)${name}\\s*\\{`).exec(t);
  if (!m) return null;
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < t.length; i++) {
    if (t[i] === '{') depth++;
    else if (t[i] === '}' && --depth === 0) return t.slice(m.index + m[0].length, i);
  }
  return null;
}

const body = block(text, 'productFlavors');
if (body === null) process.exit(0);

const dimensions = (text.match(/flavorDimensions[^\n]*/g) || []).join(' ').match(/["'][^"']+["']/g) || [];
if (dimensions.length > 1) {
  console.error(`several flavor dimensions (${dimensions.join(', ')}): name the build variant in full, for example devFree`);
  process.exit(2);
}

// the blocks directly inside: `dev {` (Groovy) or `create("dev") {` (Kotlin)
const names = [];
let depth = 0;
const token = /(?:create|register|maybeCreate)\(\s*["']([\w-]+)["']\s*\)\s*\{|([A-Za-z_]\w*)\s*\{|\{|\}/g;
for (let m; (m = token.exec(body));) {
  if (m[0] === '}') { depth--; continue; }
  if (depth === 0 && (m[1] || m[2])) names.push(m[1] || m[2]);
  depth++;
}
if (names.length) console.log(names.join('\n'));
