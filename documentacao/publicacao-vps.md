# Servidor da Guimarães Produtos

O site atende em **https://guimaraesprodutos.online**, na VPS `187.127.30.150`. O CloudPanel mantém o domínio e o certificado. O endereço com `www` redireciona para o principal.

## Serviços e portas

| Componente | Configuração |
| --- | --- |
| Front-end | Build React/Vite servido pelo Nginx existente, portas públicas 80/443 |
| API | Serviço `guimaraes-estoque`, Node 24.22.1 exclusivo em `/opt/guimaraes-node24` |
| Porta da API | `127.0.0.1:3187`, livre antes da publicação e sem exposição externa |
| Banco | `guimaraes_estoque`, usuário próprio sem permissão de criar bancos/usuários, PostgreSQL existente em `127.0.0.1:5433` |
| Certificado | Let's Encrypt, instalado e gerenciado pelo CloudPanel para domínio principal e `www` |
| Dados locais | Somente os usuários `admin` e `operador` foram importados; os cadastros comerciais e o estoque começam vazios |

A VPS usa Nginx e PostgreSQL nativos. A API roda em um serviço systemd próprio, com uma instalação separada de Node. A porta 3187 estava livre quando o projeto foi publicado; a porta 8080 já era usada por outro serviço.

## Diretórios

- Builds e código: `/home/guimaraes/apps/estoque/releases/`.
- Versão em execução: `/home/guimaraes/apps/estoque/current`.
- Front-end publicado: `/home/guimaraes/htdocs/guimaraesprodutos.online`.
- Imagens persistentes: `/home/guimaraes/apps/estoque/shared/uploads`.
- Variáveis e segredos: `/home/guimaraes/apps/estoque/shared/production.env`, legível apenas pelo root e grupo do serviço.
- Configuração Nginx: `/etc/nginx/sites-enabled/guimaraesprodutos.online.conf`.
- Serviço: `/etc/systemd/system/guimaraes-estoque.service`.
- Backups: `/var/backups/guimaraes-estoque/`.

Os usuários importados foram **`admin`** e **`operador`**, com as senhas que tinham no sistema local. Nome, e-mail, perfil e status também foram preservados. A transferência usou os hashes de senha. A conta provisória da publicação foi substituída pelo administrador importado e as sessões anteriores foram encerradas.

O arquivo local `.secrets/guimaraes-production-access.txt`, ignorado pelo Git, registra os nomes de acesso. O login do site é separado do login do CloudPanel. O servidor não foi configurado para enviar ou receber e-mails.

## Operação

Os comandos abaixo são executados na VPS via SSH:

```bash
systemctl status guimaraes-estoque --no-pager
journalctl -u guimaraes-estoque -n 100 --no-pager
systemctl restart guimaraes-estoque
curl -fsS http://127.0.0.1:3187/api/health
nginx -t
```

O serviço inicia com o servidor e reinicia se o processo falhar. Roda como `guimaraes`, pode gravar na pasta de uploads e tem limite de memória de 320 MB. A API recebe conexões apenas pela interface local; o Nginx encaminha `/api/` e `/uploads/` e informa que a conexão pública usa HTTPS.

## Backup e restauração

O script `infra/cloudpanel/backup.sh` foi instalado em `/usr/local/sbin/guimaraes-estoque-backup`. A tarefa em `/etc/cron.d/guimaraes-estoque-backup` roda às 03:17, pelo relógio do servidor. Cada execução gera um dump do PostgreSQL e um arquivo com as imagens. Os arquivos ficam restritos ao root e são mantidos por catorze dias.

```bash
/usr/local/sbin/guimaraes-estoque-backup
ls -lh /var/backups/guimaraes-estoque/
tail -n 30 /var/log/guimaraes-estoque-backup.log
```

O primeiro backup foi restaurado em um banco temporário para conferir a recuperação. Em uma recuperação real, pare `guimaraes-estoque` e guarde uma cópia da base e dos uploads atuais. Restaure o dump em um banco novo, pertencente ao usuário da aplicação, e recoloque as imagens na pasta persistente. Ajuste a URL do banco e confira os dados antes de liberar o serviço.

Não restaure sobre a base em uso. O backup diário fica na própria VPS; ainda falta manter uma cópia externa.

## Atualização e reversão

1. Gere o front-end com `npm ci` e `npm run build` localmente.
2. Envie uma release com `dist/`, `backend/src/`, `backend/package.json` e `backend/package-lock.json`, sem `.env`, `.secrets`, `node_modules` ou uploads.
3. Instale as dependências do backend com o Node exclusivo e `npm ci --omit=dev` na nova release.
4. Faça backup do banco e das imagens antes de mudar a versão.
5. Atualize o link `current`, copie `dist/` para o document root e reinicie apenas `guimaraes-estoque`.
6. Valide login, consultas e arquivos estáticos pelo domínio.

Para reverter, recoloque o link e o front-end da release anterior. Alterações de esquema exigem avaliar a compatibilidade da versão anterior; restaurar dados deve ser uma decisão explícita, pois pode descartar operações posteriores ao backup.

As cópias das configurações estão em `infra/cloudpanel/`, sem segredos. Ao editar o Vhost no CloudPanel, preserve as rotas da API e das imagens. O proxy aceita até 6 MB por requisição; a aplicação limita cada imagem a 5 MB.

## Conferência feita na publicação

- DNS do domínio principal e `www` apontando à VPS.
- HTTPS com cadeia de confiança válida, certificado cobrindo os dois nomes e redirecionamento HTTP → HTTPS.
- Página principal, JavaScript e CSS públicos respondendo corretamente.
- API e PostgreSQL saudáveis depois de reiniciar o serviço dedicado.
- Login administrativo pela origem pública, cookie `Secure`, `HttpOnly` e `SameSite=Lax`; consulta sem sessão recusada e logout funcionando.
- Consultas autenticadas de produtos, categorias, fornecedores, usuários, dashboard, relatórios, comparação de períodos, histórico de movimentações e auditoria respondendo HTTP 200.
- Backup inicial concluído e restauração em banco separado aprovada.
- Importação de dois usuários com igualdade dos hashes, perfis e status; produtos, categorias, fornecedores, movimentações, cotações e lotes permaneceram com zero registros. Novo backup realizado após a importação.
- Sites `cantoefibra.com`, `dadosbrapi.online` e `nutriss.cloud` respondendo HTTP 200 após a configuração.

As verificações acima cobrem o servidor, os arquivos publicados e as consultas da API. A revisão manual de todas as telas em produção ainda está pendente.
