# UAT — gestão de agentes

Execução em 17/09/2026. Base: `main` após merge do PR 18 (`14b2f90`).
Interface em `http://localhost:5276`, API 8889, banco `nod_test`, tenant e pessoa exclusivos
“UAT Gestão de Agentes”, executor catcher. Nenhum agente real foi alterado e nenhum serviço externo
recebeu mensagens. A gestão não depende de um turno do modelo.

## Roteiro e evidências

| ID | Passos e critério de aceite | Resultado observado |
|---|---|---|
| G01 | Abrir menu por ••• e clique direito; navegar com setas e fechar com Escape. | Aprovado na interface: ações do print disponíveis; seta move foco para Mover para; Escape fecha. |
| G02 | Renomear e reabrir o agente. | Aprovado na interface: Frida virou “UAT Gestão”; lista, cabeçalho e composer atualizaram. |
| G03 | Editar título, missão, cor e forma; salvar. | Aprovado após correção: “Design e testes”, missão UAT, círculo azul; salvar retira aviso de perfil não confirmado. |
| G04 | Fixar e desafixar. | Aprovado na interface: aparece em Fixados; ao desafixar volta à seção atribuída. |
| G05 | Mover para nova seção e depois deixá-la vazia. | Aprovado na interface: Design UAT criada com um bot; limpar campo e salvar devolve a Meus agentes e elimina seção vazia. |
| G06 | Marcar não lido; abrir o chat. | Aprovado na interface: ponto azul aparece e é removido ao abrir. Estado também validado no banco. |
| G07 | Duplicar perfil; verificar nova conversa e independência. | Aprovado na interface e banco: “UAT Gestão (cópia)” com mesmo perfil/avatar, conversa própria, sem histórico ou acessos copiados. |
| G08 | Copiar ID da conversa. | Aprovado na interface: ID do campo foi comparado com o clipboard e coincidiu. |
| G09 | Ocultar; abrir Gestão; mostrar novamente. | Aprovado na interface: cópia saiu da lateral, apareceu em Ocultos e voltou pelo menu. Aviso explica que ocultar não pausa. |
| G10 | Cancelar exclusão; depois confirmar somente no bot descartável. | Aprovado na interface: cancelar manteve a cópia; confirmar a moveu para Excluídos e removeu da lista ativa. |
| G11 | Restaurar e recarregar a página. | Aprovado na interface: cópia voltou à lista; os dois perfis e a organização persistiram. |
| G12 | Excluir bot com rotina, concessão e turno pendente; tentar executar; restaurar. | Aprovado automatizado: fila interrompida, acesso revogado, agenda pausada, envio negado; histórico preservado, sem reativação implícita. |
| G13 | Duplicar bot com rotina e nome de 60 caracteres. | Aprovado automatizado: nome dentro do limite, avatar preservado, rotina própria pausada, gate ligado, sem memória/histórico/concessões. |
| G14 | Outra pessoa tenta organizar/excluir/restaurar um agente de equipe. | Aprovado automatizado: negado; chamada direta de repositório também não altera a linha sob RLS. |
| G15 | Excluir/restaurar agente que tem fila e rotina pertencentes a outra pessoa. | Aprovado automatizado: geração antiga continua bloqueada; rotina só volta após ativação explícita da dona. |
| G16 | Usar endpoints reais com seção inválida, leitura inválida e ID malformado; excluir e tentar enviar/duplicar. | Aprovado automatizado: respostas 400/404 e ciclo completo de gestão pelo HTTP real. |

## Correções e decisões encontradas pelo aceite

- Perfil salvo manualmente ainda parecia pendente: a edição explícita de missão/título agora o confirma.
- O teste antigo exigia avatar diferente na cópia; foi atualizado para a regra da documentação oficial.
- Trava de linha no trigger impedia leitura de agente da equipe sob RLS: trocada por trava consultiva,
  sem ampliar policies. O teste entre duas pessoas passou.
- Membership de salas continua visível conforme o grant original; o bloqueio de execução acontece
  no agente/fila, sem reduzir indevidamente a leitura da sala por quem recebeu acesso.

## Repetir

Gate final aprovado: `npm run check` (354 unitários, 213 de integração, 49 de conformidade e 42 de
concorrência; 658 testes), `npm run uat:gestao` (8 testes) e `npm run build`. A repetição do gate usou
`VITEST_MAX_THREADS=2 VITEST_MAX_FORKS=2` por carga concorrente na máquina; a primeira execução
interrompeu por timeout de 5 s no teste de contratos, que passou na repetição sem mudar seu limite.

Usar Node 24.19.0, preparar `.env` e aplicar `npm run db:migrate:test`. Executar:

```sh
npm run uat:gestao
npm run check
npm run build
```

O comando dedicado reúne cinco testes de integração, um HTTP com servidor completo e dois unitários
sobre duplicação. Para os UATs visuais, criar um bot descartável, seguir a tabela e deixar qualquer
rotina criada pausada. O aceite visual não exige Claude Code nem consome assinatura.

## Instalação

Aplicar `npm run db:migrate` antes de iniciar esta versão no banco da aplicação. As migrações são
aditivas (0011 e 0012); o banco normal não foi alterado para esta prévia. As alterações de desktop no
checkout principal foram preservadas; a implementação está no worktree `/tmp/nod-gestao`.
