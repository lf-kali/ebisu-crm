-- F3 · PR 4b-2 (docs/planos/f3-4b2-convites.md). Migração aditiva: convites e outbox mínimo de
-- e-mails do sistema.
--
-- 1. convite: token só como hash (gerado pelo worker no envio), um uso, 7 dias. Um convite
--    pendente por e-mail na conta (índice parcial). O ebisu_auth lê convites de todas as contas
--    para achar o convite pelo hash do token no aceite (como já lê membro/tenant/empresa).
-- 2. email_saida: guarda o tipo e a referência, nunca o conteúdo nem o token.
-- 3. reivindicar_email_saida(): única passagem entre contas do worker. SECURITY DEFINER, devolve
--    só (id, tenant_id) e marca as linhas como ENVIANDO com prazo; o resto do envio é feito pelo
--    ebisu_app dentro da conta (comTenant). Com FORCE ROW LEVEL SECURITY, o dono da função (quem
--    roda esta migração, já dono das tabelas) também passa pelo RLS: ganha uma política só de
--    reivindicação em email_saida. As colunas são timestamp sem fuso gravadas em UTC (Prisma):
--    a função compara com now() em UTC, qualquer que seja o timezone da sessão ou do servidor.
--
-- Rollback: DROP FUNCTION reivindicar_email_saida(int, interval); DROP TABLE email_saida, convite;
-- DROP TYPE "StatusEmailSaida", "TipoEmailSaida".

-- CreateEnum
CREATE TYPE "TipoEmailSaida" AS ENUM ('CONVITE');

-- CreateEnum
CREATE TYPE "StatusEmailSaida" AS ENUM ('PENDENTE', 'ENVIANDO', 'ENVIADO', 'FALHOU', 'CANCELADO');

-- CreateTable
CREATE TABLE "convite" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "atribuicoes" JSONB NOT NULL,
    "convidado_por" UUID,
    "token_hash" TEXT,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "aceito_em" TIMESTAMP(3),
    "revogado_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "convite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_saida" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tipo" "TipoEmailSaida" NOT NULL,
    "convite_id" UUID,
    "status" "StatusEmailSaida" NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proxima_em" TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'utc'::text),
    "erro" TEXT,
    "enviado_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_saida_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "convite_token_hash_key" ON "convite"("token_hash");

-- CreateIndex
CREATE INDEX "convite_tenant_id_email_idx" ON "convite"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "convite_tenant_id_id_key" ON "convite"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "email_saida_status_proxima_em_idx" ON "email_saida"("status", "proxima_em");

-- AddForeignKey
ALTER TABLE "convite" ADD CONSTRAINT "convite_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_saida" ADD CONSTRAINT "email_saida_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_saida" ADD CONSTRAINT "email_saida_tenant_id_convite_id_fkey" FOREIGN KEY ("tenant_id", "convite_id") REFERENCES "convite"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Um convite pendente (nem aceito nem revogado) por e-mail na conta.
CREATE UNIQUE INDEX convite_pendente_uq ON convite (tenant_id, email)
  WHERE aceito_em IS NULL AND revogado_em IS NULL;

-- E-mail normalizado, como usuario.email.
ALTER TABLE convite ADD CONSTRAINT convite_email_normalizado
  CHECK (email = lower(email) AND email !~ '^\s|\s$');

ALTER TABLE email_saida ADD CONSTRAINT email_saida_referencia_ck
  CHECK (tipo <> 'CONVITE' OR convite_id IS NOT NULL);

-- RLS por conta (SEG-1), como as demais tabelas com tenant_id.
ALTER TABLE convite ENABLE ROW LEVEL SECURITY;
ALTER TABLE convite FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolamento ON convite
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE email_saida ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_saida FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolamento ON email_saida
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

-- Grants explícitos (não há default privileges).
GRANT SELECT, INSERT, UPDATE, DELETE ON convite, email_saida TO ebisu_app;
GRANT SELECT ON convite TO ebisu_auth;
CREATE POLICY auth_leitura ON convite FOR SELECT TO ebisu_auth USING (true);

CREATE FUNCTION public.reivindicar_email_saida(limite int, prazo interval)
RETURNS TABLE (id uuid, tenant_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.email_saida e
     SET status = 'ENVIANDO', tentativas = e.tentativas + 1,
         -- Prazo entre 1 s e 1 h: quem chama não consegue prender as linhas de todas as contas.
         proxima_em = (now() AT TIME ZONE 'utc')
           + least(greatest(prazo, interval '1 second'), interval '1 hour'),
         updated_at = now() AT TIME ZONE 'utc'
   WHERE e.id IN (
     SELECT s.id FROM public.email_saida s
      WHERE s.status IN ('PENDENTE', 'ENVIANDO') AND s.proxima_em <= (now() AT TIME ZONE 'utc')
      ORDER BY s.proxima_em
      LIMIT least(greatest(limite, 0), 100)
      FOR UPDATE SKIP LOCKED)
  RETURNING e.id, e.tenant_id
$$;
REVOKE ALL ON FUNCTION public.reivindicar_email_saida(int, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reivindicar_email_saida(int, interval) TO ebisu_app;

DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY reivindicacao ON email_saida FOR ALL TO %I USING (true) WITH CHECK (true)',
    current_user);
END $$;

-- Audit log (PR 3b): convite entra; email_saida é técnica (como notificacao).
CREATE TRIGGER auditoria AFTER INSERT OR UPDATE OR DELETE ON convite
  FOR EACH ROW EXECUTE FUNCTION public.auditar();
