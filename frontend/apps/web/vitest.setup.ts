// W2.53 · Общая настройка экранных тестов @ortus/web (vitest.config.ts → setupFiles).
// Ожидания Testing Library (findBy*, waitFor) по умолчанию ждут 1 с: под нагрузкой первый рендер приложения
// на MSW (холодный импорт ленивой страницы) занимает 5–10 с, и тест падал «Unable to find role=…» раньше
// срока теста. 10 с — половина срока теста (vitest.config.ts): успешное ожидание завершается сразу, дольше
// ждёт только падающее, а зависшее ожидание всё равно укладывается в срок теста.
import { configure } from '@testing-library/react';

configure({ asyncUtilTimeout: 10_000 });
