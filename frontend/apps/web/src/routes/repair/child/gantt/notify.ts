// W6.23 · Строка «Уведомим…» предпросмотра дословно по эталону (design/Ремонт и стройка.dc.html :1000):
// «Уведомим: <исполнители>; заказчика <имя в винительном падеже> — меняется дата сдачи.»
// Сервер (previewScheduleChange.notifyWho) называет заказчика словом «Заказчик»; имя берётся из карточки объекта.

const NAME_WORD = /^[А-ЯЁ][а-яё-]+$/;
/** Беглые гласные и ё: «Пётр» → «Петра», «Павел» → «Павла», «Лев» → «Льва». */
const FIRST_EXCEPTIONS: Record<string, string> = {
  Пётр: 'Петра',
  Павел: 'Павла',
  Лев: 'Льва',
  Любовь: 'Любовь',
};

function firstName(w: string): string {
  const exception = FIRST_EXCEPTIONS[w];
  if (exception) return exception;
  if (w.endsWith('а')) return w.slice(0, -1) + 'у';
  if (w.endsWith('я')) return w.slice(0, -1) + 'ю';
  if (w.endsWith('й') || w.endsWith('ь')) return w.slice(0, -1) + 'я';
  return /[бвгджзклмнпрстфхцчшщ]$/.test(w) ? w + 'а' : w;
}

function lastName(w: string): string {
  if (/(ов|ев|ёв|ин|ын)а$/.test(w) || /[нц]кая$/.test(w) || w.endsWith('ная')) {
    return w.endsWith('ая') ? w.slice(0, -2) + 'ую' : w.slice(0, -1) + 'у';
  }
  if (/(ов|ев|ёв|ин|ын)$/.test(w)) return w + 'а';
  if (/(ский|цкий|ной|ый|ой)$/.test(w))
    return w.replace(/(ский|цкий|ной|ый|ой)$/, (m) => m.slice(0, -2) + 'ого');
  return w;
}

/**
 * Имя заказчика в винительном падеже: «Ольга Смирнова» → «Ольгу Смирнову», «Андрей Кузнецов» → «Андрея Кузнецова».
 * Узнаётся «Имя» и «Имя Фамилия»; всё остальное (организация, латиница) остаётся как есть (Q-W6.23-8).
 */
export function accusativeName(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 0 || words.length > 2 || !words.every((w) => NAME_WORD.test(w))) return name;
  const [first, last] = words as [string, string | undefined];
  return [firstName(first), ...(last ? [lastName(last)] : [])].join(' ');
}

/** Слово сервера для заказчика в `notifyWho`. */
const CLIENT = 'заказчик';

/** «Уведомим: …» по списку сервера или расчёта: заказчик в списке — значит, меняется дата сдачи. */
export function notifyText(who: readonly string[], clientName: string): string {
  const executors = who.filter((w) => w.trim().toLowerCase() !== CLIENT);
  const client = executors.length !== who.length;
  const head = 'Уведомим: ' + (executors.length ? executors.join(', ') : 'исполнителей нет');
  if (!client) return head + '.';
  const name = accusativeName(clientName);
  return head + '; заказчика' + (name ? ' ' + name : '') + ' — меняется дата сдачи.';
}
