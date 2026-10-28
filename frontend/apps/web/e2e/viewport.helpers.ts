// W2.103 · Ширина окна для проверок раскладки: «широкий» — десктоп 1440 (планшет 768 держит узкую раскладку).
import type { Page } from '@playwright/test';

export const wide = (page: Page): boolean => (page.viewportSize()?.width ?? 0) >= 1024;
