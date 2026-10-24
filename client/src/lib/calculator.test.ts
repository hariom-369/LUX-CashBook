import { describe, expect, it } from 'vitest';
import { appendKey, evaluate, formatCalculatorNumber, insertValue, toggleSign, type CalculatorKey } from './calculator';

const value = (expression: string) => {
  const result = evaluate(expression);
  if (!result.ok) throw new Error(`${expression} → ${result.error}`);
  return result.value;
};
const error = (expression: string) => {
  const result = evaluate(expression);
  return result.ok ? `ok:${result.value}` : result.error;
};

describe('Quick Calculator arithmetic', () => {
  it('adds, subtracts, multiplies and divides with the usual precedence', () => {
    expect(value('12+3*2')).toBe('18');
    expect(value('100-25/5')).toBe('95');
    expect(value('7*6')).toBe('42');
    expect(value('9/4')).toBe('2.25');
    expect(value('2-5')).toBe('-3');
  });

  it('honours brackets, closing any left open', () => {
    expect(value('(12+3)*2')).toBe('30');
    expect(value('2*(3+(4-1))')).toBe('12');
    expect(value('(2+3')).toBe('5');
  });

  it('handles unary signs', () => {
    expect(value('-5+3')).toBe('-2');
    expect(value('5*-2')).toBe('-10');
    expect(value('-(2+3)')).toBe('-5');
  });

  it('accepts the display symbols ×, ÷ and −, and pasted grouping commas', () => {
    expect(value('6×7÷2−1')).toBe('20');
    expect(value('1,25,000+1')).toBe('125001');
  });
});

describe('decimals', () => {
  it('is exact where floating point is not', () => {
    expect(value('0.1+0.2')).toBe('0.3');
    expect(value('1.1*3')).toBe('3.3');
    expect(value('0.3-0.1')).toBe('0.2');
    expect(value('19.99*3')).toBe('59.97');
    expect(value('10/3*3')).toBe('10');
  });

  it('rounds a repeating result once, half away from zero, to 10 places', () => {
    expect(value('2/3')).toBe('0.6666666667');
    expect(value('-2/3')).toBe('-0.6666666667');
    expect(value('1/8')).toBe('0.125');
  });

  it('accepts leading and trailing decimal points', () => {
    expect(value('.5+5.')).toBe('5.5');
  });
});

describe('percentages', () => {
  it('reads a bare percentage as a fraction', () => {
    expect(value('15%')).toBe('0.15');
    expect(value('50%*200')).toBe('100');
  });

  it('adds or subtracts a percentage of the amount, as a desk calculator does', () => {
    expect(value('200+10%')).toBe('220');
    expect(value('1000-18%')).toBe('820');
    expect(value('499+18%')).toBe('588.82'); // GST on ₹499
  });

  it('multiplies and divides by the percentage itself', () => {
    expect(value('200*10%')).toBe('20');
    expect(value('200/10%')).toBe('2000');
  });

  it('only treats a lone percentage term that way', () => {
    expect(value('200+10%*2')).toBe('200.2'); // (10% × 2) is 0.2, not a share of 200
  });
});

describe('invalid input', () => {
  it('reports division by zero rather than Infinity', () => {
    expect(error('5/0')).toBe('divideByZero');
    expect(error('5/(2-2)')).toBe('divideByZero');
    expect(error('0/0')).toBe('divideByZero');
  });

  it('rejects incomplete or malformed expressions', () => {
    expect(error('')).toBe('empty');
    expect(error('   ')).toBe('empty');
    for (const bad of ['5+', '*5', '1..2', '1.2.3', '()', '2)', '(2+3))', '.', '5 5', 'abc', '2^3']) {
      expect(error(bad), bad).toBe('invalid');
    }
  });

  it('refuses absurdly long input', () => {
    expect(error('1'.repeat(31))).toBe('tooLong');
    expect(error('1+'.repeat(150) + '1')).toBe('tooLong');
  });
});

describe('formatCalculatorNumber', () => {
  it('groups digits in the currency\'s style without losing precision', () => {
    expect(formatCalculatorNumber('1234567.891')).toBe('12,34,567.891');
    expect(formatCalculatorNumber('1234567.891', 'western')).toBe('1,234,567.891');
    expect(formatCalculatorNumber('-1000')).toBe('-1,000');
    expect(formatCalculatorNumber('12345678901234567890')).toBe('1,23,45,67,89,01,23,45,67,890');
  });
});

describe('appendKey (keypad input rules)', () => {
  const type = (keys: string) => [...keys].reduce((expr, k) => appendKey(expr, k as CalculatorKey), '');

  it('builds an expression from keys', () => {
    expect(type('12+3*2')).toBe('12+3*2');
  });

  it('allows one decimal point per number, adding a leading zero', () => {
    expect(type('1.2.3')).toBe('1.23');
    expect(type('.5')).toBe('0.5');
    expect(type('2+.5')).toBe('2+0.5');
  });

  it('replaces a doubled operator, but keeps a minus sign after × or ÷', () => {
    expect(type('5+*')).toBe('5*');
    expect(type('5*-2')).toBe('5*-2');
    expect(type('5*-+')).toBe('5+');
    expect(type('+')).toBe('');
    expect(type('-5')).toBe('-5');
  });

  it('drops leading zeros and implies × before a bracket after a number', () => {
    expect(type('007')).toBe('7');
    expect(type('2(3)')).toBe('2*(3)');
  });

  it('only closes a bracket that is open, and only puts % after a number', () => {
    expect(type('2)')).toBe('2');
    expect(type('(2+3))')).toBe('(2+3)');
    expect(type('%')).toBe('');
    expect(type('50%')).toBe('50%');
  });
});

describe('toggleSign and insertValue (± and memory recall)', () => {
  it('flips the sign of the number being typed, and back', () => {
    expect(toggleSign('5')).toBe('-5');
    expect(toggleSign('-5')).toBe('5');
    expect(toggleSign('10+3')).toBe('10+(-3)');
    expect(toggleSign('10+(-3)')).toBe('10+3');
    expect(toggleSign('10*-3')).toBe('10*3');
    expect(toggleSign('')).toBe('-');
    expect(evaluate(toggleSign('10+3')).ok && evaluate(toggleSign('10+3'))).toMatchObject({ value: '7' });
  });

  it('puts a value in place of the number being typed, or after an operator', () => {
    expect(insertValue('', '75')).toBe('75');
    expect(insertValue('10+', '75')).toBe('10+75');
    expect(insertValue('10+4', '75')).toBe('10+75');
    expect(insertValue('(2)', '75')).toBe('(2)*75');
    expect(insertValue('10-', '-5')).toBe('10-(-5)');
    expect(value(insertValue('10-', '-5'))).toBe('15');
  });
});
