// W2.50 · Кнопки выгрузки CSV «Выгрузить расходы» и «Выгрузить рейсы» (D-11 комплекта; no-reference — B-6) для
// «Приёмки смен» и «Начислений водителям»: каталог наборов listDatasets (кэш «Данных» W2.26), выгрузка
// exportDataset (строки области права набора и data.export, до 10 000), файл сохраняет браузер — UTF-8 с BOM.
import { type ApiClient, type components, unwrap } from '@ortus/api-client';
import { Icon } from '@ortus/ui';
import type { ReactElement } from 'react';

import { useApi } from '../../../../app/api.tsx';
import { useBusy, useRun } from '../../../../shell/run.tsx';
import { useToast } from '../../../../shell/toast.tsx';
import { useDatasets } from '../../../core/data/api.ts';
import {
  type ExportButton,
  exportBody,
  exportButtons,
  exportToast,
  fileParts,
} from './export-model.ts';
import { REVIEW_TEXT } from './texts.ts';

type S = components['schemas'];

const T = REVIEW_TEXT.export;

async function exportDataset(
  api: ApiClient,
  tenantId: string,
  ds: S['Dataset'],
): Promise<S['DatasetExport']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/datasets/{datasetId}/export', {
      params: { path: { tenantId, datasetId: ds.id } },
      body: exportBody(ds),
    }),
  );
}

/** Сохранение файла выгрузки: Blob с BOM и имя файла сервера. */
function save(r: S['DatasetExport']): void {
  const blob = new Blob(fileParts(r.content), { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = r.fileName;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function Item({ tenantId, b }: { tenantId: string; b: ExportButton }): ReactElement {
  const api = useApi();
  const run = useRun();
  const toast = useToast();
  const key = `export:${b.id}`;
  const busy = useBusy(key);
  const go = async (): Promise<void> => {
    if (busy) return;
    try {
      const r = await run(key, () => exportDataset(api, tenantId, b.dataset), null);
      save(r);
      toast(exportToast(r), 'ok');
    } catch {
      // Тост ошибки показал run.
    }
  };
  return (
    <button
      type="button"
      className="ox-rv-link ox-rv-export"
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={() => void go()}
    >
      {/* Значок образца «Выгрузить» в «Данных» (data.page.tsx); имя кнопки — только подпись. */}
      <Icon name="download" size={18} />
      {busy ? T.running : b.label}
    </button>
  );
}

/** Группа «Выгрузка CSV»: только наборы с exportAllowed; каталог недоступен — группы нет. */
export function ExportButtons({ tenantId }: { tenantId: string }): ReactElement | null {
  const datasets = useDatasets(tenantId);
  const buttons = exportButtons(datasets.data ?? []);
  if (!buttons.length) return null;
  return (
    <div role="group" aria-label={T.aria} className="ox-rv-links">
      {buttons.map((b) => (
        <Item key={b.id} tenantId={tenantId} b={b} />
      ))}
    </div>
  );
}
