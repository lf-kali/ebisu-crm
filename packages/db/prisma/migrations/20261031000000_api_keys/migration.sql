-- F3 · PR 5 (docs/planos/f3-5-api-keys-cors.md). Migração aditiva sobre api_key, que ainda está
-- vazia em todo ambiente (não havia como criar chaves antes deste PR).
--
-- 1. tipo: SERVIDOR (sem origens) ou NAVEGADOR (com origens, só nas rotas /v1/publico/*). O CHECK
--    amarra o tipo às origens; escopos e origens deixam de aceitar NULL.
-- 2. O ebisu_auth lê api_key de todas as contas: a chave chega sem conta e é achada pelo prefixo,
--    como o convite pelo hash do token. Só leitura.
-- 3. Auditoria: o ultimo_uso muda a cada minuto de uso e não é edição de ninguém. O trigger de
--    UPDATE passa a ignorar a mudança que só toca o ultimo_uso.
--
-- Rollback: DROP TRIGGER auditoria_edicao ON api_key; DROP TRIGGER auditoria ON api_key;
-- CREATE TRIGGER auditoria AFTER INSERT OR UPDATE OR DELETE ON api_key FOR EACH ROW EXECUTE
-- FUNCTION public.auditar(); DROP POLICY auth_leitura ON api_key; REVOKE SELECT ON api_key FROM
-- ebisu_auth; ALTER TABLE api_key DROP CONSTRAINT api_key_tipo_ck, DROP COLUMN tipo,
-- ALTER COLUMN escopos DROP NOT NULL, ALTER COLUMN escopos DROP DEFAULT, ALTER COLUMN origens_cors
-- DROP NOT NULL, ALTER COLUMN origens_cors DROP DEFAULT; DROP TYPE "TipoApiKey".

-- CreateEnum
CREATE TYPE "TipoApiKey" AS ENUM ('SERVIDOR', 'NAVEGADOR');

-- AlterTable
ALTER TABLE "api_key" ADD COLUMN     "tipo" "TipoApiKey" NOT NULL,
ALTER COLUMN "escopos" SET NOT NULL,
ALTER COLUMN "escopos" SET DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "origens_cors" SET NOT NULL,
ALTER COLUMN "origens_cors" SET DEFAULT ARRAY[]::TEXT[];

-- Navegador se e só se tem origens; sempre ao menos um escopo.
ALTER TABLE api_key ADD CONSTRAINT api_key_tipo_ck CHECK (
  (tipo = 'NAVEGADOR') = (cardinality(origens_cors) > 0) AND cardinality(escopos) > 0
);

GRANT SELECT ON api_key TO ebisu_auth;
CREATE POLICY auth_leitura ON api_key FOR SELECT TO ebisu_auth USING (true);

DROP TRIGGER auditoria ON api_key;
CREATE TRIGGER auditoria AFTER INSERT OR DELETE ON api_key
  FOR EACH ROW EXECUTE FUNCTION public.auditar();
CREATE TRIGGER auditoria_edicao AFTER UPDATE ON api_key
  FOR EACH ROW
  WHEN ((to_jsonb(OLD) - 'ultimo_uso') IS DISTINCT FROM (to_jsonb(NEW) - 'ultimo_uso'))
  EXECUTE FUNCTION public.auditar();
