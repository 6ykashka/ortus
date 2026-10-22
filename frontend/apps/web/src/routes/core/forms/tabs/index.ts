// W4.23 · Вкладки редактора формы для оболочки W4.22: editor.tsx грузит этот модуль по glob (`./tabs/index.ts`) и
// ждёт `FormTabPanel` ({ tenantId, formId, tab }) — «Настройки», «Действия после ответа», «Ответы», «Версии» — и
// `ShareDialog` ({ tenantId, formId, onClose }) — «Поделиться формой». Реализация — `../results/`.
export { FormTabPanel } from '../results/panel.tsx';
export { ShareDialog } from '../results/share.tsx';
