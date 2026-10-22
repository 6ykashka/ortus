// W4.61 · Визуальная и структурная сверка `company-billing` со снимком design-2026-10-19 (verification-protocol.md
// §3, PD-22: 0,01): «Подписка и места» владельцев «Альты» (пробный период) и «Лотоса» (заявка SR-12) на высоком окне
// (390, 1440). Списки мест приведены к данным контракта (allowlist/company-billing.md): подпись под именем —
// рабочая функция или почта, срока приглашения и «Отозвать» нет, карточек бригады нет (модуль «Ремонт» — этап 6).
import type { Page } from '@playwright/test';

import { applyAllowlist, collectLabels, type Persona, type Target } from '@ortus/e2e-kit';

import { expect, test } from '../fixtures/index.ts';
import { openPage } from '../modules.helpers.ts';
import { LOTOS } from '../shell.helpers.ts';
import { goReference, mainTarget, tall } from './billing.compare.ts';
import { allowlist, compareShots } from './shell.compare.ts';

const SECTION = 'section[aria-labelledby="h-bill"]';

interface ImplPerson {
  name: string;
  sub: string[];
}

/** Строки списков реализации: имя и подписи под ним (по карточке «Занимают…» и «Не занимают…»). */
async function implPeople(page: Page): Promise<{ paid: ImplPerson[]; free: ImplPerson[] }> {
  return page.locator(SECTION).evaluate((s) => {
    const rows = (sel: string) =>
      Array.from(s.querySelectorAll(`${sel} .ox-bl-person`)).map((r) => ({
        name: (r.querySelector('.ox-bl-name')?.textContent ?? '').trim(),
        sub: Array.from(r.querySelectorAll('.ox-bl-title, .ox-bl-note')).map((x) =>
          (x.textContent ?? '').trim(),
        ),
      }));
    return { paid: rows('.ox-bl-paid'), free: rows('.ox-bl-free') };
  });
}

/** Списки эталона → данные реализации: подписи, без «Отозвать», без строк, которых в реализации нет. */
async function normalizeReference(ref: Page, impl: { paid: ImplPerson[]; free: ImplPerson[] }) {
  await ref.locator(SECTION).evaluate((s, v) => {
    const card = (prefix: string) =>
      Array.from(s.querySelectorAll('h2')).find((h) => (h.textContent ?? '').startsWith(prefix))
        ?.parentElement?.parentElement ?? null;
    const apply = (prefix: string, people: { name: string; sub: string[] }[], count: string) => {
      const c = card(prefix);
      if (!c) return;
      const h2 = c.querySelector('h2');
      if (h2) h2.textContent = count;
      const rows = Array.from(c.children).filter(
        (x) => x.firstElementChild?.getAttribute('aria-hidden') === 'true',
      );
      for (const row of rows) {
        const who = Array.from(row.children).find((x) => x.tagName === 'DIV');
        const name = (who?.children[0]?.textContent ?? '').trim();
        const p = people.find((x) => x.name === name);
        if (!p || !who) {
          row.remove();
          continue;
        }
        while (who.children.length > 1) who.lastElementChild?.remove();
        for (const [i, text] of p.sub.entries()) {
          const span = who.ownerDocument.createElement('span');
          span.textContent = text;
          span.setAttribute(
            'style',
            i === 0
              ? 'font-size:12px;color:#5C6964;text-wrap:pretty;'
              : 'font-size:12px;color:#7A5214;',
          );
          who.appendChild(span);
        }
        for (const b of Array.from(row.querySelectorAll('button'))) b.remove();
      }
      // Строки списка — в порядке реализации, разделитель первой строки прозрачный (как :1508).
      const left = Array.from(c.children).filter(
        (x) => x.firstElementChild?.getAttribute('aria-hidden') === 'true',
      );
      left.sort(
        (a, b) =>
          people.findIndex(
            (x) => x.name === (a.querySelector('div')?.children[0]?.textContent ?? '').trim(),
          ) -
          people.findIndex(
            (x) => x.name === (b.querySelector('div')?.children[0]?.textContent ?? '').trim(),
          ),
      );
      for (const [i, row] of left.entries()) {
        c.appendChild(row);
        (row as HTMLElement).style.borderTopColor = i ? '#E8ECE5' : 'transparent';
      }
    };
    apply('Занимают место', v.paid, `Занимают место · ${v.paid.length}`);
    apply('Не занимают место', v.free, `Не занимают место · ${v.free.length}`);
  }, impl);
}

async function open(
  app: (route: string, o?: { persona?: Persona }) => Promise<unknown>,
  page: Page,
  reference: (file?: string, o?: { persona?: Persona; hidePanel?: boolean }) => Promise<Target>,
  persona: 'owner' | 'owner@t-lotos',
): Promise<{ ref: Target; impl: Target }> {
  const ref = await reference(undefined, { persona, hidePanel: true });
  await goReference(ref.page, 'Подписка и места', 'Подписка и места');
  await tall(ref.page, 3200);
  await tall(page, 3200);
  await openPage(app, page, 'billing', {
    persona,
    ...(persona === 'owner' ? {} : { tenant: LOTOS }),
  });
  const impl: Target = { kind: 'app', page, root: page.locator('#app'), url: page.url() };
  await expect(page.locator(`${SECTION} .ox-bl-paid .ox-bl-person`).first()).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForLoadState('networkidle');
  await normalizeReference(ref.page, await implPeople(page));
  return { ref, impl };
}

test.describe('company-billing — сверка с эталоном @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пиксельная сверка — режим mock');
  test.describe.configure({ timeout: 120_000 });

  for (const persona of ['owner', 'owner@t-lotos'] as const) {
    test(`«Подписка и места» (${persona}) в допуске 0,01 и с теми же подписями`, async ({
      app,
      page,
      reference,
    }, testInfo) => {
      const { ref, impl } = await open(app, page, reference, persona);
      const entries = allowlist('company-billing');
      expect(applyAllowlist(await collectLabels(page.locator(SECTION)), entries, 'mock')).toEqual(
        applyAllowlist(await collectLabels(ref.page.locator(SECTION)), entries, 'mock'),
      );
      const key = `company-billing-${persona.replace('@', '-')}-${testInfo.project.name}`;
      const r = await compareShots(
        { target: mainTarget(impl) },
        { target: mainTarget(ref) },
        key,
        testInfo,
      );
      console.log(`visual ${key}: ${r.diffPixels} px, ${r.ratio}`);
      expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
    });
  }

  test('выбранный тариф и расчёт («Команда», 12 мес) в допуске 0,01', async ({
    app,
    page,
    reference,
  }, testInfo) => {
    const { ref, impl } = await open(app, page, reference, 'owner');
    for (const p of [ref.page, page]) {
      await p
        .locator(SECTION)
        .getByRole('radiogroup', { name: 'Тариф' })
        .getByRole('radio')
        .filter({ hasText: 'Команда' })
        .click();
    }
    const key = `company-billing-calc-${testInfo.project.name}`;
    const r = await compareShots(
      { target: mainTarget(impl) },
      { target: mainTarget(ref) },
      key,
      testInfo,
    );
    console.log(`visual ${key}: ${r.diffPixels} px, ${r.ratio}`);
    expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
  });
});
