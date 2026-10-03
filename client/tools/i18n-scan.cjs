// Lists user-visible strings in client source that are not routed through the i18n catalogue (§Phase 14).
// `node tools/i18n-scan.cjs` from client/; also exercised by src/i18n/migration.test.ts.
const path = require('path');
const { walk, walkAll, scanFile, scanLiterals, scanTemplates } = require('./i18n-lib.cjs');

// Brand names, key names, and example input values that are intentionally literal.
const SKIP = new Set(['currentPassword', 'Khata', 'Esc', 'Ctrl K', 'you@example.com', 'rahul@example.com', 'name@example.com', '29ABCDE1234F1Z5', 'My Business', 'Personal']); // the last two are default workspace names (stored data)
const posix = (f) => f.split(path.sep).join('/');

function scanClient(root = 'src') {
  const found = [];
  for (const f of walk(root)) {
    for (const x of scanFile(f).found) {
      if (SKIP.has(x.text) || /^[A-Z0-9/ .&-]+$/.test(x.text)) continue;
      found.push(posix(f) + ': ' + x.kind + ' ' + JSON.stringify(x.text));
    }
  }
  // Template literals with arbitrary substitutions, in .ts and .tsx.
  for (const f of walkAll(root)) {
    for (const x of scanTemplates(f).found) found.push(posix(f) + ': ' + x.kind + ' ' + JSON.stringify(x.text));
    // toast / setError messages in plain .ts modules (hooks, lib).
    if (f.endsWith('.ts')) {
      for (const x of scanFile(f).found) {
        if (x.kind === 'call' && !SKIP.has(x.text)) found.push(posix(f) + ': ' + x.kind + ' ' + JSON.stringify(x.text));
      }
    }
    // UI literals in ternaries, returns, `??`/`||` fallbacks and label-ish properties.
    for (const x of scanLiterals(f).found) {
      if (/(^|\/)(config\/navigation|lib\/shortcuts)\.ts$/.test(posix(f))) continue; // English source labels for i18n/nav.ts and the shortcut help
      if (!SKIP.has(x.text) && !/^[A-Z0-9/ .&-]+$/.test(x.text)) found.push(posix(f) + ': ' + x.kind + ' ' + JSON.stringify(x.text));
    }
  }
  return found;
}

module.exports = { scanClient };

if (require.main === module) {
  const found = scanClient();
  // eslint-disable-next-line no-console
  console.log(found.join('\n') + '\nremaining ' + found.length);
  process.exitCode = found.length ? 1 : 0;
}
