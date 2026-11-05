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
--
-- NOD-343 (o plano do dogfood, métricas 3, 4, 5, 6, 7 e 10): `parada_h` = as horas na mesma coluna para contar como
-- parada (padrão 24; a foto diária roda com -v dias=1). Suposições (registradas no PR #688):
-- - O grupo de cada coluna sai de quadros.colunas (as colunas da pessoa); os ids reservados têm o grupo fixo de
--   src/domain/colunas.ts (GRUPO_PADRAO). Terminar = entrar numa coluna do grupo Feito (Cancelado fica de fora do ciclo).
-- - Passagem = movimento 'mover' para uma coluna do grupo Iniciado (fora Bloqueado e Precisa de você) com responsável
--   depois que não é quem moveu, trocando de mão ou entrando no andamento vindo de fora (a regra de deveComecar;
--   revisão do PR #688). Começou sozinha = um trabalho de origem 'inicio' na tarefa entre 1 min antes e 5 min depois do movimento
--   (o trabalho abre depois do lote; o minuto antes cobre o relógio do mesmo lote). O que acontece com ele depois (a
--   pessoa cancelar, falhar) não desfaz o começo: conta nas intervenções e nos erros.
-- - Recados, trabalhos e o join pelo quadro ATUAL da tarefa: a tarefa que foi para outro quadro sai das métricas 5 e 7.
--   Repetir e Cancelar não guardam se vieram da tela ou do bot: contam todos como intervenção.
-- - Rotinas: a última linha rotina_executou de cada execução (o desfecho pode ser regravado), por bot e por período em
--   relação a quadros.assumido_em. Rodou = executou, passou_em_branco, sem_novidade ou falhou. O desfecho vem do
--   evento, não de rotina_sem_novidade (que não diz a rotina e não sai em voltas_sem_novidade).
-- - Só contagens e horas: nenhum título nem texto (ADR-004).

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
\if :{?parada_h}
\else
  \set parada_h 24
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

-- O grupo de cada coluna do quadro: as da pessoa (quadros.colunas) e os ids reservados com o grupo fixo deles.
CREATE TEMP TABLE dcol ON COMMIT DROP AS
SELECT c->>'id' AS id, c->>'grupo' AS grupo
  FROM quadros q JOIN dq ON q.tenant_id = dq.tenant_id AND q.id = dq.quadro_id, jsonb_array_elements(coalesce(q.colunas, '[]'::jsonb)) c
 WHERE c->>'id' NOT IN ('backlog', 'afazer', 'fazendo', 'revisao', 'bloqueado', 'voce', 'feito', 'cancelado')
UNION ALL
SELECT v.id, v.grupo
  FROM (VALUES ('backlog', 'nao_iniciado'), ('afazer', 'nao_iniciado'), ('fazendo', 'iniciado'), ('revisao', 'iniciado'),
               ('bloqueado', 'iniciado'), ('voce', 'iniciado'), ('feito', 'feito'), ('cancelado', 'fechado')) v(id, grupo);

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

\echo '== Tempo para achar trabalho (quadro aberto -> primeiro card em até 10 min)'
WITH pares AS (
  SELECT qa.id, qa.created_at AS abriu, primeira.created_at AS achou
    FROM events qa JOIN dq ON qa.tenant_id = dq.tenant_id AND qa.dados->>'quadro_id' = dq.quadro_id::text
    CROSS JOIN LATERAL (
      SELECT ta.created_at
        FROM events ta
       WHERE ta.tenant_id = qa.tenant_id AND ta.owner_id = qa.owner_id AND ta.kind = 'tarefa_aberta'
         AND ta.dados->>'quadro_id' = qa.dados->>'quadro_id' AND ta.dados->>'via' = 'card'
         AND ta.created_at >= qa.created_at AND ta.created_at <= qa.created_at + interval '10 minutes'
       ORDER BY ta.created_at, ta.id LIMIT 1
    ) primeira
   WHERE qa.kind = 'quadro_aberto' AND qa.created_at >= dq.desde
)
SELECT count(*) AS aberturas_com_trabalho,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM achou - abriu)))::numeric, 1) AS mediana_seg
  FROM pares;

