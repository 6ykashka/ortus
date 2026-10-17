// W1.25 · Init-скрипт проходки MCP (`--init-script`): часы страницы стартуют с «сейчас» харнесса и сида —
// 01.10.2026 10:30 по Москве (e2e-kit clock.ts), дальше идут как обычно. Нужен для дословных сроков
// пробного периода («Осталось 12 дн. · до 13.10.2026»).
(() => {
  const RealDate = Date;
  const delta = RealDate.parse('2026-10-01T07:30:00Z') - RealDate.now();
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + delta);
      else super(...args);
    }
    static now() {
      return RealDate.now() + delta;
    }
  }
  globalThis.Date = FixedDate;
})();
