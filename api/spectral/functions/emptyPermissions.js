// ortus-x-permissions-empty: пустой x-permissions — только с явным основанием, иначе операция
// становится эндпоинтом без проверки прав. Основания: x-scope identity (свой аккаунт),
// x-public-capability (публичная ссылка) или непустой x-field-permissions (права по полям тела).
export default function emptyPermissions(input) {
  if (!input || typeof input !== 'object') return [];
  const perms = input['x-permissions'];
  if (!Array.isArray(perms) || perms.length > 0) return [];
  if (input['x-scope'] === 'identity') return [];
  if (input['x-public-capability']) return [];
  const fields = input['x-field-permissions'];
  if (fields && typeof fields === 'object' && Object.keys(fields).length > 0) return [];
  return [
    {
      message:
        `${input.operationId}: пустой x-permissions допустим только для x-scope identity, ` +
        'с x-public-capability или с x-field-permissions.',
    },
  ];
}
