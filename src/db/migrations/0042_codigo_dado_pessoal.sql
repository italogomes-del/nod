-- definido em 2026-10-02: o código de erro de conector http que acessa dado pessoal ganha o nome da
-- regra que ele aplica (ADR-002, classificação de dado pessoal por origem). Só o rótulo muda: a ordem
-- do enum e as linhas já gravadas acompanham o RENAME VALUE.
ALTER TYPE codigo_erro RENAME VALUE 'http_toca_aprendiz' TO 'http_toca_dado_pessoal';

-- ROLLBACK:
-- ALTER TYPE codigo_erro RENAME VALUE 'http_toca_dado_pessoal' TO 'http_toca_aprendiz';
