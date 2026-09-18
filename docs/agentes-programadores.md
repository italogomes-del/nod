# Agentes programadores: experiência e diagnóstico

Definido em 2026-09-18 a partir do teste do MetaNod: programar é um caso de uso das
capacidades gerais do Nod. Este documento registra diagnóstico e aceite, não um
modo de execução por área. Trocar Claude Code por Codex deve preservar projeto, arquivos, autorização,
histórico e capacidade de executar testes. A escolha do harness muda o executor,
não o acesso ao projeto.

## Diagnóstico do comportamento atual

O driver Claude desabilita ferramentas nativas com `--tools ""`; o driver Codex
desabilita shell e edição nativos. Ambos recebem o catálogo do plano pelo proxy
MCP. Isso permite oferecer ferramentas comuns, mas conectar uma conta de IA não
concede por si só acesso a um projeto.

O computador do bot já oferece terminal e arquivos comuns aos dois harnesses.
Seu catálogo depende de `services.computadores`, habilitado pela infraestrutura
Docker. O workspace desse computador é separado do Mac e não contém
automaticamente seus repositórios. Não existe hoje uma configuração de agente
para liberar Read/Edit/Bash numa pasta do Mac. A sugestão nos prints não
correspondia a uma funcionalidade implementada.

## Fluxo a implementar

1. A pessoa pede uma tarefa de programação na conversa.
2. Quando falta um projeto, o Nod oferece a associação do projeto ali mesmo.
   A escolha é lembrada; não se exige navegar por configurações de ferramentas.
3. O agente inspeciona a estrutura, implementa, executa os testes adequados e
   apresenta alterações e resultados verificáveis. Pergunta apenas o que não
   conseguir descobrir no projeto.
4. A pessoa pode trocar de harness e continuar no mesmo projeto. O Nod resolve
   as capacidades autorizadas novamente para o próximo turno.

O projeto precisa identificar também a máquina que o hospeda. Uma pasta no Mac
não pode ser interpretada como uma pasta de mesmo nome no servidor. Conforme a
[ADR-038](adr/adr-038-padroes-e-escolhas-da-pessoa.md), o padrão para uma tarefa
independente em Git é um worktree, com reutilização nas continuações. Pedidos
explícitos de pasta, branch ou trabalho sem worktree prevalecem sobre esse padrão.
Worktrees também podem ficar no Mac; localidade e organização dos arquivos são
escolhas distintas. A implementação do fluxo de acesso continua pendente.

## Critérios de aceite da implementação completa

- Criar um agente programador e associar um projeto na conversa, sem configurar
  flags de CLI ou listas de ferramentas.
- Ler, buscar, editar e testar o mesmo projeto usando Claude Code e Codex.
- Trocar de harness entre tarefas e encontrar as alterações anteriores.
- Criar o worktree automaticamente para tarefa independente e reutilizá-lo nas
  continuações; respeitar a pasta/branch indicada no prompt sem exigir menus.
- Informar uma capacidade indisponível no harness escolhido sem trocar
  silenciosamente de fornecedor ou ignorar a forma de trabalho solicitada.
- Diferenciar projeto ainda não associado, computador desconectado e falha de
  execução, com uma ação concreta no produto quando existir.
- Respeitar o projeto e a máquina autorizados, revogação, isolamento entre pessoas
  e Parar; não abrir acesso a todo o Mac por conectar um executor.
- Não exigir uma nova aprovação para cada edição/teste normal de uma tarefa já
  autorizada. Publicação e alterações externas respeitam a autorização da pessoa.
- Validar arquivo alterado, diff e resultado de teste, além de conferir a montagem
  das ferramentas. Testes de configuração sozinhos não homologam programação real.

## Alteração inicial

O prompt comum orienta o agente a escolher os passos para o resultado pedido,
respeitar instruções explícitas, verificar resultados, usar o catálogo atual em
vez de memórias de limitações antigas e não inventar configurações para liberar
ferramentas. A orientação específica de programação foi retirada após a revisão
arquitetural: não deve ser necessário acrescentar instruções ao núcleo para cada
área de trabalho. A regressão
`tests/unit/executor/programacao-harnesses.test.ts` confere que os dois drivers
recebem as capacidades do plano e não acrescentam capacidades ausentes.

Essas alterações não implementam ainda a associação do projeto nem habilitam o
acesso à pasta local. Os critérios acima continuam pendentes até a entrega desse
fluxo e sua validação funcional.
