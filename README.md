# Sistema de Gestão de Estoque

Aplicação de estoque para um armazém de produtos de limpeza. A interface foi construída com React e Vite; a API usa Node.js, Express e PostgreSQL. Os cadastros e as movimentações ficam no banco de dados.

## Ambiente local

Pré-requisitos: Windows com virtualização habilitada no BIOS/UEFI, Docker Desktop com o engine Linux em execução e Docker Compose v2.

Na primeira configuração, copie `.env.example` para `.env`, gere um segredo para `SESSION_SECRET` e preencha as variáveis `SEED_*` das contas iniciais. Use `SEED_USERS=true` somente para essa criação; depois, desative a opção e remova as senhas iniciais do arquivo. O `.env` é ignorado pelo Git, e o exemplo não contém credenciais de acesso.

Entre com os nomes de usuário `admin` ou `operador` e as senhas definidas na configuração. O e-mail fica cadastrado como contato, mas não é usado no login. Em contas antigas, o nome de usuário pode ter sido criado a partir da parte do e-mail anterior ao `@`. Cada novo usuário precisa de um nome exclusivo. A senha pode ser trocada a qualquer momento em **Configurações**; a nova senha deve ter pelo menos 12 caracteres.

```powershell
cd E:\Repositorios\sistema-estoque
docker compose config --quiet
docker compose up --build --renew-anon-volumes -d
docker compose ps
```

O front-end fica em <http://localhost:5173>, a API em <http://localhost:3000> e o PostgreSQL em `localhost:5432`. A rota <http://localhost:3000/api/health> confirma a conexão com o banco. O Compose aguarda o PostgreSQL e a API ficarem saudáveis antes de iniciar o front-end.

Para acompanhar os serviços ou interrompê-los:

```powershell
docker compose logs -f
docker compose logs -f backend
docker compose stop
docker compose start
```

`docker compose down` remove os containers, mas mantém os volumes `dados_postgres` e `uploads_desenvolvimento`. Não use `docker compose down --volumes` se quiser preservar os dados locais.

## Dados e funcionalidades

Para entender cada tela, indicador, gráfico e fluxo de trabalho, consulte o [Guia detalhado do sistema](documentacao/guia-do-sistema.md).

O banco não vem preenchido com produtos de exemplo. Cadastre as categorias, os fornecedores e os itens confirmados com o armazém. Quando informar o saldo inicial de um produto, o sistema registra uma entrada para manter o histórico completo.

Use o [modelo de inventário](documentacao/modelo-inventario.csv) para organizar a contagem: uma linha por produto, com saldo e unidade. Inclua os demais dados somente depois de confirmá-los. A importação de CSV ainda não está disponível; cadastre os itens pela interface.

- Administrador: dashboard, produtos, categorias, fornecedores, equipe e permissões, relatórios exportáveis em CSV, auditoria e configurações de conta.
- Operador de estoque: dashboard, consulta de estoque, entradas, saídas, ajustes e alertas de estoque baixo.
- O administrador pode cadastrar imagens JPEG, PNG ou WebP de produtos e fornecedores (até 5 MB). Os arquivos ficam em volume persistente, separados do banco de dados.
- Em Fornecedores, os atalhos de WhatsApp e e-mail abrem uma mensagem preenchida para revisão; o sistema não envia a mensagem. No detalhe do fornecedor, é possível registrar preços recebidos por produto e consultar o histórico. Cotações não alteram o estoque nem o preço usado nos relatórios.
- As operações de estoque são validadas no servidor, atualizadas em transação e não permitem saldo negativo.
- Produtos, categorias, fornecedores e usuários são inativados em vez de apagados fisicamente; movimentos e auditoria são mantidos.
- A API impõe as permissões por perfil. Sessões usam cookie `HttpOnly`, `SameSite=Lax`, expiração de oito horas e limite de tentativas de login.

## API

As rotas exigem sessão autenticada, exceto login, logout e saúde. Ações administrativas são restritas ao administrador.

| Recurso | Rotas principais | Permissão |
| --- | --- | --- |
| Sessão | `POST /api/auth/login` (`username` e `password`), `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/change-password` | Pública ou usuário autenticado |
| Produtos | `GET/POST /api/products`, `PATCH/DELETE /api/products/:id`, `PUT /api/products/:id/image` | Consulta autenticada; escrita administrativa |
| Categorias e fornecedores | Rotas CRUD em `/api/categories` e `/api/suppliers`; vínculos de produtos em `/api/suppliers/:id/products` (inclui desvinculação); imagem em `PUT /api/suppliers/:id/image`; cotações em `GET/POST /api/suppliers/:id/quotes` | Consulta autenticada; escrita administrativa |
| Usuários | `GET/POST /api/users`, `PATCH /api/users/:id` | Administrador |
| Estoque | `GET/POST /api/movements` | Usuário autenticado |
| Relatórios | `GET /api/reports?period=7d\|30d\|month` ou `period=custom&from=AAAA-MM-DD&to=AAAA-MM-DD`; `GET /api/reports/product/:productId/movements` | Administrador |
| Auditoria | `GET /api/audit` | Administrador |
| Saúde | `GET /api/health` | Pública |

As tabelas são criadas de forma idempotente na inicialização do backend. O seed opcional `SEED_USERS=true` só cria as contas configuradas e não redefine senhas existentes. Em uma instalação de produção, mantenha-o desativado e crie o primeiro administrador com `npm run bootstrap-admin`, usando variáveis de ambiente fornecidas pelo gerenciador de segredos.

