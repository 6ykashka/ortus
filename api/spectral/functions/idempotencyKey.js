// ortus-idempotency-key: изменяющая операция объявляет обязательный заголовок Idempotency-Key
// (12 «Дополнительные соглашения»). Исключения — POST-чтения из functionOptions.readOnly.
export default function idempotencyKey(input, options) {
  if (!input || typeof input !== 'object') return [];
  if ((options?.readOnly ?? []).includes(input.operationId)) return [];
  const header = (input.parameters ?? []).find(
    (p) => p && p.in === 'header' && String(p.name).toLowerCase() === 'idempotency-key',
  );
  if (!header) {
    return [
      { message: `${input.operationId}: изменяющей операции нужен заголовок Idempotency-Key.` },
    ];
  }
  if (header.required !== true) {
    return [{ message: `${input.operationId}: Idempotency-Key должен быть обязательным.` }];
  }
  return [];
}
