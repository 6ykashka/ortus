// W2.41 · Тексты экрана «Категории расходов» (company-expense-categories; ответ владельца 17.10 на D-12 комплекта —
// справочник тенанта). Экрана в эталоне нет (no-reference, Q-W2.40-3): подписи — по умолчанию исполнителя, повторы
// чужих подписей — ссылками (одна строка — один файл).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { company, format, logisticsDriver, logisticsManager, shell, toast } from '../src/index.ts';

const T = logisticsManager.expenseCategories;

describe('«Категории расходов» (W2.41)', () => {
  it('заголовок — подпись страницы вне меню в shell.nav.items', () => {
    assert.equal(shell.nav.items.expenseCategories, 'Категории расходов');
  });

  it('шаблоны: архивация, архив, ошибка загрузки', () => {
    assert.equal(format(T.archiveNamed, { label: 'Мойка' }), 'Убрать в архив: Мойка');
    assert.equal(format(T.archiveDialog.title, { label: 'Мойка' }), 'Убрать «Мойка» в архив?');
    assert.equal(format(T.showArchive, { n: 2 }), 'Показать архив (2)');
    assert.equal(format(T.archivedSince, { date: '01.10.2026' }), 'В архиве с 01.10.2026');
    assert.equal(
      format(T.loadFailed, { error: 'Нет связи' }),
      'Не удалось загрузить категории: Нет связи',
    );
  });

  it('тосты — в toast.ts', () => {
    assert.equal(
      format(toast.manager.categoryAdded, { label: 'Стоянка на ночь' }),
      'Категория «Стоянка на ночь» добавлена',
    );
    assert.equal(
      format(toast.manager.categoryArchived, { label: 'Мойка' }),
      'Категория «Мойка» убрана в архив',
    );
  });

  it('общие подписи — ссылками на файлы-владельцы', () => {
    assert.equal(T.retry, logisticsDriver.inspection.retry);
    assert.equal(T.form.add, logisticsDriver.inspection.add);
    assert.equal(T.form.name, company.dialogs.createRole.name);
    assert.equal(T.form.commentRequired, T.commentRequired);
  });

  it('связанный раздел «Приёмки смен» и пустой архив', () => {
    assert.equal(T.archiveEmpty, 'В архиве пока нет категорий');
    assert.equal(T.form.nameRequired, 'Укажите название категории');
  });
});
