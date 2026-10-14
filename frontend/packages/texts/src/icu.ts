// W0.14 · Подмножество ICU MessageFormat для словаря: `{arg}`, `{arg, number}`,
// `{arg, plural, =N {…} one {…} few {…} many {…} other {…}}` с `#`, `{arg, select, … other {…}}`,
// кавычки ICU (`''` → `'`, `'{…}'` → буквальные скобки). Локаль одна — ru-RU.
import type { MessageNode, MessageValues } from './types.ts';

export class IcuSyntaxError extends Error {
  readonly source: string;
  readonly offset: number;
  constructor(reason: string, message: string, offset: number) {
    super(`ICU: ${reason} (позиция ${offset}): ${message}`);
    this.name = 'IcuSyntaxError';
    this.source = message;
    this.offset = offset;
  }
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PLURAL_KEY = /^(=\d+|zero|one|two|few|many|other)$/;
const SELECT_KEY = /^[A-Za-z0-9_-]+$/;

class Parser {
  private pos = 0;
  private readonly src: string;
  constructor(src: string) {
    this.src = src;
  }

  parse(): MessageNode[] {
    const nodes = this.message(0, false);
    if (this.pos < this.src.length) this.fail('лишняя «}»');
    return nodes;
  }

  private fail(reason: string): never {
    throw new IcuSyntaxError(reason, this.src, this.pos);
  }

  private ws(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos] ?? '')) this.pos++;
  }

  private message(depth: number, inPlural: boolean): MessageNode[] {
    const nodes: MessageNode[] = [];
    let text = '';
    const flush = () => {
      if (text) nodes.push({ type: 'literal', value: text });
      text = '';
    };
    while (this.pos < this.src.length) {
      const c = this.src[this.pos] as string;
      if (c === "'") {
        text += this.quoted(inPlural);
        continue;
      }
      if (c === '{') {
        flush();
        nodes.push(this.argument());
        continue;
      }
      if (c === '}') {
        if (depth === 0) this.fail('лишняя «}»');
        break;
      }
      if (c === '#' && inPlural) {
        flush();
        nodes.push({ type: 'pound' });
        this.pos++;
        continue;
      }
      text += c;
      this.pos++;
    }
    flush();
    return nodes;
  }

  /** Апостроф: `''` → `'`; перед `{`, `}` (и `#` в plural) открывает буквальный участок до `'`. */
  private quoted(inPlural: boolean): string {
    const next = this.src[this.pos + 1];
    if (next === "'") {
      this.pos += 2;
      return "'";
    }
    if (next === '{' || next === '}' || (inPlural && next === '#')) {
      let out = '';
      this.pos++;
      while (this.pos < this.src.length) {
        const c = this.src[this.pos] as string;
        if (c === "'") {
          if (this.src[this.pos + 1] === "'") {
            out += "'";
            this.pos += 2;
            continue;
          }
          this.pos++;
          return out;
        }
        out += c;
        this.pos++;
      }
      return out;
    }
    this.pos++;
    return "'";
  }

  private word(): string {
    const start = this.pos;
    while (this.pos < this.src.length && !/[\s,{}]/.test(this.src[this.pos] ?? '')) this.pos++;
    return this.src.slice(start, this.pos);
  }

  private argument(): MessageNode {
    this.pos++; // «{»
    this.ws();
    const name = this.word();
    if (!NAME.test(name)) this.fail(`неверное имя аргумента «${name}»`);
    this.ws();
    const c = this.src[this.pos];
    if (c === '}') {
      this.pos++;
      return { type: 'argument', name };
    }
    if (c !== ',') this.fail('ожидалась «,» или «}»');
    this.pos++;
    this.ws();
    const kind = this.word();
    this.ws();
    if (kind === 'number') {
      if (this.src[this.pos] !== '}') this.fail('стили number не поддерживаются');
      this.pos++;
      return { type: 'argument', name, format: 'number' };
    }
    if (kind !== 'plural' && kind !== 'select') this.fail(`неподдерживаемый тип «${kind}»`);
    if (this.src[this.pos] !== ',') this.fail('ожидалась «,» перед вариантами');
    this.pos++;
    const options: Record<string, MessageNode[]> = {};
    for (;;) {
      this.ws();
      if (this.pos >= this.src.length) this.fail('незакрытый аргумент');
      if (this.src[this.pos] === '}') {
        this.pos++;
        break;
      }
      const key = this.word();
      const ok = kind === 'plural' ? PLURAL_KEY.test(key) : SELECT_KEY.test(key);
      if (!ok) this.fail(`неверный вариант «${key}»`);
      if (key in options) this.fail(`повтор варианта «${key}»`);
      this.ws();
      if (this.src[this.pos] !== '{') this.fail(`ожидалась «{» после «${key}»`);
      this.pos++;
      options[key] = this.message(1, kind === 'plural');
      if (this.src[this.pos] !== '}') this.fail(`незакрытый вариант «${key}»`);
      this.pos++;
    }
    if (!Object.keys(options).length) this.fail('нет вариантов');
    if (!('other' in options)) this.fail('нет варианта other');
    return { type: kind, name, options };
  }
}

