# ADR-004 — Trilha imutável por trigger, sem texto livre: fato tipado na trilha, prosa em tabela irmã apagável

**Frente** Dados · **Status** decidido · **Épicos** E4, E5, E7, E8

## Decisão

A trilha é append-only por trigger BEFORE UPDATE OR DELETE OR TRUNCATE que levanta exceção, disparando inclusive para o dono da tabela. E o payload aceita apenas enum, uuid, timestamp e numérico, garantido por CHECK constraint — nenhum campo de texto livre. O texto humano (a justificativa em primeira pessoa de E4, o pedido de acesso de E6, o motivo de parada de E5) vive numa tabela irmã mutável e apagável, referenciada por id. O fato imutável ('item X foi negado pela regra Y às 14h32 por decisão de Z') sobrevive ao apagamento; a prosa não. Coluna de hash SHA-256 existe desde já como NULLABLE, sem ser preenchida, para deixar a porta do encadeamento aberta sem custo hoje.

## Contexto

E8.4 exige trilha somente-adição onde a negação aparece escrita com a regra que decidiu, e que o banco recuse alteração 'por permissão e não por convenção'. E4 exige justificativa em primeira pessoa sobre itens que tocam dado de aprendiz. As duas coisas colidem: uma justificativa útil escrita por um agente de RH sobre um jovem contém o nome do jovem, e a LGPD dá ao titular direito de exclusão.

## Alternativas rejeitadas

### Trilha imutável guardando o texto da justificativa, resolvendo LGPD 'por disciplina'

É a proposta da frente de Dados e é contraditória consigo mesma: manda não colocar dado pessoal e manda guardar o texto da justificativa. Grava dado de menor numa tabela que o banco recusa apagar e chama isso de solução. O primeiro pedido de titular vira incidente jurídico sem caminho técnico.

### Hash-chain como o buzz-audit

O Buzz implementou por completo e o custo é visível. crates/buzz-audit/src/service.rs:61-77 pega pg_advisory_lock por comunidade em TODA escrita, porque a cadeia precisa ler o head antes de computar o próximo hash — serializa a auditoria de um cliente inteiro num lock e obriga catch_unwind para não vazar o lock em panic. E crates/buzz-audit/src/hash.rs:13-24 documenta um defeito que já custou caro: created_at precisa ser truncado a microssegundos antes de hashear, senão 'the entry is written with one preimage and verified against another'. Para nós compra pouco: defende contra adversário com escrita no banco que edita o passado — e esse adversário (nós, com a service key) também recomputa a cadeia. Contra o cliente, o trigger resolve; contra nós, a cadeia não.

### REVOKE UPDATE, DELETE em vez de trigger

Mais limpo conceitualmente e vale como camada extra, mas sozinho não basta no Supabase: o role dono e a service_role passam por cima, e é com a service key que os workers escrevem. O trigger dispara para todo mundo. Note que o Buzz, com todo o rigor, não tem um único REVOKE nas 44 migrations — ele foi de trigger.

### Guardar hash do texto na trilha para provar que a prosa não mudou

Vira oráculo de confirmação: depois de apagar o texto, quem tiver o hash confirma qualquer suspeita de conteúdo por força bruta sobre um espaço pequeno (os nomes de aprendizes de um cliente). Se a coluna de hash for preenchida um dia, o preimage exclui explicitamente o texto pessoal, com teste.

## Evidência

