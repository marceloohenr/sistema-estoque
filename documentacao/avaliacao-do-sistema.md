# Revisão técnica do estoque

Revisão iniciada em 24/10/2026, com atualização após a publicação em `guimaraesprodutos.online`.

Este registro reúne os problemas encontrados, as correções e o que ainda precisa de atenção. As instruções de uso ficam no [guia do sistema](guia-do-sistema.md); os procedimentos do servidor estão em [publicação na VPS](publicacao-vps.md).

## Dados e relatórios

O filtro de produtos ativos, inativos e todos tinha uma condição SQL inválida. A consulta foi corrigida, e a lista passou a usar busca e paginação no servidor. Também é possível reativar um produto.

Os relatórios por fornecedor passaram a considerar compras antigas mesmo quando o produto já foi desvinculado dele. O vínculo define as novas operações; as compras anteriores continuam atribuídas ao fornecedor original.

Os períodos usam datas no fuso de Fortaleza. “Mês atual” começa no primeiro dia do mês, e a data final do período personalizado entra no cálculo. A tela mostra as datas consultadas e permite comparar o intervalo com outro de mesma duração, imediatamente anterior. A comparação inclui compras, saídas, custo FIFO, receita e margem realizada. O saldo atual e suas projeções ficam fora dessa comparação.

O painel tem uma consulta própria (`GET /api/dashboard`) para as operações do dia, os últimos sete dias e as cinco movimentações recentes. Os totais deixaram de depender de uma lista limitada a mil registros. Movimentações, auditoria e históricos de fornecedores também receberam consultas paginadas.

O CSV contém saldo atual, resumo financeiro e movimentações do período. A exportação busca as páginas da API e grava direto no arquivo quando o navegador oferece essa opção. Nos demais navegadores, o arquivo é montado em memória.

## A tela de relatórios em branco

A tela usava estados de comparação e exportação declarados em outros componentes. Isso causava `ReferenceError` ao abrir a página. As declarações foram movidas para o componente de relatórios.

Também foi removida a espera obrigatória pela recarga dos cadastros auxiliares. O relatório abre enquanto os filtros são atualizados. Uma falha nessa atualização aparece com a opção de tentar novamente.

A aplicação ganhou uma mensagem de recuperação para erros de renderização. Essa mensagem evita a página inteiramente branca, mas não substitui a correção do erro que a provocou.

## Compras, saídas e preços

A saída mostra uma prévia dos lotes que serão consumidos, o custo FIFO e a margem calculada para a quantidade informada. A gravação continua sujeita à conferência no servidor.

Na lista de produtos, o preço de venda aparece junto ao custo da próxima unidade FIFO. Se o preço estiver abaixo do custo, o alerta mostra a diferença por unidade e permite ao administrador revisar o preço. Há um segundo aviso quando existem lotes mais caros adiante na fila. Custos pendentes continuam identificados.

O formulário de correção de compra mostra a mudança prevista no saldo e exige um motivo. O servidor recalcula os lotes e recusa correções que deixariam saídas já registradas sem quantidade disponível.

## Interface

- Filtros, paginação e formulários receberam ajustes para telas menores.
- Cabeçalhos de tabela ficam fixos durante a rolagem; as áreas de rolagem podem receber foco pelo teclado.
- Janelas de cadastro têm nome acessível, controle de foco e fechamento por `Escape`. Ao fechar, o foco volta à ação anterior.
- Avisos de sucesso e resumos textuais dos gráficos podem ser anunciados por leitores de tela.
- Erro, carregamento e lista vazia têm mensagens distintas.

## Publicação

O site usa Nginx, Node 24 e PostgreSQL na VPS com CloudPanel. A API escuta apenas em `127.0.0.1:3187`. O domínio tem HTTPS e redirecionamento do endereço com `www` para o principal.

Foram levados somente os usuários `admin` e `operador`, com os mesmos hashes de senha, perfis e status da base local. Os cadastros comerciais e o estoque começaram vazios.

Há backup diário do banco e das imagens, com retenção de catorze dias. A restauração do banco foi conferida em uma base temporária. Falta definir uma cópia de backup fora da VPS.

## Verificações registradas

| Verificação | Resultado |
| --- | --- |
| Build do front-end | Concluído após as correções de relatórios e do alerta FIFO |
| Sintaxe do backend e dos testes | Sem erros nos arquivos verificados |
| Referências de variáveis em `App.jsx` e `main.jsx` | Nenhuma referência sem declaração na conferência por Babel |
| Integração da API | Aprovada em banco QA descartável durante a revisão |
| Alerta de preço FIFO | Teste isolado aprovado: risco no lote antigo, bloqueio da venda com prejuízo e atualização após a saída |
| Compose de desenvolvimento e produção | Configurações aceitas por `docker compose config --quiet` |
| Publicação | Página, arquivos estáticos, autenticação e consultas da API responderam pelo domínio HTTPS |
| Reinício e backup | Serviço voltou saudável; restauração em banco separado aprovada |

Esses resultados correspondem às verificações feitas nas alterações descritas aqui. Não significam que todas as combinações de dados ou todas as telas tenham sido testadas.

## Pendências

- Transformar os seletores de produtos em buscas sob demanda. A listagem já é paginada, mas outras telas ainda carregam o catálogo ativo inteiro.
- Ampliar os testes de comparação de períodos para filtros de fornecedor, intervalo personalizado e grandes volumes. A suíte cobre o intervalo de sete dias com filtro de produto.
- Oferecer exportação pelo servidor para navegadores sem gravação direta em arquivo.
- Conferir manualmente as telas em celular, tablet, desktop e zoom de 200%. A captura pelo controle do Windows não foi concluída porque a URL da janela não pôde ser identificada com segurança.
- Fazer uma revisão com leitor de tela, medir contraste e associar as mensagens de validação aos respectivos campos.
- Avaliar uma apresentação em cartões para tabelas extensas no celular e preservar filtros e posição de rolagem nas trocas de tela.
- Organizar as mudanças de esquema em migrações sequenciais. Hoje, a maior parte do esquema é preparada na inicialização, com comandos SQL que aceitam execução repetida.
- Definir monitoramento de falhas e backup externo. Atualizações de dependências e imagens de containers precisam continuar sendo revistas antes de cada publicação.
