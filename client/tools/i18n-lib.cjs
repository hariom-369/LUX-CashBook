// Shared by the codemod and the scanner: finds user-visible, un-migrated strings in client TSX.
const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const UI_ATTRS = new Set(['aria-label', 'placeholder', 'title', 'description', 'label', 'hint', 'confirmLabel', 'cancelLabel', 'eyebrow', 'subtitle', 'emptyAction', 'emptyText', 'alt']);
const LOWER_OK = new Set(['aria-label', 'placeholder', 'alt']);
const ENT = { '&amp;': '&', '&apos;': "'", '&#39;': "'", '&quot;': '"', '&rsquo;': '’', '&lsquo;': '‘', '&ldquo;': '“', '&rdquo;': '”', '&middot;': '·', '&mdash;': '—', '&ndash;': '–', '&nbsp;': ' ', '&hellip;': '…', '&times;': '×', '&larr;': '←', '&rarr;': '→' };

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      if (f !== 'i18n') walk(p, out);
    } else if (p.endsWith('.tsx') && !p.endsWith('.test.tsx')) out.push(p);
  }
  return out;
}
const decode = (s) => s.replace(/&#?\w+;/g, (m) => ENT[m] ?? m);
const hasText = (s) => /[A-Za-z]{2,}/.test(s);
const collapse = (s) => s.replace(/\s+/g, ' ').trim();

function simpleExpr(e) {
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e) && simpleExpr(e.expression)) return e.name.text;
  return null;
}

// string literal / plain template / template with only simple identifier substitutions
function textOf(node, sf) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { text: node.text, vars: [] };
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    const vars = [];
    const used = new Set();
    for (const span of node.templateSpans) {
      const name = simpleExpr(span.expression);
      if (!name) return null;
      let n = name;
      let i = 2;
      while (used.has(n)) n = name + i++;
      used.add(n);
      vars.push({ name: n, expr: span.expression.getText(sf) });
      text += '{' + n + '}' + span.literal.text;
    }
    return { text, vars };
  }
  return null;
}

function scanFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  (function visit(n) {
    if (ts.isJsxText(n)) {
      const raw = n.text;
      const decoded = decode(raw);
      if (hasText(decoded) && !/&#?\w+;/.test(decoded)) {
        const lead = raw.length - raw.trimStart().length;
        const trail = raw.length - raw.trimEnd().length;
        found.push({ file, kind: 'jsx', text: collapse(decoded), vars: [], start: n.pos + lead, end: n.end - trail, node: n });
      }
    } else if (ts.isJsxAttribute(n) && n.initializer && UI_ATTRS.has(n.name.getText(sf))) {
      const name = n.name.getText(sf);
      let t = null;
      if (ts.isStringLiteral(n.initializer)) t = textOf(n.initializer, sf);
      else if (ts.isJsxExpression(n.initializer) && n.initializer.expression) t = textOf(n.initializer.expression, sf);
      if (t && hasText(t.text) && (LOWER_OK.has(name) || /^[A-Z]/.test(t.text) || t.text.includes(' '))) {
        found.push({ file, kind: 'attr', text: collapse(t.text), vars: t.vars, start: n.initializer.getStart(sf), end: n.initializer.end, node: n });
      }
    } else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const callee = n.expression.getText(sf);
      if (/^toast\.(success|error|undo|info|warning)$/.test(callee)) {
        n.arguments.slice(0, 2).forEach((a) => {
          const t = textOf(a, sf);
          if (t && hasText(t.text)) found.push({ file, kind: 'call', text: collapse(t.text), vars: t.vars, start: a.getStart(sf), end: a.end, node: a });
        });
      }
    } else if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && /^setError$/.test(n.expression.text)) {
      const a = n.arguments[0];
      const t = a && textOf(a, sf);
      if (t && hasText(t.text)) found.push({ file, kind: 'call', text: collapse(t.text), vars: t.vars, start: a.getStart(sf), end: a.end, node: a });
    }
    ts.forEachChild(n, visit);
  })(sf);
  return { sf, src, found };
}

module.exports = { walk, scanFile, ts, decode };

