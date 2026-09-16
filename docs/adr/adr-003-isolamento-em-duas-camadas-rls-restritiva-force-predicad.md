# ADR-003 — Isolamento em duas camadas: RLS restritiva FORCE + predicado explícito, SET LOCAL por transação

**Status** revisado

## Decisão

O MECANISMO nasce ligado na migração 0001 (ENABLE + FORCE, policy RESTRICTIVE, role de aplicação NOBYPASSRLS não-dono, SET LOCAL em helper único, teste de conformidade contra o catálogo), e passa a apontar para a PESSOA. A policy do dia 1 é conjuntiva: tenant_id = current_setting('nod.tenant_id') AND (owner_id = current_setting('nod.pessoa_id') OR visibility = 'equipe' OR existe delegação). Três colunas na 0001: tenant_id (DEFAULT da constante Leapy, dentro de toda UNIQUE e FK — A-RLS-5 preservada), owner_id, e visibility como enum fechado com DEFAULT 'privado'. O helper db/tx.ts faz DOIS SET LOCAL, ambos obrigatórios, e LANÇA ERRO se algum vier vazio em vez de deixar o Postgres devolver zero linhas. A-RLS-4 mantido.

## O que mudou

O eixo da policy muda de tenant para pessoa. Duas colunas novas (owner_id, visibility). O helper ganha um segundo parâmetro obrigatório. A perna de tenant fica escrita na mesma policy desde já, como cláusula conjuntiva, para que o dia do SaaS custe dias.

## Por quê

O isolamento não sumiu, mudou de eixo — e o novo eixo é MAIS difícil, não menos. Entre 70 clientes nenhuma linha legitimamente se encontrava. Entre 19 pessoas a fila é mista de propósito: você quer que a Patrícia veja seu trabalho, e ao mesmo tempo seu agente privado não é dela. Isolamento com exceções legítimas é exatamente onde filtro de aplicação falha, e a Leapy já tem a cicatriz (CHANGELOG 0.19.0.0, 71 aprendizes fantasmas de outras contas; o TODO(rbac-follow-up) admitindo 'fail-closed por disciplina, não por construção'). DUAS FRENTES DISCORDARAM AQUI e a discordância chegou até você sem ninguém sinalizar: a frente da ponte escreveu que 'pessoa é filtro de trabalho, não fronteira de segurança'. Ela está errada, e o critério de aceite de E3.1 a desmente por escrito: 'Dado que existe uma decisão dirigida a outra pessoa numa organização onde sou membro, quando a fila renderiza, então essa decisão NÃO APARECE PARA MIM EM NENHUMA CIRCUNSTÂNCIA.' Isso é P0 desde sempre e é isolamento por pessoa DENTRO da mesma organização.

