// W2.25 · Источник «Требует решения» организации (homeVM :4068–4070; 05 §5.5 строки 6a, 6b, 7): пробный период
// завершён или кончается (≤ 14 дней), место занято больше 85 % — «Модули и место». Только владельцу — решает сервер.
import { ddmmyyyy } from '../time.ts';
import type { HomeSource, HomeTarget } from '../types.ts';

const MODULES: HomeTarget = { page: 'modules' };
const GiB = 1024 ** 3;
const gb = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

export const source: HomeSource = {
  id: 'tenant',
  moduleKey: 'billing',
  stage: 2,
  kinds: {
    'tenant.trial_ended': () => ({
      icon: 'lock_clock',
      tag: { key: 'queue.chips.subscription' },
      title: { key: 'queue.trialEnded' },
      text: { key: 'queue.trialEndedText' },
      action: { label: { key: 'queue.actions.more' }, target: MODULES },
    }),
    'tenant.trial_ending': (item, ctx) => {
      // trialEndsAt — полночь после последнего дня пробного периода (vm.ts «Модулей и места», Q-W1.24-1).
      const end = Date.parse(item.params.trialEndsAt ?? '');
      const date = Number.isNaN(end) ? '' : ddmmyyyy(new Date(end - 1), ctx.timeZone);
      return {
        icon: 'hourglass_top',
        tag: { key: 'queue.chips.subscription' },
        title: { key: 'queue.trialLeft', args: { days: Number(item.params.daysLeft ?? 0) } },
        text: { key: 'queue.trialLeftText', args: { date } },
        action: { label: { key: 'queue.actions.modules' }, target: MODULES },
      };
    },
    'tenant.storage_high': (item) => ({
      icon: 'storage',
      tag: { key: 'queue.chips.storage' },
      title: { key: 'queue.storageUsed', args: { pct: Number(item.params.percent ?? 0) } },
      text: {
        key: 'queue.storageText',
        args: {
          used: gb.format(Number(item.params.usedBytes ?? 0) / GiB),
          quota: gb.format(Math.round(Number(item.params.quotaBytes ?? 0) / GiB)),
        },
      },
      action: { label: { key: 'queue.actions.modules' }, target: MODULES },
    }),
  },
};
