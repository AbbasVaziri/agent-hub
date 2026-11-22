/**
 * Arithmetic evaluator for the `calculate` tool. It is a recursive-descent
 * parser, never eval, so model output cannot reach the JS runtime.
 */
const FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  log: Math.log10,
  ln: Math.log,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

const MAX_LEN = 500;
const MAX_DEPTH = 50;

export class CalcError extends Error {}

// Persian and Arabic-Indic digits are normalised so "۲+۲" works.
function normalise(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/٫/g, ".");
}

export function evaluate(expression: string): number {
  const src = normalise(expression);
  if (src.length > MAX_LEN) throw new CalcError("Expression is too long");
  let pos = 0;
  let depth = 0;

  const peek = () => src[pos];
  const skip = () => {
    while (pos < src.length && /\s/.test(src[pos])) pos++;
  };
  const expect = (ch: string) => {
    skip();
    if (src[pos] !== ch) throw new CalcError(`Expected '${ch}' at position ${pos}`);
    pos++;
  };

  function expr(): number {
    if (++depth > MAX_DEPTH) throw new CalcError("Expression is nested too deeply");
    let v = term();
    for (;;) {
      skip();
      const c = peek();
      if (c === "+") (pos++, (v += term()));
      else if (c === "-") (pos++, (v -= term()));
      else break;
    }
    depth--;
    return v;
  }
  function term(): number {
    let v = power();
    for (;;) {
      skip();
      const c = peek();
      if (c === "*") (pos++, (v *= power()));
      else if (c === "/") {
        pos++;
        const d = power();
        if (d === 0) throw new CalcError("Division by zero");
        v /= d;
      } else if (c === "%") (pos++, (v %= power()));
      else break;
    }
    return v;
  }
  function power(): number {
    const base = unary();
    skip();
    if (peek() === "^") {
      pos++;
      return Math.pow(base, power());
    }
    return base;
  }
  function unary(): number {
    skip();
    if (peek() === "-") return (pos++, -unary());
    if (peek() === "+") return (pos++, unary());
    return primary();
  }
  function primary(): number {
    skip();
    const c = peek();
    if (c === "(") {
      pos++;
      const v = expr();
      expect(")");
      return v;
    }
    const num = /^(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(pos));
    if (num) {
      pos += num[0].length;
      return Number(num[0]);
    }
    const id = /^[a-zA-Z]+/.exec(src.slice(pos));
    if (id) {
      pos += id[0].length;
      const name = id[0].toLowerCase();
      if (name in CONSTS) return CONSTS[name];
      const fn = FUNCS[name];
      if (!fn) throw new CalcError(`Unknown function '${id[0]}'`);
      expect("(");
      const args: number[] = [];
      skip();
      if (peek() !== ")") {
        args.push(expr());
        skip();
        while (peek() === ",") {
          pos++;
          args.push(expr());
          skip();
        }
      }
      expect(")");
      return fn(...args);
    }
    throw new CalcError(c === undefined ? "Unexpected end of expression" : `Unexpected '${c}' at position ${pos}`);
  }

  const result = expr();
  skip();
  if (pos !== src.length) throw new CalcError(`Unexpected '${src[pos]}' at position ${pos}`);
  if (!Number.isFinite(result)) throw new CalcError("Result is not a finite number");
  return result;
}
