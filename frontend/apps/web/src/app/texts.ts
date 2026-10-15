// Подписи каркаса W0.09. Словарь текстов — @ortus/texts (W0.14): при появлении домена shell эти строки
// переезжают туда, экран контекста заменяет оболочка W1.20.
export const T = {
  loading: 'Загрузка…',
  contextTitle: 'Контекст',
  operator: 'Оператор платформы',
  noTenants: 'Нет организаций',
  membership: { active: 'активно', suspended: 'приостановлено' },
  signInNeeded: 'Нужен вход',
  signIn: 'Войти',
  offline: 'Нет связи с сервером',
  loginTitle: 'Вход',
  loginStub: 'Вход через OIDC появится на шаге 1.3. Локально и в e2e — dev-вход ?persona=.',
  devLoginFailed: (persona: string, error: string) => `Dev-вход «${persona}» не выполнен: ${error}`,
} as const;