const cache = new Map<string, readonly MessageNode[]>();

/** Разбор сообщения; бросает `IcuSyntaxError`. */
export function parseMessage(message: string): MessageNode[] {
  const hit = cache.get(message);
  if (hit) return [...hit];
  const nodes = new Parser(message).parse();
  cache.set(message, nodes);
  return [...nodes];
}

/** Имена аргументов в порядке первого появления (включая вложенные в варианты). */
export function argNames(message: string): string[] {
  const out: string[] = [];
  const walk = (nodes: readonly MessageNode[]) => {
    for (const n of nodes) {
      if (n.type === 'argument' || n.type === 'plural' || n.type === 'select') {
        if (!out.includes(n.name)) out.push(n.name);
        if (n.type !== 'argument') for (const sub of Object.values(n.options)) walk(sub);
      }
    }
  };
  walk(parseMessage(message));
  return out;
}

const LOCALE = 'ru-RU';
const numberFormat = new Intl.NumberFormat(LOCALE);
const pluralRules = new Intl.PluralRules(LOCALE);

function valueOf(values: MessageValues, name: string, message: string): string | number | boolean {
  const v = values[name];
  if (v === undefined) throw new Error(`ICU: нет значения аргумента «${name}»: ${message}`);
  return v;
}

function render(
  nodes: readonly MessageNode[],
  values: MessageValues,
  message: string,
  pound: number | null,
): string {
  let out = '';
  for (const n of nodes) {
    switch (n.type) {
      case 'literal':
        out += n.value;
        break;
      case 'pound':
        out += pound === null ? '#' : numberFormat.format(pound);
        break;
      case 'argument': {
        const v = valueOf(values, n.name, message);
        out += typeof v === 'number' ? numberFormat.format(v) : String(v);
        break;
      }
      case 'plural': {
        const v = Number(valueOf(values, n.name, message));
        if (!Number.isFinite(v)) throw new Error(`ICU: plural «${n.name}» ждёт число: ${message}`);
        const exact = n.options[`=${v}`];
        const branch = exact ?? n.options[pluralRules.select(v)] ?? n.options.other ?? [];
        out += render(branch, values, message, v);
        break;
      }
      case 'select': {
        const key = String(valueOf(values, n.name, message));
        out += render(n.options[key] ?? n.options.other ?? [], values, message, pound);
        break;
      }
    }
  }
  return out;
}

/** Подстановка значений в сообщение. Пропущенный аргумент — ошибка (тексты не «молча» ломаются). */
export function format(message: string, values: MessageValues = {}): string {
  return render(parseMessage(message), values, message, null);
}
