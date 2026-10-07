#!/usr/bin/env node
// ponytail: placeholder that only reserves the name; the real init/sync/doctor/uninstall CLI comes later.
const { version } = require('../package.json');
const arg = process.argv[2];

if (arg === '--version' || arg === '-v') {
  console.log(version);
} else {
  console.log(`agentic-mobile-kit ${version} is in early development and has no commands yet.`);
  if (arg) process.exitCode = 1;
}
