# Computador ao vivo

## O que esta fatia entrega

A sala continua sendo `web/telas/tela-cheia.ts`, aberta pelo chip do computador no chat, pelo painel e por um pedido de
ajuda. Ela mostra `Iniciando desktop`, `Conectando`, `Assistindo`, `Reconectando` e o fallback sem trocar de tela. O
motor mantém o transporte existente; o Orgo usa o mesmo WebSocket público, mas o servidor abre o upstream, valida o
host, termina VNC Auth e oferece ao noVNC uma sessão sem senha. Queda, fila acima de 8 MiB, sessão revogada, tenant ou
Origin errados e protocolo desconhecido fecham a conexão; a sala conserva o último quadro e volta a capturas.

A integração Orgo fica desligada por padrão. Uma regra `NOD_COMPUTADOR_PROVEDOR*=orgo` sozinha não monta o provedor nem
o relay: o servidor exige também `NOD_COMPUTADOR_ORGO=1`, e cada pessoa só alcança a rede depois de ter o conector
privado `orgo` com `ORGO_API_KEY` cifrada no cofre. Sem qualquer uma dessas condições, falha fechado e usa o caminho
local/fallback disponível.

Docker e Orgo entram pelo mesmo `DriverComputador` e pela mesma sala. O Docker por bot ainda declara
`telaAoVivo: "capturas"`: a tentativa de VNC é recusada e o viewer cai para capturas na própria sala. Isso prova o
fallback local, não um stream contínuo do container. Transformar o socket VNC já interno ao runtime Docker numa origem
RFB do relay é trabalho posterior e não deve ser descrito como entregue.

## Provas

Sem conta externa:

```bash
mise exec -- npx vitest run --project unit \
  tests/unit/adapters/computador-relay-vnc.test.ts \
  tests/unit/adapters/computador-provedores.test.ts \
  tests/unit/adapters/computador-vivo.test.ts \
  tests/unit/voz/ws-vivo.test.ts \
  tests/unit/web/tela-cheia.test.ts
mise exec -- npm run typecheck
```

O teste do relay usa VNC Auth de verdade, dois blocos diferentes de framebuffer, filtro de entrada, allowlist e o contrato comum:
Orgo pareia uma origem; Docker recusa sem tentar outra origem. Para a prova local real do Docker, construa a imagem,
rode `node scripts/smoke-computador.ts` e abra a sala: ela deve passar pelos mesmos estados e entrar em capturas.

Para a prova Orgo real, o servidor precisa de `NOD_COMPUTADOR_ORGO=1`, escolha `orgo` em
`NOD_COMPUTADOR_PROVEDOR*` e um conector privado `orgo` com `ORGO_API_KEY` cifrada no cofre da pessoa. Nunca coloque a
chave em `.env`, argumento, log ou shell history. Com servidor `NOD_LOGIN=stub` já apontando para esse banco:

```bash
mise exec -- node scripts/ensaio-computador/vivo.ts \
  --formato orgo --api http://127.0.0.1:8889 \
  --tenant <tenant-uuid> --pessoa <pessoa-uuid> --agente <agente-uuid>
```

O ensaio só assiste: acorda pelo caminho normal, abre `?modo=assistir` e prova que o navegador recebe o handshake sem
senha. Nesta entrega a execução real está bloqueada enquanto não existir no produto um meio seguro de cadastrar o
conector `orgo`; a ausência de `ORGO_API_KEY` não é substituída por fixture nem por variável de ambiente.

## Telas, desktop e aplicativos

Uma “screen” do Bot HQ é um display X separado do mesmo computador, normalmente alugado a um bot. Não é um monitor do
bot. A navegação correta no Nod é entre bots/telas pelo chat e pelo painel; abrir um bot abre a sala da tela dele. Esta
fatia não cria uma lista falsa de quatro monitores. O contrato do relay não impede até quatro displays quando o
provedor e o vínculo bot→display existirem, mas esse aluguel ainda não existe no modelo do Orgo do Nod.

Também não entram aqui o `hq-shell.py`, dock, home personalizada, Browser/Terminal/Files nem launchers. Hoje Docker usa
a imagem `nod-computador:1` e Orgo nasce de uma imagem Linux genérica. A próxima fatia deve extrair um bootstrap
idempotente e versionado (wallpaper/tema, shell, dock, home por bot e launchers), executável no build do Docker e pelo
`bash` do Orgo, com teste de versão e sem credenciais na imagem. Só depois disso os dois formatos terão o mesmo desktop,
além da mesma sala.
