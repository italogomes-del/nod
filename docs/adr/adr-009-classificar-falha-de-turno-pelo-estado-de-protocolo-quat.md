# ADR-009 — Classificar falha de turno pelo ESTADO DE PROTOCOLO, quatro sinais booleanos

**Status** revisado

## Decisão

Mantidos os quatro sinais (attempted, rejected, promptSubmitted, producedOutput) como colunas write-ahead obrigatórias, com promptSubmitted gravado ANTES do envio ao provedor. Acréscimo exigido pela ponte: os sinais são gravados na MÁQUINA e viajam ao servidor junto com cada renovação de lease, não só no fim do turno — porque agora o turno roda noutro processo, e sinal que não viajou é sinal perdido. Morte por lease vencido é mais uma causa de morte de turno, não um caminho paralelo: com promptSubmitted=true classifica 'after-accept' e nunca reenvia; com tudo falso é 'before-accept' e mesmo assim NÃO reenvia sozinho — vira item na fila com botão.

## O que mudou

O transporte dos sinais. Antes o turno rodava no mesmo processo que escrevia no banco; agora atravessa a ponte.

## Por quê

O ADR já resolvia 'morte de turno'; laptop fechado é morte de turno com outra causa. O que muda é só o transporte. E o openmausbot chegou à mesma regra pelo lado da mensagem de erro: 'An in-flight action may have completed; inspect before retrying' — desfecho desconhecido tratado como perigoso é o 'unknown vira after-accept' que este ADR já tinha.

