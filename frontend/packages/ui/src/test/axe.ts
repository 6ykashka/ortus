import axe from 'axe-core';

/**
 * Нарушения axe уровня serious и critical (ворота компонентов, tdd-protocol §3).
 * `color-contrast` в jsdom не вычисляется (нет canvas): контраст проверяет аддон a11y Storybook
 * в браузере, а пары цветов заданы токенами (`text-muted` 5,6:1 на белом).
 */
export async function seriousViolations(node: Element): Promise<string[]> {
  const result = await axe.run(node, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false } },
  });
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.help}`);
}
