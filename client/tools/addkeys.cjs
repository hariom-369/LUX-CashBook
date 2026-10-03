// usage: node tools/addkeys.cjs <file with lines key|English|Hindi>
const fs = require('fs');
const q = (s) => "'" + s.split("'").join(String.fromCharCode(92) + "'") + "'";
const lines = fs.readFileSync(process.argv[2], 'utf8').split(String.fromCharCode(10)).map((l) => l.trim()).filter(Boolean);
let en = '';
let hi = '';
for (const line of lines) {
  const [key, e, h] = line.split('|');
  if (!key || !e || !h) throw new Error('bad line: ' + line);
  en += '  ' + q(key) + ': ' + q(e) + ',' + String.fromCharCode(10);
  hi += '  ' + q(key) + ': ' + q(h) + ',' + String.fromCharCode(10);
}
for (const [file, add, anchor] of [['src/i18n/messages/en.ts', en, '} as const;'], ['src/i18n/messages/hi.ts', hi, '};']]) {
  const s = fs.readFileSync(file, 'utf8');
  const i = s.lastIndexOf(anchor);
  fs.writeFileSync(file, s.slice(0, i) + add + s.slice(i));
}
console.log('added', lines.length);
