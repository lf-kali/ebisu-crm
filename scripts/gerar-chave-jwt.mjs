#!/usr/bin/env node
// Gera o par Ed25519 que assina o access token (F3, D-T05) e imprime as linhas para o .env.
// Não grava nada: copie a saída para o seu .env (nunca para um arquivo versionado). Em produção,
// a chave vem do cofre de segredos do ambiente.
import { generateKeyPairSync, randomUUID } from 'node:crypto';

const { privateKey } = generateKeyPairSync('ed25519');
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim();

process.stdout.write(
  [
    '# Cole no .env (chave de assinatura do access token; não versionar)',
    `AUTH_JWT_CHAVE_PRIVADA="${pem.replaceAll('\n', '\\n')}"`,
    `AUTH_JWT_KID=dev-${randomUUID().slice(0, 8)}`,
    '',
  ].join('\n'),
);
