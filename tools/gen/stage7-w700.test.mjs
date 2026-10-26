// W7.00 · Контрактный PR этапа 7 (0.12.0-stage7): «Чаты», «Документы», «Обращения» — чаты (docs/plan/v2/analysis/dor/
// chats.md §2.2, §3), документы (documents.md §2.2, §3), обращения (service.md §2.3, §3); комплект design/docs/22, 24,
// 25; D-28 комплекта, D-31 комплекта, D-32 комплекта. Эталон — «Чаты.dc.html», «Документы.dc.html», «Обращения.dc.html» (design-2026-10-19), домены
// W7.10, W7.20–W7.21, W7.30. Бриф docs/plan/v2/ws/W7.00.md §4.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { bundle } from './lib/bundle.mjs';
import { checkExamples, loadExamples } from './lib/examples.mjs';
import { loadRegistry } from './lib/errors.mjs';
import { operationsById } from './lib/inventory.mjs';
import { abs, SCREENS_PATH, SOURCE_0_1 } from './lib/paths.mjs';
import { flattenActions, loadCatalog } from './lib/permissions.mjs';
import { checkAgainstSource, loadDeltas } from './lib/source-diff.mjs';
import { readYaml } from './lib/yaml-io.mjs';

/** [operationId, метод, путь, тег, x-permissions, x-scope] — бриф W7.00 §4. */
const OPS = [
  ['listChats', 'get', '/api/v1/tenants/{tenantId}/chats', 'Chats', ['chat.read'], 'chat'],
  ['createChat', 'post', '/api/v1/tenants/{tenantId}/chats', 'Chats', ['chat.create'], 'chat'],
  [
    'createDirectChat',
    'post',
    '/api/v1/tenants/{tenantId}/chats/direct',
    'Chats',
    ['chat.direct'],
    'chat',
  ],
  ['getChat', 'get', '/api/v1/tenants/{tenantId}/chats/{chatId}', 'Chats', ['chat.read'], 'chat'],
  [
    'updateChat',
    'patch',
    '/api/v1/tenants/{tenantId}/chats/{chatId}',
    'Chats',
    ['chat.settings.manage'],
    'chat',
  ],
  [
    'archiveChat',
    'post',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/archive',
    'Chats',
    ['chat.settings.manage'],
    'chat',
  ],
  [
    'listChatMessages',
    'get',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/messages',
    'Chats',
    ['chat.read'],
    'chat',
  ],
  [
    'postChatMessage',
    'post',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/messages',
    'Chats',
    ['chat.write'],
    'chat',
  ],
  [
    'editChatMessage',
    'patch',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/messages/{messageId}',
    'Chats',
    ['chat.write'],
    'chat',
  ],
  [
    'deleteChatMessage',
    'delete',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/messages/{messageId}',
    'Chats',
    ['chat.write', 'chat.moderate'],
    'chat',
  ],
  [
    'listChatMessageVersions',
    'get',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/messages/{messageId}/versions',
    'Chats',
    ['chat.read'],
    'chat',
  ],
  [
    'markChatRead',
    'post',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/read',
    'Chats',
    ['chat.read'],
    'chat',
  ],
  [
    'ackChatMessage',
    'post',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/messages/{messageId}/ack',
    'Chats',
    ['chat.read'],
    'chat',
  ],
  [
    'getChatMessageReceipts',
    'get',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/messages/{messageId}/receipts',
    'Chats',
    ['chat.receipts.read'],
    'chat',
  ],
  [
    'revealChatMessagePdn',
    'post',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/messages/{messageId}/pdn-reveal',
    'Chats',
    ['chat.pdn.read'],
    'chat',
  ],
  [
    'voteChatPoll',
    'put',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/polls/{pollId}/vote',
    'Chats',
    ['chat.read'],
    'chat',
  ],
  [
    'closeChatPoll',
    'post',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/polls/{pollId}/close',
    'Chats',
    ['chat.polls.create', 'chat.moderate'],
    'chat',
  ],
  [
    'remindChatPoll',
    'post',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/polls/{pollId}/remind',
    'Chats',
    ['chat.polls.create', 'chat.moderate'],
    'chat',
  ],
  [
    'pinChatMessage',
    'put',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/pin',
    'Chats',
    ['chat.moderate'],
    'chat',
  ],
  [
    'unpinChatMessage',
    'delete',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/pin',
    'Chats',
    ['chat.moderate'],
    'chat',
  ],
  [
    'openViewOnceAttachment',
    'post',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/attachments/{attachmentId}/view-once',
    'Chats',
    ['chat.read'],
    'chat',
  ],
  [
    'saveChatAttachmentsToRecord',
    'post',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/messages/{messageId}/save-to-record',
    'Chats',
    ['chat.write'],
    'chat',
  ],
  [
    'createTaskFromChatMessage',
    'post',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/messages/{messageId}/task',
    'Chats',
    ['tasks.create'],
    'tenant-org-unit-project',
  ],
  [
    'listChatMembers',
    'get',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/members',
    'Chats',
    ['chat.members.manage'],
    'chat',
  ],
  [
    'getChatSources',
    'get',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/sources',
    'Chats',
    ['chat.members.manage'],
    'chat',
  ],
  [
    'replaceChatSources',
    'put',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/sources',
    'Chats',
    ['chat.members.manage'],
    'chat',
  ],
  [
    'getChatAccessExplanation',
    'get',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/access-explanation',
    'Chats',
    ['chat.members.manage'],
    'chat',
  ],
  [
    'getChatStorage',
    'get',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/storage',
    'Chats',
    ['chat.settings.manage'],
    'chat',
  ],
  [
    'createChatCleanup',
    'post',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/cleanups',
    'Chats',
    ['chat.settings.manage'],
    'chat',
  ],
  [
    'listChatJournal',
    'get',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/journal',
    'Chats',
    ['chat.settings.manage'],
    'chat',
  ],
  [
    'createChatExport',
    'post',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/exports',
    'Chats',
    ['chat.export'],
    'chat',
  ],
  [
    'getChatExport',
    'get',
    '/api/v1/tenants/{tenantId}/chats/{chatId}/exports/{exportId}',
    'Chats',
    ['chat.export'],
    'chat',
  ],
  [
    'listChatPolicies',
    'get',
    '/api/v1/tenants/{tenantId}/chat-policies',
    'Chats',
    ['chat.policy.manage'],
    'tenant-owner',
  ],
  [
    'updateChatPolicy',
    'put',
    '/api/v1/tenants/{tenantId}/chat-policies/{kind}',
    'Chats',
    ['chat.policy.manage'],
    'tenant-owner',
  ],
  [
    'listChatHolds',
    'get',
    '/api/v1/tenants/{tenantId}/chat-holds',
    'Chats',
    ['chat.hold.manage'],
    'tenant-owner',
  ],
  [
    'createChatHold',
    'post',
    '/api/v1/tenants/{tenantId}/chat-holds',
    'Chats',
    ['chat.hold.manage'],
    'tenant-owner',
  ],
  [
    'releaseChatHold',
    'delete',
    '/api/v1/tenants/{tenantId}/chat-holds/{holdId}',
    'Chats',
    ['chat.hold.manage'],
    'tenant-owner',
  ],
  [
    'listDocuments',
    'get',
    '/api/v1/tenants/{tenantId}/docs',
    'Docs',
    ['docs.read'],
    'docs-folder-doc',
  ],
  [
    'createDocument',
    'post',
    '/api/v1/tenants/{tenantId}/docs',
    'Docs',
    ['docs.create'],
    'docs-folder-doc',
  ],
  [
    'getDocument',
    'get',
    '/api/v1/tenants/{tenantId}/docs/{documentId}',
    'Docs',
    ['docs.read'],
    'docs-folder-doc',
  ],
  [
    'updateDocument',
    'patch',
    '/api/v1/tenants/{tenantId}/docs/{documentId}',
    'Docs',
    ['docs.update'],
    'docs-folder-doc',
  ],
  [
    'moveDocument',
    'post',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/move',
    'Docs',
    ['docs.update'],
    'docs-folder-doc',
  ],
  [
    'archiveDocument',
    'post',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/archive',
    'Docs',
    ['docs.update'],
    'docs-folder-doc',
  ],
  [
    'restoreDocument',
    'post',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/restore',
    'Docs',
    ['docs.update'],
    'docs-folder-doc',
  ],
  [
    'openDocumentSession',
    'get',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/open',
    'Docs',
    ['docs.read'],
    'docs-folder-doc',
  ],
  [
    'listDocVersions',
    'get',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/versions',
    'Docs',
    ['docs.read'],
    'docs-folder-doc',
  ],
  [
    'saveDocVersion',
    'post',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/versions',
    'Docs',
    ['docs.update'],
    'docs-folder-doc',
  ],
  [
    'nameDocVersion',
    'put',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/versions/{version}/name',
    'Docs',
    ['docs.update'],
    'docs-folder-doc',
  ],
  [
    'restoreDocVersion',
    'post',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/versions/{version}/restore',
    'Docs',
    ['docs.update'],
    'docs-folder-doc',
  ],
  [
    'listDocComments',
    'get',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/comments',
    'Docs',
    ['docs.read'],
    'docs-folder-doc',
  ],
  [
    'createDocComment',
    'post',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/comments',
    'Docs',
    ['docs.comment'],
    'docs-folder-doc',
  ],
  [
    'replyDocComment',
    'post',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/comments/{commentId}/replies',
    'Docs',
    ['docs.comment'],
    'docs-folder-doc',
  ],
  [
    'resolveDocComment',
    'post',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/comments/{commentId}/resolve',
    'Docs',
    ['docs.comment'],
    'docs-folder-doc',
  ],
  [
    'skipDocMentionGrant',
    'post',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/comments/{commentId}/skip-grant',
    'Docs',
    ['docs.comment'],
    'docs-folder-doc',
  ],
  [
    'getDocShares',
    'get',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/shares',
    'Docs',
    ['docs.share'],
    'docs-folder-doc',
  ],
  [
    'setDocShares',
    'put',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/shares',
    'Docs',
    ['docs.share'],
    'docs-folder-doc',
  ],
  [
    'grantDocAccess',
    'post',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/grants',
    'Docs',
    ['docs.share'],
    'docs-folder-doc',
  ],
  [
    'listDocLinks',
    'get',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/links',
    'Docs',
    ['docs.share_external'],
    'docs-folder-doc',
  ],
  [
    'createDocLink',
    'post',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/links',
    'Docs',
    ['docs.share_external'],
    'docs-folder-doc',
  ],
  [
    'revokeDocLink',
    'delete',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/links/{linkId}',
    'Docs',
    ['docs.share_external'],
    'docs-folder-doc',
  ],
  [
    'syncDocDataset',
    'post',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/dataset-sync',
    'Docs',
    ['docs.update'],
    'docs-folder-doc',
  ],
  [
    'createDocJob',
    'post',
    '/api/v1/tenants/{tenantId}/doc-jobs',
    'Docs',
    ['docs.convert'],
    'docs-folder-doc',
  ],
  [
    'getDocJob',
    'get',
    '/api/v1/tenants/{tenantId}/doc-jobs/{jobId}',
    'Docs',
    ['docs.read'],
    'docs-folder-doc',
  ],
  [
    'retryDocJob',
    'post',
    '/api/v1/tenants/{tenantId}/doc-jobs/{jobId}/retry',
    'Docs',
    ['docs.convert'],
    'docs-folder-doc',
  ],
  [
    'reviewOcrWord',
    'post',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/ocr/words/{wordId}',
    'Docs',
    ['docs.update'],
    'docs-folder-doc',
  ],
  [
    'startDocRoute',
    'post',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/route',
    'Docs',
    ['docs.update'],
    'docs-folder-doc',
  ],
  [
    'getDocRoute',
    'get',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/route',
    'Docs',
    ['docs.read'],
    'docs-folder-doc',
  ],
  [
    'decideDocRoute',
    'post',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/route/decisions',
    'Docs',
    ['docs.read'],
    'docs-folder-doc',
  ],
  [
    'requestDocSignCode',
    'post',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/route/sign/code',
    'Docs',
    ['docs.sign'],
    'docs-folder-doc',
  ],
  [
    'confirmDocSign',
    'post',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/route/sign',
    'Docs',
    ['docs.sign'],
    'docs-folder-doc',
  ],
  [
    'ackDocument',
    'post',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/ack',
    'Docs',
    ['docs.read'],
    'docs-folder-doc',
  ],
  [
    'closeDocAck',
    'post',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/route/ack/close',
    'Docs',
    ['docs.update'],
    'docs-folder-doc',
  ],
  [
    'resumeDocRoute',
    'post',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/route/resume',
    'Docs',
    ['docs.update'],
    'docs-folder-doc',
  ],
  [
    'cancelDocRoute',
    'post',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/route/cancel',
    'Docs',
    ['docs.update'],
    'docs-folder-doc',
  ],
  [
    'listDocActivity',
    'get',
    '/api/v1/tenants/{tenantId}/docs/{documentId}/activity',
    'Docs',
    ['docs.read'],
    'docs-folder-doc',
  ],
  [
    'listDocFolders',
    'get',
    '/api/v1/tenants/{tenantId}/doc-folders',
    'Docs',
    ['docs.read'],
    'docs-folder-doc',
  ],
  [
    'createDocFolder',
    'post',
    '/api/v1/tenants/{tenantId}/doc-folders',
    'Docs',
    ['docs.folders.manage'],
    'docs-folder-doc',
  ],
  [
    'updateDocFolder',
    'patch',
    '/api/v1/tenants/{tenantId}/doc-folders/{folderId}',
    'Docs',
    ['docs.folders.manage'],
    'docs-folder-doc',
  ],
  [
    'deleteDocFolder',
    'delete',
    '/api/v1/tenants/{tenantId}/doc-folders/{folderId}',
    'Docs',
    ['docs.folders.manage'],
    'docs-folder-doc',
  ],
  [
    'setDocFolderShares',
    'put',
    '/api/v1/tenants/{tenantId}/doc-folders/{folderId}/shares',
    'Docs',
    ['docs.share'],
    'docs-folder-doc',
  ],
  [
    'listDocTemplates',
    'get',
    '/api/v1/tenants/{tenantId}/doc-templates',
    'Docs',
    ['docs.read'],
    'docs-folder-doc',
  ],
  [
    'listDocRouteTemplates',
    'get',
    '/api/v1/tenants/{tenantId}/doc-route-templates',
    'Docs',
    ['docs.read'],
    'docs-folder-doc',
  ],
  [
    'openDocLink',
    'post',
    '/api/v1/public/doc-links/{token}/open',
    'PublicDocs',
    [],
    'public-doc-link-capability',
  ],
  [
    'docServerCallback',
    'post',
    '/api/v1/internal/docs/callback',
    'PublicDocs',
    [],
    'docs-server-callback',
  ],
  [
    'listServiceDirections',
    'get',
    '/api/v1/tenants/{tenantId}/service/directions',
    'Service',
    ['service.requests.read'],
    'service-direction',
  ],
  [
    'listServiceRequests',
    'get',
    '/api/v1/tenants/{tenantId}/service/requests',
    'Service',
    ['service.requests.read'],
    'service-direction',
  ],
  [
    'getServiceQueueCounts',
    'get',
    '/api/v1/tenants/{tenantId}/service/queues',
    'Service',
    ['service.requests.read'],
    'service-direction',
  ],
  [
    'getServiceRequest',
    'get',
    '/api/v1/tenants/{tenantId}/service/requests/{requestId}',
    'Service',
    ['service.requests.read'],
    'service-direction',
  ],
  [
    'createServiceRequest',
    'post',
    '/api/v1/tenants/{tenantId}/service/requests',
    'Service',
    ['service.requests.create'],
    'service-direction',
  ],
  [
    'postServiceMessage',
    'post',
    '/api/v1/tenants/{tenantId}/service/requests/{requestId}/messages',
    'Service',
    ['service.requests.read'],
    'service-direction',
  ],
  [
    'setServiceCompensation',
    'post',
    '/api/v1/tenants/{tenantId}/service/requests/{requestId}/compensation',
    'Service',
    ['service.compensation.manage'],
    'service-direction',
  ],
  [
    'transitionServiceRequest',
    'post',
    '/api/v1/tenants/{tenantId}/service/requests/{requestId}/transitions',
    'Service',
    ['service.requests.reply', 'service.requests.resolve'],
    'service-direction',
  ],
  [
    'updateServiceRequest',
    'patch',
    '/api/v1/tenants/{tenantId}/service/requests/{requestId}',
    'Service',
    ['service.requests.reply'],
    'service-direction',
  ],
  [
    'moveServiceRequest',
    'post',
    '/api/v1/tenants/{tenantId}/service/requests/{requestId}/move',
    'Service',
    ['service.requests.reply'],
    'service-direction',
  ],
  [
    'revealServiceClientPhone',
    'post',
    '/api/v1/tenants/{tenantId}/service/requests/{requestId}/client-phone/reveal',
    'Service',
    ['service.clients.contacts'],
    'service-direction',
  ],
  [
    'shareServiceConclusion',
    'post',
    '/api/v1/tenants/{tenantId}/service/requests/{requestId}/conclusion',
    'Service',
    ['service.requests.resolve'],
    'service-direction',
  ],
  [
    'createServiceRequestTask',
    'post',
    '/api/v1/tenants/{tenantId}/service/requests/{requestId}/tasks',
    'Service',
    ['service.requests.reply'],
    'service-direction',
  ],
  [
    'listServiceRatings',
    'get',
    '/api/v1/tenants/{tenantId}/service/ratings',
    'Service',
    ['service.requests.read'],
    'service-direction',
  ],
  [
    'decideServiceRating',
    'post',
    '/api/v1/tenants/{tenantId}/service/ratings/{ratingId}/decision',
    'Service',
    ['service.requests.reply', 'service.requests.create'],
    'service-direction',
  ],
  [
    'listServiceReplyTemplates',
    'get',
    '/api/v1/tenants/{tenantId}/service/directions/{directionId}/templates',
    'Service',
    ['service.requests.read'],
    'service-direction',
  ],
  [
    'createServiceDirection',
    'post',
    '/api/v1/tenants/{tenantId}/service/directions',
    'Service',
    ['service.directions.manage'],
    'service-direction',
  ],
  [
    'getServiceDirection',
    'get',
    '/api/v1/tenants/{tenantId}/service/directions/{directionId}',
    'Service',
    ['service.directions.manage'],
    'service-direction',
  ],
  [
    'updateServiceDirectionDraft',
    'put',
    '/api/v1/tenants/{tenantId}/service/directions/{directionId}/draft',
    'Service',
    ['service.directions.manage'],
    'service-direction',
  ],
  [
    'publishServiceDirection',
    'post',
    '/api/v1/tenants/{tenantId}/service/directions/{directionId}/publish',
    'Service',
    ['service.directions.manage'],
    'service-direction',
  ],
  [
    'getServiceReport',
    'get',
    '/api/v1/tenants/{tenantId}/service/report',
    'Service',
    ['service.reports.read'],
    'service-direction',
  ],
  [
    'getPublicServicePage',
    'get',
    '/api/v1/public/service/{slug}',
    'PublicService',
    [],
    'public-service-capability',
  ],
  [
    'submitPublicServiceRequest',
    'post',
    '/api/v1/public/service/{slug}/requests',
    'PublicService',
    [],
    'public-service-capability',
  ],
  [
    'getPublicServiceRequest',
    'get',
    '/api/v1/public/service/requests/{token}',
    'PublicService',
    [],
    'public-service-capability',
  ],
  [
    'postPublicServiceMessage',
    'post',
    '/api/v1/public/service/requests/{token}/messages',
    'PublicService',
    [],
    'public-service-capability',
  ],
  [
    'ratePublicServiceResolution',
    'post',
    '/api/v1/public/service/requests/{token}/csat',
    'PublicService',
    [],
    'public-service-capability',
  ],
  [
    'reopenPublicServiceRequest',
    'post',
    '/api/v1/public/service/requests/{token}/reopen',
    'PublicService',
    [],
    'public-service-capability',
  ],
  [
    'optOutPublicSurveys',
    'post',
    '/api/v1/public/service/requests/{token}/opt-out',
    'PublicService',
    [],
    'public-service-capability',
  ],
  [
    'initiatePublicServiceUpload',
    'post',
    '/api/v1/public/service/requests/{token}/uploads',
    'PublicService',
    [],
    'public-service-capability',
  ],
  [
    'completePublicServiceUpload',
    'post',
    '/api/v1/public/service/requests/{token}/uploads/{uploadId}/complete',
    'PublicService',
    [],
    'public-service-capability',
  ],
];
const NEW_TAGS = ['Chats', 'Docs', 'PublicDocs', 'Service', 'PublicService'];
const PUBLIC = OPS.filter((o) => o[3].startsWith('Public')).map((o) => o[0]);
const INTERNAL = ['docServerCallback'];
const TENANT = OPS.filter((o) => !PUBLIC.includes(o[0]));
const IF_MATCH = [
  'updateChat',
  'replaceChatSources',
  'updateDocument',
  'setDocShares',
  'updateDocFolder',
  'setServiceCompensation',
  'transitionServiceRequest',
  'updateServiceRequest',
  'moveServiceRequest',
  'shareServiceConclusion',
  'updateServiceDirectionDraft',
];
const ANY = [
  'deleteChatMessage',
  'closeChatPoll',
  'remindChatPoll',
  'transitionServiceRequest',
  'decideServiceRating',
];

