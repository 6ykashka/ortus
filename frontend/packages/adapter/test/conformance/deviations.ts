// Известные расхождения примеров контракта и сценарного сервера (W0.13, PD-43). Пример этапа 1 либо
// воспроизводится сервером из состояния (кейс с `example`), либо записан здесь с причиной. Виды:
//   scenario — состояние сервера к коду не приводит; пример отдаётся только сценарием X-Test-Scenario;
//   ignore   — поля `paths` расходятся по причине, остальное совпадает;
//   subset   — элементы `items` примера — подмножество ответа, остальные поля совпадают;
//   ids      — совпадает всё, кроме идентификаторов (UUID сравниваются по порядку появления).
// `decision` — вопрос в decisionsNeeded отчёта W0.13 (до решения действует поведение сервера).

export type DeviationKind = 'scenario' | 'ignore' | 'subset' | 'ids';

export interface Deviation {
  example: string;
  kind: DeviationKind;
  paths?: readonly string[];
  reason: string;
  decision?: string;
}

export const DEVIATIONS: readonly Deviation[] = [
  {
    example: 'getMyContext/operator',
    kind: 'ignore',
    paths: ['userId'],
    reason:
      'userId оператора — accounts.id его аккаунта (`account:op-1`), как у стенда W0.09 и dev-входа; ' +
      'пример W0.07 взял id записи platform_operators (`op-1`).',
    decision:
      'Стюарду: userId в getMyContext/operator — UUID `account:op-1` (правка примера и генератора).',
  },
  {
    example: 'getMyContext/foreman',
    kind: 'ignore',
    paths: ['tenants[1]'],
    reason:
      'У «Ремстрой Плюс» нет БД ни в сиде домена W0.12, ни в Go-сиде W0.06: членства в организации без данных ' +
      'нет на стенде, сервер её не показывает (как cmd/api). Пример W0.07 рисует контекст «Ремстроя» по прототипу.',
    decision:
      'Стюарду и W0.12: добавить «Ремстрой Плюс» в сид (данные организации) или убрать вторую организацию из примера foreman.',
  },
  {
    example: 'listPlatformTenants/forbidden_action',
    kind: 'scenario',
    reason:
      'Не оператору /platform/* отвечает 404 not_found, как шлюз cmd/api W0.09 (бриф W0.13 §10 п. 2); ' +
      'пример 403 — только сценарием.',
    decision: 'Стюарду: 404 или 403 для не оператора на /platform/* (сейчас стенд — 404).',
  },
  {
    example: 'listPlatformUsers/forbidden_action',
    kind: 'scenario',
    reason: 'Как listPlatformTenants/forbidden_action: стенд отвечает не оператору 404.',
  },
  {
    example: 'listPlatformUsers/ok',
    kind: 'subset',
    reason:
      'Каталог аккаунтов домена W0.12 добран fillAccounts (acc-g*, 45 аккаунтов персонала «Лотоса», ' +
      '«Ремстроя», «Карго»); пример W0.07 — 13 аккаунтов выписки.',
  },
  {
    example: 'startLogin/dependency_unavailable',
    kind: 'scenario',
    reason: 'Поставщика входа в режиме mock нет — он не бывает недоступен; только сценарий.',
  },
  {
    example: 'requestSubscriptionChange/feature_requires_plan',
    kind: 'scenario',
    reason:
      'Ни одно действие подписки владельца на сиде не требует более высокого тарифа (текст примера — ' +
      '«обратитесь к владельцу» — про не владельца, которому операция закрыта x-scope tenant-owner).',
    decision: 'Стюарду: когда requestSubscriptionChange отвечает 402 feature_requires_plan.',
  },
  {
    example: 'acceptInvitation/seats_exhausted',
    kind: 'scenario',
    reason:
      'Приглашённый уже занимает место (people/seats.ts W0.12: место — активный или приглашённый), поэтому ' +
      'принятие не превышает лимит; код возможен только после снижения лимита ниже занятого — текст «10 из 10» ' +
      'так не получить.',
    decision:
      'Владельцу продукта: занимает ли приглашение место до принятия (сейчас — да, как в прототипе).',
  },
  {
    example: 'getCsrfToken/ok',
    kind: 'ignore',
    paths: ['csrfToken'],
    reason: 'CSRF-токен случайный на каждую сессию (как session.Manager W0.09).',
  },
  {
    example: 'initiateUpload/ok',
    kind: 'ids',
    reason:
      'Пример — история загрузки файла сида file-insp-208-front (его fileId), новая загрузка получает новый файл.',
  },
  {
    example: 'completeUpload/ok',
    kind: 'ids',
    reason: 'Как initiateUpload/ok: файл новой загрузки, а не файл сида.',
  },
];

export const deviationOf = (example: string): Deviation | undefined =>
  DEVIATIONS.find((d) => d.example === example);
