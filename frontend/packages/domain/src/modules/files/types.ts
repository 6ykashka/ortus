// Файлы и место организации (mock-data.js 14.10:60, 150–152; api.js:970–985).

/** Строка разбивки занятого места: категория и объём, ГБ. */
export type StorageRow = readonly [string, number];

export interface StorageSlice {
  breakdown: StorageRow[];
}

/** Квота и занятое место организации (поля `Tenant` control DB). */
export interface StorageUsage {
  usedGb: number;
  quotaGb: number;
}

export interface FilesSlices {
  storage?: StorageSlice;
}

declare module '../../core/types/entities-core.ts' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ModuleSlices extends FilesSlices {}
}
