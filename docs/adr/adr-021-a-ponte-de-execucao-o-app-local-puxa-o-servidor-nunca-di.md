# ADR-021 — A ponte de execução: o app local puxa, o servidor nunca disca

**Status** novo

## Decisão

O app local é o único que inicia conexão. Cinco rotas HTTP, todas POST do app para o servidor: conectar (a máquina se anuncia: id, nome, inventário de motores, versão do contrato), puxar (long-poll, teto de 20s no servidor e 35s no cliente — a folga é deliberada), renovar (batida de 30s enquanto o turno roda, levando os quatro sinais do ADR-009 e o lote de eventos; resposta {ativo:false} manda abortar), entregar (o resultado, uma vez só) e desconectar. O servidor NUNCA abre conexão com a máquina, não conhece o IP e não tem rota que a alcance. Autenticação: a pessoa entra pelo navegador com Google Workspace restrito a leapy.com.br, e dali emite um TOKEN DE MÁQUINA guardado no Keychain, do qual o servidor guarda só o SHA-256 com comparação em tempo constante. Toda requisição com cabeçalho Origin é recusada com 403 ANTES de olhar o token. PRESENÇA é derivada do próprio poll (sem heartbeat separado). Turno órfão por lease vencido vira 'interrompido' com motivo tipado, numa transição terminal e idempotente por constraint — NÃO volta para pendente, NÃO é oferecido a outra máquina, NÃO migra para o servidor. Duas máquinas da mesma pessoa competem e o SKIP LOCKED decide; o produto MOSTRA onde rodou. O TAMANHO: o núcleo verificado no openmausbot é 110 linhas de servidor + 254 de cliente = 364 linhas.

## O que mudou

Novo. É o único mecanismo desta rodada que não existia em nenhum ADR.

## Por quê

As suas decisões 3 e 4 fixam a direção da conexão e o comportamento no laptop fechado, mas nenhum ADR descrevia o canal — e sem isso escrito a implementação inventaria um, com alta chance de inventar um túnel. O custo que isso evita está inventariado: o companion/ inteiro do openmausbot existe só para deixar algo de fora alcançar a máquina, com um processo que mente sobre a própria origem, mais pareamento, mais token por dispositivo, mais scrubbing. Nada disso é necessário quando a máquina é quem disca. Pus o número de linhas dentro do ADR de propósito: a ponte parece um subsistema quando descrita como lista de exigências, e o time precisa ver que são dias, não semanas.

