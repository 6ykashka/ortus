// Сид места организации: разбивка занятого объёма (mock-data.js 14.10:60, 150–152).
import type { StorageRow, StorageSlice } from './types.ts';

const BREAKDOWN: Readonly<Record<string, readonly StorageRow[]>> = {
  't-alta': [
    ['Фото осмотров и отчётов', 31.4],
    ['Документы', 9.8],
    ['Вложения задач и форм', 3.1],
    ['Прочее', 1.9],
  ],
  't-lotos': [
    ['Фото работ и техкарты', 6.2],
    ['Документы', 3.9],
    ['Вложения задач и форм', 1.6],
    ['Прочее', 0.7],
  ],
};

export const filesSeed = (tenantId: string): StorageSlice => ({
  breakdown: (BREAKDOWN[tenantId] ?? []).map(([name, gb]): StorageRow => [name, gb]),
});
