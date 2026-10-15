// Числа и деньги полей ввода: разряды — неразрывный пробел U+00A0, дробная часть — запятая
// (components.md «Тексты интерфейса»: `1 250 ₽`, `3,5 т`; MoneyInput — `1 250,00 ₽`).

const NBSP = String.fromCharCode(0xa0);
/** Пробелы, которые пользователь или форматтер мог оставить между разрядами. */
const SPACES = new RegExp(`[\\s${String.fromCharCode(0xa0, 0x202f)}]`, 'g');

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** 48210 → «48 210», 3.5 → «3,5». */
export function formatInteger(value: number): string {
  const sign = value < 0 ? '-' : '';
  const [int = '0', frac] = String(Math.abs(value)).split('.');
  return `${sign}${group(int)}${frac ? `,${frac}` : ''}`;
}

/** amountMinor (копейки) → «3 250,00». */
export function formatMoney(amountMinor: number): string {
  const sign = amountMinor < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(amountMinor));
  const rub = Math.floor(abs / 100);
  const kop = String(abs % 100).padStart(2, '0');
  return `${sign}${group(String(rub))},${kop}`;
}

/** «3 250,00» → 325000; «12,5» → 1250; пусто или мусор → null. */
export function parseMoney(text: string): number | null {
  const t = text.replace(SPACES, '');
  const m = /^(-?)(\d+)(?:[.,](\d{0,2}))?$/.exec(t);
  if (!m) return null;
  const [, sign, rub = '0', kop = ''] = m;
  const minor = Number(rub) * 100 + Number(kop.padEnd(2, '0'));
  return sign ? -minor : minor;
}

/** «48 210» → 48210; «3,5» → 3.5; пусто → '' (нет значения); мусор → null. */
export function parseNumber(text: string): number | '' | null {
  const t = text.replace(SPACES, '');
  if (t === '') return '';
  if (!/^-?\d+(?:[.,]\d+)?$/.test(t)) return null;
  return Number(t.replace(',', '.'));
}

/** Черновик числового поля: цифры, разряды, знак и дробная часть — то, что можно допечатать. */
export function isNumberDraft(text: string, maxFraction = Infinity): boolean {
  const t = text.replace(SPACES, '');
  const m = /^-?\d*(?:[.,](\d*))?$/.exec(t);
  return m !== null && (m[1] ?? '').length <= maxFraction;
}
