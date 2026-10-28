# Guimarães Produtos — Gestão de estoque

Sistema usado para cadastrar os produtos do armazém, registrar compras e saídas e acompanhar os preços dos fornecedores. O front-end usa React e Vite; a API é feita com Node.js e Express, e os dados ficam no PostgreSQL.

O site está em **https://guimaraesprodutos.online**. Consulte o [guia de uso](documentacao/guia-do-sistema.md) para as rotinas de estoque e o [guia da VPS](documentacao/publicacao-vps.md) para acesso, portas, logs e backups.

Os [requisitos](documentacao/requisitos.md) têm uma versão editável em Markdown e uma [cópia em PDF](documentacao/pdf/Documento-de-Requisitos-SaaS-Gestao-de-Estoque.pdf). A modelagem inicial está em [Diagramas UML](documentacao/uml/diagrama-uml.md).

## Ambiente local

No Windows, é preciso ter Docker Desktop com o engine Linux em execução, virtualização habilitada e Docker Compose v2.

Na primeira configuração, copie `.env.example` para `.env`, gere um segredo para `SESSION_SECRET` e preencha as variáveis `SEED_*` das contas iniciais. Use `SEED_USERS=true` somente para essa criação; depois, desative a opção e remova as senhas iniciais do arquivo. O `.env` é ignorado pelo Git, e o exemplo não contém credenciais de acesso.

O login usa nome de usuário e senha. Os nomes iniciais do exemplo são `admin` e `operador`; as senhas são definidas na configuração. Cada conta precisa de um nome de usuário exclusivo. O e-mail serve como contato. A senha pode ser trocada em **Configurações**, com pelo menos 12 caracteres.

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

## Rotinas do estoque

Uma instalação nova começa sem produtos. Cadastre as categorias e os itens do armazém. Fornecedor e preço de venda são opcionais no cadastro do produto e podem ser definidos depois. Se houver saldo inicial, informe o custo por embalagem de compra; o sistema converte a quantidade para a unidade de venda. Uma saída exige preço de venda definido e respeita o custo FIFO.

Use o [modelo de inventário](documentacao/modelo-inventario.csv) para organizar a contagem: uma linha por produto, com saldo e unidade. Inclua os demais dados somente depois de confirmá-los. A importação de CSV ainda não está disponível; cadastre os itens pela interface.

- Administrador: dashboard, produtos, categorias, fornecedores, equipe e permissões, relatórios exportáveis em CSV, auditoria e configurações de conta.
- Operador de estoque: dashboard, consulta de estoque, entradas, saídas, ajustes e alertas de estoque baixo.
- O administrador pode incluir fotos JPEG, PNG ou WebP de produtos e fornecedores, até 5 MB. As imagens ficam em uma pasta persistente; o banco guarda a referência do arquivo.
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

O backend prepara as tabelas na inicialização, sem recriar as que já existem. `SEED_USERS=true` cria somente as contas configuradas e preserva senhas existentes. Em produção, mantenha essa opção desativada e use `npm run bootstrap-admin` apenas quando precisar criar o primeiro administrador.

## Testes de integração

Os testes usam um banco descartável separado e nunca devem apontar para o banco local com dados. Crie um banco cujo nome termine com `_test` ou `_qa`, rode o teste dentro do container do backend e depois remova somente esse banco de testes:

```powershell
docker compose exec banco createdb -U estoque_dev sistema_estoque_test
docker compose exec -e TEST_DATABASE_NAME=sistema_estoque_test backend npm test
docker compose exec banco dropdb -U estoque_dev --force sistema_estoque_test
```

O teste cobre login por nome de usuário, unicidade do usuário, acesso normal no primeiro acesso, troca voluntária de senha, cookies/sessão, proteção de origem, perfis, cadastros, movimentos, saldo, relatório, auditoria e inativação.

## Produção na VPS

A publicação usa os serviços nativos da VPS: Nginx do CloudPanel, Node 24 e PostgreSQL. A API atende em `127.0.0.1:3187`, e o Nginx recebe o tráfego HTTPS do domínio. Somente os usuários foram levados da base local; os cadastros comerciais e o estoque começaram vazios. O backup diário inclui banco e imagens.

Os comandos de manutenção e recuperação estão em [Publicação na VPS](documentacao/publicacao-vps.md).

## Alternativa de produção com Docker

`compose.production.yaml` atende ambientes que usam Docker. Ele serve o front-end com Nginx, mantém API e banco sem portas públicas e usa volumes para os dados. Os segredos são montados como arquivos. O Nginx e o backend rodam sem root, com sistema de arquivos somente leitura e áreas temporárias em `tmpfs`. O HTTPS fica a cargo de um proxy externo.

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

Preencha nome, usuário e e-mail com os dados do responsável. A senha é lida do arquivo montado somente para leitura. O comando cria uma conta e falha se o usuário ou e-mail já existir. Na VPS atual, os usuários já foram importados; não é necessário executar esse comando.

As imagens de Node.js, Nginx e PostgreSQL estão fixadas por digest. Revise as versões e as atualizações de segurança antes de trocar as imagens de produção.

## Limitações atuais

A importação de planilhas, a recuperação de senha por e-mail, a autenticação em duas etapas e o uso por várias empresas ainda não estão disponíveis. As pendências técnicas estão registradas em [Revisão técnica do estoque](documentacao/avaliacao-do-sistema.md).
