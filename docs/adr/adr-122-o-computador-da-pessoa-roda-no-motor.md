# ADR-122 — O computador da pessoa roda no motor

Status: aceita (PR 1 da NOD-96: decisão, dados e contratos; o comportamento entra nos PRs 2 a 7, atrás de
`NOD_COMPUTADORES=motor`) · Data: 2026-10-22 · Revê a [ADR-037](adr-037-computadores-por-bot.md) (um computador por
bot, container Docker no servidor); emenda a [ADR-090](adr-090-o-motor-numa-maquina-linux-da-pessoa.md) item 10 e a
[ADR-085](adr-085-uso-do-mac-segura-trabalho-novo.md)/[ADR-097](adr-097-agentes-entram-trabalho-pesado-faz-fila.md)
(as telas entram pela mesma régua). Plano do Arquiteto no comentário de 22/10 (11:52) da NOD-96; protótipo v2
aprovado (`53c1c07`). O plano chamava esta ADR de "ADR-118": 117 a 121 já estavam tomadas por PRs abertos.

## Contexto

Decisões do Marlon em 21/10: "quero compartilhar o computador para todos os bots, assim como o Grok Bot faz", com o
mesmo modelo do Grok: **uma máquina por pessoa**, disco comum, **tela e Chrome por bot**, em paralelo e sem fila,
**cookies compartilhados**. O computador roda **na máquina da pessoa, pelo motor** (ADR-090), e tem de funcionar numa
VM Linux como a `nod-motor-teste`. Medido nela em 21/10: GCP e2-standard-8 (8 vCPU, 31 GB), Debian 12 bookworm,
kernel 6.1, **sem Docker, sem Podman e sem `/dev/kvm`**; com `bwrap`, user namespaces sem privilégio e systemd 252.
"Pode recriar do zero": a máquina nasce nova, sem migrar os volumes por bot. Memória: "igual fazemos nos bots" — sem
número fixo de telas, a régua e o modo de uso que já existem.

O computador por bot (ADR-037) está desligado em produção (sem `NOD_COMPUTADORES=docker`) e ficou fora da ADR-090.

## Decisão

1. **Um computador por pessoa, uma tela por bot.** A unidade é (tenant, dona): uma linha em `computadores` com
   `modelo = 'por_pessoa'` e uma linha por bot em `computador_telas` (0106). Cada tela é um Xvfb `:1NN`, um openbox e um
   Chromium com perfil próprio (fork de `perfil-base`), em paralelo; a única espera é por memória. O controle (Assistindo
   / no controle), a política (supervisionado / autônomo), o pedido de ajuda e a reserva da ação passam a ser **da
   tela**: assumir pausa só aquele bot. As aprovações continuam por bot ("o resto desta tarefa" de A não libera B).
   `agentes.computador_id` deixa de ser único: os bots da pessoa apontam para o mesmo computador.
2. **Cookies comuns por loja única + CDP, não por symlink.** Dois Chromes no mesmo SQLite `Cookies` não é seguro (cache
   em memória por processo, lock e WAL por processo). Uma loja só, `logins/principal/cookies.enc` (AES-256-GCM, como o
   checkpoint de hoje): a tela manda ao supervisor o diff depois de cada ação, o supervisor funde (último a escrever por
   `lastAccess` e sequência), grava atômico e repassa às outras telas por `addCookies`/`clearCookies`; quem abre depois
   sobe com a loja aplicada. Alvo: menos de 1 s entre telas. Só cookies nesta versão (senhas e storage na NOD-97).
3. **Um keyring por máquina, com o Safe Storage determinístico.** Um gnome-keyring, desbloqueado com
   `HMAC(NOD_CREDENTIAL_KEY, "nod-computador:"+id)` (como hoje), que vai no comando `iniciar` selado para a chave X25519
   do supervisor e nunca toca o disco. A senha "Chromium Safe Storage" é gravada antes do primeiro Chrome como
   `HKDF(chave da máquina, "login:principal:chrome-safe-storage-v1")`: todos os forks decifram os mesmos blobs, e ela
   sobrevive a Atualizar e Redefinir.
