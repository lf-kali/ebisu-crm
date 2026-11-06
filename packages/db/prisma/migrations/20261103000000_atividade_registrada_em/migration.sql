-- F4 · PR 2b (docs/planos/f4-2b-atividades.md, decisão 5). Migração aditiva: quando a atividade
-- foi registrada. O prazo de 24 horas para o autor corrigir conta daqui, não de `ocorreu_em`
-- (que pode ser no passado: a ligação de ontem registrada hoje).
--
-- As linhas que já existem recebem `ocorreu_em`, o melhor que se sabe sobre elas.
--
-- Rollback: ALTER TABLE atividade DROP COLUMN registrada_em;

-- AlterTable
ALTER TABLE "atividade" ADD COLUMN     "registrada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE atividade SET registrada_em = ocorreu_em;
