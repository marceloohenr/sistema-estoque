# Documento de requisitos

Sistema de gestão de estoque para um armazém de produtos de limpeza.

## Integrantes

- Marcelo Henrique Malagueta
- Caio Toscano
- Clayton Lima
- Kilber Alves
- Artur Camara

## 1. O projeto

O armazém precisa conferir o saldo dos produtos, registrar o que recebe e vende e saber quando comprar novamente. O sistema reúne essas informações e mantém o histórico com o usuário responsável por cada lançamento.

Cada produto tem um único cadastro e pode ser comprado de vários fornecedores. As compras guardam quantidade, custo, preço de venda e data. Os valores antigos permanecem no histórico para permitir a comparação dos fornecedores e a apuração do custo das vendas.

### Perfis de acesso

| Perfil | Responsabilidades |
| --- | --- |
| Administrador | Cadastrar produtos, categorias, fornecedores e usuários; registrar e corrigir operações; consultar relatórios e auditoria. |
| Operador de estoque | Consultar saldo e histórico; registrar entradas, saídas e ajustes; acompanhar os alertas de reposição. |

Os dois perfis acessam a visão geral e podem trocar a própria senha em Configurações. O acesso é feito por nome de usuário e senha; o e-mail fica como contato.

### Prioridades

Os requisitos de prioridade alta são necessários para registrar as operações e manter o saldo correto. Os de prioridade média complementam a consulta e a organização dos cadastros.

## 2. Requisitos funcionais

| Código | Requisito | Prioridade |
| --- | --- | --- |
| RF01 | Entrar e sair do sistema usando nome de usuário e senha. Permitir a troca de senha nas configurações da conta. | Alta |
| RF02 | Permitir ao administrador cadastrar, editar, ativar e inativar usuários. | Alta |
| RF03 | Definir cada conta como Administrador ou Operador de Estoque e restringir as ações pelo perfil. | Alta |
| RF04 | Cadastrar produto com código único, nome, categoria, medidas de compra e venda, conversão, estoque mínimo e preços. Permitir uma foto do item. | Alta |
| RF05 | Cadastrar, editar e inativar categorias, mantendo os vínculos e o histórico necessários. | Média |
| RF06 | Cadastrar fornecedores com telefone, e-mail e foto; vincular vários fornecedores ao produto e registrar cotações com data. | Média |
| RF07 | Registrar compras com produto, fornecedor, quantidade, custo por medida de compra, preço de venda e data da entrada. Converter a embalagem para a unidade de estoque e criar o lote. | Alta |
| RF08 | Registrar saídas com produto, quantidade e data, usando o preço de venda do cadastro e calculando o custo pelos lotes FIFO. | Alta |
| RF09 | Registrar ajustes de contagem com motivo. Exigir custo unitário quando o ajuste acrescentar saldo. | Alta |
| RF10 | Atualizar saldo, lotes e históricos do produto e do fornecedor após cada operação confirmada. | Alta |
| RF11 | Consultar o saldo e o histórico de compras e saídas por produto, preservando fornecedor, quantidade, custo e data. | Alta |
| RF12 | Impedir saldo negativo, saída com custo pendente e venda abaixo do custo FIFO das unidades retiradas. Mostrar o risco no produto. | Alta |
| RF13 | Mostrar aviso quando o saldo atingir ou ficar abaixo do mínimo configurado para o produto. | Alta |
| RF14 | Mostrar na visão geral os produtos ativos, o saldo, os itens com estoque baixo e as movimentações recentes. | Média |
| RF15 | Gerar relatórios por período, produto e fornecedor, com compras, custo das saídas, receita, margem e projeção do saldo. Permitir exportar em CSV. | Média |
| RF16 | Pesquisar produtos e filtrar os cadastros por categoria e situação. Comparar a última compra e a última cotação de cada fornecedor separadamente. | Média |
| RF17 | Registrar data, hora e usuário de cada movimentação. Guardar o motivo e o responsável por correções e estornos. | Alta |
| RF18 | Permitir ao administrador consultar a auditoria e corrigir ou estornar compras, com recálculo dos lotes e proteção das saídas já registradas. | Alta |

