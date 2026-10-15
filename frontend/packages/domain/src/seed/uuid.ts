// Детерминированные UUID сида (PD-30, правило Go-сида W0.06 `seedID`): UUID v5 (RFC 4122 §4.3)
// в пространстве NameSpaceURL от имени «ortus:<область>:<id прототипа>». Область `platform` —
// control DB; `t-alta`, `t-lotos` — данные организации (id участников «Лотоса» совпадают с «Альтой»).
// SHA-1 написан здесь: пакет домена работает и в браузере, `node:crypto` ему недоступен.

export const NAMESPACE_URL = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

const rotl = (x: number, n: number): number => ((x << n) | (x >>> (32 - n))) >>> 0;

/** Раунд SHA-1: функция и константа по номеру шага. */
function round(i: number, b: number, c: number, d: number): number {
  if (i < 20) return (((b & c) | (~b & d)) + 0x5a827999) >>> 0;
  if (i < 40) return ((b ^ c ^ d) + 0x6ed9eba1) >>> 0;
  if (i < 60) return (((b & c) | (b & d) | (c & d)) + 0x8f1bbcdc) >>> 0;
  return ((b ^ c ^ d) + 0xca62c1d6) >>> 0;
}

/** SHA-1 (FIPS 180-4) байтов; результат — 40 шестнадцатеричных символов. */
export function sha1Hex(bytes: Uint8Array): string {
  const total = Math.ceil((bytes.length + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  const bitLen = bytes.length * 8;
  view.setUint32(total - 8, Math.floor(bitLen / 2 ** 32));
  view.setUint32(total - 4, bitLen >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w: number[] = new Array<number>(80).fill(0);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 80; i++) {
      w[i] =
        i < 16
          ? view.getUint32(off + i * 4)
          : rotl((w[i - 3] ?? 0) ^ (w[i - 8] ?? 0) ^ (w[i - 14] ?? 0) ^ (w[i - 16] ?? 0), 1);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      const t = (rotl(a, 5) + round(i, b, c, d) + e + (w[i] ?? 0)) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = t;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, '0')).join('');
}

const hexToBytes = (hex: string): number[] => (hex.match(/../g) ?? []).map((x) => parseInt(x, 16));

const NS = hexToBytes(NAMESPACE_URL.replace(/-/g, ''));

/** UUID v5 сущности сида: `seedUuid('t-alta', 'm-owner')`. */
export function seedUuid(scope: string, protoId: string): string {
  const name = new TextEncoder().encode('ortus:' + scope + ':' + protoId);
  const b = hexToBytes(sha1Hex(Uint8Array.from([...NS, ...name])).slice(0, 32));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x50;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const hex = b.map((x) => x.toString(16).padStart(2, '0')).join('');
  return [20, 16, 12, 8].reduce((s, at) => s.slice(0, at) + '-' + s.slice(at), hex);
}
