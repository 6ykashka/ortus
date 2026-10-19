// W2.31 · Матрица устройств (S2-19 п. 1–2, R-04): проекты устройств в конфиге Playwright и то, что spec каталога
// `e2e/devices/` идут только на них. Проекты 390/768/1440 (W0.05) spec устройств не запускают.
import { expect, test } from '../fixtures/index.ts';

interface DeviceMeta {
  os: 'android' | 'ios' | 'desktop';
  osVersion: number;
  browser: string;
  zoom: number;
}

const deviceOf = (metadata: unknown): DeviceMeta | undefined =>
  (metadata as { device?: DeviceMeta } | undefined)?.device;

test.describe('матрица устройств @devices', () => {
  test('конфиг: ≥ 2 Android (Chrome) и ≥ 2 iPhone (Safari) текущей и предыдущей ОС, iPhone 390, масштаб 200 %', () => {
    const projects = test.info().config.projects.flatMap((p) => {
      const d = deviceOf(p.metadata);
      return d ? [{ name: p.name, d, width: p.use.viewport?.width ?? 0 }] : [];
    });
    const android = projects.filter((p) => p.d.os === 'android' && p.d.browser === 'Chrome');
    const ios = projects.filter((p) => p.d.os === 'ios' && p.d.browser === 'Safari');
    expect(android.length).toBeGreaterThanOrEqual(2);
    expect(ios.length).toBeGreaterThanOrEqual(2);
    expect(new Set(android.map((p) => p.d.osVersion)).size).toBeGreaterThanOrEqual(2);
    expect(new Set(ios.map((p) => p.d.osVersion)).size).toBeGreaterThanOrEqual(2);
    expect(ios.every((p) => p.width === 390)).toBe(true);
    expect(projects.some((p) => p.d.zoom === 2)).toBe(true);
    expect(projects.every((p) => p.name.startsWith('devices-'))).toBe(true);
  });

  test('spec устройств идут только на проектах устройств', () => {
    expect(deviceOf(test.info().project.metadata)).toBeDefined();
    expect(test.info().project.name).toMatch(/^devices-/);
  });
});
