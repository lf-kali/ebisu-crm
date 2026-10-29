-- F3 · PR 4a (docs/planos/f3-4a-cadastro-empresas.md, decisão 10). Migração aditiva.
--
-- O cadastro não confirma o e-mail: quem cadastra primeiro com o e-mail de outra pessoa fica com
-- o usuário. A coluna marca quem já provou ser dono do e-mail. O convite (F3-4b), que chega por
-- e-mail, prova; se o usuário não estava verificado, o convite assume o e-mail (troca a senha e
-- encerra as sessões). Linhas antigas ficam NULL: ninguém provou nada até aqui.
--
-- Rollback: ALTER TABLE usuario DROP COLUMN email_verificado_em.

ALTER TABLE "usuario" ADD COLUMN "email_verificado_em" TIMESTAMP(3);