## 3. Uso e operação

| Código | Requisito |
| --- | --- |
| RNF01 | Funcionar nos navegadores atuais de computadores e celulares. |
| RNF02 | Manter campos legíveis, navegação por teclado e layout adaptado à largura da tela. |
| RNF03 | Guardar senhas como hashes e usar HTTPS no acesso público. |
| RNF04 | Conferir as permissões no servidor em todas as ações protegidas. |
| RNF05 | Ter como meta consultas usuais em até três segundos nas condições de uso previstas. O tempo deve ser medido antes de afirmar que a meta foi cumprida. |
| RNF06 | Manter dados e imagens em armazenamento persistente, com backup e procedimento de restauração. |
| RNF07 | Informar quando uma ação falhar e permitir nova tentativa sem apresentar um cadastro não salvo como concluído. |

## 4. Regras do estoque

1. Um produto é cadastrado uma vez e pode ter vários fornecedores.
2. Compras aumentam o saldo. Saídas o reduzem. Ajustes podem aumentar ou reduzir a quantidade e exigem motivo.
3. Nenhuma operação pode deixar o saldo negativo.
4. Cada compra mantém seu lote, fornecedor, data, custo e preço de venda. Uma cotação guarda apenas o preço informado e não movimenta estoque.
5. FIFO significa primeiro que entra, primeiro que sai: a saída consome os lotes mais antigos antes dos novos.
6. A receita de uma saída é a quantidade vendida multiplicada pelo preço registrado. A margem realizada é essa receita menos o custo FIFO consumido. Taxas, impostos e outras despesas não entram nesse cálculo.
7. O saldo restante tem custo e margem estimados. Esses valores são projeções; não representam vendas concluídas. Unidades sem custo conhecido ficam sinalizadas como pendentes.
8. Uma correção ou um estorno deve manter quantidade suficiente para as saídas posteriores. Se isso não for possível, a alteração é recusada.
9. A inativação mantém o histórico. Para inativar um produto, o saldo precisa estar zerado.

## 5. Conferência para entrega

- Administrador e operador conseguem entrar, sair e alterar a própria senha.
- O administrador consegue manter o catálogo, os fornecedores e as contas de usuário.
- Uma compra atualiza o saldo e aparece no histórico do produto, na ficha do fornecedor e nos relatórios.
- Compras do mesmo produto com custos diferentes permanecem em lotes distintos; uma saída consome as unidades na ordem FIFO.
- O sistema recusa saldo insuficiente, custo pendente e venda abaixo do custo FIFO. O alerta do produto acompanha os lotes restantes.
- Cotações aparecem nos históricos e na comparação, sem alterar o saldo.
- A margem realizada corresponde às saídas registradas; a projeção do saldo é apresentada separadamente.
- Correções e estornos exigem motivo, recalculam os lotes e ficam na auditoria.
- Os filtros e o CSV respeitam o período escolhido. As consultas do saldo atual continuam identificadas como posição de hoje.
- O backup do banco e das imagens pode ser recuperado em um ambiente separado.

Estes itens orientam a conferência. O que foi testado e as pendências encontradas estão registrados em avaliacao-do-sistema.md.

## 6. Funcionalidades fora desta entrega

Não fazem parte desta entrega a emissão de nota fiscal, o contas a pagar e receber, a importação automática de planilhas, a leitura de código de barras, a previsão de demanda e o controle de várias filiais.

Os atalhos de WhatsApp e e-mail abrem uma mensagem preenchida para o usuário revisar e enviar. Não há disparo automático de mensagens. O estoque também não confirma recebimento de pagamentos.

Os diagramas UML ficam em arquivos próprios, na pasta documentacao/uml. Este documento trata dos requisitos; as instruções de uso estão em guia-do-sistema.md.
