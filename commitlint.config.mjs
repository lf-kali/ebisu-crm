// Conventional Commits (D-T10). Corpo e assunto em pt-BR, então não forçamos caixa do assunto.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [0],
    'body-max-line-length': [0],
  },
};
