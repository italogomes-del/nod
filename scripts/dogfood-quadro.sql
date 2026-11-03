-- NOD-422 (PR 2): as consultas da semana do dogfood do quadro. Só leitura; roda com psql como o papel do app, escopado
-- numa pessoa (as tabelas têm FORCE RLS por tenant e pessoa, ADR-016; o papel dono é NOBYPASSRLS e veria zero linhas):
--   psql "$DATABASE_URL" -v tenant=<uuid> -v pessoa=<uuid> -v anfitriao='EngNod' -v dias=7 -f scripts/dogfood-quadro.sql
-- Tudo roda numa transação que termina em ROLLBACK (a tabela temporária some junto).
-- `anfitriao` = o nome do bot dono do quadro; `dias` = a janela (padrão 7). A trilha não leva títulos (ADR-004): eles vêm
-- daqui, do banco, nunca dos eventos.
--
-- Suposições (registradas no PR #630):
-- - Membro do quadro = o anfitrião, os responsáveis de coluna e os bots com tarefa no quadro.
-- - "Conversa aberta sem mensagem em 60 s" = um conversa_aberta de um membro sem nenhuma mensagem da pessoa naquela
--   conversa nos 60 s seguintes. Abrir e sair sem escrever conta; abrir e só ler a resposta de um bot também. Só entram
--   as aberturas cuja janela de 60 s já fechou (a de agora ainda pode ganhar a mensagem).
-- - A conversa_aberta só sai com a Conversa do bot à vista (web/lib/trilha-conversa.ts), nunca com o Quadro dele.
-- - O tempo em coluna sai do histórico (quadro_tarefa_historico), sem evento novo: a entrada numa coluna até a próxima
--   mudança de status (ou agora, se a tarefa ainda está nela). A tarefa excluída sai da conta.

\if :{?anfitriao}
\else
  \echo 'falta -v anfitriao=<nome do bot dono do quadro>'
  \quit
\endif
\if :{?tenant}
\else
  \echo 'falta -v tenant=<uuid do tenant>'
  \quit
\endif
\if :{?pessoa}
\else
  \echo 'falta -v pessoa=<uuid da pessoa dona do quadro>'
  \quit
\endif
\if :{?dias}
\else
  \set dias 7
\endif

BEGIN;
-- O mesmo escopo que o app abre em cada transação (src/db/tx.ts): o RLS mostra só as linhas desta pessoa.
SELECT set_config('nod.tenant_id', :'tenant', true) AS tenant_escopo, set_config('nod.pessoa_id', :'pessoa', true) AS pessoa_escopo \gset

-- O quadro da semana (um por anfitrião da pessoa) e a janela, numa tabela temporária para as consultas abaixo.
CREATE TEMP TABLE dq ON COMMIT DROP AS
SELECT q.tenant_id, q.id AS quadro_id, q.agente_id AS anfitriao_id, q.assumido_em,
       now() - make_interval(days => :dias) AS desde
  FROM quadros q JOIN agentes a ON a.tenant_id = q.tenant_id AND a.id = q.agente_id
 WHERE a.nome = :'anfitriao' AND q.owner_id = :'pessoa'::uuid;

\echo '== O quadro (assumido_em vazio = ainda não assumiu a esteira)'
SELECT quadro_id, assumido_em, desde FROM dq;

\echo '== Tarefas movidas por autor (pessoa, agente, regra)'
SELECT e.dados->>'autor' AS autor, count(*) AS movidas
  FROM events e JOIN dq ON e.tenant_id = dq.tenant_id AND e.dados->>'quadro_id' = dq.quadro_id::text
 WHERE e.kind = 'tarefa_movida' AND e.created_at >= dq.desde
 GROUP BY 1 ORDER BY 2 DESC;

\echo '== Tarefas movidas por bot (só autor agente)'
SELECT a.nome AS bot, count(*) AS movidas
  FROM events e JOIN dq ON e.tenant_id = dq.tenant_id AND e.dados->>'quadro_id' = dq.quadro_id::text
  JOIN agentes a ON a.tenant_id = e.tenant_id AND a.id = (e.dados->>'autor_agente_id')::uuid
 WHERE e.kind = 'tarefa_movida' AND e.created_at >= dq.desde
 GROUP BY 1 ORDER BY 2 DESC;

\echo '== Fluxo entre colunas (de -> para)'
SELECT e.dados->>'de' AS de, e.dados->>'para' AS para, count(*) AS vezes
  FROM events e JOIN dq ON e.tenant_id = dq.tenant_id AND e.dados->>'quadro_id' = dq.quadro_id::text
 WHERE e.kind = 'tarefa_movida' AND e.created_at >= dq.desde
 GROUP BY 1, 2 ORDER BY 3 DESC;

\echo '== Tarefas abertas: pelo card ou por link'
SELECT e.dados->>'via' AS via, count(*) AS aberturas, count(DISTINCT e.dados->>'tarefa_id') AS tarefas
  FROM events e JOIN dq ON e.tenant_id = dq.tenant_id AND e.dados->>'quadro_id' = dq.quadro_id::text
 WHERE e.kind = 'tarefa_aberta' AND e.created_at >= dq.desde
 GROUP BY 1 ORDER BY 2 DESC;

\echo '== Tempo em coluna (horas, das entradas na janela; aberta = a tarefa ainda está lá)'
-- Entrada = 'criada' ou 'status' neste quadro; saída = a próxima mudança de status ou a ida para outro quadro (a linha
-- 'quadro' fica no destino, com `de` = este quadro). Tarefa importada: a entrada na primeira coluna começa na data da
-- linha 'linear' ("No Linear em <estado> desde dd/mm") gravada no MESMO lote que a criou, não na hora da importação.
-- As linhas de reimportações depois (outro estado, "fechada no Linear" com a hora de agora) não mexem nessa entrada
-- (revisão do PR #630: o max() delas jogava a entrada para a hora da importação).
-- Revisão 4: só as tarefas que ainda existem (em qualquer quadro). Excluir apaga a tarefa e deixa o histórico (o Desfazer
-- a restaura); sem o JOIN, a excluída ficava "aberta" na última coluna, contando horas até agora.
WITH linhas AS (
  SELECT h.id, h.tarefa_id, h.campo, h.para, h.criado_em, h.lote_id
    FROM quadro_tarefa_historico h JOIN dq ON h.tenant_id = dq.tenant_id AND h.quadro_id = dq.quadro_id
    JOIN quadro_tarefas t ON t.tenant_id = h.tenant_id AND t.id = h.tarefa_id
   WHERE h.campo IN ('criada', 'status')
  UNION ALL
  SELECT h.id, h.tarefa_id, h.campo, h.para, h.criado_em, h.lote_id
    FROM quadro_tarefa_historico h JOIN dq ON h.tenant_id = dq.tenant_id AND h.de = dq.quadro_id::text
    JOIN quadro_tarefas t ON t.tenant_id = h.tenant_id AND t.id = h.tarefa_id
   WHERE h.campo = 'quadro'
), linear AS (
  SELECT h.tarefa_id, h.lote_id, min(h.criado_em) AS desde_linear
    FROM quadro_tarefa_historico h JOIN dq ON h.tenant_id = dq.tenant_id AND h.quadro_id = dq.quadro_id
   WHERE h.campo = 'linear' AND h.para IS NOT NULL AND h.lote_id IS NOT NULL
   GROUP BY 1, 2
), entradas AS (
  SELECT l.campo, l.para AS coluna, l.criado_em AS registrada,
         CASE WHEN l.campo = 'criada' THEN least(l.criado_em, coalesce(li.desde_linear, l.criado_em)) ELSE l.criado_em END AS entrou,
         lead(l.criado_em) OVER (PARTITION BY l.tarefa_id ORDER BY l.criado_em, l.id) AS saiu
    FROM linhas l LEFT JOIN linear li ON l.campo = 'criada' AND li.tarefa_id = l.tarefa_id AND li.lote_id = l.lote_id
)
SELECT coluna, count(*) AS passagens, count(*) FILTER (WHERE saiu IS NULL) AS abertas,
       round(avg(extract(epoch FROM coalesce(saiu, now()) - entrou)) / 3600, 1) AS media_h,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM coalesce(saiu, now()) - entrou)) / 3600)::numeric, 1) AS mediana_h,
       round(max(extract(epoch FROM coalesce(saiu, now()) - entrou)) / 3600, 1) AS max_h
  FROM entradas, dq
 WHERE entradas.campo <> 'quadro' AND registrada >= dq.desde
 GROUP BY 1 ORDER BY 1;

