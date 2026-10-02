# Evidências do roadmap

Capturas e material trazidos pelo dono do produto que motivam as jornadas. Servem de âncora concreta
para o "porquê" de cada jornada.

## E-02-a — Bots chamando bots (Marola coordena Ressaca e Review)

**Arquivo:** [jornada-02-bots-chamando-bots-marola-pr399.png](jornada-02-bots-chamando-bots-marola-pr399.png)
· **Trazida em:** 2026-09-16 · **Motiva:** [Jornada 02](../jornada-02-bots-se-chamam.md)

Print de um app de chat no estilo do OpenMausBot / Grok Bot, com **bots como contatos** na barra
lateral, agrupados por time (Produto & Engenharia, QA, Dev 1–7, Organização, ClickUp, Marketplace).
Rotinas na coluna da direita ("Dev Prod idle check", "Resumo semanal Acme — toda segunda").

O que a conversa mostra (o cenário que o dono diz ter vivido "o tempo todo"):

- **A pessoa pergunta ao Marola (Tech Lead):** *"399 já foi mergeado?"*
- **O Marola, para responder, NÃO responde sozinho — ele aciona dois bots:** *Ressaca* e *Review*
  (aparecem `→ Ressaca`, `→ Review` e @menções ao longo do fio).
- **Ressaca responde** confirmando o merge do #399 (~14:35 UTC), aponta um **Workflow**
  (`acme-releases`) que falhou nas migrations 0124→0126 e num script de reclassificação, e
  **pergunta de volta** se deve rodar o release de novo.
- **Review responde** sobre outro PR (#409): squash merge, approve bloqueada, etc.
- O Marola sintetiza e devolve à pessoa.

**Por que é evidência:** é bot-a-bot **interativo** (delegação + @menção + handoff + workflow +
pergunta de volta), guiado pelas **instruções de cada bot** (o que faz, o que não faz, quem pode
procurar). É a experiência que o Grok Bot promove e que o OMB **não** implementa (o OMB só tem
"channels" organizacionais). O nod já tem os **primitivos** disso no domínio — falta a experiência.

> Observação: partes do texto do print estão borradas/parciais; a descrição acima registra só o que
> é legível com segurança.