const doc = bundle();
const source = readYaml(SOURCE_0_1);
const ops = operationsById(doc);
const op = (id) => ops.get(id)?.op;
const schemas = doc.components.schemas;
const deref = (x) => (x?.$ref ? doc.components.parameters[x.$ref.split('/').pop()] : x);
const params = (id) =>
  [...(doc.paths[ops.get(id).path].parameters ?? []), ...(op(id).parameters ?? [])].map(deref);
const param = (id, where, n) =>
  params(id).find((p) => p.in === where && p.name.toLowerCase() === n.toLowerCase());
const w700 = () => loadDeltas().filter((d) => /W7\.00/.test(d.source));
const catalog = loadCatalog();
const actions = flattenActions(catalog);
const registry = loadRegistry();
const read = (rel) => readFileSync(abs(rel), 'utf8');

describe('контракт этапа 7 (W7.00): операции', () => {
  it(`${OPS.length} новых операций пяти тегов: метод, путь, тег, x-permissions, x-scope`, () => {
    assert.equal(OPS.length, 114);
    const wrong = [];
    for (const [id, method, path, tag, perms, scope] of OPS) {
      const o = ops.get(id);
      if (!o) {
        wrong.push(`${id}: нет в бандле`);
        continue;
      }
      const got = [o.method, o.path, o.tag, o.op['x-permissions'], o.op['x-scope']];
      const want = [method, path, tag, perms, scope];
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        wrong.push(`${id}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
      }
    }
    assert.deepEqual(wrong, []);
  });

  it('число операций по тегам: Chats 37, Docs 45, PublicDocs 2, Service 21, PublicService 9', () => {
    const n = (t) => [...ops.values()].filter((o) => o.tag === t).length;
    assert.deepEqual(NEW_TAGS.map(n), [37, 45, 2, 21, 9]);
    assert.deepEqual(
      NEW_TAGS.map((t) => doc.tags.some((x) => x.name === t)),
      [true, true, true, true, true],
    );
  });

  it('режим any — только там, где право зависит от роли (удаление, опрос, переход, оценка)', () => {
    const got = OPS.filter((o) => op(o[0])?.['x-permissions-mode'] === 'any').map((o) => o[0]);
    assert.deepEqual(got.sort(), [...ANY].sort());
  });

  it('команды тенанта: Idempotency-Key, X-CSRF-Token, Origin, x-csrf; чтения — без них', () => {
    const gaps = [];
    for (const [id, method] of TENANT) {
      if (!op(id)) {
        gaps.push(`${id}: нет`);
        continue;
      }
      const cmd = method !== 'get';
      for (const h of ['Idempotency-Key', 'X-CSRF-Token', 'Origin']) {
        if (Boolean(param(id, 'header', h)) !== cmd) gaps.push(`${id}: заголовок ${h}`);
      }
      if (Boolean(op(id)['x-csrf-required-for-cookie']) !== cmd) gaps.push(`${id}: x-csrf`);
    }
    assert.deepEqual(gaps, []);
  });

  it('If-Match — только изменение того, что читают с ETag; остальные команды без него', () => {
    const got = OPS.filter((o) => param(o[0], 'header', 'If-Match')).map((o) => o[0]);
    assert.deepEqual(got.sort(), [...IF_MATCH].sort());
    for (const id of IF_MATCH) {
      for (const s of ['412', '428']) assert.ok(op(id).responses[s], `${id}: ${s}`);
    }
  });

  it('публичный контур: security [], x-public-capability, без сессии и CSRF; callback — без Origin', () => {
    assert.equal(PUBLIC.length, 11);
    for (const id of PUBLIC) {
      const o = op(id);
      const internal = INTERNAL.includes(id);
      assert.deepEqual(o.security, internal ? [{ docServerJwt: [] }] : [], id);
      assert.ok(o['x-public-capability'], id);
      assert.deepEqual(o['x-permissions'], [], id);
      assert.equal(param(id, 'header', 'X-CSRF-Token'), undefined, id);
      assert.equal(o.responses['401'] !== undefined, internal, id);
    }
    for (const id of INTERNAL) {
      assert.equal(param(id, 'header', 'Origin'), undefined);
      assert.match(op(id)['x-public-capability'], /JWT of the document server/);
      assert.equal(ops.get(id).path, '/api/v1/internal/docs/callback');
    }
  });

  it('каждая операция названа в описании ссылкой на W7.00 и разбор; события — «Emits …v1»', () => {
    const events = new Set();
    for (const [id] of OPS) {
      const d = op(id).description;
      assert.match(d, /^W7\.00 \((chats|documents|service)\.md §/, id);
      for (const m of d.matchAll(/(?:chat|docs|service)\.[a-z_.]+\.v1/g)) events.add(m[0]);
    }
    assert.ok(events.size >= 25, `событий в описаниях: ${events.size}`);
  });

  it('новые ответы — схемы своих групп; успех и ошибки по правилам контракта', () => {
    const gaps = [];
    for (const [id, method] of OPS) {
      const o = op(id);
      const ok = Object.keys(o.responses).find((s) => /^2/.test(s));
      if (!ok) gaps.push(`${id}: нет ответа успеха`);
      for (const s of ['400', '404', '422', '429']) {
        // callback движка — по ключу версии, не по пути: 404 не объявлен
        if (!o.responses[s] && !(INTERNAL.includes(id) && s === '404'))
          gaps.push(`${id}: нет ${s}`);
      }
      if (method !== 'get' && !o.responses['409'] && !PUBLIC.includes(id))
        gaps.push(`${id}: нет 409`);
    }
    assert.deepEqual(gaps, []);
  });
});

describe('контракт этапа 7 (W7.00): схемы и параметры', () => {
  const NAMES = [
    'ChatPolicy',
    'ChatKindPolicy',
    'ChatSummary',
    'ChatList',
    'Chat',
    'ChatCreate',
    'ChatCreateResult',
    'ChatMessage',
    'ChatMessageList',
    'ChatMessageCreate',
    'ChatPoll',
    'ChatMemberList',
    'ChatSources',
    'ChatStorage',
    'ChatHold',
    'DocSummary',
    'DocumentList',
    'Document',
    'DocFolder',
    'DocCreate',
    'DocSessionConfig',
    'DocVersion',
    'DocComment',
    'DocShares',
    'DocSharesSet',
    'DocSharesResult',
    'DocExternalLink',
    'DocJob',
    'DocRoute',
    'DocRouteStart',
    'DocRouteStartResult',
    'DocPublicSession',
    'DocServerCallback',
    'DocServerCallbackAck',
    'DocTemplate',
    'ServiceDirection',
    'ServiceRequestType',
    'ServiceRequestSummary',
    'ServiceRequestList',
    'ServiceRequest',
    'ServiceRequestCreate',
    'ServiceMessage',
    'ServiceTransition',
    'ServiceRating',
    'ServiceReport',
    'ServiceDirectionConfig',
    'PublicServicePage',
    'PublicServiceRequest',
    'PublicServiceReceipt',
  ];
  it('ключевые схемы есть; все объекты закрыты (additionalProperties false)', () => {
    assert.deepEqual(
      NAMES.filter((n) => !schemas[n]),
      [],
    );
    const prefixed = Object.keys(schemas).filter((n) =>
      /^(Chat|Doc|Service|PublicService)/.test(n),
    );
    assert.ok(prefixed.length >= 150, `схем этапа 7: ${prefixed.length}`);
    const open = prefixed.filter(
      (n) => schemas[n].type === 'object' && schemas[n].additionalProperties !== false,
    );
    assert.deepEqual(open, []);
  });

  it('параметры пути: chatId, messageId, pollId, documentId, directionId, requestId и др.', () => {
    const ps = doc.components.parameters;
    const want = {
      chatId: 'chatId',
      messageId: 'messageId',
      pollId: 'pollId',
      attachmentId: 'attachmentId',
      chatExportId: 'exportId',
      chatHoldId: 'holdId',
      chatKindParam: 'kind',
      documentId: 'documentId',
      docFolderId: 'folderId',
      docVersionNumber: 'version',
      docCommentId: 'commentId',
      docLinkId: 'linkId',
      docJobId: 'jobId',
      ocrWordId: 'wordId',
      docLinkToken: 'token',
      directionId: 'directionId',
      serviceRequestId: 'requestId',
      serviceRatingId: 'ratingId',
      servicePortalSlug: 'slug',
      servicePortalToken: 'token',
    };
    for (const [key, nm] of Object.entries(want)) {
      assert.equal(ps[key]?.name, nm, key);
      assert.equal(ps[key]?.in, 'path', key);
    }
  });

  it('политика чата: пределы CHAT-10 (удалённые ровно 30 дней), режимы и значения по умолчанию разбора', () => {
    const p = schemas.ChatPolicy.properties;
    assert.deepEqual([p.deletedDays.minimum, p.deletedDays.maximum], [30, 30]);
    assert.deepEqual(p.receipts.enum, ['off', 'ticks', 'who']);
    assert.deepEqual(p.onFull.enum, ['block', 'ring', 'compress', 'archive']);
    assert.deepEqual(p.temp.enum, ['off', 'allowed', 'viewonce']);
    assert.deepEqual([p.textYears.minimum, p.textYears.maximum], [1, 5]);
  });

  it('сообщение чата: удалённое — только метка, текст ≤ 4000, опрос 2–10 вариантов, срок важного — дата', () => {
    assert.equal(schemas.ChatMessageCreate.properties.text.maxLength, 4000);
    assert.equal(schemas.ChatPollCreate.properties.options.maxItems, 10);
    assert.equal(schemas.ChatPollCreate.properties.closesInHours.maximum, 168);
    assert.ok(schemas.ChatMessage.properties.deleted);
    assert.match(schemas.ChatDeleted.description, /never «resurrects»/);
    assert.equal(schemas.ChatImportant.properties.dueDate.format, 'date');
  });

  it('документ: статусы, уровни, виды; callback сервера документов — ключ, статус 0–7, ответ {error}', () => {
    assert.deepEqual(schemas.Document.properties.status.enum, [
      'draft',
      'in_route',
      'returned',
      'agreed',
      'approved',
      'signed',
      'archived',
    ]);
    assert.deepEqual(schemas.DocShareEntry.properties.level.enum, [
      'view',
      'comment',
      'suggest',
      'edit',
      'manage',
    ]);
    assert.deepEqual(schemas.Document.properties.kind.enum, ['text', 'sheet', 'pdf']);
    assert.deepEqual(schemas.DocServerCallback.required.sort(), ['key', 'status']);
    assert.equal(schemas.DocServerCallback.properties.status.maximum, 7);
    assert.deepEqual(schemas.DocServerCallbackAck.required, ['error']);
    assert.equal(schemas.DocRoute.properties.steps.maxItems, 6);
    assert.equal(
      schemas.DocExternalLinkCreate.properties.expiresAt.description.includes('30 days'),
      true,
    );
  });

  it('обращения: 5 статусов прототипа, 7 видов, 6 каналов; телефон — маска; публично — клиентские подписи', () => {
    assert.deepEqual(schemas.ServiceRequest.properties.status.enum, [
      'new',
      'work',
      'wait',
      'resolved',
      'closed',
    ]);
    assert.equal(schemas.ServiceRequest.properties.kind.enum.length, 7);
    assert.equal(schemas.ServiceRequest.properties.channel.enum.length, 6);
    assert.ok(schemas.ServiceClient.properties.phoneMasked);
    assert.match(
      schemas.PublicServiceRequest.properties.statusLabel.description,
      /«Ждём вашего ответа»/,
    );
    assert.ok(schemas.ServiceRequestPatch.properties.assigneeId);
    assert.deepEqual(schemas.ServiceRequest.properties.assignee.oneOf.length, 2);
  });

  it('files.purpose: chat_attachment и document (UploadCreate, UploadSession, FileListItem)', () => {
    for (const n of ['UploadCreate', 'UploadSession', 'FileListItem']) {
      const e = schemas[n].properties.purpose.enum;
      assert.ok(e.includes('chat_attachment') && e.includes('document'), n);
    }
  });
});

describe('контракт этапа 7 (W7.00): права, ошибки, канал реального времени', () => {
  const DOCS = [
    'docs.read',
    'docs.comment',
    'docs.suggest',
    'docs.create',
    'docs.update',
    'docs.convert',
    'docs.export',
    'docs.share',
    'docs.share_external',
    'docs.sign',
    'docs.templates.manage',
    'docs.folders.manage',
  ];
  const SERVICE = [
    'service.directions.manage',
    'service.requests.read',
    'service.requests.create',
    'service.requests.reply',
    'service.requests.resolve',
    'service.clients.contacts',
    'service.compensation.manage',
    'service.reports.read',
    'service.reports.staff',
  ];

  it('core.docs (12 ключей) и core.service (9) в каталоге; перенесены из prototype_pending', () => {
    assert.deepEqual(Object.keys(catalog.modules['core.docs'].actions), DOCS);
    assert.deepEqual(Object.keys(catalog.modules['core.service'].actions), SERVICE);
    const pending = Object.keys(catalog.prototype_pending ?? {});
    assert.deepEqual(
      pending.filter((k) => /^(docs|service)\./.test(k)),
      [],
    );
    for (const k of [...DOCS, ...SERVICE]) assert.ok(actions.has(k), k);
  });

  it('уровни, области и чувствительность ключей — design/docs/24 и 22 «Новые права»', () => {
    const a = (k) => actions.get(k);
    assert.equal(a('docs.share_external').sensitivity, 'sensitive');
    assert.deepEqual(a('docs.share_external').scopes, ['tenant', 'unit']);
    assert.deepEqual(a('docs.read').scopes, [
      'tenant',
      'unit',
      'folder',
      'doc',
      'relation',
      'self',
    ]);
    assert.equal(a('docs.sign').level, 'review');
    assert.equal(a('docs.export').level, 'export');
    for (const k of [
      'service.clients.contacts',
      'service.compensation.manage',
      'service.reports.staff',
    ]) {
      assert.equal(a(k).sensitivity, 'sensitive', k);
    }
    assert.equal(a('service.requests.resolve').level, 'review');
    assert.deepEqual(a('service.requests.read').scopes, ['tenant', 'unit', 'project']);
    assert.ok(!actions.has('service.compensation'));
  });

  it('у каждого действия каталога только допустимые поля (метки с запятой взяты в кавычки)', () => {
    const allowed = new Set([
      'level',
      'label',
      'scopes',
      'sensitivity',
      'note',
      'owner_only',
      'blocked_by_function',
      'limit',
    ]);
    const bad = [];
    for (const [key, a] of actions) {
      if (a.module === 'platform') continue;
      for (const f of Object.keys(a))
        if (f !== 'module' && !allowed.has(f)) bad.push(`${key}: поле ${f}`);
    }
    assert.deepEqual(bad, []);
    assert.equal(actions.get('chat.announce').label, 'Объявления, важное и @все');
    assert.equal(actions.get('chat.receipts.read').label, 'Видеть, кто и когда прочитал');
    assert.equal(actions.get('chat.retention.manage').label, 'Сроки хранения, очистка, место');
  });

  it('шаблоны ролей: папки документов (5 / 4 / 1), направление обращений, роли чата не изменены', () => {
    const t = catalog.role_templates;
    assert.equal(t.docs_folder_manager.default_scope, 'folder');
    assert.deepEqual(t.docs_folder_reader.actions, ['docs.read']);
    assert.ok(t.docs_folder_editor.actions.includes('docs.update'));
    assert.ok(!t.docs_folder_editor.actions.includes('docs.share'));
    assert.equal(t.service_direction_lead.default_scope, 'project');
    assert.ok(t.service_direction_lead.actions.includes('service.clients.contacts'));
    assert.ok(!t.service_direction_lead.actions.includes('service.directions.manage'));
    assert.deepEqual(t.service_observer.actions, ['service.requests.read']);
    assert.deepEqual(t.service_specialist.actions, [
      'service.requests.read',
      'service.requests.create',
      'service.requests.reply',
      'service.requests.resolve',
    ]);
    for (const n of [
      'chat_owner',
      'chat_moderator',
      'chat_member',
      'chat_reader',
      'chat_creator',
    ]) {
      assert.ok(t[n], n);
    }
    // AUTH-09: действия новых модулей в существующие роли организации не добавляются.
    for (const n of ['logistics_manager', 'driver', 'temporary_driver', 'foreman', 'observer']) {
      assert.deepEqual(
        t[n].actions.filter((k) => /^(docs|service)\./.test(k)),
        [],
        n,
      );
    }
  });

  it('коды ошибок: 8 новых (chat_ephemeral_disabled … service_assignee_out_of_scope)', () => {
    const want = {
      chat_ephemeral_disabled: 403,
      document_locked: 409,
      range_protected: 403,
      formula_invalid: 422,
      job_in_progress: 409,
      file_password_protected: 422,
      sign_code_invalid: 422,
      service_assignee_out_of_scope: 422,
    };
    for (const [code, status] of Object.entries(want)) {
      assert.equal(registry.codes[code]?.status, status, code);
      assert.ok(registry.codes[code]?.ui, code);
      assert.ok(schemas.ProblemCode.enum.includes(code), code);
    }
    assert.equal(Object.keys(registry.codes).length, 66); // 58 до W7.00 (с кодами W5.00) + 8
  });

  it('канал реального времени: подсказка chat.changed с chatId и lastSeq, без данных (ADR-0015)', () => {
    const m = schemas.RealtimeServerMessage;
    assert.ok(m.properties.type.enum.includes('chat.changed'));
    assert.equal(m.properties.type.enum.length, 5);
    assert.equal(m.properties.chatId.$ref, '#/components/schemas/Id');
    assert.equal(m.properties.lastSeq.minimum, 0);
    assert.match(m.properties.type.description, /no typing or presence frame/);
    assert.deepEqual(schemas.RealtimeClientMessage.properties.type.enum, ['auth', 'pong']);
  });

  it('виды уведомлений и карточек «Требует решения» перечислены в описаниях', () => {
    const d = schemas.DecisionItem.properties.kind.description;
    for (const k of [
      'chat.ack_pending',
      'docs.approve',
      'docs.sign',
      'docs.ack',
      'service.sla_breached',
      'service.unassigned',
    ]) {
      assert.ok(d.includes(k), k);
    }
    const n = schemas.Notification.properties.kind.description;
    for (const k of [
      'chat.mention',
      'chat.important',
      'docs.access.granted',
      'service.request.sla_warning',
    ]) {
      assert.ok(n.includes(k), k);
    }
  });
});

describe('контракт этапа 7 (W7.00): дельты, экраны, примеры, журнал', () => {
  it('версия 0.12.0-stage7; отличия от 0.1 объявлены, дельты W7.00 только add и change', () => {
    assert.equal(doc.info.version, '0.12.0-stage7');
    const { errors } = checkAgainstSource(doc, source, loadDeltas());
    assert.deepEqual(errors, []);
    assert.ok(w700().length >= 300, `дельт W7.00: ${w700().length}`);
    assert.deepEqual([...new Set(w700().map((d) => d.kind))].sort(), ['add', 'change']);
  });

  it('экраны этапа 7: 17 ключей со снимком 19.10 или no-reference; операции есть в бандле', () => {
    const screens = readYaml(SCREENS_PATH).screens;
    const s7 = Object.entries(screens).filter(([, s]) => s.stage === 7);
    assert.equal(s7.length, 17);
    for (const [k, s] of s7) {
      assert.match(s.reference, /^(design-2026-10-19 · |no-reference)/, k);
      assert.match(s.ws, /^W7\.\d\d$/, k);
      for (const id of s.operations) assert.ok(ops.has(id), `${k}: ${id}`);
    }
    const used = new Set(s7.flatMap(([, s]) => s.operations));
    // операции без экрана названы в комментарии screens.yaml (удержания, выгрузка истории, callback движка)
    const free = OPS.map((o) => o[0]).filter((id) => !used.has(id));
    assert.deepEqual(free.sort(), [
      'createChatExport',
      'createChatHold',
      'docServerCallback',
      'getChatExport',
      'listChatHolds',
      'releaseChatHold',
    ]);
  });
  it('примеры: у каждой новой операции есть пример успеха и пример ошибки; все проходят ajv', () => {
    const ex = loadExamples();
    const missing = [];
    for (const [id] of OPS) {
      const names = [...(ex.get(id)?.keys() ?? [])];
      const errs = names.filter((n) => n in registry.codes);
      // 204 без тела (deleteDocFolder) — пример успеха не нужен
      const ok = Object.keys(op(id).responses).find((s) => /^2/.test(s));
      const hasBody = Boolean(op(id).responses[ok]?.content);
      if (hasBody && names.length === errs.length) missing.push(`${id}: нет примера успеха`);
      if (!errs.length) missing.push(`${id}: нет примера ошибки`);
    }
    assert.deepEqual(missing, []);
    assert.deepEqual(checkExamples(doc, ex), []);
  });

  it('журнал и README: раздел 0.12.0-stage7, реестр событий, миграции tenant 0060–0062', () => {
    const log = read('api/CHANGELOG.md');
    assert.match(log, /## 0\.12\.0-stage7 — W7\.00/);
    const readme = read('api/README.md');
    assert.match(readme, /0060_chats\.sql/);
    assert.match(readme, /0061_docs\.sql/);
    assert.match(readme, /0062_service\.sql/);
    const events = new Set();
    for (const [id] of OPS) {
      for (const m of op(id).description.matchAll(/(?:chat|docs|service)\.[a-z_.]+\.v1/g))
        events.add(m[0]);
    }
    const lost = [...events].filter((e) => !readme.includes(e));
    assert.deepEqual(lost, [], 'события из описаний есть в таблице событий README');
    for (const e of [
      'chat.changed',
      'docs.version.saved.v1',
      'service.request.sla_breached.v1',
      'service.survey.answered.v1',
    ]) {
      assert.ok(readme.includes(e), e);
    }
  });

  it('ADR-0016 (сервер документов, callback, подсказки чатов) и уточнение ADR-0015', () => {
    const adr = read('docs/adr/0016-docs-server-and-chat-hints.md');
    assert.match(adr, /# 0016\./);
    assert.match(adr, /D-32/); // решение комплекта
    assert.match(adr, /docServerCallback/);
    assert.match(read('docs/adr/0015-realtime-channel.md'), /chat\.changed/);
  });
});
