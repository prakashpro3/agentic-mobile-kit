// Temp folders for tests, removed when the test file finishes.
const fs = require('fs');
const os = require('os');
const path = require('path');

const made = [];
process.on('exit', () => made.forEach(d => fs.rmSync(d, { recursive: true, force: true })));

module.exports = prefix => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
};
// a folder a test made another way (a git worktree beside a temp app), removed with the rest
module.exports.track = dir => { made.push(dir); return dir; };
