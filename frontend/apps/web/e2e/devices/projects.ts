// W2.31 · Матрица устройств (S2-19 п. 1–2, R-04): Playwright-проекты телефонов водителей и масштаба 200 % поверх
// проектов харнесса W0.05 (mobile-390, tablet-768, desktop-1440). Подключение — playwright.config.ts приложения:
//   export default withDeviceProjects(defineHarnessConfig({ appDir: import.meta.dirname }));
// Spec каталога e2e/devices/ идут только на проектах устройств; проекты харнесса их не запускают.
//
// Движок: Android — Chromium (Chrome). iPhone — по умолчанию Chromium с профилем iPhone (viewport, плотность 3, UA
// Safari, касание): в CI ставится только Chromium (`e2e:install`, W0.05). `E2E_DEVICES_WEBKIT=1` — iPhone на WebKit
// (нужен `playwright install webkit`). Настоящие Safari и Chrome на телефоне — полевой тест (field-test-checklist.md).
import { devices, type PlaywrightTestConfig } from '@playwright/test';

type Project = NonNullable<PlaywrightTestConfig['projects']>[number];
type Env = Readonly<Record<string, string | undefined>>;

export interface DeviceMeta {
  /** ОС профиля (UA дескриптора Playwright). */
  os: 'android' | 'ios' | 'desktop';
  /** Мажорная версия ОС из UA дескриптора. */
  osVersion: number;
  /** Браузер, который эмулирует профиль. */
  browser: 'Chrome' | 'Safari';
  /** Движок прогона. */
  engine: 'chromium' | 'webkit';
  /** Дескриптор Playwright (`devices[…]`). */
  descriptor: string;
  /** Масштаб браузера: 1 — обычный, 2 — 200 % (CSS-ширина вдвое меньше при плотности 2). */
  zoom: number;
  /** Камера — фальшивое устройство Chromium (`getUserMedia`); иначе кадр рисует холст. */
  fakeCamera: boolean;
}

interface Entry {
  name: string;
  descriptor: keyof typeof devices & string;
  os: DeviceMeta['os'];
  osVersion: number;
  browser: DeviceMeta['browser'];
  zoom?: number;
  /** CSS-viewport (для масштаба 200 % — половина физического окна). */
  viewport?: { width: number; height: number };
  deviceScaleFactor?: number;
}

/**
 * Телефоны S2-19 п. 1: два Android (Chrome) и два iPhone (Safari) текущей и предыдущей версии ОС; iPhone — ширина 390.
 * Android — узкий (360) и широкий (412) экран. Масштаб 200 % — окно 1280×800 при масштабе браузера 200 %.
 */
export const DEVICE_MATRIX: readonly Entry[] = [
  {
    name: 'devices-android-galaxy-s24',
    descriptor: 'Galaxy S24',
    os: 'android',
    osVersion: 14,
    browser: 'Chrome',
  },
  {
    name: 'devices-android-pixel-7a',
    descriptor: 'Pixel 7a',
    os: 'android',
    osVersion: 13,
    browser: 'Chrome',
  },
  {
    name: 'devices-iphone-16e',
    descriptor: 'iPhone 16e',
    os: 'ios',
    osVersion: 18,
    browser: 'Safari',
  },
  {
    name: 'devices-iphone-14',
    descriptor: 'iPhone 14',
    os: 'ios',
    osVersion: 16,
    browser: 'Safari',
  },
  {
    name: 'devices-zoom-200',
    descriptor: 'Desktop Chrome',
    os: 'desktop',
    osVersion: 0,
    browser: 'Chrome',
    zoom: 2,
    viewport: { width: 640, height: 400 },
    deviceScaleFactor: 2,
  },
];

/** Каталог spec устройств (абсолютный путь файла теста). */
export const DEVICES_DIR = /[\\/]e2e[\\/]devices[\\/]/;
const PHONE_SPECS = /[\\/]e2e[\\/]devices[\\/](matrix|driver-devices)\.spec\.ts$/;
const ZOOM_SPECS = /[\\/]e2e[\\/]devices[\\/](matrix|zoom)\.spec\.ts$/;

/**
 * Фальшивая камера Chromium: `getUserMedia` отдаёт тестовый кадр без запроса разрешения. Геолокация не выдаётся
 * (permissions без `geolocation`, координат нет — S2-19 п. 2).
 */
const FAKE_CAMERA_ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];

export function deviceProjects(env: Env = process.env): Project[] {
  const webkit = env.E2E_DEVICES_WEBKIT === '1';
  return DEVICE_MATRIX.map((e) => {
    const engine: DeviceMeta['engine'] = e.os === 'ios' && webkit ? 'webkit' : 'chromium';
    const zoom = e.zoom ?? 1;
    const device: DeviceMeta = {
      os: e.os,
      osVersion: e.osVersion,
      browser: e.browser,
      engine,
      descriptor: e.descriptor,
      zoom,
      fakeCamera: engine === 'chromium',
    };
    const base = devices[e.descriptor];
    return {
      name: e.name,
      testMatch: zoom === 1 ? PHONE_SPECS : ZOOM_SPECS,
      metadata: { device },
      use: {
        ...base,
        ...(e.viewport ? { viewport: e.viewport } : {}),
        ...(e.deviceScaleFactor ? { deviceScaleFactor: e.deviceScaleFactor } : {}),
        browserName: engine,
        permissions: engine === 'chromium' ? ['camera'] : [],
        ...(engine === 'chromium' ? { launchOptions: { args: FAKE_CAMERA_ARGS } } : {}),
      },
    };
  });
}

const asArray = <T>(v: T | readonly T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? [...(v as readonly T[])] : [v as T];

/** Конфиг харнесса + проекты устройств; проекты харнесса не запускают spec каталога `e2e/devices/`. */
export function withDeviceProjects(
  config: PlaywrightTestConfig,
  env: Env = process.env,
): PlaywrightTestConfig {
  const harness = (config.projects ?? []).map((p) => ({
    ...p,
    testIgnore: [...asArray(p.testIgnore), DEVICES_DIR],
  }));
  return { ...config, projects: [...harness, ...deviceProjects(env)] };
}