## Testes de integração

Os testes usam um banco descartável separado e nunca devem apontar para o banco local com dados. Crie um banco cujo nome termine com `_test` ou `_qa`, rode o teste dentro do container do backend e depois remova somente esse banco de testes:

```powershell
docker compose exec banco createdb -U estoque_dev sistema_estoque_test
docker compose exec -e TEST_DATABASE_NAME=sistema_estoque_test backend npm test
docker compose exec banco dropdb -U estoque_dev --force sistema_estoque_test
```

O teste cobre login por nome de usuário, unicidade do usuário, acesso normal no primeiro acesso, troca voluntária de senha, cookies/sessão, proteção de origem, perfis, cadastros, movimentos, saldo, relatório, auditoria e inativação.

## Preparação para produção e limites atuais

O Compose padrão é de desenvolvimento. Para produção há um Compose separado com front-end estático servido por Nginx, backend sem porta pública, PostgreSQL sem porta publicada, volume persistente, verificações de saúde e segredos montados como arquivos. Nginx e backend executam sem root, com sistema de arquivos somente leitura e capacidades removidas; áreas temporárias ficam em `tmpfs`. Ele ainda precisa de um servidor e de um proxy reverso externo que termine HTTPS.

As imagens enviadas pelo administrador são gravadas no volume `uploads_producao`, montado somente no backend. Inclua esse volume no processo de backup junto com o banco para preservar as fotos.

Copie `.env.production.example` para `.env.production` e crie os quatro arquivos de segredo fora do Git indicados nele: senha do usuário de inicialização do PostgreSQL, senha do usuário limitado da aplicação, URL do banco e segredo da sessão. O usuário `POSTGRES_INIT_USER` é superusuário e serve apenas à inicialização; o backend conecta como `APP_DB_USER`, que não pode criar bancos nem usuários. A senha dentro da `DATABASE_URL_FILE` deve corresponder a `APP_DB_PASSWORD_FILE`; codifique caracteres reservados no formato URL. Configure `APP_ORIGIN` com a origem HTTPS pública do site. O script em `infra/postgres/init-app-user.sh` cria o usuário da aplicação com acesso somente ao banco e ao schema público, e só é executado quando o volume do PostgreSQL é inicializado pela primeira vez. Depois, construa e inicie:

```powershell
docker compose --env-file .env.production -f compose.production.yaml config --quiet
docker compose --env-file .env.production -f compose.production.yaml up --build -d
docker compose --env-file .env.production -f compose.production.yaml ps
```

O serviço web publica apenas em `127.0.0.1:8080`; configure o proxy reverso HTTPS para encaminhar para essa porta e enviar `Host` e `X-Forwarded-Proto: https`. No proxy, redirecione HTTP para HTTPS, mantenha os certificados atualizados e configure HSTS após confirmar que o domínio atende exclusivamente por HTTPS. O backend aceita apenas a origem `APP_ORIGIN`, ativa cookies `Secure` e não publica a porta 3000. O banco não publica a porta 5432.

Se o volume de produção já tiver sido inicializado antes da criação desse usuário limitado, o script de inicialização não será executado novamente. Nesse caso, crie o usuário e conceda as permissões necessárias antes de alterar `DATABASE_URL_FILE`; não apague o volume para tentar reaplicar o script.

Para criar o primeiro administrador, mantenha `SEED_USERS=false` e guarde uma senha forte em `.secrets/admin_password`, com acesso restrito (essa pasta é ignorada pelo Git). Depois de iniciar o Compose de produção e confirmar que o banco está saudável, execute no PowerShell, a partir da pasta do projeto:

```powershell
$adminPasswordFile = (Resolve-Path ".secrets/admin_password").Path
docker compose --env-file .env.production -f compose.production.yaml run --rm `
  --volume "${adminPasswordFile}:/run/secrets/admin_password:ro" `
  --env "BOOTSTRAP_ADMIN_NAME=Administrador" `
  --env "BOOTSTRAP_ADMIN_USERNAME=admin" `
  --env "BOOTSTRAP_ADMIN_EMAIL=admin@seudominio.com" `
  --env "BOOTSTRAP_ADMIN_PASSWORD_FILE=/run/secrets/admin_password" `
  backend npm run bootstrap-admin
```

Troque o nome, usuário e e-mail de exemplo pelos dados do responsável. A senha não é digitada na linha de comando; ela é lida do arquivo montado somente para leitura. O comando cria uma única conta e falha se o usuário ou e-mail já existir. Não reutilize as contas locais de desenvolvimento em produção. Faça backup do volume do banco e teste a restauração antes de receber dados importantes.

As imagens-base de Node.js, Nginx e PostgreSQL estão fixadas por digest nos arquivos de build e Compose. Antes de publicar, configure o proxy e os certificados TLS, estabeleça um processo regular de revisão e atualização desses digests, monitore os serviços e revise limites de rede e armazenamento. Não reutilize as credenciais locais.

Esta versão ainda não faz importação dos dados reais do armazém, recuperação de senha por e-mail, autenticação multifator, segregação multiempresa nem configuração de hospedagem/HTTPS. Essas decisões dependem dos dados e do ambiente de produção escolhidos. O cadastro manual inicial usa apenas informações confirmadas pela empresa; não há produtos fictícios na base.
