-- F4 · PR 1 (docs/planos/f4-1-contatos.md, decisão 5). Migração aditiva: nome do contato
-- normalizado para busca sem diferenciar maiúsculas nem acentos (`Joao` acha `João`).
--
-- A aplicação grava `nome_busca` em toda escrita (normalizarBusca, @ebisu/db: NFD sem marcas
-- combinantes, minúsculas). Aqui os contatos que já existem são preenchidos com o equivalente em
-- SQL para os acentos do português; o próximo PATCH do contato regrava pela aplicação.
--
-- Rollback: ALTER TABLE contato DROP COLUMN nome_busca;

-- AlterTable
ALTER TABLE "contato" ADD COLUMN     "nome_busca" TEXT NOT NULL DEFAULT '';

UPDATE contato SET nome_busca = translate(
  lower(nome),
  'áàâãäéèêëíìîïóòôõöúùûüçñ',
  'aaaaaeeeeiiiiooooouuuucn'
);
