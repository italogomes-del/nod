-- definido em 2026-10-08 (ADR-086): "me chame às 16:00". O bot que vai esperar algo demorado (um CI, um deploy, uma
-- resposta de fora) não fica num laço com `sleep` segurando processo e memória no Mac: ele enfileira a própria retomada
-- com `acordar_em`, encerra o turno, e o `reivindicar` só a entrega a partir dessa hora — na mesma sessão (--resume).
-- Null = a fila de sempre. A task fica `rodando` (há turno pendente) e a tela diz "volta às 16:00 · fora do Mac".
ALTER TABLE turnos ADD COLUMN IF NOT EXISTS acordar_em timestamptz;

-- ROLLBACK:
-- ALTER TABLE turnos DROP COLUMN IF EXISTS acordar_em;
