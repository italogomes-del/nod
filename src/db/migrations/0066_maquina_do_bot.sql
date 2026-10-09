-- definido em 2026-10-09 (ADR-088): o motor numa máquina Linux da pessoa. Cada bot pode trabalhar numa máquina escolhida
-- (o id da chave da máquina, ADR-031), com um padrão por pessoa; o turno pode ir a outra máquina "só desta vez", por ato
-- da pessoa. Null = qualquer máquina, o comportamento de antes. Sem FK de propósito: a chave pode ser revogada, e o
-- `reivindicar` trata a chave que não vale (revogada ou de outra pessoa) como "qualquer máquina", nunca como fila presa.
-- Colunas nulas sem default: só metadado, mas o ALTER pega a trava da tabela — desiste em 5 s com o servidor de pé.
SET LOCAL lock_timeout = '5s';
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS maquina_id uuid;
ALTER TABLE preferencias ADD COLUMN IF NOT EXISTS maquina_padrao_id uuid;
ALTER TABLE turnos ADD COLUMN IF NOT EXISTS maquina_desta_vez uuid;

-- ROLLBACK:
-- -- O reivindicar antigo ignora as três colunas: os turnos voltam a ir para qualquer máquina, nada fica preso.
-- ALTER TABLE turnos DROP COLUMN IF EXISTS maquina_desta_vez;
-- ALTER TABLE preferencias DROP COLUMN IF EXISTS maquina_padrao_id;
-- ALTER TABLE agentes DROP COLUMN IF EXISTS maquina_id;
