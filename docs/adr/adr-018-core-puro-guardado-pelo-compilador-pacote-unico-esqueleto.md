# ADR-018 — Core puro guardado pelo COMPILADOR, pacote único, esqueleto commitado antes da lógica

**Frente** Código · **Status** decidido · **Épicos** E2, E3, E4, E5, E7, E9, E12

## Decisão

Um único package.json na raiz, sem workspaces, com módulos como pastas nomeadas por assunto: core/ (decisões puras), db/, http/, drivers/, agent/, web/, contracts/. core/ tem TSCONFIG PRÓPRIO cujo types não inclui @types/node e cuja lib não inclui DOM — o compilador recusa import fs from 'node:fs' e não há comentário que desative isso. O lint com regras de fronteira fica para o que o compilador não cobre (db/ não importa http/ nem agent/; web/ só importa type de contracts/). Teste ao lado do arquivo, nenhum acima de ~600 linhas. O primeiro commit cria a árvore com os arquivos de decisão já existindo, cada um com tipos de entrada e saída, corpo que lança 'não implementado' e teste irmão com o caso adversarial escrito.

## Contexto

As regras que mais podem machucar são de decisão, não de encanamento, e precisam de teste exaustivo — que só é barato sem banco para levantar. E a fronteira precisa de um mecanismo que sobreviva a 2-3 engenheiros com pressa.

## Alternativas rejeitadas

### Regra de lint como única guarda do core

Foi a proposta da frente e ela mesma admite que 'uma regra de lint pode ser desativada com um comentário na linha' e que no Buzz a proibição é a AUSÊNCIA da dependência no Cargo.toml, incontornável. Mas a decisão de pacote único removeu o mecanismo forte sem repor nada. O tsconfig próprio é o equivalente TypeScript real do '# NO tokio, NO sqlx, NO redis, NO axum' do buzz-core, e custa um arquivo de configuração. Sob prazo, o eslint-disable acontece numa sexta e ninguém revisa.

### pnpm workspaces com pacotes internos

O OpenMausBot TEM pnpm-workspace.yaml e mesmo assim manteve server/, src/ e shared/ como PASTAS do pacote raiz — os únicos workspaces reais são apps/docs e cloudflare/control-plane, que são deployables separados. O repo que tinha a ferramenta escolheu não usá-la para o código principal. Workspace só paga quando há outro artefato de deploy.

### Um pacote por módulo, como os 32 crates do Buzz

Granularidade de pacote não impede o módulo-monstro: mesmo com 32 crates, buzz-relay tem 89.275 linhas e buzz-acp 53.085, enquanto crates/sprig tem 53 linhas. A fronteira que funcionou no Buzz não foi a contagem de crates, foi a proibição de dependência — e essa dá para ter com tsconfig.

### Camadas técnicas (controllers/, services/, repositories/)

Cada épico atravessa as quatro camadas, então mudar uma regra toca quatro pastas e nenhuma conta a história. Nem OpenMausBot nem Buzz organizam assim: o Buzz nomeia crates por assunto (buzz-auth, buzz-search, buzz-audit) e o OpenMausBot nomeia arquivos por assunto (room-post-budget.ts, resume-recovery.ts).

### Deixar a estrutura emergir do primeiro caminho vertical

A estrutura que emerge da pressa é o diretório plano. O OpenMausBot não decidiu ter 398 arquivos em server/ num nível só — chegou lá por acréscimo, e server/index.ts com 16.282 linhas e 147 imports é o resultado de sempre haver um lugar óbvio e errado para colocar mais uma coisa. É o arquivo mais tocado do histórico (11 dos 51 commits), ou seja, conflito de merge garantido com duas pessoas em épicos diferentes.

## Evidência

crates/buzz-core/Cargo.toml termina com o comentário literal '# NO tokio, NO sqlx, NO redis, NO axum — zero I/O dependencies', e ARCHITECTURE.md:343 registra 'Zero I/O. Explicitly prohibits tokio, sqlx, redis, and axum in its Cargo.toml.' No OpenMausBot o mesmo padrão aparece sem nome: os arquivos de server/ com ZERO imports — room-post-budget.ts (172), resume-recovery.ts (84), room-turn-timeout.ts (117), sse-fanout.ts (67), turn-dispatch-guard.ts (203), redact.ts (125) — têm TODOS teste ao lado. Nenhum ficou sem. O cabeçalho de room-post-budget.ts explica: 'The decision is a pure function of the recorded state plus a caller-supplied now, so the server can pass Date.now() and tests can pass whatever they need.' E as violações que o lint não pegou são reais: shared/team-setup.ts:1 importa ../server/contracts.ts invertendo a camada neutra, e src/lib/taskTimeline.ts:1 faz import { redactSecretsInText } from '../../server/redact.js' — código de servidor executando no browser, em runtime, não import type.

## Consequências

- Cada regra ganha tabela de casos rodando em milissegundos, sem Docker. É o que torna viável exigir o caso adversarial (o item que toca dado de aprendiz nascendo desmarcado) e não só o caminho feliz — e é o que torna o plantão barato, porque bug de regra se reproduz em milissegundos.
- now vira parâmetro em toda assinatura pública do core. Verboso, e é o que permite testar a expiração da fila (E3) e a janela da rotina (E7) sem esperar tempo real.
- O core não faz log nem métrica: quem observa é a borda. Depurar decisão errada em produção depende de a borda registrar a entrada que o core recebeu.
- contracts/ vira o acoplamento mais forte do repo (no OpenMausBot, contracts.ts é importado por 83 arquivos). Todo campo que entra ali é caro de mudar, o que é motivo para ser conservador — e para ele ser trabalho de uma pessoa até estabilizar (ADR-012).
- A suíte unitária roda em paralelo e em segundos porque nada nela levanta processo, ao contrário do OpenMausBot, que teve de pôr fileParallelism: false na suíte inteira por causa de uma minoria de testes.
- Arquivos que lançam 'não implementado' são dívida visível: melhor errar para menos e criar 12 arquivos de decisão de que se tem certeza do que 20 adivinhados.

## Reversibilidade

cara para introduzir o core puro depois (desfazer I/O entranhado no meio de regras), trivial para relaxar. Por isso começa estrito. Virar workspace depois é mover pastas e escrever package.json, e o código dentro delas não muda se as fronteiras já forem respeitadas. O esqueleto em si é um commit num repositório vazio.

## Revisitar quando

Quando core/ passar de ~25 arquivos (precisa de subpastas), quando um case precisar de await para decidir o próximo estado (a fronteira está no lugar errado e a decisão pertence ao servidor), ou quando aparecer um eslint-disable de regra de fronteira num PR — ou a fronteira está errada ou o PR está, e vale a conversa nas duas hipóteses.

