// Conventional Commits (скил git-commit). Заголовки на русском, поэтому регистр темы не проверяется.
// Scope — ID WS в нижнем регистре (w0.03) или область (repo, api, web, backend).
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [0],
    'scope-case': [2, 'always', 'lower-case'],
    'body-max-line-length': [1, 'always', 100],
    'footer-max-line-length': [1, 'always', 100],
  },
};
