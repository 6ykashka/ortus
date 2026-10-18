// Сырая «База знаний» сида 14.10 (extra-data.js:24–54) до миграции v2: три пространства, пять страниц
// старого вида (`access: all|owner`), таблица осмотров. «Лотос» получает только «Салон и SPA» и
// таблицы и записи своих страниц (mock-data.js:54–55). Каждый вызов — новые объекты.
import type { KnowledgeSlice } from './types.ts';

function altaKnowledge(): KnowledgeSlice {
  return {
    spaces: [
      { id: 'sp-log', name: 'Логистика' },
      { id: 'sp-spa', name: 'Салон и SPA' },
      { id: 'sp-own', name: 'Руководство' },
    ],
    pages: [
      {
        id: 'kb-1',
        space: 'sp-log',
        title: 'Регламент приёмки смены',
        access: 'all',
        versions: [
          {
            v: 1,
            at: '05.09.2026',
            by: 'Дарья Зимина',
            body: 'Менеджер проверяет фото до и после, пробег и расходы. Машина возвращается в пул только после приёмки.',
          },
          {
            v: 2,
            at: '24.09.2026',
            by: 'Дарья Зимина',
            body: 'Менеджер проверяет фото до и после (5 ракурсов, включая одометр), пробег и расходы с чеками. При замечаниях смена возвращается водителю с указанием раздела. Машина возвращается в пул только после приёмки.',
          },
        ],
      },
      {
        id: 'kb-2',
        space: 'sp-log',
        title: 'Как фотографировать машину при осмотре',
        access: 'all',
        versions: [
          {
            v: 1,
            at: '10.09.2026',
            by: 'Марина Котова',
            body: 'Снимайте при дневном свете с расстояния 3–4 метра. Номер должен читаться на фото спереди и сзади. Одометр — крупно, без бликов.',
          },
        ],
      },
      {
        id: 'kb-5',
        space: 'sp-log',
        title: 'Журнал осмотров машин',
        access: 'all',
        versions: [
          {
            v: 1,
            at: '24.09.2026',
            by: 'Дарья Зимина',
            body: 'Сводный журнал осмотров перед выездом и при сдаче машины. Строки добавляет форма «Осмотр машины» после принятия ответа; исправления вносятся через ответ формы. Как снимать машину — на странице «Как фотографировать машину при осмотре».',
          },
        ],
      },
      {
        id: 'kb-3',
        space: 'sp-spa',
        title: 'Технологические карты процедур',
        access: 'all',
        versions: [
          {
            v: 1,
            at: '12.09.2026',
            by: 'Дарья Зимина',
            body: 'Классический массаж: масло 30 мл. SPA-ритуал: масло 40 мл, крем 20 г. Массаж спины: масло 20 мл. Отклонение от нормы фиксируется при завершении процедуры.',
          },
        ],
      },
      {
        id: 'kb-4',
        space: 'sp-own',
        title: 'Политика начислений водителям',
        access: 'owner',
        versions: [
          {
            v: 1,
            at: '01.09.2026',
            by: 'Дарья Зимина',
            body: 'Начисление создаётся после приёмки смены. Ставка зависит от маршрута. Водитель не видит начисления в приложении.',
          },
        ],
      },
    ],
    tables: [
      {
        id: 'kt-insp',
        page: 'kb-5',
        title: 'Осмотры',
        columns: [
          { id: 'c-at', name: 'Дата', type: 'text' },
          { id: 'c-obj', name: 'Рейс', type: 'text' },
          { id: 'c-who', name: 'Водитель', type: 'text' },
          { id: 'c-odo', name: 'Пробег, км', type: 'number' },
          { id: 'c-fuel', name: 'Топливо', type: 'text' },
          { id: 'c-def', name: 'Дефекты', type: 'text' },
          { id: 'c-resp', name: 'Ответ', type: 'text' },
        ],
        rows: [
          {
            id: 'kr-2',
            at: '27.09 09:12',
            src: { form: 'fm-insp', resp: 'R-1012', fv: 3, rule: 'au-2', rv: 1 },
            cells: {
              'c-at': '27.09 09:05',
              'c-obj': 'Рейс Р-196',
              'c-who': 'Илья Васильев',
              'c-odo': '84 210',
              'c-fuel': '¾',
              'c-def': 'нет',
              'c-resp': 'R-1012',
            },
          },
          {
            id: 'kr-1',
            at: '24.09 18:20',
            src: { form: 'fm-insp', resp: 'R-0988', fv: 2, rule: 'au-2', rv: 1 },
            cells: {
              'c-at': '18.09 08:41',
              'c-obj': 'Рейс Р-171',
              'c-who': 'Кирилл Громов',
              'c-odo': '83 902',
              'c-resp': 'R-0988',
            },
          },
        ],
      },
    ],
    entries: [],
  };
}

/** «Лотос» — копия БЗ «Альты» только с пространством салона (как `seedLotos` эталона). */
function lotosKnowledge(): KnowledgeSlice {
  const s = altaKnowledge();
  const pages = s.pages.filter((p) => !p.space || p.space === 'sp-spa');
  const ids = new Set(pages.map((p) => p.id));
  return {
    ...s,
    spaces: s.spaces.filter((x) => x.id === 'sp-spa'),
    pages,
    tables: (s.tables ?? []).filter((t) => ids.has(t.page)),
    entries: (s.entries ?? []).filter((x) => ids.has(x.page)),
  };
}

export function knowledgeSeed(tenantId: string): KnowledgeSlice {
  if (tenantId === 't-alta') return altaKnowledge();
  if (tenantId === 't-lotos') return lotosKnowledge();
  return { spaces: [], pages: [], tables: [], entries: [] };
}
