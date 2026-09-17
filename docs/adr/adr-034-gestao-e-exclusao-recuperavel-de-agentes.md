# ADR-034 — Gestão de agentes e exclusão recuperável

Status: aceito em 2026-09-17.

A referência de produto é o [menu enviado pela pessoa e a documentação oficial do Grok Bot](https://docs.x.ai/grok-bot/bots).
Ocultar preserva o trabalho e não pausa rotinas. Duplicar reaproveita a configuração, sem histórico
ou memória. Excluir precisa retirar o agente de operação, não apenas da lista.

## Decisão

- Menu na barra lateral (botão e clique direito) e no chat; teclado com setas e Escape.
- Nome, título, missão, modelo, forma e cor editáveis. Salvar missão/título é confirmação explícita
  do perfil. Propostas do modelo continuam exigindo a confirmação existente.
- Fixação, seção e marcação manual de não lido persistem no servidor. Abrir o chat limpa a marcação.
  Seções são nomes atribuídos a bots; nascem ao mover o primeiro bot e desaparecem quando vazias.
- Só a dona altera a organização/perfil ou exclui/restaura. Bots visíveis da equipe podem ser
  copiados para um novo agente, sem herdar permissões. O dono do novo recurso é quem o cria.
- Duplicar mantém o avatar, corrigindo a regra anterior de gerar outra forma/cor. Também copia
  rotinas, **pausadas e com aprovação ligada**. Não copia concessões, memória, mensagens, sessão do
  CLI, fixação, seção ou estado de leitura. Nome com sufixo respeita o limite de 60 caracteres.
- Exclusão é recuperável: `excluido_em` retira o perfil da frota ativa e bloqueia novos trabalhos.
  A gestão separa ativos, ocultos e excluídos. Não há purga definitiva nesta rodada.
- Excluir pausa rotinas próprias, revoga concessões próprias, interrompe turnos próprios pendentes,
  solicita parada dos que estão rodando e encerra propostas/decisões próprias pendentes. Arquivos,
  contas conectadas e efeitos externos já realizados são preservados.
- Restaurar recupera perfil e histórico; não devolve concessões nem reativa rotinas automaticamente.
  A trilha de auditoria é preservada. Exclusão recuperável não é uma promessa de apagar dados pessoais.

## Concorrência e escopo

Migrações 0011 e 0012 adicionam metadados às tabelas já escopadas. Nenhuma policy é ampliada.
O agente tem uma geração de execução, incrementada ao excluir. Turnos capturam essa geração na
criação; rotinas a capturam na criação/ativação. A fila, o lease e o gate de ferramentas recusam
trabalho de gerações antigas. A agenda apresenta rotinas antigas como pausadas até ativação explícita.
Isso protege inclusive turnos/rotinas de outra pessoa sobre um agente de equipe, sem escrever fora
do escopo de quem excluiu. Decidir uma aprovação antiga também não revalida seu turno.

Triggers de criação/ativação e exclusão usam a mesma trava consultiva por tenant/agente. A leitura
sob RLS continua normal: `SELECT FOR SHARE` exigiria também a policy de escrita e impediria uma
pessoa de trabalhar com um agente de equipe que ela pode ler. Não usamos SECURITY DEFINER nem
mudança temporária de identidade para contornar as policies.

O limite de interrupção é o mesmo do restante do nod: um efeito externo já em execução pode terminar.
A interface informa isso ao confirmar exclusão. Restaurar não revalida tokens/planos de gerações antigas.

## Validação

`tests/integration/gestao-agentes.test.ts` cobre o ciclo, cópia, isolamento de dono e geração entre
pessoas. `tests/concurrency/gestao-agentes-http.test.ts` verifica os endpoints reais. O roteiro visual
está em [UAT da gestão](../uat-gestao-agentes.md).