\echo '== Consultas de estado por dia (tela + chat)'
SELECT e.created_at::date AS dia,
       count(*) FILTER (WHERE e.kind = 'quadro_aberto') AS pela_tela,
       count(*) FILTER (WHERE e.kind = 'quadro_consultado') AS pelo_chat,
       count(*) AS total
  FROM events e JOIN dq ON e.tenant_id = dq.tenant_id AND e.dados->>'quadro_id' = dq.quadro_id::text
 WHERE e.kind IN ('quadro_aberto', 'quadro_consultado') AND e.created_at >= dq.desde
 GROUP BY 1 ORDER BY 1;

\echo '== Avisos do quadro por tipo'
SELECT e.dados->>'tipo' AS tipo, count(*) AS avisos, sum((e.dados->>'tarefas')::int) AS tarefas
  FROM events e JOIN dq ON e.tenant_id = dq.tenant_id AND e.dados->>'quadro_id' = dq.quadro_id::text
 WHERE e.kind = 'quadro_avisou' AND e.created_at >= dq.desde
 GROUP BY 1 ORDER BY 1;

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

\echo '== Tempo de ciclo (horas, da criação ao 1º Feito, das tarefas terminadas na janela)'
-- O começo é o da linha 'criada' (a importada: desde o Linear, como no tempo em coluna); o fim, a 1ª entrada numa coluna
-- do grupo Feito. Só as tarefas que ainda existem. Revisão do PR #688: o começo é procurado em qualquer quadro (a tarefa
-- que veio de outro quadro tem a linha 'criada' lá; filtrar por este quadro a tirava do ciclo sem aviso).
WITH fim AS (
  SELECT h.tarefa_id, min(h.criado_em) AS terminou
    FROM quadro_tarefa_historico h JOIN dq ON h.tenant_id = dq.tenant_id AND h.quadro_id = dq.quadro_id
    JOIN dcol c ON c.id = h.para AND c.grupo = 'feito'
   WHERE h.campo = 'status'
   GROUP BY 1
), inicio AS (
  SELECT h.tarefa_id, least(min(h.criado_em), coalesce(min(li.criado_em), min(h.criado_em))) AS comecou
    FROM quadro_tarefa_historico h JOIN dq ON h.tenant_id = dq.tenant_id JOIN fim f ON f.tarefa_id = h.tarefa_id
    LEFT JOIN quadro_tarefa_historico li ON li.tenant_id = h.tenant_id AND li.tarefa_id = h.tarefa_id AND li.quadro_id = h.quadro_id
         AND li.campo = 'linear' AND li.para IS NOT NULL AND li.lote_id = h.lote_id
   WHERE h.campo = 'criada'
   GROUP BY 1
), ciclos AS (
  SELECT extract(epoch FROM f.terminou - i.comecou) / 3600 AS h
    FROM fim f JOIN inicio i ON i.tarefa_id = f.tarefa_id
    JOIN quadro_tarefas t ON t.id = f.tarefa_id, dq
   WHERE t.tenant_id = dq.tenant_id AND f.terminou >= dq.desde
)
SELECT count(*) AS terminadas,
       round(avg(h)::numeric, 1) AS media_h,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY h))::numeric, 1) AS mediana_h,
       round((percentile_cont(0.9) WITHIN GROUP (ORDER BY h))::numeric, 1) AS p90_h
  FROM ciclos;

