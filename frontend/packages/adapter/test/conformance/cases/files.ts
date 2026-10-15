// Кейсы тега Files (W0.13): сессии загрузки (резерв → передача → проверка), файлы и ссылки на скачивание.
import { expect } from 'vitest';

import type { Session } from '../client.ts';
import { type CaseContext, cases } from '../types.ts';

const SHA = 'a3f1c9e2b7d4058e6c1f2a9b3d7e4c5f8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d';
const MISSING = '00000000-0000-5000-8000-000000000000';

/** Фото осмотра Р-208 спереди (примеры initiateUpload, completeUpload); часы — 06:05 UTC. */
async function initiate(ctx: CaseContext, s: Session) {
  return s.post(`${ctx.alta}/files/uploads`, {
    fileName: 'Р-208 · спереди.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 2457600,
    sha256: SHA,
    purpose: 'inspection',
    owner: {
      moduleKey: 'fleet',
      entityType: 'reservation',
      entityId: (ctx.example('getUploadSession/ok') as { owner: { entityId: string } }).owner
        .entityId,
    },
  });
}

export const filesCases = cases('files')([
  {
    title: 'начало загрузки фото осмотра',
    operationId: 'initiateUpload',
    expect: 'success',
    example: 'initiateUpload/ok',
    run: async (ctx) => {
      ctx.server.setNow('2026-10-01T06:05:00Z');
      const s = await ctx.as('owner');
      ctx.expectExample(await initiate(ctx, s), 'initiateUpload/ok', 201);
      const usage = (await s.get(`${ctx.alta}/storage`)).body as { reservedBytes: number };
      expect(usage.reservedBytes).toBe(2457600);
    },
  },
  {
    title: 'место заполнено',
    operationId: 'initiateUpload',
    expect: 'error',
    example: 'initiateUpload/quota_exceeded',
    run: async (ctx) => {
      ctx.server.applyPreset('storage-full');
      const s = await ctx.as('owner');
      ctx.expectExample(await initiate(ctx, s), 'initiateUpload/quota_exceeded');
    },
  },
  {
    title: 'файл больше 20 МБ',
    operationId: 'initiateUpload',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(`${ctx.alta}/files/uploads`, {
        fileName: 'big.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 30 * 1024 * 1024,
        sha256: SHA,
        purpose: 'inspection',
        owner: { moduleKey: 'fleet', entityType: 'reservation', entityId: MISSING },
      });
      ctx.expectProblem(r, 'payload_too_large');
    },
  },
  {
    title: 'завершение загрузки — файл на проверке',
    operationId: 'completeUpload',
    expect: 'success',
    example: 'completeUpload/ok',
    run: async (ctx) => {
      ctx.server.setNow('2026-10-01T06:05:00Z');
      const s = await ctx.as('owner');
      const ticket = (await initiate(ctx, s)).body as { uploadId: string };
      const r = await s.post(`${ctx.alta}/files/uploads/${ticket.uploadId}/complete`, {
        sha256: SHA,
      });
      ctx.expectExample(r, 'completeUpload/ok');
      const session = (await s.get(`${ctx.alta}/files/uploads/${ticket.uploadId}`)).body;
      expect(session).toMatchObject({ state: 'completed', fileStatus: 'quarantined' });
    },
  },
  {
    title: 'контрольная сумма не совпала',
    operationId: 'completeUpload',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const ticket = (await initiate(ctx, s)).body as { uploadId: string };
      const r = await s.post(`${ctx.alta}/files/uploads/${ticket.uploadId}/complete`, {
        sha256: '0'.repeat(64),
      });
      ctx.expectProblem(r, 'validation_failed');
    },
  },
  {
    title: 'загрузка не найдена',
    operationId: 'completeUpload',
    expect: 'error',
    example: 'completeUpload/not_found',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(`${ctx.alta}/files/uploads/${MISSING}/complete`, { sha256: SHA });
      ctx.expectExample(r, 'completeUpload/not_found');
    },
  },
  {
    title: 'сессия загрузки Р-208',
    operationId: 'getUploadSession',
    expect: 'success',
    example: 'getUploadSession/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const id = (ctx.example('getUploadSession/ok') as { uploadId: string }).uploadId;
      ctx.expectExample(await s.get(`${ctx.alta}/files/uploads/${id}`), 'getUploadSession/ok');
    },
  },
  {
    title: 'неизвестная сессия загрузки',
    operationId: 'getUploadSession',
    expect: 'error',
    example: 'getUploadSession/not_found',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(
        await s.get(`${ctx.alta}/files/uploads/${MISSING}`),
        'getUploadSession/not_found',
      );
    },
  },
  {
    title: 'отмена загрузки возвращает резерв',
    operationId: 'abortUpload',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const ticket = (await initiate(ctx, s)).body as { uploadId: string };
      const r = await s.delete(`${ctx.alta}/files/uploads/${ticket.uploadId}`);
      expect(r.status).toBe(204);
      const usage = (await s.get(`${ctx.alta}/storage`)).body as { reservedBytes: number };
      expect(usage.reservedBytes).toBe(0);
      const session = (await s.get(`${ctx.alta}/files/uploads/${ticket.uploadId}`)).body;
      expect(session).toMatchObject({ state: 'aborted' });
    },
  },
  {
    title: 'завершённую загрузку не отменить',
    operationId: 'abortUpload',
    expect: 'error',
    example: 'abortUpload/invalid_transition',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const id = (ctx.example('getUploadSession/ok') as { uploadId: string }).uploadId;
      ctx.expectExample(
        await s.delete(`${ctx.alta}/files/uploads/${id}`),
        'abortUpload/invalid_transition',
      );
    },
  },
  {
    title: 'файл осмотра Р-208',
    operationId: 'getFile',
    expect: 'success',
    example: 'getFile/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const id = (ctx.example('getFile/ok') as { id: string }).id;
      ctx.expectExample(await s.get(`${ctx.alta}/files/${id}`), 'getFile/ok');
    },
  },
  {
    title: 'неизвестный файл',
    operationId: 'getFile',
    expect: 'error',
    example: 'getFile/not_found',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.get(`${ctx.alta}/files/${MISSING}`), 'getFile/not_found');
    },
  },
  {
    title: 'ссылка на скачивание на 5 минут',
    operationId: 'getFileDownload',
    expect: 'success',
    example: 'getFileDownload/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const id = (ctx.example('getFile/ok') as { id: string }).id;
      ctx.expectExample(await s.get(`${ctx.alta}/files/${id}/download`), 'getFileDownload/ok');
    },
  },
  {
    title: 'файл ещё на проверке; после проверки — скачивается',
    operationId: 'getFileDownload',
    expect: 'error',
    example: 'getFileDownload/photo_not_ready',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const ticket = (await initiate(ctx, s)).body as { uploadId: string; fileId: string };
      await s.post(`${ctx.alta}/files/uploads/${ticket.uploadId}/complete`, { sha256: SHA });
      ctx.expectExample(
        await s.get(`${ctx.alta}/files/${ticket.fileId}/download`),
        'getFileDownload/photo_not_ready',
      );
      await ctx.anon().post('/api/v1/dev/scenario', { scanFiles: true });
      expect((await s.get(`${ctx.alta}/files/${ticket.fileId}/download`)).status).toBe(200);
    },
  },
]);