4. **Isolamento por uids + systemd + bwrap + comandos assinados, no lugar do container.** Na VM-alvo não há Docker,
   Podman nem KVM, e o instalador não deve pôr um daemon de container. Quatro camadas:
   - **uids próprios**: `nod-pc` (supervisor, Xvfb, Chrome, keyring) e `nod-pc-term` (terminal). O `nod` (motor e CLIs
     dos bots) não lê `/var/lib/nod-computador/<id>/{perfis,logins,keyring}` (0700); com outro uid, o `ptrace` não
     alcança o Chrome.
   - **unidade systemd** `nod-computador.service`, ativada por socket (0660, grupo `nod`), com `NoNewPrivileges`,
     `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `PrivateDevices`, `ProtectKernel*`, `OOMScoreAdjust=300` e
     **`IPAddressDeny`** para loopback, faixas privadas, CGNAT, link-local e **169.254/16 (metadata)**: o egress da
     ADR-037 feito no kernel, por cgroup, sem proxy nem rebinding de DNS.
   - **bwrap por tela**: só o próprio perfil, `logins/` em leitura e `/workspace`; o resto do sistema em leitura. Com
     userns, o **Chrome volta ao próprio sandbox**. CDP só por pipe.
   - **comandos assinados**: os CLIs dos bots rodam como `nod` e alcançariam o socket. O servidor assina cada comando
     (`ComandoComputador.assinatura`, Ed25519, semente `HKDF(NOD_CREDENTIAL_KEY, "nod-computador-assina:"+id)`); o
     supervisor confere a assinatura, a validade de 2 min e o id não repetido. A chave X25519 do supervisor fica em
     `computadores.supervisor_pub` no primeiro contato (TOFU) e só troca pelo Redefinir.
   O terminal (`nod-pc-term`) só escreve em `/workspace`, não tem `DISPLAY` e tem o mesmo `IPAddressDeny`.
5. **Admissão pela régua e espera em fila.** Antes de abrir uma tela, o supervisor aplica `deveSegurar(uso, memória,
   processador, regra)` com a leitura local do motor e o modo de uso da pessoa (Pouco / Equilibrado / Livre; o `uso` vai
   em cada comando). Se segura, fecha a tela ociosa mais antiga e reavalia; sem ociosa, responde `esperando_tela` com
   quem está usando, e a tela vai para `esperando` (fila por `esperando_desde`). A ferramenta espera no próprio turno, em
   fatias, como a aprovação; em Livre nunca segura. Falta de memória é espera, nunca erro.
6. **Onde roda.** `computadores.maquina_id` (contrato da NOD-94; nulo = "onde o nod roda") e `hospedeira_id` (onde o
   disco está agora). O despachante escolhe `maquina_id`, senão `hospedeira_id`, senão a única máquina Linux que anuncia
   `computador: pronto`, senão a máquina padrão, senão a de contato mais recente; nunca a máquina do turno. Mac anuncia
   `sem_suporte` (NOD-93). O motor anuncia `AnuncioComputador` (`pronto | faltam_pacotes | sem_suporte`, com `falta`).
7. **Atualizar, Redefinir e Sair de todos os sites** são da máquina inteira, uma de cada vez
   (`computadores.operacao*`, com progresso de 0 a 100 e a etapa). Atualizar troca binários e preserva workspace,
   perfis e logins; Redefinir apaga tudo menos `logins/`, recria `perfil-base` e esquece a chave do supervisor; Sair de
   todos zera a loja. Durante a operação a ação espera ("atualizando"), não falha.
8. **Legado recriado do zero.** Ao passar ao motor, os computadores por bot da pessoa são arquivados
   (`arquivado_em`), os bots deixam de apontar para eles, os containers param e os volumes ficam 30 dias sem uso pelo
   produto; a pessoa vê uma vez "entre nos sites de novo". Nada é migrado.
9. **Com a flag desligada, nada muda.** `NOD_COMPUTADORES` diferente de `motor` não cria linha `por_pessoa`; o modo
   `docker` segue um computador por bot.

### Desvio do plano: o índice único tem discriminador

O plano pedia `UNIQUE (tenant_id, owner_id) WHERE arquivado_em IS NULL`. Isso quebraria a flag desligada (o modo
docker cria uma linha por bot da mesma pessoa) e o deploy falharia em quem já tem dois bots com computador. A 0106
acrescenta `computadores.modelo` (`por_bot`, padrão, ou `por_pessoa`) e o índice vale só para `modelo = 'por_pessoa'`.
As colunas de `computadores` que passam a ser da tela (controle, política, ajuda, reserva) ficam paradas no modelo
`por_pessoa` e saem numa migração posterior.

## Registrado, sem medida

- **Memória por tela é estimativa**, não medida (o comando caiu em aprovação): Xvfb 1280×800×24 ≈ 20–40 MB, openbox
  ≈ 10 MB, processo da tela ≈ 50 MB, Chromium com uma aba ≈ 250–600 MB de PSS (1–1,5 GB em sites pesados), **≈ 0,5 GB
  por tela típica**. O passo 0 do PR 2 mede com `scripts/medir-tela.mjs` (1, 3 e 6 telas) e registra aqui. A admissão
  não usa o número: usa a régua.
- **Risco do TOFU:** um processo malicioso já presente no primeiro boot poderia fixar a chave dele. A janela é curta; a
  correção é o Redefinir.
- **Alvo Debian 12 bookworm.** Ubuntu 24.04 restringe userns por AppArmor e o bwrap e o sandbox do Chrome falham: o
  motor anuncia `sem_suporte`. Trixie entra como smoke secundário no PR 7.
- **Chromium fixado pela versão do Playwright do repo** (em `/opt/nod-motor/chromium`), não o do apt, cuja versão
  diverge da API do Playwright. A segurança dele depende do Atualizar (NOD-295); alerta quando passar de 60 dias.
- Portas fora de 80/443 passam a ser permitidas; as faixas privadas e a metadata seguem bloqueadas.

## Fora

Compartilhar por workspace (bots de colegas); mais de uma máquina por pessoa; compartilhar senhas, storage e
extensões (NOD-97); tela ao vivo (NOD-95); rotear o navegador pelo Mac da pessoa; computador no Mac (NOD-93) e na
nuvem gerenciada (NOD-92/NOD-89).

## Gatilho de reversão

Mais de 1 em 10 aberturas de tela falhando por isolamento (bwrap, userns, systemd) em 14 dias de log, ou uma fuga
confirmada do uid `nod-pc` → voltar ao container, com **Podman rootless** instalado pelo motor.
