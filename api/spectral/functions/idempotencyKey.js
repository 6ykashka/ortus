// ortus-idempotency-key: изменяющая операция объявляет обязательный заголовок Idempotency-Key
// (12 «Дополнительные соглашения»). Исключения — POST-чтения из functionOptions.readOnly. Операции
// functionOptions.singleUse выдают одноразовый секрет (билет канала, ADR-0015): их ответ нельзя хранить
// и повторять, поэтому заголовок у них запрещён (ревью W1.00).
const findKey = (input) =>
  (input.parameters ?? []).find(
    (p) => p && p.in === 'header' && String(p.name).toLowerCase() === 'idempotency-key',
  );

export default function idempotencyKey(input, options) {
  if (!input || typeof input !== 'object') return [];
  if ((options?.readOnly ?? []).includes(input.operationId)) return [];
  const header = findKey(input);
  if ((options?.singleUse ?? []).includes(input.operationId)) {
    return header
      ? [
          {
            message: `${input.operationId}: одноразовый секрет не повторяется — Idempotency-Key не объявлять.`,
          },
        ]
      : [];
  }
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
