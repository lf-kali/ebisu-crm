-- F3 · PR 1 (docs/planos/f3-1-nucleo-auth.md). Migração aditiva.
--
-- 1. A sessão pertence a uma conta: o refresh devolve a conta em que o usuário estava, e a
--    "conta usada por último" é a da família mais recente. Linhas antigas ficam com NULL (não há
--    refresh tokens reais antes da F3).
-- 2. E-mail único sem diferenciar maiúsculas: o auth grava o e-mail normalizado (trim +
--    minúsculas) e o CHECK impede outra forma; com o UNIQUE existente, "Ana@x" e "ana@x" não
--    convivem. (Índice em lower(email) não é representável no schema do Prisma.)
--
-- Rollback: DROP CONSTRAINT usuario_email_normalizado; DROP INDEX refresh_token_familia_idx,
-- refresh_token_usuario_id_created_at_idx; ALTER TABLE refresh_token DROP COLUMN tenant_id.

ALTER TABLE "refresh_token" ADD COLUMN "tenant_id" UUID;

ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "refresh_token_familia_idx" ON "refresh_token"("familia");
CREATE INDEX "refresh_token_usuario_id_created_at_idx" ON "refresh_token"("usuario_id", "created_at");

-- Sem maiúsculas e sem espaço em branco nas pontas (qualquer um: btrim só tira o espaço comum,
-- e o trim() do JavaScript tira também TAB e quebra de linha).
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_email_normalizado"
  CHECK (email = lower(email) AND email !~ '^\s|\s$');
