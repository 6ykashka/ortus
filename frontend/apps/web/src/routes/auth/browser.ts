// W1.22 · Навигация браузера вне роутера (уход на BFF и к провайдеру входа); экранные тесты подменяют `assign`.
export const browser = {
  assign(url: string): void {
    window.location.assign(url);
  },
  /** Есть ли сеть: без неё навигация на BFF уводит вкладку на страницу ошибки браузера. */
  online(): boolean {
    return navigator.onLine;
  },
  /**
   * Подгрузить шрифт значков (лигатуры Material Symbols, @ortus/tokens) заранее: браузер грузит его при первом значке,
   * и без сети баннер «Нет связи» показал бы слово «warning». Статический файл приложения, не API. Файл большой
   * (≈ 5,4 МБ), поэтому загрузка начинается после события `load`: экран входа не ждёт шрифт. Возвращает отмену.
   */
  warmIconFont(): () => void {
    if (!('fonts' in document)) return () => undefined;
    const warm = () => {
      document.fonts.load('20px "Material Symbols Rounded"', 'warning').catch(() => undefined);
    };
    if (document.readyState === 'complete') {
      warm();
      return () => undefined;
    }
    window.addEventListener('load', warm, { once: true });
    return () => window.removeEventListener('load', warm);
  },
};
