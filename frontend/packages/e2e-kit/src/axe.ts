// axe на странице (эталон или реализация): количество serious/critical и список нарушений.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { PANEL } from './persona.ts';

export interface AxeViolation {
  id: string;
  impact: string | null | undefined;
  help: string;
  nodes: { target: unknown[] }[];
}

export interface AxeResult {
  serious: number;
  critical: number;
  violations: AxeViolation[];
}

export async function runAxe(page: Page, o: { exclude?: string[] } = {}): Promise<AxeResult> {
  let builder = new AxeBuilder({ page });
  for (const sel of o.exclude ?? [PANEL]) builder = builder.exclude(sel);
  const { violations } = await builder.analyze();
  const count = (impact: string) => violations.filter((v) => v.impact === impact).length;
  return {
    serious: count('serious'),
    critical: count('critical'),
    violations: violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => ({ target: [...n.target] })),
    })),
  };
}
