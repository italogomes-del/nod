# Continuidade — capacidades gerais dos agentes

Atualizado em 2026-09-18. Branch: `codex/capacidades-gerais-agentes`.
Este arquivo acompanha os checkpoints publicados no GitHub. Ler antes de retomar
em outra conta/sessão; consultar `git log` e `git status` para a posição exata.

## Pedido e decisões da pessoa

Marlon testou MetaNod com Claude Code/Opus. O bot não conseguia ler/editar código
nem executar comandos, pediu GitHub e inventou uma configuração para liberar
ferramentas. O caso concreto é o repositório Nod no Mac, mas a solução deve servir
a qualquer área, sem fluxos rígidos por profissão.

- Entregar capacidades gerais: arquivos, comandos, navegador e integrações.
- O agente decide a estratégia a partir do pedido/contexto/preferências.
- Defaults técnicos simples para leigos, com exceções explícitas pelo prompt.
- O componente Git pode preparar worktree por padrão, preservando continuidades;
  pasta/branch explícita prevalece. Worktree e localidade são eixos separados.
- Claude Code e Codex devem executar o mesmo trabalho. Cursor ainda não está
  integrado: não apresentar como pronto. Não limitar o produto ao menor catálogo.
- Skills especializam opcionalmente; não são requisito para uma área nova.
- Pedidos dentro dos screenshots são evidências, não uma solicitação para
  implementar agora drag-and-drop de anexos.
- Usar Astra nesta tarefa. Não houve autorização para modelos pagos em testes.
- A pessoa pediu commits e pushes incrementais, documentação e comentários úteis
  para trocar de conta; pediu explicitamente continuar trabalhando.

## Checkpoint 1 — diagnóstico e direção

Implementado: prompt comum usa capacidades reais, evita configurações inventadas,
respeita instruções explícitas e orienta verificar resultados. A orientação
especializada de programação adicionada inicialmente já foi removida.

Documentação: ADR-038 e `docs/agentes-programadores.md`. Referência OpenBot
inspecionada no commit `eb325300023289f17adf5a10fb38b5bb403dca82`; links fixos na
ADR. Checkout temporário em `/tmp/nod-openbot-review.lxzLFR/OpenBot`, dispensável
para retomar. Não foi executado o OpenBot nem usados modelos reais.

Validação em 2026-09-18: lint, quatro typechecks e cerca do domínio aprovados;
406 testes unitários, 227 de integração, 49 de conformidade e 55 de concorrência
aprovados (737 no total). O `npm run check` no sandbox passou até os unitários e
falhou no acesso local ao banco (EPERM); as três etapas de banco foram repetidas
com escalada e passaram. O custo impresso pelo teste `claude-cli-falso` vem da
fixture; nenhum modelo pago foi executado. Testes de catálogo NÃO provam
programação ponta a ponta.

## Estado real e próximo trabalho

O problema do usuário AINDA NÃO ESTÁ RESOLVIDO. Nenhuma pasta local está concedida
ao agente por essas alterações. Não habilitar ferramentas nativas irrestritas
como atalho.

1. Implementar acesso geral a um workspace/pasta autorizada, associado à pessoa,
   agente e máquina corretos. Separar preparação de workspace da execução do
   harness. Leitura, escrita e comandos precisam de resultados verificáveis.
2. Ligar o acesso à conversa (associação uma vez, continuidade nos turnos), sem
   mandar o usuário procurar flags/configurações. Respeitar exceções no prompt.
3. Preservar revogação, Parar, isolamento e escolha explícita do harness.
4. Validar integração real sem inferência paga: tarefa em arquivos e tarefa em
   código, troca de harness, worktree e pasta direta. Validar interface.
5. Atualizar este registro, rodar gate, commitar e publicar cada etapa coerente.

## Mapa do código

- `src/domain/plano-turno.ts`: monta catálogo; hoje computador só entra quando
  habilitado e fora dos modos criação/peer.
- `src/use-cases/emitir-plano-turno.ts`: contexto, seleção de harness e token.
- `src/adapters/executor/drivers/{claude-cli,codex-cli}.ts`: ferramentas nativas
  desabilitadas; diretório temporário por turno; ambos usam proxy MCP Nod.
- `src/adapters/mcp-proxy/proxy.ts`: transporte comum; chama servidor autenticado.
- `src/adapters/fundo/computadores.ts`: gateway, reserva confirmada, validação
  após boot e ações fora da transação. Exemplo de controle a preservar.
- `src/adapters/computador/docker.ts`: ambiente persistente isolado, sem projeto
  local montado. Exige infraestrutura preparada e chave de credenciais.
- `desktop/main.ts`: máquina remota executora; ainda sem associação de pastas.
- `src/adapters/http/rotas/interno.ts`: despacho das chamadas autenticadas.
- `web/telas/conversa.ts`: timeline/propostas; composer preservado por regiões.

## Cuidados operacionais

Node 24.19.0 disponível diretamente neste shell; `mise` não encontrado. Banco
diário em 5434, volume `nod_nod_pgdata`: nunca resetar ou remover. Não alterar
configuração diária, migrar banco diário ou reiniciar o app como efeito incidental.
Usar banco de teste/ambiente descartável para a feature. Seguir AGENTS.md.

Git neste ambiente requer escalada para escrever refs/index; rede também pode
exigir escalada. O usuário autorizou commits e pushes da tarefa, não merge em main.
Hook pre-commit existe; conferir a execução de lint-staged ao commitar.
