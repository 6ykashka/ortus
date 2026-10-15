import type { Meta, StoryObj } from '@storybook/react-vite';
import { AccessGate } from './AccessGate';

const noop = () => undefined;

const meta = {
  title: 'Core/AccessGate',
  component: AccessGate,
  args: { reason: 'module_off' },
} satisfies Meta<typeof AccessGate>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Отраслевой модуль не подключён, владелец (gateVM, Ортус CRM.dc.html:3074–3076). */
export const ModuleOff: Story = {
  name: 'Модуль не подключён',
  args: {
    reason: 'module_off',
    title: '«Логистика» не подключена организацией',
    text: 'Подключите модуль в разделе «Модули и место», затем назначьте роли сотрудникам.',
    action: { label: 'Открыть «Модули и место»', onPress: noop },
  },
};

/** Отключён с историей, сотрудник (Ортус CRM.dc.html:3074–3076). */
export const ModuleReadonly: Story = {
  name: 'Модуль отключён',
  args: {
    reason: 'module_readonly',
    title: '«Логистика» не подключена организацией',
    text: 'Подключить модуль может владелец бизнеса. Само подключение доступа не выдаёт — понадобится ещё роль с областью.',
    action: { label: 'Демо: открыть как владелец', onPress: noop },
  },
};

/** Нет права на раздел общего модуля — без действия (Ортус CRM.dc.html:3063). */
export const NoPermission: Story = {
  name: 'Нет права',
  args: {
    reason: 'no_permission',
    title: 'Нет доступа к разделу «Данные»',
    text: 'Ни одна ваша роль не разрешает его просматривать. Владелец бизнеса может добавить действие в роль.',
  },
};

/** Объект вне области (Дизайн-система.dc.html:298–303). */
export const NoScope: Story = {
  name: 'Нет доступа к объекту',
  args: {
    reason: 'no_scope',
    title: 'Нет доступа к объекту',
    text: 'Запись не найдена или находится вне вашей области: Москва / Логистика 1.',
    action: { label: 'К списку рейсов', onPress: noop },
  },
};