\echo '== Passagens automáticas que começaram sozinhas (por quem moveu)'
-- Revisão do PR #688: passagem é o movimento que DEVE começar (deveComecar, src/domain/quadro.ts): o responsável novo não
-- é quem moveu (o bot que leva a própria tarefa para Em revisão não se aciona) e troca de mão, ou, em Fazendo e nas
-- colunas de andamento da pessoa, entra vindo de fora do grupo Iniciado. Sem isso, cada "terminei, vai para revisão" do
-- bot entrava como passagem que não começou e afundava a %. (O turno vivo, que também segura o começo, não fica gravado.)
-- QA do PR #688: A fazer também aciona (deveComecar). A que começa já sai gravada em Fazendo; a que fica (a segurada pelo
-- teto de começos do lote ou pelo limite da corrente volta para A fazer, colunaDeEspera) sumia da conta e inflava a %.
-- Limite: no quadro sem A fazer a segurada volta para a 1ª coluna de Não iniciado e segue fora.
WITH passagens AS (
  SELECT m.tenant_id, m.tarefa_id, m.autor, m.acionou, m.criado_em
    FROM quadro_movimentos m JOIN dq ON m.tenant_id = dq.tenant_id AND m.quadro_id = dq.quadro_id
    JOIN dcol c ON c.id = m.para AND (c.grupo = 'iniciado' OR m.para = 'afazer')
    LEFT JOIN dcol cd ON cd.id = m.de
   WHERE m.tipo = 'mover' AND m.para NOT IN ('bloqueado', 'voce') AND m.agente_depois IS NOT NULL AND m.criado_em >= dq.desde
     AND m.agente_depois IS DISTINCT FROM m.autor_agente_id
     AND (m.agente_antes IS DISTINCT FROM m.agente_depois OR (m.para = 'afazer' AND m.de <> 'afazer')
          OR (m.para NOT IN ('revisao', 'afazer') AND coalesce(cd.grupo, '') <> 'iniciado'))
), marcadas AS (
  SELECT p.autor, p.acionou, EXISTS (
           SELECT 1 FROM quadro_execucoes e
            WHERE e.tenant_id = p.tenant_id AND e.tarefa_id = p.tarefa_id AND e.origem = 'inicio'
              AND e.criado_em BETWEEN p.criado_em - interval '1 minute' AND p.criado_em + interval '5 minutes') AS comecou
    FROM passagens p
)
SELECT coalesce(autor, 'total') AS autor, count(*) AS passagens,
       count(*) FILTER (WHERE acionou) AS acionaram,
       count(*) FILTER (WHERE comecou) AS comecaram,
       round(100.0 * count(*) FILTER (WHERE comecou) / nullif(count(*), 0), 1) AS pct_comecaram
  FROM marcadas
 GROUP BY ROLLUP (autor) ORDER BY autor NULLS LAST;

\echo '== Intervenções manuais (por tarefa terminada na janela)'
-- Terminada = a tarefa entrou numa coluna do grupo Feito ou Fechado na janela (cada tarefa uma vez).
WITH n AS (
  SELECT
    (SELECT count(*) FROM quadro_movimentos m
      WHERE m.tenant_id = dq.tenant_id AND m.quadro_id = dq.quadro_id AND m.autor = 'pessoa' AND m.tipo IN ('mover', 'desfazer')
        AND m.criado_em >= dq.desde) AS movimentos_da_pessoa,
    (SELECT count(*) FROM quadro_recados r JOIN quadro_tarefas t ON t.tenant_id = r.tenant_id AND t.id = r.tarefa_id
      WHERE t.tenant_id = dq.tenant_id AND t.quadro_id = dq.quadro_id AND r.criado_em >= dq.desde) AS recados,
    (SELECT count(*) FROM quadro_execucoes e JOIN quadro_tarefas t ON t.tenant_id = e.tenant_id AND t.id = e.tarefa_id
      WHERE t.tenant_id = dq.tenant_id AND t.quadro_id = dq.quadro_id AND e.origem = 'repetir' AND e.criado_em >= dq.desde) AS repeticoes,
    (SELECT count(*) FROM quadro_execucoes e JOIN quadro_tarefas t ON t.tenant_id = e.tenant_id AND t.id = e.tarefa_id
      WHERE t.tenant_id = dq.tenant_id AND t.quadro_id = dq.quadro_id AND e.origem = 'resposta' AND e.criado_em >= dq.desde) AS respostas,
    (SELECT count(*) FROM quadro_execucoes e JOIN quadro_tarefas t ON t.tenant_id = e.tenant_id AND t.id = e.tarefa_id
      WHERE t.tenant_id = dq.tenant_id AND t.quadro_id = dq.quadro_id AND e.cancelada_em >= dq.desde) AS cancelamentos,
    (SELECT count(DISTINCT h.tarefa_id) FROM quadro_tarefa_historico h JOIN dcol c ON c.id = h.para AND c.grupo IN ('feito', 'fechado')
      WHERE h.tenant_id = dq.tenant_id AND h.quadro_id = dq.quadro_id AND h.campo = 'status' AND h.criado_em >= dq.desde) AS terminadas
  FROM dq
)
SELECT movimentos_da_pessoa, recados, repeticoes, respostas, cancelamentos,
       movimentos_da_pessoa + recados + repeticoes + respostas + cancelamentos AS total, terminadas,
       round((movimentos_da_pessoa + recados + repeticoes + respostas + cancelamentos)::numeric / nullif(terminadas, 0), 2) AS por_terminada
  FROM n;

