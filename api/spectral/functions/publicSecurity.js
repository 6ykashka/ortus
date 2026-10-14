// ortus-public-security: `security: []` (операция без аутентификации) допустим только вместе с
// x-public-capability — описанием секрета ссылки, который заменяет вход (публичные формы 0.1).
export default function publicSecurity(input) {
  if (!input || typeof input !== 'object') return [];
  const security = input.security;
  if (!Array.isArray(security) || security.length > 0) return [];
  if (input['x-public-capability']) return [];
  return [
    {
      message: `${input.operationId}: security: [] допустим только с x-public-capability.`,
    },
  ];
}
