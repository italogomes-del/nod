# ADR-142 — Passagem por coluna: a coluna tem responsável, e entrar nela aciona

Status: aceita (2026-11-02, NOD-417; a PM aceitou na revisão do PR #622) · Revisa a [ADR-140](adr-140-colunas-do-quadro-por-grupo.md) (decisão 2: quem é acionado).

## Contexto

Na ADR-140 a coluna só dizia o comportamento pelo grupo; quem trabalhava era sempre o responsável da tarefa. Para um
fluxo em etapas (fazer → revisar → testar), a pessoa precisava mudar o responsável à mão a cada passo. O pedido é a
passagem no estilo Multica: cada coluna pode ter um agente e uma instrução, e a tarefa que entra nela vai para ele.

## Decisão

1. **A coluna ganha `responsavel` (id de agente ou null) e `instrucoes` (até 500).** Ficam no mesmo jsonb
   `quadros.colunas`, sem migração; coluna sem os dois campos é igual a antes, e as padrão continuam "padrão" só sem
   eles. Só aceitam passagem as colunas de não iniciado e de andamento (Backlog, A fazer, Fazendo, Revisão e as da
   pessoa nesses grupos); Bloqueado, Precisa de você, Cancelado, Feito e Fechado nunca têm (`aceitaPassagem`).
2. **Entrar numa coluna com responsável passa a tarefa a ele; ele é acionado só onde a coluna aciona**
   (`acionaNaColuna`, emendado na revisão 3 do PR #622): A fazer e as colunas de andamento, inclusive Revisão. Em Não
   iniciado só A fazer aciona: no Backlog e nas colunas da pessoa desse grupo a tarefa passa ao responsável sem
   acioná-lo, e entrar nelas para o turno vivo da tarefa. A tarefa fica na coluna (Revisão não vira Fazendo); A fazer
   segue levando ao andamento, como na ADR-140 ("entrar em A fazer aciona" fica). O passo que nomeia um agente explicitamente vence a passagem. As tarefas que já estavam na
   coluna quando a passagem foi definida não mudam de mão. O bot que move a própria tarefa para a coluna que já é dele
   não se reaciona (só pelo `terminei`).
3. **`terminei`** fecha a etapa: a tarefa vai para a próxima coluna da ordem (pulando Precisa de você, Bloqueado e
   Cancelado) e, se ela tiver responsável, ele começa. Sem tarefa explícita, vale a do turno de quem chama. Sem próxima
   coluna (já no fim do andamento), é erro com a frase de por quê. Na próxima sem passagem, o responsável continua e não
   é reacionado.
4. **O mesmo caminho de mudança de status.** A passagem por entrada, o `terminei` e o "Não iniciar ainda" da tela são
   o `mudar_tarefa` de sempre dentro do `planejarLote` (lote travado, tudo ou nada, Desfazer), para as travas e o
   histórico de movimentos verem toda mudança. `sem_iniciar` move e passa ao responsável sem acionar (`semAcionar`).
5. **`definir_passagem`** é um passo de coluna: só a pedido da pessoa (na tela ou num turno de conversa limpo), como
   criar ou renomear coluna. A instrução da etapa é da pessoa e vai ao responsável fora da cerca `<tarefa>`.
6. **Tela**: o cabeçalho mostra o nome do responsável (cinza) ou o "Passar para…" só no hover; o popover tem "Sem
   passagem — o responsável continua" / "Passar para um agente — começa na hora" (onde a coluna aciona; nas outras,
   "passa para ele, sem acionar"), o agente e "O que essa etapa faz"; a descrição do `definir_passagem` diz o mesmo.
   Soltar o card numa coluna com responsável pede "Confirmar · Não iniciar ainda" (Confirmar é o padrão) num card
   discreto no lugar do card, dentro da lista da coluna de destino: sem modal, sem popover e sem botão cheio
   (`role="group"`, dois links, foco no Confirmar, Esc cancela). O "Mover para…" do card (teclado e toque) leva à
   mesma confirmação.

## Emenda (2026-11-02, revisão do PR #622): o pedir_a_bot com a tarefa

O `pedir_a_bot` com `tarefa` grava o pedido como comentário do remetente na tarefa e aciona o colega por ele, sem
trocar o responsável. Fora isso é o mesmo pedido do caminho sem tarefa: o `handoff` fica na conversa de quem pede e o
`peer_pedido` no turno de quem recebe, então a espera circular, o `ja_pedido`, o painel e o varredor de esperas o veem; a
mensagem da pessoa vai na entrada do colega; e o resultado volta a quem pediu pela entrega de sempre (`peer_ask` e
retomada do turno que pediu) quando o turno do colega acaba. O comentário do colega na tarefa não aciona o remetente
de novo, para não haver dois trabalhos pela mesma resposta. O turno do colega na fila só recebe o pedido se não atende
o pedido de outro bot. `tarefa_id` é sempre o turno do colega. Erros distintos, sem gravar nada: `experimento_desligado`,
`sem_quadro`, `tarefa_invalida`, `colega_fora_do_quadro` (colega de outro dono, que não está no quadro da pessoa).
`colega_nao_acionado` (o colega não ganhou turno) também é tipado; nesse caso o comentário fica na tarefa, mas nenhum
pedido aberto é registrado. A cota da IA do colega é conferida como no pedido sem tarefa: na reserva ou no limite, a
instrução diz a quem pediu que ele ainda não começa e até quando. O mesmo critério de juntar vale no lote: o início da
tarefa não se junta a um turno que atende o pedido de outro bot, e o turno juntado fica com a maior profundidade.

A trava do `terminei` vale também para o `mudar_tarefa` com status: o bot que não é o responsável, num turno com
conteúdo de fora, muda a tarefa de coluna (a passagem troca o responsável), mas não aciona ninguém por isso.

Revisão 3 do PR #622: a trava compara com o responsável do INÍCIO do lote, e num turno com conteúdo de fora o bot não
se toma uma tarefa (de outro bot ou sem responsável) nem cria uma para si, em lote nenhum: sem isso, se atribuir e depois
mandar `terminei` ou o status, no mesmo lote ou na chamada seguinte, contornava a trava. O comentário do colega que
atende um pedido do responsável nessa tarefa (o `peer_pedido` do turno dele) não aciona o responsável: a resposta volta
pelo peer.

Revisão 4 do PR #622:
- Num turno com conteúdo de fora, entrar na coluna cujo responsável é o próprio autor, com uma tarefa que não era dele
  (ou criando uma ali), é recusado como "se tomar a tarefa": senão a passagem o fazia responsável e o `terminei`
  seguinte acionava a próxima etapa. Vale para `criar_tarefa`, `mudar_tarefa` e `importar_linear`.
- No mesmo turno, a troca explícita de responsável (`agente` no passo) numa tarefa que não era do autor muda a tarefa,
  mas não aciona ninguém, como a passagem. No turno confiável e para a dona da tarefa, a troca de mão aciona (NOD-418).
- `acionaNaColuna` exclui Precisa de você e Bloqueado, como o `andando`: lá ninguém começa.
- O pedido do responsável ao colega que comenta é achado pela tarefa e pelo par responsável → colega, enquanto está
  aberto (`pedidoAbertoSql`), não pelo turno de quem comenta: a retomada do turno do colega também não reaciona o
  responsável. Respondido o pedido, o comentário do colega volta a acioná-lo.
- No `pedir_a_bot` com a tarefa, a @menção no texto do pedido não aciona nenhum bot além do alvo: o pedido é a ele.
- **Decisão (suposição para a Ada confirmar):** o comentário só aciona o responsável quando a tarefa está numa coluna
  em andamento (grupo iniciado, fora Precisa de você e Bloqueado). Em Não iniciado (Backlog, A fazer) e Encerrado
  (Feito, Cancelado) o comentário fica na tarefa sem acionar o responsável, e o resultado diz isso (a tarefa, a coluna
  e quem não foi acionado). A @menção segue acionando o mencionado em qualquer coluna.

## Gatilho de reversão

Se a passagem acionar agentes que a pessoa não esperava (Desfazer logo depois de mover para uma coluna com
responsável em mais de 1 a cada 5 casos, ou queixa do mesmo tipo), volta a regra da ADR-140 (coluna não muda o
responsável) e a passagem passa a ser só uma sugestão no card.
