/**
 * The Quick Calculator's arithmetic — exact, with no floating point anywhere.
 *
 * Every number is held as a fraction of two BigInts, so `0.1 + 0.2` is exactly `0.3` and
 * `10 / 3 * 3` is exactly `10`. Rounding happens once, when the result is shown
 * (`maxFractionDigits`, half away from zero). Nothing here touches any record: it is a
 * pure function of the expression typed in.
 *
 * Grammar (usual precedence, brackets, unary signs):
 *   expression := term (('+' | '-') term)*
 *   term       := factor (('*' | '/') factor)*
 *   factor     := ('+' | '-') factor | primary '%'*
 *   primary    := number | '(' expression ')'
 *
 * Percentages follow the convention of a desk calculator, which is what people expect
 * when working out a discount or GST:
 *   `200 + 10%` → 220 (adds 10% *of 200*), `200 - 10%` → 180,
 *   `200 * 10%` → 20,  `200 / 10%` → 2000, and a bare `15%` → 0.15.
 * Unclosed brackets are closed at the end (`(2+3` → 5); `×`, `÷` and `−` are accepted.
 */

export type CalculatorError = 'empty' | 'invalid' | 'divideByZero' | 'tooLong';
export type CalculatorResult = { ok: true; value: string } | { ok: false; error: CalculatorError };

const MAX_LENGTH = 200;
const MAX_NUMBER_DIGITS = 30;

interface Fraction {
  n: bigint;
  d: bigint;
}

const abs = (v: bigint) => (v < 0n ? -v : v);
function gcd(a: bigint, b: bigint): bigint {
  a = abs(a);
  b = abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}
function frac(n: bigint, d: bigint = 1n): Fraction {
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
const add = (a: Fraction, b: Fraction) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Fraction, b: Fraction) => frac(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Fraction, b: Fraction) => frac(a.n * b.n, a.d * b.d);
const HUNDRED = frac(100n);

class CalcError extends Error {
  constructor(readonly code: CalculatorError) {
    super(code);
  }
}

function div(a: Fraction, b: Fraction): Fraction {
  if (b.n === 0n) throw new CalcError('divideByZero');
  return frac(a.n * b.d, a.d * b.n);
}

type Token = { kind: 'num'; value: Fraction } | { kind: 'op'; value: '+' | '-' | '*' | '/' | '%' | '(' | ')' };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === ' ') {
      i++;
    } else if ((ch >= '0' && ch <= '9') || ch === '.') {
      let digits = '';
      let dot = -1;
      while (i < input.length && /[0-9.,]/.test(input[i]!)) {
        const c = input[i++]!;
        if (c === ',') continue; // pasted grouping such as 1,25,000
        if (c === '.') {
          if (dot !== -1) throw new CalcError('invalid');
          dot = digits.length;
        } else {
          digits += c;
        }
      }
      if (digits.length === 0) throw new CalcError('invalid'); // a lone "."
      if (digits.length > MAX_NUMBER_DIGITS) throw new CalcError('tooLong');
      const scale = dot === -1 ? 0 : digits.length - dot;
      tokens.push({ kind: 'num', value: frac(BigInt(digits), 10n ** BigInt(scale)) });
    } else {
      const op = ({ '×': '*', x: '*', X: '*', '÷': '/', '−': '-', '–': '-' } as Record<string, string>)[ch] ?? ch;
      if (!'+-*/%()'.includes(op)) throw new CalcError('invalid');
      tokens.push({ kind: 'op', value: op as Extract<Token, { kind: 'op' }>['value'] });
      i++;
    }
  }
  return tokens;
}

function parse(tokens: Token[]): Fraction {
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => peek()?.kind === 'op' && peek()!.value === v;

  /** A term that is a single percentage (`10%`, `-5%`), which `+`/`-` read as a share of the left side. */
  function term(): { value: Fraction; percentOnly: boolean } {
    const first = factor();
    let value = first.value;
    let percentOnly = first.percent;
    while (isOp('*') || isOp('/')) {
      const op = (tokens[pos++] as { value: string }).value;
      const right = factor().value;
      value = op === '*' ? mul(value, right) : div(value, right);
      percentOnly = false;
    }
    return { value, percentOnly };
  }

  function factor(): { value: Fraction; percent: boolean } {
    if (isOp('+') || isOp('-')) {
      const negative = (tokens[pos++] as { value: string }).value === '-';
      const inner = factor();
      return { value: negative ? frac(-inner.value.n, inner.value.d) : inner.value, percent: inner.percent };
    }
    let value = primary();
    let percent = false;
    while (isOp('%')) {
      pos++;
      value = div(value, HUNDRED);
      percent = true;
    }
    return { value, percent };
  }

  function primary(): Fraction {
    const token = tokens[pos++];
    if (!token) throw new CalcError('invalid');
    if (token.kind === 'num') return token.value;
    if (token.value === '(') {
      const value = expression();
      if (!isOp(')')) throw new CalcError('invalid');
      pos++;
      return value;
    }
    throw new CalcError('invalid');
  }

  function expression(): Fraction {
    let value = term().value;
    while (isOp('+') || isOp('-')) {
      const op = (tokens[pos++] as { value: string }).value;
      const right = term();
      const amount = right.percentOnly ? mul(value, right.value) : right.value;
      value = op === '+' ? add(value, amount) : sub(value, amount);
    }
    return value;
  }

  const value = expression();
  if (pos !== tokens.length) throw new CalcError('invalid');
  return value;
}

