# ADR-009 — Classificar falha de turno pelo estado de protocolo, com os quatro sinais como colunas write-ahead e o desfecho virando item na fila

**Frente** Execução · **Status** decidido · **Épicos** E9, E5, E3, E8, E7

## Decisão

No restart e em qualquer morte de turno, decidir se pode reenviar a partir de quatro sinais booleanos PERSISTIDOS EM COLUNAS durante o turno — attempted, rejected, promptSubmitted, producedOutput — reenviando apenas na classe 'before-accept'; 'unknown' é tratado como 'after-accept'. promptSubmitted é gravado em write-ahead ANTES do envio ao provedor. O contador de reenvio é uma coluna persistida, não unicidade emergente. E a transição para FALHO escreve, NA MESMA TRANSAÇÃO, a entrada na fila da Frota com a frase que nomeia o que foi interrompido e o que a pessoa precisa decidir.

## Contexto

E9.1 e E9.2 são P0 e exigem classificação por quatro sinais com teste que falha se a string de erro influenciar o resultado, contador de reenvio persistido, e — o que nenhuma frente modelou — 'a pessoa vê na fila da Frota uma entrada explicando o que foi interrompido e o que ela precisa decidir, em vez de silêncio'. Com dados de menores, um turno reexecutado envia a mesma mensagem duas vezes ou grava o mesmo dado duas vezes.

## Alternativas rejeitadas

### Regex sobre a mensagem de erro do provedor

O próprio arquivo de referência rejeita por escrito: 'strings de erro de provedor são prosa: são reescritas entre releases, são localizadas, e uma decisão de retry que depende de um regex sobre elas é um efeito colateral duplicado esperando por uma revisão de texto do fornecedor' (server/resume-recovery.ts, cabeçalho). E9.1 exige teste que falhe se a string influenciar.

### Idempotência de efeitos em cada ferramenta, tornando replay seguro

Só funciona para os efeitos que nós controlamos. O agente executa MCP de terceiros e escreve em sistemas de cliente; não há como garantir chave de idempotência do outro lado. Vale como defesa em profundidade nas ferramentas próprias, não como substituto.

### Nunca reenviar: toda morte de turno vira falha visível

Bricka a thread no caso mais comum. O comentário em claude.ts:1735-1742 descreve: um cursor de sessão que o provedor não honra mais, sem caminho de recuperação, faz TODO turno seguinte falhar identicamente e 'o usuário não tem volta a não ser trocar de motor'.

### Unicidade do reenvio garantida emergentemente (o relançamento não oferece cursor, logo attempted fica falso)

É o que o OpenMausBot faz (claude.ts:1741-1742) e E9.2 exige a versão durável: 'o contador de reenvio é PERSISTIDO — um segundo restart não reenvia de novo'. Garantia emergente é exatamente o que este documento recusa em todos os outros pontos.

## Evidência

server/resume-recovery.ts inteiro (84 linhas) é a especificação: ResumeAttemptState (linha 30) com os quatro campos; classifyResumeFailure (linha 43) com duas linhas de corpo; mayReplay (linha 53) só libera before-accept. CORREÇÃO DECISIVA: os quatro sinais NÃO são gravados de forma durável. No único ponto de uso real (server/drivers/claude.ts:1744-1749) são DERIVADOS de dois campos em memória do processo — session.sawInit e session.turn.sawStreamDelta (claude.ts:954 e 962, dentro de um Map em claude.ts:969). Grep por classifyResumeFailure no servidor inteiro dá só claude.ts. O mecanismo do OpenMausBot resolve restart do CLI, não do SERVIDOR — que é o caso do nod no PaaS.

## Consequências

- Os quatro booleanos viram colunas escritas durante o turno. Sem isso, o restart do container perde a evidência e toda falha cai em 'unknown' — seguro, mas transforma cada deploy em turnos perdidos.
- promptSubmitted gravado DEPOIS do envio registra 'não enviei' para um turno que enviou — exatamente o bug que a classificação existe para impedir. Write-ahead é obrigatório.
- 'unknown' tratado como 'after-accept' faz do caminho seguro o caminho comum, e obriga a UI a ter resposta boa para 'não sei o que aconteceu' — que é E5.2: nomeia o que falta e quem destrava, e NÃO tenta de novo.
- A escrita do item na fila na mesma transação é o que liga E9 a E3 e E5, e é a diferença entre 'seguro' e 'seguro e visível'.
- O SPI (ADR-012) precisa OBRIGAR o Adapter a reportar os quatro sinais. Do jeito que o contracts.ts original está, cada driver reimplementa a retomada e só um o fez.
- LACUNA OPERACIONAL QUE NENHUMA FRENTE COBRIU: indisponibilidade do provedor (a Anthropic fora por 40 minutos) é seguramente 'before-accept' e precisa de classe própria — senão 40 minutos de trabalho de 70 clientes viram parada manual, que é um sábado inteiro de destravamento para 3 engenheiros.

## Reversibilidade

cara, e não pelo código, que é pequeno, mas pelos dados. Nascer sem os quatro sinais persistidos deixa a trilha de E8 com buraco permanente sobre o que foi ou não executado naquele período. Colunas de write-ahead são baratas agora e impossíveis de retroagir.

## Revisitar quando

No primeiro relato de efeito duplicado: o diagnóstico é qual dos quatro sinais estava errado e por quê. E se um driver futuro não conseguir distinguir os quatro estados, ele declara isso e cai sempre em 'unknown' — nunca finge que sabe.

