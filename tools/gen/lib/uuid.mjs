// UUID v5 (RFC 4122 / RFC 9562, SHA-1 от пространства имён и имени). Тот же алгоритм в Go:
// uuid.NewSHA1(uuid.NameSpaceURL, []byte(name)) из github.com/google/uuid.
import { createHash } from 'node:crypto';

/** Пространство имён URL (RFC 4122, приложение C). */
export const NAMESPACE_URL = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

export function uuidv5(namespace, name) {
  const ns = Buffer.from(namespace.replaceAll('-', ''), 'hex');
  if (ns.length !== 16) throw new Error(`пространство имён не UUID: ${namespace}`);
  const h = createHash('sha1').update(ns).update(Buffer.from(name, 'utf8')).digest();
  const b = h.subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = b.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
