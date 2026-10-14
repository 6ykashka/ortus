// @stub Owner: W1.21 — заглушка контракта W0.10; владелец заменяет каталог целиком.
import type { ReactElement } from 'react';
import { makeStub } from '../../stub';
import type { DataTableProps } from '../../types';

export const DataTable = makeStub<DataTableProps<unknown>>('DataTable') as <Row>(
  props: DataTableProps<Row>,
) => ReactElement;