\echo '== Paradas há mais de' :parada_h 'h na mesma coluna (agora; fora Backlog, Feito e Fechado)'
SELECT t.status AS coluna, count(*) AS paradas,
       round(max(extract(epoch FROM now() - t.na_coluna_desde)) / 3600, 1) AS max_h
  FROM quadro_tarefas t JOIN dq ON t.tenant_id = dq.tenant_id AND t.quadro_id = dq.quadro_id
  LEFT JOIN dcol c ON c.id = t.status
 WHERE t.status <> 'backlog' AND coalesce(c.grupo, '') NOT IN ('feito', 'fechado')
   AND t.na_coluna_desde < now() - make_interval(hours => :parada_h)
 GROUP BY 1 ORDER BY 2 DESC, 1;

\echo '== Erros e freios (trabalhos que falharam, novas tentativas, laços, freios e recusas)'
SELECT
  (SELECT count(*) FROM quadro_execucoes e JOIN quadro_tarefas t ON t.tenant_id = e.tenant_id AND t.id = e.tarefa_id
    WHERE t.tenant_id = dq.tenant_id AND t.quadro_id = dq.quadro_id AND e.desfecho = 'falhou' AND coalesce(e.tratada_em, e.criado_em) >= dq.desde) AS falharam,
  (SELECT count(*) FROM quadro_execucoes e JOIN quadro_tarefas t ON t.tenant_id = e.tenant_id AND t.id = e.tarefa_id
    WHERE t.tenant_id = dq.tenant_id AND t.quadro_id = dq.quadro_id AND e.origem = 'automatica' AND e.criado_em >= dq.desde) AS novas_tentativas,
  count(*) FILTER (WHERE m.tipo = 'laco') AS lacos,
  count(*) FILTER (WHERE m.tipo = 'freio') AS freios,
  count(*) FILTER (WHERE m.tipo = 'nao_e_comigo') AS recusas
  FROM dq LEFT JOIN quadro_movimentos m ON m.tenant_id = dq.tenant_id AND m.quadro_id = dq.quadro_id AND m.criado_em >= dq.desde
 GROUP BY dq.tenant_id, dq.quadro_id, dq.desde;

\echo '== Rotinas sem novidade (por bot, antes e depois de assumir a esteira)'
-- Para ter a semana de antes, rode com -v dias=14.
WITH ex AS (
  SELECT DISTINCT ON (e.dados->>'execucaoId') e.dados->>'rotinaId' AS rotina_id, e.dados->>'desfecho' AS desfecho, e.created_at
    FROM events e JOIN dq ON e.tenant_id = dq.tenant_id
   WHERE e.kind = 'rotina_executou' AND e.owner_id = :'pessoa'::uuid AND e.created_at >= dq.desde AND e.dados ? 'execucaoId'
   ORDER BY e.dados->>'execucaoId', e.created_at DESC, e.id DESC
)
SELECT coalesce(a.nome, '(rotina apagada)') AS bot,
       CASE WHEN dq.assumido_em IS NULL THEN 'sem assumir' WHEN ex.created_at < dq.assumido_em THEN 'antes' ELSE 'depois' END AS periodo,
       count(*) FILTER (WHERE ex.desfecho IN ('executou', 'passou_em_branco', 'sem_novidade', 'falhou')) AS rodaram,
       count(*) FILTER (WHERE ex.desfecho = 'sem_novidade') AS sem_novidade,
       round(100.0 * count(*) FILTER (WHERE ex.desfecho = 'sem_novidade')
             / nullif(count(*) FILTER (WHERE ex.desfecho IN ('executou', 'passou_em_branco', 'sem_novidade', 'falhou')), 0), 1) AS pct_sem_novidade
  FROM ex CROSS JOIN dq
  LEFT JOIN rotinas r ON r.tenant_id = dq.tenant_id AND r.id::text = ex.rotina_id
  LEFT JOIN agentes a ON a.tenant_id = r.tenant_id AND a.id = r.agente_id
 GROUP BY 1, 2 ORDER BY 1, 2;

ROLLBACK;

-- "Como foi a semana?" pelo resumo do quadro: fica para depois. O resumo que o bot recebe (resumoParaBot) é a foto de
-- agora, sem janela de tempo; contar a semana a ele pede ler o histórico no caso de uso e um campo novo no contrato.
-- Até lá, estas consultas são a resposta.
