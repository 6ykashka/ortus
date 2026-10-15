// Генератор realm-экспорта Keycloak стенда (W1.03): node deploy/compose/keycloak/gen-realms.mjs
// Проверка — TestRealmFiles (backend/internal/platform/session/oidc/realm_test.go).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const ports = [5173, ...Array.from({ length: 21 }, (_, i) => 5200 + i)];
const origins = ports.flatMap((p) => [`http://localhost:${p}`, `http://127.0.0.1:${p}`]);
const redirectUris = origins.map((o) => `${o}/api/v1/auth/callback`);
const postLogout = origins.map((o) => `${o}/`).join('##');

const client = {
  clientId: 'ortus-web',
  name: 'Ортус · BFF',
  description:
    'Go BFF: OIDC Authorization Code + PKCE S256 (W1.03, S1-05). Токены не попадают в браузер.',
  enabled: true,
  protocol: 'openid-connect',
  publicClient: false,
  clientAuthenticatorType: 'client-secret',
  secret: 'change-me-local',
  standardFlowEnabled: true,
  implicitFlowEnabled: false,
  directAccessGrantsEnabled: false,
  serviceAccountsEnabled: false,
  frontchannelLogout: false,
  consentRequired: false,
  fullScopeAllowed: false,
  rootUrl: '',
  baseUrl: '/',
  redirectUris,
  webOrigins: [],
  attributes: {
    'pkce.code.challenge.method': 'S256',
    'post.logout.redirect.uris': postLogout,
    'oauth2.device.authorization.grant.enabled': 'false',
    'backchannel.logout.session.required': 'true',
  },
  defaultClientScopes: ['basic', 'profile', 'email'],
  optionalClientScopes: [],
};

function user(email, first, last) {
  return {
    username: email,
    email,
    emailVerified: true,
    enabled: true,
    firstName: first,
    lastName: last,
    credentials: [{ type: 'password', value: 'change-me-local', temporary: false }],
  };
}

function realm(name, display, registration, users) {
  return {
    realm: name,
    displayName: display,
    enabled: true,
    sslRequired: 'external',
    registrationAllowed: registration,
    registrationEmailAsUsername: true,
    verifyEmail: registration,
    loginWithEmailAllowed: true,
    duplicateEmailsAllowed: false,
    resetPasswordAllowed: true,
    editUsernameAllowed: false,
    bruteForceProtected: true,
    permanentLockout: false,
    failureFactor: 10,
    passwordPolicy: 'length(12) and notUsername and notEmail',
    internationalizationEnabled: true,
    supportedLocales: ['ru', 'en'],
    defaultLocale: 'ru',
    accessTokenLifespan: 300,
    ssoSessionIdleTimeout: 1800,
    ssoSessionMaxLifespan: 43200,
    smtpServer: {
      host: 'mailpit',
      port: '1025',
      from: 'noreply@ortus.local',
      fromDisplayName: 'Ортус',
    },
    clients: [client],
    users,
  };
}

const realms = {
  'realm-ortus.json': realm('ortus', 'Ортус', true, [
    user('d.zimina@alta.example', 'Дарья', 'Зимина'),
    user('o.petrova@alta.example', 'Олеся', 'Петрова'),
    user('m.kotova@alta.example', 'Марина', 'Котова'),
  ]),
  'realm-ortus-operators.json': realm('ortus-operators', 'Ортус · Платформа', false, [
    user('e.lapteva@ortus.example', 'Евгения', 'Лаптева'),
  ]),
};
for (const [file, doc] of Object.entries(realms)) {
  writeFileSync(join(dir, file), JSON.stringify(doc, null, 2) + '\n', 'utf8');
}
