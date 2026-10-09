#!/usr/bin/env node
// Finds files and folders that git tracks under a name differing from the disk only in letter case.
// macOS and Windows treat both names as one file, so a rename such as storage.ts to Storage.ts never reaches git:
// the app builds on that machine and fails in CI and on every fresh clone. Exits 1 when it finds any.
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 30 }).split('\0').filter(Boolean);
const listings = new Map();
const names = dir => {
  if (!listings.has(dir)) { try { listings.set(dir, new Set(fs.readdirSync(dir || '.'))); } catch { listings.set(dir, null); } }
  return listings.get(dir);
};

const wrong = new Map(); // git's path -> the path on disk
for (const file of tracked) {
  const parts = file.split('/');
  for (let i = 0; i < parts.length; i++) {
    const dir = parts.slice(0, i).join('/');
    const here = names(dir);
    if (here && here.has(parts[i])) continue;
    const disk = here && [...here].find(n => n.toLowerCase() === parts[i].toLowerCase());
    if (disk) wrong.set(parts.slice(0, i + 1).join('/'), [dir, disk].filter(Boolean).join('/'));
    break; // deleted, or reported: nothing to check below it
  }
}

if (wrong.size) {
  console.error('Git has these under a different letter case than the disk:');
  for (const [inGit, onDisk] of wrong) console.error(`  ${inGit}  (on disk: ${onDisk})`);
  const [inGit, onDisk] = wrong.entries().next().value;
  console.error(`Rename each through git in two steps, for example: git mv "${inGit}" "${inGit}.tmp" && git mv "${inGit}.tmp" "${onDisk}"`);
  process.exit(1);
}
