// Сид форм 14.10 (mock-data.js:231–275): «Альта» — «Осмотр машины» v1–v3 с действиями au-1/au-2 и
// черновик отчёта прораба, два принятых ответа; «Лотос» и прочие — без форм (mock-data.js:74).
// Строки таблицы «Осмотры» (kt-insp на kb-5) — сид Базы знаний (W4.30), здесь только ответы.
import type { Form, FormField, FormResponse } from './types.ts';

export interface FormsSeed {
  forms: Form[];
  responses: FormResponse[];
}

const fld = (
  id: string,
  label: string,
  type: FormField['type'],
  required: boolean,
  section: string,
  x: Partial<FormField> = {},
): FormField => ({ id, label, type, required, section, ...x });

const DEFECT = { showIf: { field: 'q-defect', eq: 'да' } } as const;

function altaForms(): Form[] {
  return [
    {
      id: 'fm-insp',
      name: 'Осмотр машины',
      module: 'logistics',
      owner: 'Дарья Зимина',
      status: 'published',
      published: 3,
      versions: [
        {
          v: 1,
          at: '02.09.2026',
          by: 'Дарья Зимина',
          fields: [
            fld('q-photos', 'Фото: спереди, сзади, слева, справа', 'photo', true, 'Фото'),
            fld('q-odo', 'Пробег', 'number', true, 'Показания'),
            fld('q-fuel-t', 'Уровень топлива', 'text', false, 'Показания'),
          ],
        },
        {
          v: 2,
          at: '10.09.2026',
          by: 'Дарья Зимина',
          fields: [
            fld('q-photos', 'Фото: спереди, сзади, слева, справа, одометр', 'photo', true, 'Фото'),
            fld('q-odo', 'Пробег по одометру, км', 'number', true, 'Показания'),
            fld('q-fuel-t', 'Уровень топлива', 'text', false, 'Показания'),
            fld('q-checks', 'Чек-лист: кузов, шины, документы', 'multi', true, 'Проверка'),
          ],
        },
        {
          v: 3,
          at: '24.09.2026',
          by: 'Дарья Зимина',
          fields: [
            fld('q-photos', 'Фото: спереди, сзади, слева, справа, одометр', 'photo', true, 'Фото'),
            fld('q-odo', 'Пробег по одометру, км', 'number', true, 'Показания'),
            fld('q-fuel', 'Уровень топлива', 'choice', true, 'Показания', {
              options: ['¼', '½', '¾', 'Полный'],
            }),
            fld('q-checks', 'Чек-лист: кузов, шины, документы', 'multi', true, 'Проверка'),
            fld('q-defect', 'Есть дефекты?', 'bool', true, 'Дефекты'),
            fld('q-defect-text', 'Описание дефекта', 'text', true, 'Дефекты', { ...DEFECT }),
            fld('q-critical', 'Дефект критический', 'bool', false, 'Дефекты', { ...DEFECT }),
          ],
        },
      ],
      automations: [
        {
          id: 'au-1',
          text: 'Ответ принят → задача менеджеру «Проверить осмотр»',
          version: 1,
          on: true,
        },
        {
          id: 'au-2',
          kind: 'kb',
          mode: 'table',
          page: 'kb-5',
          table: 'kt-insp',
          pos: 'top',
          when: 'accepted',
          on: true,
          version: 1,
          by: 'Дарья Зимина',
          byId: 'm-owner',
          ack: true,
          showLink: false,
          fields: [
            { col: 'c-at', name: 'Дата', src: '$at' },
            { col: 'c-obj', name: 'Рейс', src: '$object' },
            { col: 'c-who', name: 'Водитель', src: '$author' },
            { col: 'c-odo', name: 'Пробег, км', src: 'q-odo' },
            { col: 'c-fuel', name: 'Топливо', src: 'q-fuel' },
            { col: 'c-def', name: 'Дефекты', src: 'q-defect' },
            { col: 'c-resp', name: 'Ответ', src: '$id' },
          ],
        },
      ],
    },
    {
      id: 'fm-foreman',
      name: 'Ежедневный отчёт прораба',
      module: 'repair',
      owner: 'Дарья Зимина',
      status: 'draft',
      published: null,
      versions: [],
      automations: [],
      draft: [
        fld('q-volume', 'Выполненный объём, м²', 'number', true, 'Работы'),
        fld('q-crew', 'Явка бригады', 'multi', true, 'Работы'),
        fld('q-photo', 'Фотоотчёт', 'photo', true, 'Фото'),
      ],
    },
  ];
}

const KB_OK = {
  rule: 'au-2',
  rv: 1,
  kind: 'kb',
  ok: true,
  page: 'kb-5',
  table: 'kt-insp',
  text: 'Строка в таблице «Осмотры» · страница «Журнал осмотров машин»',
} as const;

function altaResponses(): FormResponse[] {
  return [
    {
      id: 'R-0988',
      actions: [{ ...KB_OK, at: '24.09 18:20' }],
      formId: 'fm-insp',
      version: 2,
      at: '18.09 08:41',
      author: 'Кирилл Громов',
      object: 'Рейс Р-171',
      status: 'Принят',
      values: {
        'q-photos': '5 фото',
        'q-odo': '83 902',
        'q-fuel-t': 'почти полный',
        'q-checks': 'кузов, шины, документы',
      },
    },
    {
      id: 'R-1012',
      actions: [{ ...KB_OK, at: '27.09 09:12' }],
      formId: 'fm-insp',
      version: 3,
      at: '27.09 09:05',
      author: 'Илья Васильев',
      object: 'Рейс Р-196',
      status: 'Принят',
      values: {
        'q-photos': '5 фото',
        'q-odo': '84 210',
        'q-fuel': '¾',
        'q-checks': 'кузов, шины, документы',
        'q-defect': 'нет',
      },
    },
  ];
}

/** Срез форм организации; каждый вызов — новые объекты. */
export function formsSeed(tenantId: string): FormsSeed {
  if (tenantId !== 't-alta') return { forms: [], responses: [] };
  return { forms: altaForms(), responses: altaResponses() };
}
