// Проверки типов контракта: файл только компилируется (`tsc --noEmit`), не исполняется.
import {
  AccessGate,
  Banner,
  Button,
  Card,
  DataTable,
  Dialog,
  Field,
  IconButton,
  Meter,
  MoneyInput,
  Select,
  Status,
  Switch,
  Tabs,
  Toast,
} from '../index';

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
    // W1.21
    // @ts-expect-error — тосту нужен onDismiss (автоскрытие)
    <Toast tone="ok" text="Список обновлён" />,
    // @ts-expect-error — тон тоста: error, а не danger (Ортус CRM.dc.html:2888)
    <Toast tone="danger" text="Ошибка" onDismiss={noop} />,
    // @ts-expect-error — у полосы заполнения подпись обязательна
    <Meter value={1} max={2} />,
    // @ts-expect-error — у списка вкладок имя обязательно
    <Tabs items={[]} value="a" onChange={noop} />,
    // @ts-expect-error — у гейта причина обязательна
    <AccessGate title="Нет права" />,
    // @ts-expect-error — переключателю нужна подпись (видимая или для чтения с экрана)
    <Switch checked onChange={noop} />,
    // @ts-expect-error — MoneyInput хранит копейки числом, не строкой
    <MoneyInput value="3 250,00" onChange={noop} />,
    // @ts-expect-error — значение Select — из вариантов options
    <Select<'a' | 'b'> value="c" options={[{ value: 'a', label: 'А' }]} onChange={noop} />,
    <DataTable<{ id: string }>
      columns={[{ key: 'id', header: 'Рейс', primary: true }]}
      rows={[{ id: 'TR-000214' }]}
      rowKey={(r) => r.id}
      mobile="cards"
    />,
  ];
}
