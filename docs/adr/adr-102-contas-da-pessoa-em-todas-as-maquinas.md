# ADR-102 — As contas de IA são da pessoa, em todas as máquinas

Status: aceito (decisões do Marlon no protótipo, 2026-10-13) · Data: 2026-10-13 · Emenda a
[ADR-101](adr-101-varias-contas-por-ia-um-diretorio-por-conta.md) (várias contas por IA) e a
[ADR-090](adr-090-o-motor-numa-maquina-linux-da-pessoa.md) (item 4: o login na VM) · Mantém a
[ADR-019](adr-019-a-sonda-de-disponibilidade-pergunta-ao-cli-nunca-le-a-cr.md) · Plano:
[plano-contas-mac-vm.md](../plano-contas-mac-vm.md)

## Contexto

A ADR-101 deu várias contas por IA ao app do Mac. A VM ficou com uma conta por IA, logada no terminal, sem relação com
as do Mac; a conta da VM no limite não tinha para onde ir; e a pessoa via as contas em duas telas que não se falavam. O
Marlon pediu para redesenhar a jornada e escolheu, no protótipo de 13/10 (canvas "Nod — tela do agente", páginas
"Contas e máquinas" e "Decisão 1 · Gestão"), os caminhos abaixo.

## Decisão

1. **Uma lista só de contas, da pessoa.** Claude e ChatGPT intercalados numa ordem só, que vale em todas as máquinas.
   Substitui a ordem das IAs da pessoa (`preferencias.ordem_ias` passa a ser derivada da lista) e a ordem das contas
   por IA do Mac.
2. **Ver em dois lugares, gerenciar em um** (opções 1A + 1B). Provedores de IA mostra e gerencia as contas (adicionar,
   entrar numa máquina, renomear, sair de uma máquina, remover, reordenar, o modo no limite). Máquinas mostra as contas
   de cada máquina e leva a Provedores filtrado por ela. Renomear e desconectar a máquina ficam em Máquinas.
3. **O login na VM é pela tela** (opção 2A, emenda o item 4 da ADR-090). O motor roda o login do CLI e manda o link (e,
   no Codex, o código do aparelho) pelo servidor. O código que a página da Anthropic devolve vai **cifrado no navegador**
   com a chave pública que o motor gerou para aquele login (RSA-OAEP 2048 envolvendo uma chave AES-GCM 256); o servidor
   só repassa: o código nunca fica em claro no servidor (memória longa, log, banco). A cifra não protege contra o próprio servidor comprometido, que serve o JS da tela (revisão R5). No Claude, o terminal continua como saída discreta (`nod-motor entrar claude`).
4. **A mesma conta em duas máquinas é reconhecida por uma impressão** (opção 3A). A máquina calcula
   `sha256("nod-conta-v1", pessoa, ia, e-mail, organização)` com o que o CLI informa e manda só o hash. O servidor casa
   as contas iguais sem ver o e-mail; a mesma conta em duas pessoas dá hashes diferentes.
5. **O servidor escolhe a conta do turno.** O plano leva `conta` (id + impressão); a máquina usa a pasta daquela conta
   (`CLAUDE_CONFIG_DIR`/`CODEX_HOME`). As regras da ADR-101 continuam, por provedor: "Perguntar antes" é o padrão entre
   contas do mesmo provedor; passar de um provedor para o outro continua automático; conta corporativa só entra na troca
   automática marcada. O limite é da conta (vale em todas as máquinas).
6. **Emenda à ADR-101, item 3:** o **apelido** e o **plano** passam a morar no servidor (o apelido é um rótulo que a
   pessoa escreve; o plano decide o selo e a regra da conta corporativa). **E-mail e organização continuam só nas
   máquinas** e aparecem na tela só dentro do app do Mac que conhece a conta. A conversa cita a conta pelo apelido.
7. **Conectar a VM:** o comando de instalação leva um convite de uso único (30 min) e a máquina se apresenta sozinha; a
   tela pede só para confirmar. O Codex vem sempre (opt-out `NOD_SEM_CODEX=1`).

## Alternativas descartadas

- **Contas dentro de cada máquina (1B sozinha).** Repete a mesma conta em várias telas e põe uma ordem por máquina.
- **Login da VM só pelo terminal (2C) ou só o Codex pela tela (2B).** Mantêm os três saltos que motivaram o redesenho.
- **Listas independentes por máquina (3B)** ou **e-mail mascarado no servidor (3C).** A primeira não diz qual conta é
  qual; a segunda emenda a ADR-019 sem precisar.
- **Copiar a credencial do Mac para a VM.** Proibido pela ADR-019 e pela cláusula da Anthropic contra intermediar
  credenciais.
- **Repassar o código do Claude em claro pelo servidor.** O servidor passaria a ver uma credencial de uso único; a cifra
  ponta a ponta custa pouco (WebCrypto no navegador, `node:crypto` no motor).

## Consequências

- Uma tabela de contas por pessoa (`contas_ia`) e uma de vínculos com as máquinas (`contas_ia_maquinas`); o turno grava
  a conta usada (`turnos.conta_id`).
- O canal servidor → máquina ganha uma puxada de contas (`/api/maquina/contas`): logins pedidos, saídas, desconectar.
- O modo local (ADR-092) continua com a tela da ADR-101.
- O app do Mac precisa da versão nova para entrar na lista; o antigo mostra a tela de hoje com o aviso de atualizar.

## Gatilho de reversão

- Um fornecedor proibir explicitamente a troca entre contas próprias (vale o gatilho da ADR-101).
- O `claude auth status`/`account/read` deixar de dizer e-mail e organização: a impressão perde a base (voltar à 3B).
- Mais de 1 em cada 10 logins pela tela falhar por um código que não chega ao CLI em 14 dias: rever a cifra e o
  repasse (o terminal continua como saída).
