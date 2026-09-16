# ADR-001 — Modo do pooler, tamanho do pool e política de deploy decididos antes de qualquer código

**Frente** Deploy · **Status** decidir-antes-da-fase-0 · **Épicos** E2, E3, E7, E9

## Decisão

Usar o pooler do Supabase em modo transação, com pool pequeno e explícito (começar em 15 conexões para a aplicação, 3 para o worker, 2 para migração), e configurar o PaaS para RECREATE em vez de rolling na Fase 1. Nenhuma operação segura conexão do pool por mais de alguns segundos: turno de agente NUNCA roda dentro de transação aberta — a reivindicação é uma transação curta que marca estado, o turno roda fora, e o assentamento é outra transação curta.

## Contexto

Cinco decisões de quatro frentes dependem deste parâmetro e nenhuma o tomou: RLS exige SET LOCAL dentro de transação (modo transação obriga isso em toda leitura escopada); a fila com SELECT FOR UPDATE seguraria conexão pelo tempo do turno; o buffer SSE em memória só é correto com uma instância; o job de expiração duplica com containers sobrepostos. Com 70 clientes e turnos concorrentes, esgotamento de pool é o incidente mais provável do sistema.

## Alternativas rejeitadas

### Modo session do pooler, que permitiria SET fora de transação

Amarra uma conexão por cliente pelo tempo da sessão e o Supabase dimensiona o pooler para modo transação. Além disso, contexto de tenant que sobrevive à transação é exatamente o modo de falha que A-RLS-3 proíbe: 'pooled connections must not retain or combine tenant context across requests' (docs/multi-tenant-relay.md:363-365).

### Deixar rolling deploy e resolver a sobreposição só com travas de banco

As travas são necessárias de qualquer jeito (ADR-010 e ADR-011), mas com rolling o buffer SSE em memória fica errado — dois STREAM_ID, clientes reidratando aleatoriamente — e não há decisão sobre isso em nenhuma frente. Recreate custa alguns segundos de indisponibilidade por deploy num produto cuja fila tem relógio; rolling custa três ADRs incorretos. Trocar para rolling depois é uma configuração, desde que as travas já estejam certas.

### Segurar o lock da conversa com SELECT FOR UPDATE durante o turno inteiro

Um turno dura de segundos a minutos. Com pool pequeno em modo transação, dez turnos concorrentes esgotam o pool e a fila global — a tela de abertura do produto — para de responder. A exclusão tem que ser por ESTADO persistido ('despachando' com prazo absoluto), não por lock de linha segurado.

## Evidência

docs/multi-tenant-relay.md:363-365 (A-RLS-3 exige SET LOCAL por transação e proíbe contexto retido em conexão de pool). O custo do lock longo não tem precedente nos repos porque nenhum dos dois usa pooler gerenciado: o Buzz sobe postgres:17-alpine próprio (docker-compose.yml) e o OpenMausBot é single-process em arquivo/SQLite. Esta é extrapolação necessária, não cópia — e é honesto dizer.

## Consequências

- Toda leitura escopada por tenant precisa abrir transação explícita, mesmo um SELECT único. Isso tem que estar num único helper que faz SET LOCAL, e nenhum código pode pegar conexão do pool por fora dele.
- A exclusão de turno vira estado ('pendente', 'despachando', 'assentado') com prazo absoluto, não lock de linha. Já é o desenho certo por outras razões (ADR-010).
- O deploy tem janela de alguns segundos. Com fila de RH em horário comercial brasileiro isso é aceitável, e é o preço de três ADRs ficarem corretos.
- A métrica de duração de checkout do pool (ADR-017) é o alarme mais cedo que existe e precisa estar ligada no dia 1.

## Reversibilidade

barata para o tamanho do pool (variável de ambiente), média para o modo (trocar para session obrigaria revisar todo caminho que assume SET LOCAL), média para recreate→rolling (exige o buffer SSE sair da memória ou a sequência virar global, o que é trabalho de protocolo, não de deploy).

## Revisitar quando

Quando a métrica de checkout do pool mostrar espera consistente, ou quando a segunda réplica virar necessidade — aí rolling volta à mesa junto com a mudança do buffer de replay.

## Revisão — investigação do monorepo da Leapy

**O que muda.** Incorporar duas consequências operacionais que a Leapy já pagou e que o ADR-001 não registra: com pooler em modo transação é obrigatório `prepare: false` (o pooler não suporta prepared statements), e o parâmetro que de fato importa contra esgotamento não é o tamanho do pool e sim o `idle_timeout`.

**Motivo.** packages/db/src/client.ts documenta as duas com data e sintoma. Importa ao nod porque interage com o ADR-003: toda leitura escopada abre transação explícita com SET LOCAL, e sem prepared statements o parse acontece toda vez — o custo por query sobe e ninguém mediu quanto.

Ver [o que o nod herda da Leapy](../inherited-from-leapy.md).