\echo '== Conversas de membros abertas sem mensagem da pessoa em 60 s'
WITH membros AS (
  SELECT dq.tenant_id, dq.anfitriao_id AS agente_id FROM dq
  UNION
  SELECT t.tenant_id, t.agente_id FROM quadro_tarefas t JOIN dq ON t.tenant_id = dq.tenant_id AND t.quadro_id = dq.quadro_id
   WHERE t.agente_id IS NOT NULL
  UNION
  SELECT q.tenant_id, (c->>'responsavel')::uuid FROM quadros q JOIN dq ON q.tenant_id = dq.tenant_id AND q.id = dq.quadro_id,
         jsonb_array_elements(coalesce(q.colunas, '[]'::jsonb)) c
   WHERE c->>'responsavel' IS NOT NULL
), aberturas AS (
  SELECT e.tenant_id, (e.dados->>'agente_id')::uuid AS agente_id, (e.dados->>'conversa_id')::uuid AS conversa_id, e.created_at
    FROM events e JOIN dq ON e.tenant_id = dq.tenant_id
   WHERE e.kind = 'conversa_aberta' AND e.created_at >= dq.desde AND e.created_at <= now() - interval '60 seconds'
)
SELECT a.nome AS bot, count(*) AS aberturas,
       count(*) FILTER (WHERE NOT EXISTS (
         SELECT 1 FROM mensagens m
          WHERE m.tenant_id = ab.tenant_id AND m.conversa_id = ab.conversa_id AND m.autor_tipo = 'pessoa'
            AND m.criado_em >= ab.created_at AND m.criado_em < ab.created_at + interval '60 seconds')) AS sem_mensagem_60s
  FROM aberturas ab
  JOIN membros mb ON mb.tenant_id = ab.tenant_id AND mb.agente_id = ab.agente_id
  JOIN agentes a ON a.tenant_id = ab.tenant_id AND a.id = ab.agente_id
 GROUP BY 1 ORDER BY 3 DESC, 2 DESC;

\echo '== A semana em números (tarefas criadas, terminadas e paradas em Precisa de você)'
SELECT count(*) FILTER (WHERE h.campo = 'criada' AND h.criado_em >= dq.desde) AS criadas,
       count(*) FILTER (WHERE h.campo = 'status' AND h.para IN ('feito', 'cancelado') AND h.criado_em >= dq.desde) AS terminadas,
       (SELECT count(*) FROM quadro_tarefas t WHERE t.tenant_id = dq.tenant_id AND t.quadro_id = dq.quadro_id AND t.status = 'voce') AS esperando_voce
  FROM quadro_tarefa_historico h JOIN dq ON h.tenant_id = dq.tenant_id AND h.quadro_id = dq.quadro_id
 GROUP BY dq.tenant_id, dq.quadro_id;

ROLLBACK;

-- "Como foi a semana?" pelo resumo do quadro: fica para depois. O resumo que o bot recebe (resumoParaBot) é a foto de
-- agora, sem janela de tempo; contar a semana a ele pede ler o histórico no caso de uso e um campo novo no contrato.
-- Até lá, estas consultas são a resposta.
