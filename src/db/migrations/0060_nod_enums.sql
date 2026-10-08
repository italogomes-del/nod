-- definido em 2026-10-07 (ADR-081/082, o Nod: bot fixo da pessoa): os valores de enum que o Nod usa, sozinhos nesta
-- migração porque um valor novo não pode ser usado na mesma transação que o criou (como na 0028, 0047 e 0050).
-- nod_protegido: a recusa de excluir, ocultar, renomear, mover ou duplicar o Nod (403).
-- lote_bots: o card das mudanças em vários bots que o Nod pede de uma vez (gerir_bots).
ALTER TYPE codigo_erro ADD VALUE IF NOT EXISTS 'nod_protegido';
ALTER TYPE kind_proposta ADD VALUE IF NOT EXISTS 'lote_bots';
ALTER TYPE tipo_decisao ADD VALUE IF NOT EXISTS 'lote_bots';

-- ROLLBACK:
-- (os valores ficam: Postgres não remove valor de enum; antes, recuse as propostas/decisões 'lote_bots' pendentes)
