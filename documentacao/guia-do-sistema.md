# Como usar o estoque da Guimarães Produtos

Use este guia para cadastrar o catálogo, lançar compras e saídas e conferir o resultado das vendas. O sistema está em [guimaraesprodutos.online](https://guimaraesprodutos.online).

## Onde ver o lucro das vendas realizadas

Em **Relatórios**, o cartão **Margem realizada** mostra quanto sobrou das vendas depois de descontar o custo dos produtos vendidos. O gráfico **Valores do período** reúne esse resultado, as compras, o custo das saídas e a receita.

O cálculo usado é:

> **Receita registrada − custo FIFO das unidades vendidas = margem realizada**

- **Receita registrada** é a soma das saídas registradas como venda: quantidade vendida multiplicada pelo preço informado naquela saída.
- **Custo das saídas (FIFO)** é o custo dos lotes consumidos para atender às saídas. FIFO vem do inglês *First In, First Out* — “primeiro que entra, primeiro que sai”: o sistema baixa primeiro as unidades do lote mais antigo e só depois passa aos lotes novos.
- **Margem realizada** é a diferença entre esses dois valores. Ela considera apenas vendas registradas; não desconta taxas, impostos ou outras despesas que não são controladas pelo sistema.

### Exemplo de FIFO

Imagine duas compras do mesmo produto: 10 unidades a **R$ 5,00** cada e, alguns dias depois, mais 10 unidades a **R$ 8,00** cada. Se forem vendidas 12 unidades, o sistema considera primeiro as 10 mais antigas e depois 2 da compra seguinte:

> **(10 × R$ 5,00) + (2 × R$ 8,00) = R$ 66,00 de custo da saída**

Esse valor é o custo das unidades vendidas, não o preço de venda nem o lucro. Para chegar à margem realizada, o sistema subtrai os R$ 66,00 da receita registrada nessa venda. As 8 unidades que restarem continuam vinculadas ao custo do lote mais novo.

Clique no cartão **Margem realizada** para ver o resultado por produto. A tabela detalha compras e unidades recebidas, vendas e unidades vendidas, custo FIFO, receita e lucro/margem. Ao clicar no nome do produto, abre-se o histórico detalhado de compras e vendas, com data, fornecedor, quantidade, custo, valor de venda e resultado da saída.

O cartão **Margem estimada do saldo** e a **Venda estimada do saldo** não mostram lucro já obtido. São projeções do estoque que ainda está disponível:

> **Unidades restantes × preço de venda atual = venda estimada**  
> **Venda estimada − custo conhecido dos lotes restantes = margem estimada**

Unidades sem custo informado ficam como **pendentes** e não são tratadas como se tivessem custo zero. Por isso, uma margem estimada pode ser parcial ou aparecer como pendente.

## Perfis de acesso

### Administrador

Pode consultar a visão geral e o estoque, criar e editar produtos, categorias e fornecedores, administrar contas de usuário, registrar e corrigir operações, consultar relatórios e auditoria e alterar a própria senha.

### Operador de estoque

Pode consultar o estoque, registrar entradas, saídas e ajustes, acompanhar alertas de estoque baixo e alterar a própria senha. Não administra cadastros de categorias, fornecedores ou usuários, nem acessa relatórios administrativos e auditoria.

As ações disponíveis no menu acompanham o perfil de cada conta.

## Telas e funções

### 1. Entrar no sistema

O acesso é feito com **usuário** e **senha**. O e-mail cadastrado no perfil serve como contato e não substitui o usuário no login. Após a autenticação, o menu e as ações disponíveis dependem do perfil.

### 2. Visão geral

É o painel inicial dos dois perfis. Os indicadores exibidos são:

- **Produtos cadastrados:** quantidade de itens ativos no catálogo.
- **Unidades em estoque:** soma dos saldos atuais dos produtos.
- **Estoque baixo:** quantidade de produtos cujo saldo está no mínimo ou abaixo dele.
- **Valor em estoque** (administrador): estimativa pelo preço de venda atual multiplicado pelo saldo. Não é custo de aquisição nem receita recebida.
- **Movimentação da semana:** gráfico de barras com unidades recebidas e retiradas em cada um dos últimos sete dias. Ajustes não são incluídos nessas duas séries.
- **Movimentações recentes:** últimas operações registradas, com produto, tipo, quantidade, responsável e data.
- **Precisa de reposição:** lista dos produtos no mínimo ou abaixo dele.

O botão **Nova movimentação** abre o formulário de entrada, saída ou ajuste. O painel também tem atalhos para consultar produtos, registrar uma operação e, para o administrador, abrir relatórios.

### 3. Produtos / Consultar estoque

O administrador usa **Produtos** para cadastrar e manter o catálogo. O operador vê a tela **Consultar estoque**, sem as ações administrativas.

É possível pesquisar por nome, código ou categoria e filtrar por categoria. A lista apresenta:

- **Produto e código:** identificação do item; uma imagem pode aparecer junto ao nome.
- **Categoria:** agrupamento do produto.
- **Fornecedor:** fornecedor principal, se definido. Um produto também pode ser fornecido por outras empresas; consulte a ação de fornecedores e preços.
- **Saldo:** quantidade disponível na unidade de controle/venda cadastrada para o produto.
- **Preço de venda e custo FIFO:** mostra o preço atual e o custo unitário do lote que será consumido a seguir. Quando o preço fica abaixo desse custo, aparece um alerta com a perda por unidade e o atalho **Revisar preço de venda** para o administrador. O sistema também avisa quando há unidades de outros lotes mais caros que o preço atual. O maior custo do saldo ajuda a revisar o preço; a validação da saída usa os lotes FIFO e a quantidade efetivamente retirada. Custos pendentes ficam sinalizados. Esses valores consideram o custo da mercadoria, sem taxas, impostos ou outras despesas.
- **Mínimo e status:** limite de reposição e situação do produto: em estoque, estoque baixo ou inativo.

Ações por produto:

- **Histórico:** consulta entradas, fornecedor, quantidade recebida e restante do lote, custo unitário, preço de venda e total da compra. Lotes e saídas seguem FIFO; custo não informado aparece pendente.
- **Fornecedores e preços** (administrador): compara a última compra real e a última cotação de cada fornecedor vinculado, destacando separadamente o menor custo de compra e a menor cotação. Mostra também históricos separados. Cotação não é compra e não movimenta saldo.
- **Movimentação:** abre uma operação já com o produto selecionado.
- **Editar / Inativar** (administrador): altera o cadastro ou inativa o produto sem apagar o histórico. Para inativar, o saldo precisa estar zerado.

#### Cadastro do produto

O cadastro reúne código, unidade de controle/venda, nome, categoria, fornecedor principal opcional, estoque mínimo, eventual saldo inicial, custo, preço de venda, imagem e unidades por medida de compra.

- **Como você vende?** é a unidade usada no saldo e nas saídas: unidade, frasco, litro, quilo ou outra medida. O preço de venda vale para uma unidade dessa medida.
- **Como você compra?** é a embalagem ou medida usada no recebimento. A lista mostra unidade, pacote, caixa, fardo, balde, bombona, galão, tambor, palete, litro, quilograma e outras opções. Em **Outra medida…**, você pode escrever uma embalagem específica. Medidas personalizadas já cadastradas continuam disponíveis na edição. O custo de entrada vale para uma embalagem inteira.
- **Quantas unidades de venda vêm na embalagem?** define a conversão. Se 1 fardo tem 12 frascos, receber 2 fardos acrescenta 24 frascos ao saldo. O formulário mostra esse exemplo com as medidas escolhidas. Se compra e venda usam a mesma medida, informe 1.
- **Saldo inicial:** quantidade contada em embalagens de compra. Se for maior que zero, informe o custo por embalagem. Fornecedor e preço de venda continuam opcionais, mesmo com saldo inicial.
- **Estoque mínimo:** limite individual do produto que dispara o alerta.
- **Custo e preço de venda:** o custo é obrigatório quando há saldo inicial. O preço de venda pode ser definido depois, pela edição do produto; enquanto isso, a lista mostra **Preço não informado**, as saídas ficam bloqueadas e a margem estimada aparece pendente. Compras posteriores registram seus próprios valores.
- **Imagem:** JPEG, PNG ou WebP, até 5 MB.

Na criação do produto também é possível abrir um cadastro rápido de categoria ou fornecedor; após salvar esse cadastro auxiliar, o formulário do produto continua aberto.

### 4. Categorias (administrador)

Organiza produtos por grupos. A lista mostra nome, descrição e quantidade de produtos vinculados. O administrador pode adicionar, editar ou inativar uma categoria. Uma categoria é uma classificação; não altera saldo, custo ou preço.

### 5. Fornecedores (administrador)

A tela apresenta os fornecedores cadastrados. Os filtros **Todos**, **Ativos** e **Inativos** permitem consultar cada situação. Um fornecedor inativo continua no sistema e no histórico, mas não é oferecido para novas operações que exigem fornecedor ativo.

O cartão do fornecedor pode mostrar nome, status, telefone, e-mail, imagem e número de produtos vinculados. Os atalhos de WhatsApp e e-mail abrem o aplicativo correspondente com uma mensagem previamente preenchida; o usuário revisa e envia. O sistema não envia mensagens automaticamente.

#### Detalhes do fornecedor

Ao abrir **Produtos e preços**, a ficha concentra apenas os registros daquele fornecedor:

- **Compras recebidas:** entradas reais do fornecedor, com produto, data, quantidade, saldo restante do lote, custo e preço de venda registrados.
- **Cotações recebidas:** valores e observações informados pelo fornecedor. Cotação não comprova compra nem aumenta estoque.
- **Produtos deste fornecedor:** permite vincular um produto existente ou cadastrar um novo produto já associado.
- **Desvincular produto:** remove o vínculo para novas compras e cotações desse fornecedor. As compras já registradas e seus dados permanecem no histórico.
- **Registrar compra:** abre a movimentação de entrada com o fornecedor fixo e restringe a seleção aos produtos vinculados.
- **Registrar cotação:** registra produto vinculado, preço unitário, data e observação, sem alterar saldo.

Na listagem geral, **Comparação pela última compra** exibe o custo da última entrada real para cada combinação produto/fornecedor e destaca o menor custo recente. Ela não mistura cotações com compras.

### 6. Usuários e permissões (administrador)

Lista os membros, nome, usuário de login, e-mail, perfil e status. O administrador pode cadastrar uma conta, escolher entre Administrador e Operador de Estoque, gerenciar perfil ou inativar/reativar outro usuário. O próprio administrador não pode desativar a própria conta por essa ação.

O cadastro de usuário requer nome, usuário exclusivo, e-mail, perfil e senha inicial com pelo menos 12 caracteres. Cada pessoa pode alterar a própria senha em **Configurações**.

### 7. Movimentações

O histórico mostra o que entrou, saiu ou foi ajustado, com data, produto, quantidade, responsável e observação. As saídas mostram também custo FIFO e margem. Há busca e filtros por produto, fornecedor, tipo e datas.

O botão **Nova movimentação** abre um único formulário com três tipos:

#### Entrada / compra

Registra recebimento real. Informe produto, fornecedor, quantidade na medida de compra, custo unitário por medida, preço de venda unitário e data da chegada. O sistema converte a embalagem para unidades de controle, atualiza saldo e cria lote com fornecedor, data, custo e preço. A compra passa a aparecer nos históricos do produto e do fornecedor, na comparação de compras e nos relatórios.

Antes de salvar, a conferência mostra o saldo após entrada, total da compra e margem estimada daquele lote. Essa margem é apenas uma projeção; não significa que a mercadoria já foi vendida. Se houver custos diferentes, cada entrada permanece como lote separado.

#### Saída / venda

Escolha o produto, a quantidade e a data da saída. O preço vem do cadastro do produto. Antes de salvar, confira a prévia dos lotes e a margem. As unidades mais antigas saem primeiro, pela ordem FIFO explicada no início deste guia. A venda é recusada se ficar abaixo do custo FIFO da quantidade retirada ou se houver custo pendente nas unidades necessárias.

No relatório, toda operação do tipo **Saída** conta como venda para os indicadores de receita e margem. Ainda não existe um tipo separado para retirada por perda, consumo interno ou uso; por isso, não use **Saída** para esses casos se não quiser que sejam contabilizados como receita. O sistema não emite nota fiscal nem confirma recebimento de pagamento.

#### Ajuste de saldo

Registra diferença encontrada na contagem física. Informe uma variação positiva para acrescentar unidades ou negativa para retirá-las. Acréscimos exigem custo por unidade para evitar incorporar saldo sem custo conhecido. Ajustes atualizam quantidade e auditoria, mas não são compra nem venda e não compõem a margem realizada.

O saldo não pode ficar negativo. Operações são validadas no servidor e gravadas no banco.

#### Corrigir ou estornar compra (administrador)

Uma entrada incorreta pode ser corrigida com quantidade, fornecedor, custos, preço de venda, data e motivo. Também pode ser estornada com motivo. O sistema recalcula lotes e alocações FIFO; rejeita uma alteração que deixe saídas existentes sem quantidade para cobrir o histórico. A correção/estorno é auditada.

### 8. Estoque baixo (operador)

Mostra produtos com saldo igual ou abaixo do mínimo definido individualmente. A tabela compara saldo, mínimo e quantidade que falta para alcançar o limite. O botão **Ver estoque** abre a consulta de produtos. O alerta é baseado no saldo atual, não somente nas movimentações do período.

### 9. Relatórios (administrador)

Escolha o período (**Últimos 7 dias**, **Últimos 30 dias**, **Mês atual** ou **Período personalizado**) e, se precisar, filtre por produto e fornecedor. No período personalizado, os dois dias informados entram no cálculo. **Mês atual** começa no primeiro dia do mês.

A tela consulta os dados ao abrir e ao mudar os filtros. O botão **Comparar período anterior** coloca os números ao lado dos de outro intervalo com a mesma duração. O CSV reúne o período, a posição atual do estoque, o resumo financeiro e as movimentações.

#### Indicadores

- **Entradas / saídas:** número de operações e unidades recebidas/retiradas no período. Ajustes aparecem separadamente.
- **Ajustes:** quantidade de operações de ajuste no período.
- **Venda estimada do saldo:** saldo atual multiplicado pelo preço de venda atual; potencial de receita, não receita recebida.
- **Total comprado:** custo das entradas reais no período (quantidade × custo unitário).
- **Custo das saídas:** custo das unidades baixadas em saídas, calculado pelos lotes FIFO.
- **Receita registrada:** valor das saídas registradas com preço de venda.
- **Margem realizada:** receita menos custo FIFO das saídas. É o indicador de resultado já vendido/registrado.
- **Custo do estoque restante:** custo conhecido dos lotes ainda disponíveis hoje. Pode mostrar pendência se houver unidades sem custo confiável.
- **Margem estimada do saldo:** projeção de venda futura menos custo conhecido do saldo restante; não é lucro realizado.

#### Gráficos

- **Movimentação no período:** compara unidades recebidas e retiradas, respeitando período e filtros atuais.
- **Valores do período:** compara total comprado, custo das saídas FIFO, receita registrada e margem realizada. A barra de **Margem realizada** é o resultado de vendas lançadas; para consultar quais produtos compõem esse valor, clique no cartão de margem.
- **Gráfico da Visão geral:** mostra unidades de entrada e saída em cada dia dos últimos sete dias. Não representa valores em reais nem lucro.

#### Detalhes por produto

Clique em **Margem realizada** para consultar produtos com vendas e ver compras, quantidades compradas, vendas, quantidades vendidas, custo FIFO, receita e margem por produto. Clique em um produto para abrir o histórico detalhado. Nesse detalhe, o período pode ser alterado e o histórico completo pode ser consultado.

Clique em **Margem estimada do saldo** para ver unidades com custo conhecido, unidades pendentes, custo restante, venda potencial e margem estimada por produto. Cotações, ajustes e valores de compra não vendidos não são classificados como lucro realizado.

A posição atual mostra produto, saldo, mínimo, preço de venda atual e custo conhecido dos lotes restantes. O saldo e o custo remanescente representam a situação de hoje, mesmo quando o filtro de período é menor; os indicadores de movimentação e vendas obedecem ao período selecionado.

### 10. Auditoria (administrador)

Registra ações e movimentações realizadas, incluindo data/hora, usuário, ação, tipo de registro, identificador e detalhes. A busca filtra os eventos. A auditoria ajuda a rastrear alterações, inclusive correções e estornos; não é um relatório de vendas.

### 11. Configurações

Para trocar sua senha, informe a senha atual, a nova senha e a confirmação. A nova senha precisa ter pelo menos 12 caracteres. A troca pode ser feita a qualquer momento; não há exigência de alteração no primeiro acesso.

## Rotinas do dia a dia

### Configuração inicial do catálogo

1. Cadastre as categorias usadas pelo armazém.
2. Cadastre os fornecedores, incluindo os contatos confirmados.
3. Cadastre cada produto uma única vez, escolhendo unidades de compra e venda e o fator de conversão.
4. Abra a ficha do fornecedor e vincule os produtos que ele vende. A ação **Fornecedores e preços**, no produto, permite comparar os valores.
5. Se já houver saldo, informe a quantidade e o custo por embalagem de compra. Fornecedor e preço de venda podem ficar para depois. Defina o preço antes de vender. Se houver saldo antigo com custo pendente, regularize-o em **Relatórios → Informar custo**.

### Registrar uma compra e acompanhar seu resultado

1. Abra **Movimentações**, a ficha do fornecedor ou a ação de movimentação do produto.
2. Escolha **Compra / entrada** e informe produto, fornecedor, quantidade, custo, venda e data.
3. Confira a conversão da embalagem e o resumo da compra antes de salvar.
4. Depois de salvar, confira o lote no histórico do produto/fornecedor e a compra na comparação de fornecedores e nos relatórios.

### Registrar uma venda e conferir lucro

1. Confira o preço no cadastro do produto e registre a retirada como **Saída**.
2. O custo da saída será apurado consumindo lotes antigos primeiro.
3. Em **Relatórios**, consulte **Receita registrada**, **Custo das saídas** e **Margem realizada**.
4. Clique em **Margem realizada** para localizar o resultado por produto e abrir suas vendas detalhadas.

## Dúvidas frequentes

- **Compra e cotação são diferentes:** compra é uma entrada que atualiza saldo e cria lote; cotação é apenas um preço informado e não mexe no estoque.
- **Produto é único; fornecedor pode variar:** o mesmo cadastro de produto pode estar vinculado a vários fornecedores, cada um com histórico próprio.
- **Custos por lote:** entradas com custos diferentes não são mescladas; FIFO mantém a ordem de consumo.
- **Margem não é faturamento:** margem realizada desconta custo FIFO da receita registrada, mas não outras despesas, impostos ou taxas que o sistema não acompanha.
- **Saída é tratada como venda:** no estado atual, uma saída entra na receita usando o preço atual cadastrado do produto. Retiradas não comerciais ainda não têm uma categoria própria.
- **Projeção não é venda:** margem e venda estimadas do saldo mostram um cenário futuro usando preço atual, não dinheiro recebido.
- **Fotos e dados:** imagens aceitas são JPEG, PNG ou WebP de até 5 MB; cadastros e operações ficam no banco, enquanto fotos ficam em armazenamento persistente separado.
- **Planilha de inventário:** o arquivo modelo serve para organizar a contagem. Os produtos ainda precisam ser cadastrados pela interface; não há importação de CSV.