// Second tier (§Phase 14): UI literals in ternaries, returns, fallbacks and label-ish properties.
const LIT_PROPS = new Set(['label', 'hint', 'title', 'group', 'message', 'description']);
const LIT_RE = /^[A-Z][a-z]+(['’][a-z]+)?( [A-Za-z'’\/&,.\-—()0-9%]+)+$|^[A-Z][a-z]{3,}$/;
function scanLiterals(file) {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  (function visit(n) {
    if (ts.isStringLiteral(n) && LIT_RE.test(n.text) && !n.text.includes('{')) {
      const p = n.parent;
      let ok = false;
      if (ts.isConditionalExpression(p) && (p.whenTrue === n || p.whenFalse === n)) ok = true;
      else if (ts.isReturnStatement(p)) ok = true;
      else if (ts.isBinaryExpression(p) && p.right === n && ['??', '||'].includes(p.operatorToken.getText(sf))) ok = true;
      else if (ts.isPropertyAssignment(p) && p.initializer === n && LIT_PROPS.has(p.name.getText(sf))) ok = true;
      if (ok) found.push({ file, kind: 'lit', text: n.text, vars: [], start: n.getStart(sf), end: n.end, node: n });
    }
    ts.forEachChild(n, visit);
  })(sf);
  return { sf, src, found };
}
module.exports.scanLiterals = scanLiterals;

// Third tier (§Phase 14): English prose inside template literals with arbitrary substitutions
// (`${x.toLowerCase()} saved`), in .ts and .tsx alike. Skips class names, URLs and API paths.
function walkAll(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      if (f !== 'i18n' && f !== 'test') walkAll(p, out);
    } else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}
const CSS_HINT = /(^|[\s"'`:])(flex|grid|inline-|block|hidden|rounded|text-|bg-|border|size-|[pmwh][xytblr]?-|gap-|absolute|relative|fixed|transition|animate|ring|shadow|font-|items-|justify-|sr-only|min-|max-|opacity|translate|cursor|overflow|space-|divide)/;
// A dynamic catalogue key, e.g. `reminders.type.${type}` — already translated at the lookup.
const CATALOGUE_KEY = /^[a-z][A-Za-z]*(\.[A-Za-z0-9_]*|\u0000[A-Za-z]*)+$/;
function scanTemplates(file) {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = [];
  (function visit(n) {
    if (ts.isTemplateExpression(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const text = ts.isTemplateExpression(n) ? n.head.text + n.templateSpans.map((s) => '\u0000' + s.literal.text).join('') : n.text;
      const words = text.replace(/\u0000/g, ' ').match(/[A-Za-z][A-Za-z']{2,}/g) ?? [];
      let skip = !words.length || !/\s/.test(text.trim()) || CATALOGUE_KEY.test(text) || /^\u0000?-(hint|error)$/.test(text) || /^Bearer /.test(text) || CSS_HINT.test(text) || /^\s*\//.test(text) || /^[\w-]+:/.test(text) && !text.includes(' ');
      for (let p = n.parent; p && !skip; p = p.parent) {
        if (ts.isTaggedTemplateExpression(p)) skip = true;
        else if (ts.isJsxAttribute(p) && /^(className|class|href|src|to|id|htmlFor|key|name|value)$/.test(p.name.getText(sf))) skip = true;
        else if (ts.isCallExpression(p) && /^(cn|clsx|twMerge|navigate|fetch|api\.\w+|Date|URL|apiUrl|queryKey|invalidateQueries|setQueryData|useQuery|cacheKey|keys)$/.test(p.expression.getText(sf).replace(/^new /, ''))) skip = true;
        else if (ts.isNewExpression(p) && /^(Date|URL|Error|RegExp|Intl\.\w+)$/.test(p.expression.getText(sf))) skip = true;
        else if (ts.isPropertyAssignment(p) && /^(queryKey|key|id|className|href|to|path|url)$/.test(p.name.getText(sf))) skip = true;
        else if (ts.isArrayLiteralExpression(p) && ts.isPropertyAssignment(p.parent) && p.parent.name.getText(sf) === 'queryKey') skip = true;
        else if (ts.isThrowStatement(p) || (ts.isNewExpression(p) && p.expression.getText(sf) === 'Error')) skip = true;
        else if (ts.isFunctionLike(p) || ts.isSourceFile(p)) break;
      }
      if (!skip) found.push({ file, kind: 'tpl', text: text.replace(/\u0000/g, '${…}').replace(/\s+/g, ' ').trim(), vars: [], start: n.getStart(sf), end: n.end, node: n });
      return;
    }
    ts.forEachChild(n, visit);
  })(sf);
  return { sf, src, found };
}
module.exports.walkAll = walkAll;
module.exports.scanTemplates = scanTemplates;