/** Round to `digits` decimal places (half away from zero) and drop trailing zeros. */
export function toDecimalString(value: { n: bigint; d: bigint }, digits = 10): string {
  const scale = 10n ** BigInt(digits);
  const negative = value.n < 0n;
  const scaled = abs(value.n) * scale;
  let units = scaled / value.d;
  if ((scaled % value.d) * 2n >= value.d) units += 1n;
  if (units === 0n) return '0';
  const whole = units / scale;
  const fraction = (units % scale).toString().padStart(digits, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** Evaluate an expression. `value` is a plain decimal string, e.g. `"-1234.5"`. */
export function evaluate(expression: string, maxFractionDigits = 10): CalculatorResult {
  const trimmed = expression.trim();
  if (!trimmed) return { ok: false, error: 'empty' };
  if (trimmed.length > MAX_LENGTH) return { ok: false, error: 'tooLong' };
  try {
    const tokens = tokenize(trimmed);
    // Close any brackets left open at the end, as a desk calculator does.
    let open = 0;
    for (const t of tokens) {
      if (t.kind === 'op' && t.value === '(') open++;
      if (t.kind === 'op' && t.value === ')') open--;
      if (open < 0) return { ok: false, error: 'invalid' };
    }
    for (; open > 0; open--) tokens.push({ kind: 'op', value: ')' });
    return { ok: true, value: toDecimalString(parse(tokens), maxFractionDigits) };
  } catch (err) {
    if (err instanceof CalcError) return { ok: false, error: err.code };
    return { ok: false, error: 'invalid' };
  }
}

/** A key on the keypad (or its keyboard equivalent). */
export type CalculatorKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | '+' | '-' | '*' | '/' | '%' | '(' | ')';

/**
 * Append a key to the expression being typed, keeping it well formed as far as a keypad
 * reasonably can: one decimal point per number, no doubled operators (a second one replaces
 * the first, except a minus sign after × or ÷), `×` implied before a bracket that follows a
 * number, and a `)` only where there is an open bracket to close.
 */
export function appendKey(expression: string, key: CalculatorKey): string {
  if (expression.length >= MAX_LENGTH) return expression;
  const last = expression.slice(-1);
  const number = /[0-9.]*$/.exec(expression)![0];
  const endsValue = /[0-9.)%]/.test(last);

  if (/[0-9]/.test(key)) {
    if (number === '0') return expression.slice(0, -1) + key; // no leading zeros
    return last === ')' || last === '%' ? `${expression}*${key}` : expression + key;
  }
  if (key === '.') {
    if (number.includes('.')) return expression;
    if (number) return `${expression}.`;
    return last === ')' || last === '%' ? `${expression}*0.` : `${expression}0.`;
  }
  if (key === '(') return endsValue ? `${expression}*(` : `${expression}(`;
  if (key === ')') {
    const open = (expression.match(/\(/g)?.length ?? 0) - (expression.match(/\)/g)?.length ?? 0);
    return open > 0 && endsValue ? `${expression})` : expression;
  }
  if (key === '%') return /[0-9.)]/.test(last) ? `${expression}%` : expression;

  // + - * /
  if (key === '-') {
    if (expression === '' || last === '(' || last === '*' || last === '/') return `${expression}-`;
    if (last === '+' || last === '-') return `${expression.slice(0, -1)}-`;
    return `${expression}-`;
  }
  if (!endsValue) {
    const stripped = expression.replace(/[+\-*/]+$/, '');
    // Nothing to apply it to yet (empty, "(" or a lone sign): ignore rather than build "(*".
    return stripped === '' || stripped.endsWith('(') ? expression : stripped + key;
  }
  return expression + key;
}

/**
 * Put a number (an answer, or the memory) into the expression: it replaces the number being
 * typed, follows an operator or bracket, or is multiplied after a `)` or `%`. A negative value
 * is bracketed so it reads unambiguously (`5 × (-2)`).
 */
export function insertValue(expression: string, value: string): string {
  const v = value.startsWith('-') ? `(${value})` : value;
  const number = /[0-9.]+$/.exec(expression)?.[0] ?? '';
  if (number) return expression.slice(0, -number.length) + v;
  const last = expression.slice(-1);
  return last === ')' || last === '%' ? `${expression}*${v}` : expression + v;
}

/** The ± key: flip the sign of the number being typed. */
export function toggleSign(expression: string): string {
  const bracketed = /\(-([0-9.]+)\)$/.exec(expression);
  if (bracketed) return expression.slice(0, -bracketed[0].length) + bracketed[1];
  const number = /[0-9.]+$/.exec(expression)?.[0] ?? '';
  if (!number) return /[0-9)%]$/.test(expression) ? expression : appendKey(expression, '-');
  const before = expression.slice(0, -number.length);
  // Already negative: a unary minus at the start, or straight after an operator or "(".
  if (before === '-' || /[+\-*/(]-$/.test(before)) return before.slice(0, -1) + number;
  if (before === '' || before.endsWith('(')) return `${before}-${number}`;
  return `${before}(-${number})`;
}

/** Group a plain decimal string for display (`1234567.5` → `12,34,567.5` or `1,234,567.5`) without losing a digit. */
export function formatCalculatorNumber(value: string, grouping: 'indian' | 'western' = 'indian'): string {
  const match = /^(-?)(\d+)(\.\d+)?$/.exec(value);
  if (!match) return value;
  const whole = new Intl.NumberFormat(grouping === 'indian' ? 'en-IN' : 'en-US').format(BigInt(match[2]!));
  return `${match[1]}${whole}${match[3] ?? ''}`;
}