O mecanismo de imutabilidade do Buzz é trigger, não permissão: migrations/0042_nip_fi_authorization_foundation.sql:525-535 cria authorization_events_immutable BEFORE UPDATE OR DELETE executando nip_fi_reject_row_mutation_v1(), mais authorization_events_no_truncate BEFORE TRUNCATE; o mesmo padrão em 0041:868-892 para seis tabelas. Repare que authorization_authentication_denial_attempts (0042:531) é literalmente a tabela de NEGAÇÕES que E8.4 pede, e é protegida por trigger. Grep por REVOKE nas migrations: nenhum resultado. Do lado do formato da linha, server/decision-log.ts:29-66 do OpenMausBot é o esquema de E8 já pensado: DecisionKind com auto-approved, card-shown, user-approved, user-denied e o par review-would-approve/review-would-deny, mais os campos 'rule' (qual regra decidiu) e 'unattended' (se havia alguém no teclado). Copiar o esquema de linha e jogar fora o meio: decision-log.ts grava em arquivo NDJSON com rotação que SOBRESCREVE o anterior, logo não é append-only de verdade.

## Consequências

- A trilha nunca é corrigida por UPDATE. Erro vira linha nova que referencia a anterior, e a leitura precisa saber disso desde o começo, senão a UI mostra erro e correção como fatos concorrentes.
- O CHECK constraint que proíbe texto livre é a garantia estrutural; ele é o que separa esta decisão de uma promessa. Precisa existir na mesma migração da tabela.
- DROP PARTITION numa tabela com trigger BEFORE TRUNCATE precisa ser verificado explicitamente — e o role que faz poda por retenção é o mesmo que poderia apagar por conveniência. Ele precisa ser um role separado, nomeado, usado só pelo job de retenção, e seu uso precisa aparecer na própria trilha.
- Ganhamos escrita concorrente que o hash-chain tiraria: sem cadeia, não há advisory lock por cliente e dois agentes do mesmo tenant escrevem em paralelo.
- Toda linha de expiração precisa de idempotência estrutural (ADR-011): numa trilha imutável, a linha duplicada não sai.

## Reversibilidade

barata para o trigger e para o CHECK (CREATE/DROP), cara para o hash-chain. Adicionar cadeia depois exige backfill sequencial de toda a trilha com o sistema parado, além do advisory lock em todo caminho de escrita. O caminho barato, se um cliente exigir em contrato, é começar a cadeia a partir de uma data assumindo genesis ali — a coluna nullable deixa essa porta aberta de graça. O que é IRREVERSÍVEL é o dado pessoal que entrar na trilha antes do CHECK existir.

## Revisitar quando

Quando um cliente grande exigir laudo de integridade da trilha em contrato, ou no primeiro processo em que uma decisão registrada pelo nod virar prova. O caminho intermediário barato é encadear APENAS a tabela de decisões, usando a PK sequencial como ordem e verificando em lote fora do caminho quente — sem advisory lock.

## Revisão — investigação do monorepo da Leapy

**O que muda.** Acrescentar que todo teste de imutabilidade abre SAVEPOINT antes da operação proibida, e que o helper de teste expõe isso desde o primeiro teste. No Postgres, exceção levantada por trigger deixa a transação ABORTADA: como o withRollback é UM envelope por teste, o teste 'tenta atualizar a trilha, espera erro, depois verifica que a linha original continua lá' NÃO funciona — a verificação morre com 25P02. Segundo ponto: declarar o CHECK no schema TypeScript, não só na migration, com nome IDÊNTICO nos dois lados.

**Motivo.** Verifiquei o padrão real da Leapy em cep.repo.test.ts:85-105: o `rejects.toThrow()` é sempre o ÚLTIMO ato do envelope, nada é verificado depois. Eles CONTORNARAM o problema em vez de resolvê-lo, e o nod não pode contornar. Os 4 CREATE TRIGGER das 124 migrations são todos de normalização (BEFORE INSERT/UPDATE que reescreve valor), nunca de imutabilidade append-only — não há precedente para copiar. O mecanismo da transação abortada, porém, está documentado com cicatriz em jovens.repo.ts:1049, onde eles usaram transaction aninhada (que emite SAVEPOINT) para sobreviver a um 'relation does not exist'. Sobre o CHECK: db:push derrubou views em 2026-05-22 e CHECK constraints não declarados no TS em 2026-07-25.

Ver [o que o nod herda da Leapy](../inherited-from-leapy.md).
