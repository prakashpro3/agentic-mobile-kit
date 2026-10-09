// Run: node --test tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const tmpDir = require('./tmp');

const SCRIPT = path.join(__dirname, '../stacks/react-native/template/scripts/amk/android-flavors.js');
function flavors(gradle, file = 'build.gradle') {
  const dir = tmpDir('amk-flavors-');
  fs.mkdirSync(path.join(dir, 'android/app'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'android/app', file), gradle);
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
  return { names: r.stdout.trim().split('\n').filter(Boolean), code: r.status, err: r.stderr };
}

test('lists Groovy flavors in order, ignoring nested blocks and comments', () => {
  const { names, code } = flavors(`android {
  flavorDimensions "edition"
  productFlavors {
    phone { dimension "edition"; applicationId "com.example.app" }
    // old { }
    kiosk {
      applicationIdSuffix ".kiosk"
      sourceSets { main { res.srcDirs = ['src/kiosk/res'] } }
    }
  }
  buildTypes { release { } }
}`);
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(names, ['phone', 'kiosk']);
});

test('lists Kotlin DSL flavors; no flavors prints nothing', () => {
  assert.deepStrictEqual(flavors('android {\n  flavorDimensions += "env"\n  productFlavors {\n    create("dev") { applicationIdSuffix = ".dev" }\n    create("prod") { }\n  }\n}\n', 'build.gradle.kts').names, ['dev', 'prod']);
  const none = flavors('android {\n  defaultConfig { applicationId "com.example" }\n}\n');
  assert.deepStrictEqual(none.names, []);
  assert.strictEqual(none.code, 0);
});

test('several flavor dimensions exit 2, since a variant must be named in full', () => {
  const { code, err } = flavors('android {\n  flavorDimensions "env", "tier"\n  productFlavors { dev { dimension "env" }\n free { dimension "tier" } }\n}\n');
  assert.strictEqual(code, 2);
  assert.match(err, /several flavor dimensions/);
});
