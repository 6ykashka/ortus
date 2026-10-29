// W2.74 · Сверка «Моей смены» с машинами на выбор с макетами 1c–1e «Временный водитель - варианты.dc.html» (снимок
// 19.10b, тег design-2026-10-19b; verification-protocol §3). Макет — холст с кадрами телефона и данными другого
// сюжета (Олег Тарасов, Hyundai HD-35, Ford Transit), поэтому пиксельной сверки нет (allowlist/driver-today.md):
// структурная — заголовки и кнопки кадра (модели машин заменены на {model}), строки статуса 1e — по образцу.
// Снимки кадров макета и реализации — в EVIDENCE_DIR, если он задан (проходка, docs/plan/evidence/driver-today/).
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openReference } from '@ortus/e2e-kit';
import type { Locator, Page } from '@playwright/test';

import { offerCard, offerSheet, openOffer, SPRINTER } from '../driver-offer.helpers.ts';
import { expect, test } from '../fixtures/index.ts';
import { type OwnReference, startOwnReference } from './own-reference.ts';

const FILE = 'Временный водитель - варианты.dc.html';
/** Тег снимка эталона с макетом S2-20 (design-2026-10-19b). */
const OFFER_REF = 'design-2026-10-19b';
const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const MODELS = /Hyundai HD-35|Ford Transit|Mercedes Sprinter|Isuzu Elf/g;

let own: Promise<OwnReference> | undefined;

/**
 * Свой сервер эталона на снимке OFFER_REF: в CI общий эталон стоит на design-stage-1 (W2.70, Q-W2.70-15),
 * где макета «Временный водитель - варианты» ещё нет, и `reference(FILE)` ждал `.sc-host` до тайм-аута
 * теста (2 мин на строку, три попытки). Один сервер на воркер, гасится в afterAll.
 */
function ownReference(): Promise<OwnReference> {
  own ??= startOwnReference({ repoRoot: REPO_ROOT, ref: OFFER_REF, probeFile: FILE });
  return own;
}

test.afterAll(async () => {
  const started = own;
  own = undefined;
  await (await started?.catch(() => undefined))?.stop();
});
type ReferenceFn = (file?: string) => Promise<{ page: Page }>;

/** Макет FILE: на общем эталоне, если он там есть, иначе — на своём сервере снимка OFFER_REF. */
async function offerReference(
  reference: ReferenceFn,
  referenceFiles: readonly string[],
): Promise<{ page: Page }> {
  if (referenceFiles.includes(FILE)) return reference(FILE);
  const host = await reference();
  const base = (await ownReference()).url;
  // Сеть контекста пропускает только allowlist; свой порт — тоже loopback эталона.
  await host.page.context().route(`${base}/**`, (route) => route.continue());
  return openReference(host.page, { baseURL: base, file: FILE });
}

test.describe.configure({ timeout: 120_000 });

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().replace(MODELS, '{model}');

/** Подписи кнопок без лигатур значков (Material Symbols — текст в span). */
async function buttons(root: Locator): Promise<string[]> {
  return (
    await root.getByRole('button').evaluateAll((list) =>
      list.map((el) => {
        const copy = el.cloneNode(true) as HTMLElement;
        copy.querySelectorAll('.material-symbols-rounded').forEach((i) => i.remove());
        return copy.textContent ?? '';
      }),
    )
  ).map(norm);
}

async function headings(root: Locator): Promise<string[]> {
  return (await root.locator('h1, h2, h3, h4').allTextContents()).map(norm);
}

async function shoot(target: Locator, name: string): Promise<void> {
  const dir = process.env.EVIDENCE_DIR;
  if (dir) await target.screenshot({ path: join(dir, name) });
}

/** Кадр телефона макета: второй блок `#1c`/`#1d`/`#1e` (первый — подпись). */
const frame = (page: Page, id: string): Locator => page.locator(`[id="${id}"] > div`).nth(1);

test.describe('driver-today · S2-20 1c–1e: структура как в макете @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'структурная сверка mock-визуала');

  test('1c «Выберите машину»: заголовки и кнопки', async ({
    app,
    page,
    reference,
    referenceFiles,
  }, testInfo) => {
    const ref = await offerReference(reference, referenceFiles);
    const r = frame(ref.page, '1c');
    await openOffer(app, page, 'two');
    const mine = page.locator('section.ox-dr');
    // `openOffer` ждёт только h1 «Моя смена»; предложение приходит после загрузки броней — без ожидания чтение
    // заголовков изредка видело один «Моя смена» (возврат 3).
    await expect(mine.getByRole('heading', { level: 2, name: 'Выберите машину' })).toBeVisible();
    expect(await headings(mine)).toEqual(await headings(r));
    expect(await buttons(mine)).toEqual(await buttons(r));
    await shoot(r, `s2-20-1c-reference-${testInfo.project.name}.png`);
    await shoot(page.locator('#app'), `s2-20-1c-${testInfo.project.name}.png`);
  });

  test('1d «Берёте …?»: заголовок, пункты и кнопки листа', async ({
    app,
    page,
    reference,
    referenceFiles,
  }, testInfo) => {
    const ref = await offerReference(reference, referenceFiles);
    const r = frame(ref.page, '1d').getByRole('dialog');
    await openOffer(app, page, 'two');
    await offerCard(page, SPRINTER.model).getByRole('button', { name: 'Взять эту машину' }).click();
    const mine = offerSheet(page);
    expect(await headings(mine)).toEqual(await headings(r));
    expect(await buttons(mine)).toEqual(await buttons(r));
    expect(await mine.getByRole('listitem').count()).toBe(await r.getByRole('listitem').count());
    await shoot(frame(ref.page, '1d'), `s2-20-1d-reference-${testInfo.project.name}.png`);
    await shoot(page.locator('#app'), `s2-20-1d-${testInfo.project.name}.png`);
  });

  test('1e осмотр на выбранной машине: заголовки и статус брони', async ({
    app,
    page,
    reference,
    referenceFiles,
  }, testInfo) => {
    const ref = await offerReference(reference, referenceFiles);
    const r = frame(ref.page, '1e');
    await openOffer(app, page, 'two');
    await offerCard(page, SPRINTER.model).getByRole('button', { name: 'Взять эту машину' }).click();
    await offerSheet(page).getByRole('button', { name: 'Взять и начать осмотр' }).click();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Осмотр перед выездом' }),
    ).toBeVisible();
    const mine = page.locator('section.ox-dr');
    // Заголовки кадра: «Моя смена», «Осмотр перед выездом» (у реализации ниже — подписи осмотра этапа 2).
    expect((await headings(mine)).slice(0, 2)).toEqual(await headings(r));
    // Статус 1e: «Бронь подтверждена сервером · {модель} до {время}» и «{модель} {номер} освобождена в {время}».
    const status = async (l: Locator) =>
      norm(((await l.textContent()) ?? '').replace(/cloud_done|event_busy/g, ' '));
    const pattern =
      /^Бронь подтверждена сервером · \{model\} до \d\d:\d\d \{model\} \S \d{3} \S{2} \d{2,3} освобождена в \d\d:\d\d$/;
    expect(await status(r.locator('[role="status"]').first())).toMatch(pattern);
    expect(await status(page.locator('.ox-dr-offer-held'))).toMatch(pattern);
    await shoot(r, `s2-20-1e-reference-${testInfo.project.name}.png`);
    await shoot(page.locator('#app'), `s2-20-1e-${testInfo.project.name}.png`);
  });
});
