// Подписи каркаса W0.09 (вход и dev-вход). Экран контекста / заменён редиректом оболочки W1.20 (ADR-0001);
// перенос строк в @ortus/texts — через владельца словаря.
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
