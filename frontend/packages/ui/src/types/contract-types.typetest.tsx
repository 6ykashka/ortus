// Проверки типов контракта: файл только компилируется (`tsc --noEmit`), не исполняется.
import { Banner, Button, Card, Dialog, Field, IconButton, Status } from '../index';

export function contractTypeChecks() {
  const noop = () => undefined;
  return [
    // @ts-expect-error — текст статуса обязателен (components.md: «Текст обязателен»)
    <Status tone="ok" />,
    // @ts-expect-error — варианта danger-secondary в контракте 14.10 нет
    <Button variant="danger-secondary">Отклонить</Button>,
    // @ts-expect-error — у кнопки-иконки подпись обязательна (aria-label)
    <IconButton icon="close" />,
    // @ts-expect-error — тон баннера только из пяти тонов токенов
    <Banner tone="error" title="Нет связи." />,
    // @ts-expect-error — у поля подпись обязательна
    <Field>
      <input />
    </Field>,
    // @ts-expect-error — диалогу нужен заголовок
    <Dialog open onClose={noop} />,
    <Card title="Логистика" onOpen={noop} selected />,
    <Status tone="warn" icon="pending">
      Ожидает приёмки
    </Status>,
  ];
}
