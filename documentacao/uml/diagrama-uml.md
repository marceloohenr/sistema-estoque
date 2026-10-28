# Sistema de Gestão de Estoque

Esta pasta guarda os diagramas da modelagem inicial: os casos de uso dos dois perfis e as classes do domínio de estoque.

Os desenhos representam a proposta inicial. O sistema passou a ter vários fornecedores por produto e compras por lote; esses detalhes estão no [guia de uso](../guia-do-sistema.md) e no código. O diagrama de classes não corresponde ao esquema completo do PostgreSQL.

## Casos de uso

![Diagrama de casos de uso do Sistema de Gestão de Estoque](diagrama-casos-de-uso.svg)

O arquivo [diagrama-casos-de-uso.puml](diagrama-casos-de-uso.puml) contém a versão editável do desenho.

| Perfil | Ações principais |
| --- | --- |
| Administrador | Mantém produtos, categorias, fornecedores e usuários; consulta o painel, os relatórios e a auditoria. |
| Operador de estoque | Consulta produtos e registra entradas, saídas e ajustes. |

No diagrama, `<<include>>` indica uma etapa comum e obrigatória do caso de uso. `<<extend>>` indica um comportamento que só ocorre quando determinada condição é atendida. Por exemplo, o aviso de estoque baixo é gerado quando uma movimentação deixa o saldo no mínimo ou abaixo dele.

## Classes

![Diagrama de classes do Sistema de Gestão de Estoque](diagrama-classes.svg)

A versão editável está em [diagrama-classes.puml](diagrama-classes.puml). O desenho reúne usuários, categorias, fornecedores, produtos, saldo, movimentações e alertas.

## Regras de negócio

- Cada produto tem um código único, uma unidade de controle e um limite mínimo de estoque.
- Um produto pode ser fornecido por mais de um fornecedor. Compras e cotações de cada fornecedor são mantidas separadamente.
- Toda entrada, saída ou ajuste gera um registro no histórico e atualiza o saldo.
- Uma saída não pode deixar o saldo negativo.
- Compras com custos diferentes permanecem em lotes separados. Nas saídas, o sistema consome primeiro o lote mais antigo (FIFO — *First In, First Out*).
- Cotações não são compras e não alteram o estoque.
- Apenas administradores gerenciam cadastros administrativos e acessam os relatórios e a auditoria.

## O que está disponível hoje

O administrador pode cadastrar produtos, categorias e fornecedores, vincular fornecedores aos produtos, registrar compras e cotações e consultar relatórios e auditoria. O operador pode consultar o estoque e registrar movimentações. O sistema também oferece alerta de estoque baixo, histórico por produto e fornecedor, comparação de custos, cadastro de imagens e exportação de relatórios em CSV.

As saídas são consideradas vendas nos indicadores de receita e margem. O sistema não calcula impostos, taxas ou outras despesas. A importação automática de planilhas, leitura de código de barras, pedidos de clientes e gestão de várias filiais não fazem parte do escopo atual.
