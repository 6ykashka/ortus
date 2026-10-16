// W1.22 · Тексты экранов входа и приглашения. Эталона нет (B-6 №1, №2; no-reference, PD-48): тексты написаны по
// состояниям docs/plan/v2/design-requests.md и словарю @ortus/texts (ошибки — errors.problem по Problem.code). Перенос
// в домен `auth` словаря — через стюарда (план v2 §3.5, «Словарь текстов»).
import { errors } from '@ortus/texts';

export const LOGIN_TEXT = {
  brand: 'Ортус',
  title: 'Вход',
  lead: 'Войдите, чтобы открыть рабочее пространство бизнеса.',
  leadOperator: 'Вход в управление платформой. Отдельный вход · без доступа к данным клиентов.',
  signIn: 'Войти',
  signingIn: 'Переходим ко входу…',
  note: 'Пароль вы вводите на странице входа Ортус — приложение его не получает.',
  expiredTitle: 'Нужен вход',
  /** Сессия истекла: без ?next= «Войти» ведёт на «/», обещать возврат на экран нельзя. */
  expired: 'Сессия истекла. Войдите снова.',
  expiredBack: 'Сессия истекла. Войдите снова — после входа вы вернётесь на прежнюю страницу.',
  signedOutTitle: 'Вы вышли',
  signedOutText: 'Сеанс на этом устройстве завершён. Чтобы продолжить работу, войдите снова.',
  offlineTitle: 'Нет связи',
  offlineText: 'Проверьте подключение к интернету и нажмите «Войти» ещё раз.',
  failedTitle: 'Вход не выполнен',
  failed: {
    forbidden_action: 'Вход отклонён: учётная запись заблокирована или доступ не подтверждён.',
    access_denied: 'Вход отклонён: учётная запись заблокирована или доступ не подтверждён.',
    dependency_unavailable: errors.problem.dependency_unavailable,
    temporarily_unavailable: errors.problem.dependency_unavailable,
    server_error: errors.problem.dependency_unavailable,
  } as Readonly<Record<string, string>>,
  failedOther: 'Повторите вход.',
} as const;

export const INVITATION_TEXT = {
  loading: 'Проверяем приглашение…',
  pendingTitle: 'Приглашение в «{tenant}»',
  pendingText: 'Приглашение отправлено на {email} и действует до {date}.',
  signedOut: 'Войдите под этим адресом — после входа вы вернётесь сюда и примете приглашение.',
  signInAccept: 'Войти и принять',
  signingIn: 'Переходим ко входу…',
  signedIn: 'Вы вошли как {name}.',
  /** Подпись кнопки письма приглашения эталона («Ортус CRM.dc.html» :1431). */
  accept: 'Принять приглашение',
  accepting: 'Принимаем…',
  otherAccount: 'Войти под другим аккаунтом',
  joined: 'Вы присоединились к «{tenant}»',
  mismatchTitle: 'Приглашение для другого адреса',
  mismatchText: 'Приглашение отправлено на {email}. Войдите под этим адресом.',
  failedTitle: 'Приглашение не принято',
  closed: errors.mock.company.inviteClosed,
  acceptedTitle: 'Приглашение уже принято',
  acceptedText: 'Бизнес «{tenant}» уже в списке ваших организаций.',
  openWorkspace: 'Открыть рабочее пространство',
  expiredTitle: 'Срок приглашения истёк',
  expiredText: 'Попросите владельца «{tenant}» отправить приглашение ещё раз.',
  expiredUnknown: 'Попросите владельца бизнеса отправить приглашение ещё раз.',
  revokedTitle: 'Приглашение отозвано',
  revokedText:
    'Ссылка больше не действует. Если приглашение нужно, обратитесь к владельцу «{tenant}».',
  notFoundTitle: 'Приглашение не найдено',
  notFoundText:
    'Проверьте ссылку из письма — её могли скопировать не полностью — или попросите отправить приглашение ещё раз.',
  loadErrorTitle: 'Не удалось проверить приглашение',
  /** Приглашение проверено, не загрузился /me/context (кто вошёл). */
  meErrorTitle: 'Не удалось проверить вход',
  retry: 'Повторить',
  toLogin: 'Перейти ко входу',
} as const;
