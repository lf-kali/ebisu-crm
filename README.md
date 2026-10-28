# ebisuCRM

CRM para assistências técnicas: leads, orçamentos, bancada (OS), estoque e financeiro gerencial.
Especificação e regras de negócio em [`docs/`](./docs/) — comece por [`docs/spec-mvp.md`](./docs/spec-mvp.md).
Visual do web (cores, tipografia, componentes): [`DESIGN.md`](./DESIGN.md).

## Desenvolvimento local

Requisitos: Node.js 24 (`.nvmrc`), pnpm 10 e Docker com Compose.

```bash
cp .env.example .env     # portas e credenciais de dev
docker compose up -d     # Postgres, Redis, SeaweedFS (S3) e Mailpit
pnpm install
pnpm db:migrate          # aplica as migrações (packages/db)
pnpm db:papeis           # define LOGIN/senha de ebisu_app e ebisu_auth
pnpm db:seed             # catálogo global de permissões
pnpm db:seed:demo        # opcional: tenant de demonstração (usuários *@demo.ebisu.local)
pnpm dev                 # api, worker e web
```

| Serviço        | Endereço padrão                                        |
| -------------- | ------------------------------------------------------ |
| API            | http://localhost:3000/v1/saude                         |
| Web            | http://localhost:5173                                  |
| Postgres       | `localhost:5433` (usuário/senha/banco `ebisu`)         |
| Redis          | `localhost:6380`                                       |
| S3 (SeaweedFS) | http://localhost:8333, bucket `ebisu-anexos`           |
| Mailpit        | SMTP `localhost:1025`, interface http://localhost:8025 |

### Acesso pela tailnet

`pnpm dev:tailnet` expõe o web na sua tailnet com `sudo tailscale serve --https=8447 5173` e sobe o
`pnpm dev`. Antes, defina no `.env` o nome da máquina em `WEB_ALLOWED_HOSTS` (o Vite recusa hosts
desconhecidos) e, se quiser, outra porta em `TAILNET_HTTPS_PORT`.

- Só a sua tailnet enxerga (`serve`, nunca `funnel`). O `/v1` (API) vai junto, pelo proxy do Vite.
- Se a porta já for de outro serve da máquina, o script aborta sem alterar nada.
- Ao sair (Ctrl+C, `kill` ou terminal fechado), desfaz só esse serve
  (`tailscale serve --https=8447 off`). Se o processo morrer com `kill -9`, rode esse comando à mão.

As portas de Postgres e Redis fogem das padrão para não conflitar com instalações nativas; ajuste
no `.env` se quiser. O bucket é criado pelo serviço `seaweedfs-init` alguns segundos depois do `up`.

`docker compose down -v` apaga a infraestrutura e os dados locais. Usuário, senha e banco do
Postgres só valem na criação do volume: para trocá-los, rode `down -v` antes.

## Comandos

| Comando                             | O que faz                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm build`                        | Build de todos os pacotes e apps                                                  |
| `pnpm typecheck`                    | Checagem de tipos                                                                 |
| `pnpm test`                         | Testes (Vitest)                                                                   |
| `pnpm lint`                         | ESLint                                                                            |
| `pnpm format` / `pnpm format:check` | Prettier                                                                          |
| `pnpm db:invariantes`               | Recria `ebisu_test`, aplica as migrações e roda os testes de invariantes do banco |
