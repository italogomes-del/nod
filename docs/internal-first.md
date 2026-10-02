# Interno primeiro

O nod deixou de ser um SaaS B2B e virou ferramenta de uso interno, para um time pequeno. Este documento registra o que mudou na arquitetura, e o que foi protegido para que virar SaaS depois não seja reescrita.

---

## A tese

O nod deixou de ser um SaaS B2B e virou uma ferramenta de uso interno para um time pequeno. A mudança maior não é de escala — é de LUGAR. O trabalho sai do nosso container e vai para a máquina de cada pessoa do time, pilotando o Claude Code, o Cursor ou o Codex que a pessoa já tem instalado e logado. O nod nunca vê essa credencial: ela mora no Keychain do macOS, sob a sessão da pessoa, e o processo filho a resolve sozinho. Em troca, a organização para de pagar a conta dos turnos do dia a dia — cada pessoa usa a própria assinatura, custo zero — e paga só pelas rotinas noturnas, que rodam no servidor com uma chave de API da empresa. Os dados continuam num Postgres da organização, porque é o que permite ver o trabalho dos outros e é o que mantém a porta do SaaS aberta sem pagar o custo do multi-tenant agora.

O que muda na arquitetura tem um nome: o isolamento não desapareceu, MUDOU DE EIXO — e o eixo novo é mais difícil que o antigo, não mais fácil. Entre 70 clientes, nenhuma linha legitimamente se encontrava e o tenant_id separava tudo sozinho. Entre as pessoas de um mesmo time num banco só, a fila é MISTA de propósito: você quer que outra pessoa do time veja seu trabalho, e ao mesmo tempo o seu agente privado não é dela. Isolamento com exceções legítimas é exatamente onde filtro de aplicação falha — e o projeto de referência das [práticas herdadas](praticas-herdadas.md) já tem essa cicatriz no CHANGELOG. Por isso a resposta sobre RLS se separa em três coisas que costumam virar uma: a POLICY sobre tenant_id = 1 é cerimônia sem função e sai; a COLUNA tenant_id fica, dentro de toda chave, porque custa 16 bytes e retrofitá-la é reescrever o protocolo do fio; e o MECANISMO (role sem bypass, SET LOCAL em helper único, teste contra o catálogo) nasce ligado no dia 1, só que apontado para a PESSOA. Ele custa a mesma tarde e agora compra defesa real desde o primeiro usuário, em vez de uma apólice para clientes que não existem.

---

## As três coisas que precisam ser feitas agora

Não porque há uso imediato — porque são impossíveis de retroagir.

### 1. AS TRÊS COLUNAS DE ESCOPO NA MIGRAÇÃO 0001, COM O DEFAULT 'PRIVADO' LIGADO

São tenant_id (com DEFAULT da constante TENANT_PADRAO, dentro de toda UNIQUE e toda FK), owner_id, e visibility como enum fechado com default 'privado' — mais o helper db/tx.ts com DOIS SET LOCAL obrigatórios que LANÇA ERRO se algum vier vazio, em vez de deixar o Postgres devolver zero linhas em silêncio. POR QUE É IMPOSSÍVEL RETROAGIR: o tenant_id tem dois custos e o segundo é o que mata — o ALTER TABLE é barato, mas o par (tenant_id, id) atravessa o fio, a URL e cada linha da trilha imutável, e o ADR-005 já precificou isso como 'mudança de contrato de cliente, não migração de dados'. O visibility é pior ainda: adicioná-lo depois exige responder, para cada linha já gravada, de quem ela era e QUEM JÁ A LEU — e a segunda pergunta não tem resposta técnica. Custo hoje: uma tarde. Custo depois: semanas mais um incidente de confiança do qual uma ferramenta de time pequeno não se recupera. ATENÇÃO: isto exige uma decisão sua antes de qualquer código, porque duas frentes discordaram frontalmente — uma quer a policy sobre pessoa no dia 1, a outra chamou isso de 'o erro caro'. Recomendo a primeira, e o critério de aceite de E3.1 a sustenta por escrito.

### 2. AUTORIA COMPOSTA NO EVENTO, NA PRIMEIRA MIGRAÇÃO

Três campos: autor_tipo (pessoa | agente), autor_id, e sob_procuracao_de. Junto com eles, os campos que dizem ONDE e SOB QUE REGRA o turno rodou: executor, locality, locality_reason, machine_id e decidido_por. POR QUE É IMPOSSÍVEL RETROAGIR: a trilha é imutável por trigger, então campo ausente é ausente para sempre — 'limpar' não é DELETE. E isto é a maior omissão de toda a rodada: autoria composta é o item nº1 da lista 'acertar de primeira' do seu próprio README, marcada como obrigatória na primeira migração, com o aviso de que 'retrofitar reescreve toda renderização de mensagem e toda regra que pergunta foi uma pessoa?'. Nenhuma das quatro frentes a mencionou. E a premissa nova AGRAVA em vez de aliviar: agora o agente roda sob a assinatura PESSOAL de quem o disparou, na máquina dela, com a credencial dela. 'Foi a pessoa ou foi o agente dela?' deixou de ser questão de produto e virou questão de trilha, de custo e de LGPD ao mesmo tempo. Custo hoje: três campos num tipo. Custo depois: a renderização inteira, sobre uma trilha que não aceita reescrita.

### 3. A REGRA, ESCRITA E VERIFICADA POR TESTE, DE QUE NENHUMA DECISÃO DO PRODUTO EXIGE O APP DESKTOP ABERTO

Um teste de fumaça que roda todo endpoint de decisão, aprovação, leitura de fila e leitura de trilha com o app local fechado, e falha o CI se algum depender dele. POR QUE É IMPOSSÍVEL RETROAGIR: não é código, é suposição acumulada. Cada semana em que a web puder degradar, alguma decisão de produto vai assumir silenciosamente que o app está aberto — e descobrir quais foram exige reler o produto inteiro. A estimativa honesta de reconstruir a web completa depois é de 6 a 10 semanas de uma pessoa, e o custo não é a UI: é a arqueologia. Respeitada a regra, o SaaS nasce web-only com executor de servidor e o desktop vira upgrade opcional — que é um modelo comercial MELHOR que o original. Violada, o SaaS herda 'todo cliente instala um app', que é o mais difícil de vender para TI de RH, e a resposta que o ADR-020 tinha pronta ('funciona inteiro no navegador') deixa de existir. Custo hoje: uma linha de política e um teste.

---

## O que cai

- A POLICY de RLS sobre tenant_id. Com um tenant só ela não impede vazamento nenhum e ainda cobra o fail-closed silencioso que o próprio ADR-003 já temia ('a fila apareceu vazia'). A coluna fica, o mecanismo fica, a policy muda de alvo.
- O CLI no container como caminho padrão (ADR-014). Cada pessoa já paga a própria assinatura e já está logada — insistir no container seria pagar pela chave de API um trabalho que a assinatura já cobre. O container continua vivo, mas só nas rotinas noturnas.
- A tabela de credencial por pessoa, a cifra em banco e o health check de decifra no boot (ADR-015). Não há credencial de pessoa do time para guardar: ela mora no Keychain da pessoa e o nod nunca a toca. Sobra UMA chave da organização, que é um secret do PaaS.
- O PWA, em desktop e em mobile. Ele existia como sucedâneo do app instalável, e o app instalável agora existe. Duas superfícies (desktop e web) é a conta certa; três é a matriz de teste que o ADR-020 usou para rejeitar mobile.
- Mobile nativo, agora SEM gatilho. Os três gatilhos antigos dependiam de cliente pagante ou decisão comercial e não podem mais disparar. Gatilho que não pode disparar é pior que nenhum: dá a impressão de que a decisão está viva quando está parada.
- E11 inteiro (browser com procuração): cinco histórias, 5-6 semanas, o épico mais longo do backlog. Ele existe para operar PORTAIS DE CLIENTE em nome deles. Uma pessoa do time que precisa de um portal abre o portal — tem a máquina e tem o login. Some junto o bloqueio jurídico de retenção de screenshot com dado pessoal sensível.
- E10.6 (assinatura pessoal como exceção enterprise) some COMO EXCEÇÃO: com a inversão do ADR-014 ela deixa de ser caso de borda atrás de validação jurídica e vira o caminho padrão. A história não é cortada, é promovida.
- E10.2 (catálogo de motores com três níveis de privilégio, entradas de cliente que não podem declarar ícone remoto). O mecanismo inteiro de privilégio existia para conter clientes hostis. Sobra uma tabela de catálogo simples.
- A reverificação de alcance de canal na borda de CADA CHAMADA de ferramenta (parte de E6.4). Vira allowlist por pessoa mais capacidades por agente. ATENÇÃO: a reverificação na borda do DESPACHO continua — com a fila durável e a ponte, a janela entre enfileirar e despachar ficou MAIOR, não menor.
- Metade das 22 histórias ancoradas nas duas personas do lado do cliente (a gerente convidada externa e a head de operações que adotou só a Frota). Duas das cinco jornadas que geraram os épicos morrem inteiras com uso interno — e o spec diz em letras maiúsculas que 'os épicos saíram daqui, não de uma lista de features'.
- Três das sete métricas do ADR-017: duração de checkout do pool, distância até a partição futura, taxa de resumed:false. São métricas de escala que um time pequeno não tem.
- O electron-updater. Verifiquei: 15.949 das 39.883 linhas de electron/ do openmausbot são o updater VENDORIZADO dentro do repo. Em lugar dele, um campo na resposta HTTP dizendo a versão mínima aceita.

## O que fica

- O SPI de três camadas (ADR-012), com UM campo novo. A frase que o justificava — 'a organização tem uma assinatura e três chaves' — ficou mais verdadeira, não menos: agora é uma assinatura pessoal por pessoa e uma chave da organização. E a camada Instance é literalmente 'conta viva com credencial e catálogo', que é onde se pendura 'a conta da Fulana na máquina dela'.
- A trilha imutável por trigger, com o CHECK proibindo texto livre (ADR-004). Não afrouxa uma vírgula: os dados pessoais continuam em jogo, a LGPD não pergunta quantas empresas usam o software, e uso interno gera MAIS texto informal e menos revisão.
- A classificação de dado pessoal por ORIGEM com default fechado (ADR-002). Vários da rodada trataram 'dado pessoal' como problema de multi-tenant. Não é: os clientes que uma pessoa do time atende são dados que a organização opera hoje, internamente.
- O par (tenant_id, id) em todo identificador que sai do servidor, e tenant_id dentro de toda UNIQUE e FK. Custa 16 bytes por linha e zero linha de código; retrofitar é reescrever o protocolo do fio, a URL e cada linha de trilha já gravada.
- As três regras da sonda (ADR-019), sem tirar vírgula — e a regra 2 (identidade do fornecedor é PROIBIDA para autorizar) fica MAIS importante, porque com o time inteiro logado em contas pessoais a tentação de usar o login do Claude como login do nod é enorme e economizaria uma tela.
- O proxy MCP inteiro, com as quatro responsabilidades (ADR-013), rodando onde o CLI roda e com autoridade local. Ele sempre defendeu o AGENTE, não o dono da máquina — e o agente não é admin da máquina.
- Os três estados da fila com prazo absoluto (ADR-010), que ficam MAIS necessários: laptop fechado deixa de ser falha rara e vira evento diário.
- O particionamento por tempo e a ausência de catch-all (ADR-006) — a chave é irreversível e o catch-all ausente é o que torna a falha barulhenta.
- A configuração de busca portuguese+unaccent como objeto de banco e a allowlist positiva (ADR-008) — a parte cara e recorrente. O índice e o rebuild esperam.
- O pacote único (ADR-018) e o core guardado pelo COMPILADOR, não por lint.
- E4 inteiro, e especialmente E4.2 (item que toca dado pessoal nasce desmarcado, por origem). É a história MENOS afetada pela mudança de premissa em todo o backlog — e o bloqueio jurídico que a trava continua valendo integralmente, com o mesmo lead time.
- E3.3, E5.2 e E7.5 (estados negativos escritos, parada que nomeia o que falta, 'passou em branco'). O princípio 1 do produto — 'vazio nunca significa vazio' — é exatamente a sua decisão 4 chegando pelo outro lado.
- O alarme externo de disponibilidade e o union fechado de rótulos de métrica. O primeiro é o único item que acorda alguém; o segundo impede que id ou email de uma pessoa vire rótulo de métrica.

---

## A ponte: app local ↔ servidor

COMO FUNCIONA, EM UMA FRASE: o seu computador liga para o servidor e pergunta "tem trabalho para mim?". O servidor nunca liga para o seu computador. Ele nem sabe o endereço dele.

Isso resolve de graça um problema que custou caro nos dois repositórios estudados. Para deixar algo de fora alcançar uma máquina você precisa atravessar o NAT do roteador — e o companion/ inteiro do openmausbot existe só para isso: um processo intermediário que recebe o pedido do celular e o "reencena" contra 127.0.0.1 para enganar a defesa de DNS-rebinding do harness, mais pareamento de dispositivo, mais token por dispositivo, mais ranqueamento de interfaces de rede (porque a primeira pode ser uma utun que o outro lado não roteia), mais um aviso no README de que a rota de LAN é texto claro. Nada disso existe quando a máquina é quem disca.

OS CINCO VERBOS. Tudo é POST do app para o servidor, HTTP comum:

1. conectar — a máquina se anuncia: um id de instalação, o nome ("macbook do Marlon"), o inventário de motores que a sonda do ADR-019 levantou (tenho Claude Code 2.1.4 autenticado, tenho Cursor não autenticado, não tenho Codex) e a versão do contrato da ponte.
2. puxar — long-poll. O servidor segura a requisição aberta por até 20 segundos esperando aparecer trabalho; se aparecer antes, responde na hora. Sem trabalho, devolve 204 e o app chama de novo imediatamente. O cliente corta em 35 segundos — a folga de 15s é deliberada, para o cliente nunca desistir antes de o servidor responder.
3. renovar — de 30 em 30 segundos enquanto o turno roda. Essa é a mensagem que carrega tudo o que é periódico: o lease (dizendo "ainda estou viva e ainda estou com este turno"), os quatro sinais do ADR-009, e o lote de eventos que o turno gerou desde a última renovação. Se a resposta vier {ativo:false}, o app aborta o turno.
4. entregar — o resultado final, uma vez só.
5. desconectar — saída limpa, melhor esforço.

POR QUE LONG-POLL E NÃO SSE OU WEBSOCKET. SSE é difusão: entrega o mesmo frame a todos os conectados. Para trabalho isso é exatamente errado — se você tem desktop e laptop ligados, os dois receberiam o mesmo turno e os dois começariam. Corrigir significa reintroduzir reivindicação por cima do stream, ou seja, long-poll disfarçado. E SSE não tem caminho de volta: o app precisaria de POST para renovar e entregar de qualquer jeito, então o SSE substituiria só um dos cinco verbos, a troco de um segundo contrato de resume para manter. WebSocket resolveria, mas traz reconexão, keepalive, detecção de half-open e proxies corporativos que cortam conexão ociosa — e o long-poll ganha detecção de morte de graça, porque a AUSÊNCIA do próximo poll já é o sinal.

Os dois canais nunca se conhecem: o SSE do ADR-016 leva eventos do servidor para o NAVEGADOR; a ponte leva trabalho do servidor para a MÁQUINA. O app manda eventos por POST, o servidor grava, e o SSE os lê e leva ao navegador sem saber que vieram de fora.

AUTENTICAÇÃO, EM DUAS CAMADAS. Primeiro você entra no nod pelo navegador com uma conta Google cujo e-mail está no cadastro (NOD_GOOGLE_DOMINIO, opcional, restringe a um domínio Workspace — é o que faz "quem pode usar o nod" ser a mesma pergunta que "quem está no cadastro do time", e desligar a conta de alguém que sai desliga o nod junto). Dentro da sessão, você clica em "conectar esta máquina" e o servidor emite um token de alta entropia, mostrado uma vez só, que o app guarda no Keychain. O servidor guarda apenas o SHA-256 dele, comparado em tempo constante — um dump do banco não é uma frota roubada.

O app NÃO faz OAuth do Google diretamente: isso exigiria PKCE, captura de redirect e renovação de refresh token, que é máquina real para um time pequeno, e duplicaria um login que já vai acontecer no navegador. E o app não usa o cookie da sessão do navegador (que é o que o openmausbot faz, e paga o preço: o poll morre quando a sessão expira, e sessão de navegador é pensada para expirar, enquanto o app precisa sobreviver a uma noite inteira de rotina).

A defesa de borda que vale copiar literalmente: recusar com 403 qualquer requisição que traga cabeçalho Origin, ANTES de olhar o token. App nativo nunca manda Origin; quem manda é um navegador que achou a porta. Isso elimina a classe inteira de ataque de navegador sem depender do segredo, e o token vira segunda camada em vez de primeira.

HEARTBEAT: NÃO EXISTE. Presença é derivada do próprio poll. O servidor guarda visto_em na linha da máquina e o renova a cada puxar e a cada renovar; máquina sem contato há mais de 60 segundos é declarada offline. Um heartbeat separado seria um verbo a mais, um timer a mais e uma forma nova de discordar de si mesmo (heartbeat vivo com poll morto).

REIVINDICAÇÃO: é o UPDATE condicional que o ADR-010 já tinha, não uma tabela nova. UPDATE turno SET status='despachando', machine_id=$1, lease_ate=now()+interval '90 seconds' WHERE id=(SELECT id FROM turno WHERE status='pendente' AND pessoa_id=$2 ORDER BY criado_em FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *. Se você tem desktop e laptop ligados, os dois puxam e o Postgres decide: um leva a linha, o outro recebe zero linhas e volta a esperar, sem erro. Nenhuma regra de roteamento, nenhuma máquina preferida — máquina preferida cria a pior falha possível (a preferida está desligada, o turno não anda, e nada na tela explica por quê). O que o produto DEVE fazer é mostrar onde rodou, porque a diferença é observável: os repositórios clonados podem ser outros. Fica um campo opcional maquina_exigida, nulo e sem UI, para quando alguém pedir; turno esperando máquina offline aparece na fila com "esperando o macbook" escrito.

INTERRUPÇÃO: o lease de 90 segundos, renovado de 30 em 30, dá três chances de rede ruim antes de declarar morte — é a diferença entre "wifi caiu no elevador" e "laptop fechou". Quando o lease vence, o servidor faz UMA transição, uma vez só, e ela é TERMINAL: o turno passa a interrompido, com motivo tipado (maquina_sem_contato), o machine_id de quem estava rodando, o instante do último contato, e — na mesma transação — uma entrada na sua fila com a frase do que foi interrompido. O turno NÃO volta para pendente, NÃO é oferecido a outra máquina, NÃO migra para o servidor. Retomar é ação humana com botão, e retomar cria um turno NOVO que referencia o interrompido.

Isso é a sua decisão 4, e o openmausbot chegou à mesma conclusão sozinho, com as mensagens já redigidas: "Restart/disconnect NEVER replays an operation with an unknown outcome" e "An in-flight action may have completed; inspect before retrying". A razão técnica sustenta: turno de agente não é idempotente — ele pode ter mandado mensagem, escrito arquivo ou gravado dado pessoal antes de morrer. Requeue automático é a decisão que produz efeito duplicado em dado pessoal sensível.

Uma consequência desconfortável que precisa ser dita: a parada aparece até 90 segundos depois de o laptop fechar. É o preço de não depender de aviso do sistema operacional (que não chega justamente nos casos ruins: bateria acabou, tampa fechada com rede lenta). É aceitável — quem fechou o laptop não está olhando a fila nesse minuto.

RESULTADO PARCIAL: o que a máquina já entregou em lotes anteriores fica gravado e visível, marcado como parcial. Descartar seria perder trabalho; apresentar como completo seria mentir. E se a máquina voltar e tentar entregar o resultado de um turno já marcado interrompido, o servidor ACEITA como anexo (é informação nova e valiosa) mas não reabre — reabrir é sua decisão.

O TAMANHO, que é o número que falta em toda discussão desta rodada: eu conferi o núcleo no openmausbot. server/shared-computers.ts tem 110 linhas e electron/computer-sharing.mjs tem 254. Trezentas e sessenta e quatro linhas para os cinco verbos, o long-poll, o lease e a presença derivada. A ponte parece um subsistema porque foi descrita como uma lista de exigências; ela é dias de trabalho, não semanas.

TRÊS ARMADILHAS OPERACIONAIS, todas baratas de evitar e caras de descobrir: (1) o poll não pode segurar conexão do pool enquanto espera — consulta, solta, dorme no processo; com pooler em modo transação e pool pequeno, 38 polls segurando conexão esgotariam o pool e travariam a fila global. (2) É obrigatório verificar que o proxy do PaaS não faz buffer de uma resposta que demora 20 segundos (o openmausbot manda x-accel-buffering: no justamente por isso). (3) A versão do contrato viaja em cabeçalho desde a primeira requisição, mesmo valendo sempre 1 — sem ela, um servidor atualizado e um app velho se encontram sem diagnóstico.

---

## Os 23 ADRs

| | Decisão | Status |
|---|---|---|
| ADR-001 | Modo do pooler, tamanho do pool e política de deploy | mantido |
| ADR-002 | Classificação de dado pessoal por ORIGEM, função pura, default fechado | mantido |
| ADR-003 | Isolamento em duas camadas: RLS restritiva FORCE + predicado explícito, SET LOCAL por transação | revisado |
| ADR-004 | Trilha imutável por TRIGGER, sem texto livre, prosa em tabela irmã apagável | mantido |
| ADR-005 | Uma tabela events para fluxo + tabelas de domínio para estado com regra | mantido |
| ADR-006 | Particionar events por tempo, sem catch-all | revisado |
| ADR-007 | A fila global lê por PESSOA sob RLS, item vencido em cinza, servidor é fonte da verdade do tempo | mantido |
| ADR-008 | Busca tsvector portuguese + unaccent com allowlist positiva | revisado |
| ADR-009 | Classificar falha de turno pelo ESTADO DE PROTOCOLO, quatro sinais booleanos | revisado |
| ADR-010 | Fila por conversa no Postgres, prazo absoluto | revisado |
| ADR-011 | Travas de execução: janela de rotina única, expiração idempotente | revisado |
| ADR-012 | SPI de três camadas Driver / Instance / Adapter | revisado |
| ADR-013 | O proxy MCP é o ponto de decisão do produto | revisado |
| ADR-014 | CLI do fornecedor: dois executores | invertido |
| ADR-015 | Credenciais: dois regimes opostos | revisado |
| ADR-016 | SSE com frames numerados, buffer de replay por PESSOA | revisado |
| ADR-017 | Um container, métricas ligadas a promessa de produto, alarme externo | revisado |
| ADR-018 | Core puro guardado pelo compilador, PACOTE ÚNICO | revisado |
| ADR-019 | A sonda de disponibilidade pergunta ao CLI, nunca lê a credencial | revisado |
| ADR-020 | Distribuição: app local primeiro, web obrigatória, um só ADR | invertido |
| ADR-021 | A ponte de execução: o app local puxa, o servidor nunca disca | novo |
| ADR-022 | A localidade do turno é resolvida por regra declarativa, nunca escolhida pelo agente | novo |
| ADR-023 | Autoria composta: todo evento carrega quem escreveu e sob procuração de quem | novo |

### ADR-003 — Isolamento em duas camadas: RLS restritiva FORCE + predicado explícito, SET LOCAL por transação *(revisado)*

O MECANISMO nasce ligado na migração 0001 (ENABLE + FORCE, policy RESTRICTIVE, role de aplicação NOBYPASSRLS não-dono, SET LOCAL em helper único, teste de conformidade contra o catálogo), e passa a apontar para a PESSOA. A policy do dia 1 é conjuntiva: tenant_id = current_setting('nod.tenant_id') AND (owner_id = current_setting('nod.pessoa_id') OR visibility = 'equipe' OR existe delegação). Três colunas na 0001: tenant_id (DEFAULT da constante TENANT_PADRAO, dentro de toda UNIQUE e FK — A-RLS-5 preservada), owner_id, e visibility como enum fechado com DEFAULT 'privado'. O helper db/tx.ts faz DOIS SET LOCAL, ambos obrigatórios, e LANÇA ERRO se algum vier vazio em vez de deixar o Postgres devolver zero linhas. A-RLS-4 mantido.

**Mudou.** O eixo da policy muda de tenant para pessoa. Duas colunas novas (owner_id, visibility). O helper ganha um segundo parâmetro obrigatório. A perna de tenant fica escrita na mesma policy desde já, como cláusula conjuntiva, para que o dia do SaaS custe dias.

### ADR-006 — Particionar events por tempo, sem catch-all *(revisado)*

Mantido o que é irreversível: PARTITION BY RANGE (created_at) mensal na migração inicial, e a AUSÊNCIA de partição catch-all p_future. Reduzido de 24 para 12 meses de partições criadas de uma vez. O job de boot que cria partições faltantes fica. A métrica de distância até a partição mais distante ESPERA — vira alarme quando houver volume.

**Mudou.** De 24 para 12 partições. A métrica de distância sai do dia 1.

### ADR-008 — Busca tsvector portuguese + unaccent com allowlist positiva *(revisado)*

Fixar AGORA só o que é caro em base populada: a configuração de busca própria (unaccent + portuguese_stem) criada como OBJETO DE BANCO, a coluna TSVECTOR GENERATED ALWAYS AS STORED, e a ALLOWLIST POSITIVA (o que não está na lista vira NULL). ESPERAM até haver conteúdo: o índice GIN, a extensão btree_gin, e o procedimento genérico de rebuild. Quando o índice vier, nasce escopado por (owner_id, search_tsv). Busca continua não sendo fronteira de acesso: devolve ids e a releitura reaplica a policy.

**Mudou.** Índice GIN, btree_gin e rebuild-busca.sql saem do primeiro commit e esperam volume. A configuração e a allowlist ficam.

### ADR-009 — Classificar falha de turno pelo ESTADO DE PROTOCOLO, quatro sinais booleanos *(revisado)*

Mantidos os quatro sinais (attempted, rejected, promptSubmitted, producedOutput) como colunas write-ahead obrigatórias, com promptSubmitted gravado ANTES do envio ao provedor. Acréscimo exigido pela ponte: os sinais são gravados na MÁQUINA e viajam ao servidor junto com cada renovação de lease, não só no fim do turno — porque agora o turno roda noutro processo, e sinal que não viajou é sinal perdido. Morte por lease vencido é mais uma causa de morte de turno, não um caminho paralelo: com promptSubmitted=true classifica 'after-accept' e nunca reenvia; com tudo falso é 'before-accept' e mesmo assim NÃO reenvia sozinho — vira item na fila com botão.

**Mudou.** O transporte dos sinais. Antes o turno rodava no mesmo processo que escrevia no banco; agora atravessa a ponte.

### ADR-010 — Fila por conversa no Postgres, prazo absoluto *(revisado)*

Mantidos os três estados e o prazo absoluto, e acrescentado um QUARTO estado: 'interrompido', com motivo tipado. Duas colunas novas na linha de turno: machine_id (qual máquina reivindicou) e lease_ate (instante absoluto, renovado). O prazo passa a ter dois níveis: o lease curto (90s, renovado de 30 em 30 pela máquina) e o prazo de produto que já existia. A reivindicação é o UPDATE condicional com FOR UPDATE SKIP LOCKED — não precisa de tabela nova. Lease vencido converte a linha em parada VISÍVEL com motivo escrito, nunca em reenvio.

**Mudou.** Quarto estado 'interrompido'. Duas colunas (machine_id, lease_ate). O lease como segundo nível de prazo.

### ADR-011 — Travas de execução: janela de rotina única, expiração idempotente *(revisado)*

Mantidas as duas UNIQUE — reivindicação de janela por (tenant_id, rotina_id, instante_agendado) derivado do cron mais fuso IANA, e idempotência do varredor por (decisao_id, tipo_de_evento). Mantida a recusa de offset numérico na persistência de rotina. Acréscimo: a tabela de reivindicação registra QUAL executor ganhou. MAS A JUSTIFICATIVA MUDA: a trava protege o varredor idempotente sobre a trilha imutável e o scheduler do servidor — NÃO protege contra 'N laptops disputando a janela das 8h', porque quem avalia cron é o servidor, não o laptop.

**Mudou.** Nada de mecanismo. A justificativa é reescrita, porque o cenário de frota que uma frente usou para defendê-la não existe na arquitetura de pull.

### ADR-012 — SPI de três camadas Driver / Instance / Adapter *(revisado)*

Mantidas as três camadas sem tirar uma vírgula, com UM campo novo no metadata do Driver: locality ('local' | 'servidor' | 'ambos'). O RuntimeEvent ganha executor ('local' | 'servidor') desde o primeiro evento gravado. UM Driver com campo locality, NÃO duas implementações — as duas frentes propuseram desenhos diferentes e este é o certo, porque duas implementações divergem de comportamento com o tempo e toda a trilha fala o vocabulário de eventos. A diferença entre local e servidor é (a) de onde vem o ambiente do filho, (b) quem hospeda o processo, (c) qual proxy MCP ele monta.

**Mudou.** Um campo no Driver, um campo no evento. Resolvida a divergência entre frentes a favor de um Driver só.

### ADR-013 — O proxy MCP é o ponto de decisão do produto *(revisado)*

O proxy MCP sobrevive INTEIRO e roda onde o CLI roda: local no executor local, no container no executor de servidor. A autoridade é LOCAL (loopback), como sempre foi. Mantidas as quatro responsabilidades: montar as ferramentas do turno, classificar negação em terminal ou transitória, cortar resultado acima do orçamento antes de entrar no contexto, e construir a aprovação tipada item a item. ADIA: a reverificação de alcance de canal derivado de composição viva (E6.4) na borda de cada chamada — vira allowlist por pessoa mais capacidades por agente, com o alcance de canal reverificado na borda do DESPACHO (que continua valendo, porque a fila durável ficou mais longa, não mais curta). RECUSADA a proposta de endpoint de decisão síncrono no servidor com fail-closed. O que FICA do instinto correto daquela proposta: o EVENTO grava quem decidiu e sob qual versão de regra, desde o primeiro turno.

**Mudou.** Adia a reverificação de alcance na borda de cada CHAMADA (mantém na borda do despacho). Recusa a autoridade remota proposta. Grava decidido_por no evento.

### ADR-014 — CLI do fornecedor: dois executores *(invertido)*

Dois executores, mesmo SPI. (A) LOCAL, o caminho padrão: o CLI é o que já está na máquina da pessoa, o nod NÃO instala e NÃO pina versão, e o processo filho HERDA o ambiente para o CLI resolver a própria credencial. Some o pin exato, some a imagem, some o teste de fumaça contra imagem construída. Entram: a resolução de caminho do binário (o PATH pelado de app aberto pelo Finder) e a tabela de flag floors, que fica MAIS necessária. (B) SERVIDOR, só para rotinas noturnas: o ADR-014 original sobrevive inteiro — container, CLI pinado em versão exata, teste de fumaça no CI, chave da organização. Em ambos: --strict-mcp-config e --setting-sources project desde o primeiro dia, e diretório de trabalho por turno apagado ao fim.

**Mudou.** A inversão. O CLI sai do container e vai para a máquina no caminho padrão; o container fica vivo no caminho noturno.

### ADR-015 — Credenciais: dois regimes opostos *(revisado)*

Dois regimes com posturas OPOSTAS. (A) LOCAL: não existe credencial da organização para guardar. A assinatura é da pessoa, mora no Keychain, e o nod NUNCA a lê, transporta ou persiste. Some tenant_credential do caminho local e some o health check de decifra. O ambiente parte de {...source} com DENYLIST curta apagando ANTHROPIC_API_KEY herdada e qualquer chave da organização. (B) SERVIDOR: UMA chave da organização como secret do PaaS — sem tabela, sem cifra, sem health check. Aqui o ambiente CONTINUA partindo de objeto vazio com allowlist fixa. O teto de gasto pré-turno é MANTIDO e vale só para o servidor. Três mitigações obrigatórias hoje: a montagem de ambiente é UMA função pura com o regime como parâmetro; a leitura da chave passa por UMA função; a tabela de gasto nasce com owner_id e executor.

**Mudou.** A tabela de credencial e a cifra passam a guardar só a chave da organização. O ambiente local inverte de allowlist para denylist.

### ADR-016 — SSE com frames numerados, buffer de replay por PESSOA *(revisado)*

Mantido o SSE inteiro e exclusivamente para o canal servidor→NAVEGADOR. A ponte servidor↔máquina NÃO usa SSE. CORREÇÃO OBRIGATÓRIA: a chave do buffer de replay troca de tenant para PESSOA. Fixar no dia 1 o que é caro depois: o CONTRATO de resume (streamId, numeração, a condição replayBuffer[0].seq <= since+1, e a regra de nunca fazer replay parcial), porque ele vive nos dois lados ao mesmo tempo. Buffer e replay nascem triviais; o jitter no backoff entra desde já porque é uma linha.

**Mudou.** A chave do buffer: de tenant para pessoa. O contrato de resume é fixado; o dimensionamento do buffer espera.

### ADR-017 — Um container, métricas ligadas a promessa de produto, alarme externo *(revisado)*

O container único sobrevive, com menos gente dentro: web, fila, trilha e o executor de SERVIDOR. O endpoint de long-poll mora NELE. As sete métricas caem para QUATRO: (1) idade da pendência mais velha não decidida; (2) taxa de expiração por falta de decisão, COM OS DOIS RÓTULOS (expirou_sem_ninguém_ver / expirou_com_alguém_ciente); (4) turnos retomados versus perdidos após restart, agora com rótulo separando restart do servidor de máquina sumida; (5) custo do executor de servidor no mês. Entra uma quinta: quantas máquinas estão com poll aberto agora, por pessoa. Saem: duração de checkout do pool, distância até a partição futura, taxa de resumed:false. O alarme externo PERMANECE. Rótulo como union fechado em TypeScript permanece, com o campo de tenant JÁ DECLARADO no tipo.

**Mudou.** De sete para cinco métricas. A (2) é DEVOLVIDA com os dois rótulos depois de uma frente a ter cortado.

### ADR-018 — Core puro guardado pelo compilador, PACOTE ÚNICO *(revisado)*

O pacote único sobrevive sem emenda de princípio. A árvore ganha duas pastas: desktop/ (processo principal do Electron, preload, e o cliente que puxa trabalho) e executor/ (spawn da CLI, montagem de PATH, classificação de resultado — compartilhado entre os dois executores). O mecanismo não muda: tsconfig por alvo de build. desktop/ ganha tsconfig próprio com lib sem DOM e types node+electron. TRÊS FRONTEIRAS NOVAS guardadas pelo compilador: desktop/ importa contracts/ e executor/, e NUNCA db/ nem http/; executor/ não importa db/; web/ continua só importando type de contracts/. O esqueleto commitado antes da lógica permanece.

**Mudou.** Duas pastas, um tsconfig, três regras de fronteira.

### ADR-019 — A sonda de disponibilidade pergunta ao CLI, nunca lê a credencial *(revisado)*

Mantidas as três regras acopladas sem tirar uma vírgula: (1) presença de variável de ambiente nunca é prova de autenticação; (2) a identidade que o CLI reporta é cosmética e PROIBIDA para autorização; (3) contrato de snapshot com três estados e gate pré-spawn que recusa o turno antes de gastar. Acréscimo: a sonda vira o mecanismo de INVENTÁRIO. O app local publica o snapshot no servidor junto com o heartbeat. O servidor guarda por pessoa: motor, disponível, autenticado, motivo, VERSÃO DO CLI e instante. Nunca credencial, nunca token, e o email do fornecedor NÃO é gravado.

**Mudou.** Ganha o papel de inventário. A versão do CLI entra porque alimenta os flag floors.

### ADR-020 — Distribuição: app local primeiro, web obrigatória, um só ADR *(invertido)*

Substitui o ADR-020 original e absorve num documento só as quatro decisões de distribuição. (1) ORDEM: app local primeiro (é o produto — sem ele não há executor), web em seguida e OBRIGATÓRIA. (2) MOTOR: Electron, macOS na v1 (arm64 e x64 single-arch), processo principal em TypeScript puro, ZERO módulo nativo, a janela carrega a web do servidor — não existe UI de desktop separada. Tauri rejeitado com motivo escrito: cobra Rust exatamente na metade onde mora todo o valor do app. (3) ASSINATURA: Developer ID + notarização desde a primeira versão (99 USD/ano); Windows NÃO assina. (4) AUTO-UPDATE: só a verificação de versão mínima — o servidor devolve a versão mínima aceita em toda resposta de trabalho e o app recusa trabalhar abaixo dela. Nenhuma linha de electron-updater. Mobile: descartado, a web responsiva decide no celular e NUNCA executa. A REGRA QUE SEPARA TUDO: nenhuma DECISÃO do produto pode exigir o app aberto, verificada por teste de fumaça com o app fechado.

**Mudou.** Inversão da ordem. Quatro ADRs propostos viram um. Mobile perde os gatilhos (dependiam de cliente pagante) e é descartado sem gatilho.

### ADR-021 — A ponte de execução: o app local puxa, o servidor nunca disca *(novo)*

O app local é o único que inicia conexão. Cinco rotas HTTP, todas POST do app para o servidor: conectar (a máquina se anuncia: id, nome, inventário de motores, versão do contrato), puxar (long-poll, teto de 20s no servidor e 35s no cliente — a folga é deliberada), renovar (batida de 30s enquanto o turno roda, levando os quatro sinais do ADR-009 e o lote de eventos; resposta {ativo:false} manda abortar), entregar (o resultado, uma vez só) e desconectar. O servidor NUNCA abre conexão com a máquina, não conhece o IP e não tem rota que a alcance. Autenticação: a pessoa entra pelo navegador com uma conta Google cujo e-mail está no cadastro (NOD_GOOGLE_DOMINIO, opcional, restringe a um domínio Workspace), e dali emite um TOKEN DE MÁQUINA guardado no Keychain, do qual o servidor guarda só o SHA-256 com comparação em tempo constante. Toda requisição com cabeçalho Origin é recusada com 403 ANTES de olhar o token. PRESENÇA é derivada do próprio poll (sem heartbeat separado). Turno órfão por lease vencido vira 'interrompido' com motivo tipado, numa transição terminal e idempotente por constraint — NÃO volta para pendente, NÃO é oferecido a outra máquina, NÃO migra para o servidor. Duas máquinas da mesma pessoa competem e o SKIP LOCKED decide; o produto MOSTRA onde rodou. O TAMANHO: o núcleo verificado no openmausbot é 110 linhas de servidor + 254 de cliente = 364 linhas.

**Mudou.** Novo. É o único mecanismo desta rodada que não existia em nenhum ADR.

### ADR-022 — A localidade do turno é resolvida por regra declarativa, nunca escolhida pelo agente *(novo)*

Todo turno nasce com locality já resolvida por uma função PURA que recebe (origem do turno, se toca dado pessoal, motor exigido, pessoa dona) e devolve 'local' ou 'servidor' com um motivo TIPADO. A regra da v1 cabe em três linhas: conversa e trabalho do dia rodam LOCAL; rotina agendada roda no SERVIDOR; turno que exige motor ausente do inventário da pessoa é RECUSADO com motivo, nunca silenciosamente promovido. O agente NÃO escolhe e não tem ferramenta para pedir troca de executor. Turno local interrompido não migra. locality, locality_reason, executor e machine_id são gravados no evento desde o primeiro turno.

**Mudou.** Novo. É a regra que impede o agente de escolher com qual credencial gasta.

### ADR-023 — Autoria composta: todo evento carrega quem escreveu e sob procuração de quem *(novo)*

O RuntimeEvent e a forma da mensagem carregam AUTORIA COMPOSTA desde a primeira migração: autor_tipo (pessoa | agente), autor_id, e sob_procuracao_de (pessoa_id, nullable). A renderização deriva daí a assinatura no formato 'Vera · por Marlon'. Toda regra que pergunta 'foi uma pessoa?' lê autor_tipo, nunca infere de outro campo. O campo entra em contracts/evento.ts no commit 2 (o dos tipos), antes de qualquer lógica.

**Mudou.** Novo — mas não é ideia minha: já estava escrito em contracts/evento.ts no esqueleto e é o item nº1 da lista 'acertar de primeira' do README.

---

## Esqueleto

```
nod/
├── package.json                 # UM pacote. Sem workspaces. O openmausbot TINHA
│                                #   pnpm-workspace.yaml e mesmo assim deixou electron/
│                                #   como pasta da raiz. O repo que tinha a ferramenta
│                                #   escolheu não usá-la.
├── tsconfig.base.json           # strict, target moderno, paths
├── tsconfig.core.json           # types: [] e lib sem DOM — o COMPILADOR guarda o core
├── tsconfig.server.json         # core, db, http, executor, agent, contracts
├── tsconfig.desktop.json        # NOVO: lib sem DOM, types node+electron.
│                                #   O processo principal do Electron não tem DOM.
├── tsconfig.web.json            # web, contracts (só type)
├── eslint.config.js             # as fronteiras que o compilador não cobre:
│                                #   desktop/ ↛ db/ e desktop/ ↛ http/  ← a regra
│                                #   que impede o app de virar um segundo servidor
├── Dockerfile                   # só o executor de SERVIDOR: CLI pinado por versão
│                                #   EXATA. Sem as libs do Chrome.
├── .github/workflows/ci.yml     # tipos, lint, unit, conformidade de RLS,
│                                #   fumaça do CLI, "web viva sem o app",
│                                #   e a checagem que falha se aparecer .node no pacote
│
├── contracts/                   # O ARTEFATO MAIS CARO. Uma pessoa só até estabilizar.
│   ├── evento.ts                # RuntimeEvent: denials[], source,
│   │                            #   AUTORIA COMPOSTA (autor_tipo, autor_id,
│   │                            #   sob_procuracao_de)  ← ADR-023
│   │                            #   + executor, locality, locality_reason,
│   │                            #   machine_id, decidido_por
│   ├── decisao.ts               # DecisaoId = { tenantId, id } — o par, sempre
│   ├── item-aprovacao.ts        # item tipado: estado, origem, autoria da marcação
│   ├── turno.ts                 # os 4 sinais de aceitação, obrigatórios
│   ├── frame.ts                 # frame SSE com pessoa_id no envelope  ← mudou
│   └── ponte.ts                 # NOVO: os cinco verbos, versão de contrato
│
├── core/                        # ZERO I/O. Recebe `now` como parâmetro.
│   ├── dado-pessoal.ts          # classifica por ORIGEM. Default: TOCA. (ADR-002)
│   ├── aprovacao-item.ts        # origem sensível nasce desmarcada
│   ├── parada-alcada.ts         # negação TERMINAL vs TRANSITÓRIA (E5.1)
│   ├── retomada-turno.ts        # os 4 sinais → before/after/unknown (E9.1)
│   ├── fila-frota.ts            # agrupa por PESSOA e por AGENTE  ← mudou o critério
│   ├── relogio.ts               # os DOIS relógios: decisão e execução
│   ├── rotina-janela.ts         # instante canônico do cron + fuso IANA
│   ├── canal-responde.ts        # política de 3 valores; menção sempre vence
│   ├── canal-orcamento.ts       # 4 regras + quebra-anel; rotina isenta
│   ├── montagem-ferramentas.ts  # catálogo ∩ agente ∩ alcance do canal
│   ├── ambiente-executor.ts     # UMA função, o REGIME como parâmetro:
│   │                            #   'servidor' parte de {} com allowlist;
│   │                            #   'local' parte de {...source} com denylist.
│   │                            #   Teste: chave no ambiente do servidor não sai.
│   ├── localidade-turno.ts      # NOVO (ADR-022): (origem, toca dado pessoal?, motor,
│   │                            #   pessoa) → local|servidor + motivo tipado
│   └── redacao.ts               # texto que encerra, nunca convida
│
├── db/
│   ├── tx.ts                    # DOIS SET LOCAL obrigatórios (tenant, pessoa).
│   │                            #   LANÇA ERRO se algum vier vazio — nunca deixa
│   │                            #   o Postgres devolver zero linhas em silêncio.
│   ├── migrations/
│   │   ├── 0001_fundacao.sql
│   │   └── _make_scoped_table.sql # tenant_id(default) + owner_id +
│   │                              #   visibility(default 'privado') + ENABLE +
│   │                              #   FORCE + policy conjuntiva, num script só
│   ├── conformidade.test.ts     # pg_policies, pg_constraint, pg_proc (A-RLS-1..5)
│   └── repos/                   # uma função por consulta, predicado explícito
│
├── http/
│   ├── sse.ts                   # buffer POR PESSOA  ← a correção do ADR-016
│   ├── ponte/                   # NOVO: os cinco verbos (~110 linhas)
│   │   ├── conectar.ts          #   recusa Origin ANTES de olhar o token
│   │   ├── puxar.ts             #   long-poll 20s; NÃO segura conexão do pool
│   │   ├── renovar.ts           #   lease + os 4 sinais + lote de eventos
│   │   ├── entregar.ts          #   idempotente por (turno_id, seq_local)
│   │   └── desconectar.ts
│   ├── snapshot-frota.ts
│   └── rotas/
│
├── agent/
│   ├── despacho.ts              # reivindica (tx curta) → roda FORA de tx → assenta
│   ├── mcp-proxy.ts             # O PONTO DE DECISÃO, autoridade LOCAL (ADR-013)
│   ├── varredor-expiracao.ts    # idempotente por constraint
│   ├── varredor-lease.ts        # NOVO: lease vencido → 'interrompido' com motivo
│   └── scheduler-rotina.ts      # só no servidor; reivindicação única
│
├── executor/                    # NOVO: o que sabe rodar um turno.
│   │                            #   COMPARTILHADO pelos dois executores —
│   │                            #   é o mesmo trabalho em máquinas diferentes.
│   ├── spawn.ts                 # recebe a identidade de quem pede como PARÂMETRO
│   ├── path.ts                  # augmentedPath: o PATH pelado do Finder
│   ├── flag-floors.ts           # uma versão de CLI por máquina, não uma pinada
│   └── drivers/
│       ├── spi.ts               # Driver(+locality) / Instance / Adapter
│       └── claude-cli.ts
│
├── desktop/                     # NOVO: Electron. NÃO importa db/ nem http/.
│   │                            #   Guardado pelo compilador, não por intenção.
│   ├── main.ts                  # janela + ciclo de vida. Fica pequeno de propósito:
│   │                            #   main.mjs do openmausbot tem 2.647 linhas e é
│   │                            #   onde mora a bifurcação servidor-embutido/remoto.
│   ├── preload.ts
│   ├── cliente-ponte.ts         # os cinco verbos do lado da máquina (~254 linhas)
│   └── versao-minima.ts         # recusa trabalhar abaixo da versão que o servidor diz
│
└── web/                         # funciona SOZINHA, sem o desktop. Testado no CI.
    ├── estado/reducer.ts        # (estado, acao) → estado. Sem I/O.
    └── lib/live-events.ts       # transporte atrás de interface de 4 campos + JITTER
```

## Primeiros passos

1. ANTES DE QUALQUER CÓDIGO — três decisões que só você pode tomar. (a) Corta E11 (browser com procuração)? Recomendo sim: 5-6 semanas, o épico mais longo, existe para operar portais de cliente, e some junto um bloqueio jurídico. (b) A policy do dia 1 mira pessoa ou tenant? Duas frentes decidiram o OPOSTO e a contradição chegou até você sem ninguém sinalizar — recomendo pessoa, e o critério de aceite de E3.1 sustenta. (c) Qual é o default de PRODUTO quando alguém cria uma conversa: o nod pergunta a visibilidade, assume privado, ou assume equipe? Default privado no banco com UI que sempre marca equipe é o mesmo vazamento com mais passos.
2. ESTA SEMANA, EM PARALELO A TUDO: comece o parecer jurídico sobre quando um item é 'dado pessoal sensível'. Dos três bloqueios jurídicos que o spec nomeia, um morre com E11 e um morre com a procuração, mas ESTE sobrevive inteiro — o uso interno não encurtou o caminho crítico. Ele bloqueia E4.2, que bloqueia o mecanismo 2, que é metade do produto, e tem lead time próprio.
3. REPROCESSE AS JORNADAS, não as histórias. Um dia de trabalho. Duas das cinco personas (a gerente e a head de operações, ambas do lado do cliente) morrem, e com elas ~22 das 69 histórias perdem o dono. Responda três perguntas: quem substitui as duas entre as pessoas do time; qual é a jornada de 'ver o trabalho do colega' (que é um dos dois motivos que você deu para pôr os dados no servidor e não existe em nenhuma história); o Rafael continua sendo persona ou vira você. As histórias caem como consequência. Revisar 69 histórias sem tocar nas jornadas é o método que produziu quatro relatórios excelentes respondendo à pergunta errada.
4. REFAÇA A CONTA DO ORÇAMENTO. O spec dizia 38 a 44 semanas e gritava que não fechava. Cortando E11, E10.2, E10.6, a metade cara de E6.4 e dois dos três bloqueios jurídicos, a premissa DEVOLVE na ordem de 10 a 14 semanas — mas CONSOME de volta: o app desktop não estava em nenhuma fase, a ponte não estava em nenhuma fase, e a tela de 'trabalho dos outros' não existe. Quatro frentes mediram com rigor o custo de adiar o SaaS e nenhuma somou o que a premissa devolve hoje. Esse número decide se a Fase 1 cabe.
5. COMMIT 1 — Esqueleto e travas: a árvore completa com desktop/ e executor/, os cinco tsconfig, eslint com a fronteira desktop/ ↛ db/, CI rodando tipos + lint + unit. Nenhuma lógica. A prova de que a trava funciona é um arquivo em core/ que tenta importar node:fs e não compila.
6. COMMIT 2 — contracts/, decidido por UMA pessoa e revisado por todos. É o commit mais caro do repositório e o único que não deve ser feito com pressa. Inclui AUTORIA COMPOSTA (autor_tipo, autor_id, sob_procuracao_de), o par DecisaoId, os quatro sinais do turno, e os campos novos do evento: executor, locality, locality_reason, machine_id, decidido_por.
7. COMMIT 3 — Migração 0001, tudo junto e nada depois: _make_scoped_table com tenant_id(default) + owner_id + visibility(default 'privado') + ENABLE + FORCE + policy conjuntiva; events particionada com 12 meses e SEM catch-all; trilha com trigger e CHECK proibindo texto livre; tabela irmã de prosa; configuração de busca portuguese+unaccent como objeto de banco; as duas UNIQUE de reivindicação e idempotência; as colunas da ponte (machine_id, lease_ate) e o quarto estado 'interrompido'; todas as unique e FK incluindo tenant_id.
8. COMMIT 4 — db/tx.ts com os DOIS SET LOCAL obrigatórios que LANÇAM ERRO se vierem vazios, e db/conformidade.test.ts percorrendo o catálogo. Mais o teste que abre duas transações com pessoas diferentes e prova que a consulta sem WHERE devolve só as linhas certas. Sem estes dois, o resto é fé.
9. COMMIT 5 — core/ com assinatura, tipos e corpo lançando 'não implementado', mais o .test.ts irmão com o caso ADVERSARIAL já escrito e pendente. Inclui os dois arquivos novos: core/localidade-turno.ts e core/ambiente-executor.ts com o regime como parâmetro.
10. COMMIT 6 — A ponte: os cinco verbos no servidor (~110 linhas) e o cliente no desktop (~254). Junto, o teste de fumaça 'a web viva sem o app' que roda todo endpoint de decisão, aprovação, leitura de fila e leitura de trilha com o app fechado e falha o CI se algum depender dele.
11. COMMIT 7 — Dockerfile do executor de servidor com CLI pinado, o job de fumaça no CI, e a tabela de flag floors. A partir daqui o executor local e o de servidor exercitam o mesmo executor/ todo dia.

## Riscos

- A CONTRADIÇÃO SOBRE RLS POR PESSOA NÃO SE RESOLVE TECNICAMENTE. Duas frentes decidiram o oposto no mesmo ADR-003, citando o mesmo argumento, sem se citarem. Se a versão errada vencer por ser mais barata, a coluna visibility não nasce, a primeira conversa privada já foi lida, e ligar a coluna depois exige responder de cada linha 'quem já a leu' — pergunta que não tem resposta técnica. Isso é irreversível JÁ, não no dia do SaaS.
- A FRENTE DO PROXY MCP CONSTRUIU SOBRE EVIDÊNCIA FALSA, e eu verifiquei linha a linha. A tese de que 'o openmausbot já separa processo local de autoridade remota' é falsa: o control-client consulta LOOPBACK (o próprio cabeçalho diz 'two dozen loopback round trips'; container-mcp.ts:18-19 diz 'the token guards a loopback endpoint'), e a segunda prova citada (connector-proxy) também é 127.0.0.1. O registro consultado é uma trava física de mouse, deliberadamente em memória e por boot. Se essa proposta tivesse passado, o nod pagaria uma consulta WAN com 2s de timeout no caminho de cada chamada de ferramenta, em troca de uma garantia que a própria frente admitia não existir contra o dono da máquina.
- NINGUÉM LEU O PRODUCT-SPEC. As quatro frentes julgaram ADRs sem abrir o documento onde estão as jornadas que geraram os épicos. Consequência: ~32% do backlog está ancorado em duas personas do lado do cliente que deixam de existir, e ninguém percebeu. O risco não é as histórias erradas — é o método: o spec diz em maiúsculas que 'os épicos saíram daqui, não de uma lista de features'.
- O EXECUTOR DE SERVIDOR PODE VIRAR CÓDIGO MORTO QUE ACORDA NO PIOR DIA. Se a proporção for 95% local e 5% noturno, o caminho que vira principal no SaaS é o que menos rodou, e os bugs de container aparecem todos juntos no dia do primeiro cliente. Mitigação: verificar se as rotinas noturnas cobrem os mesmos TIPOS de turno que as conversas do dia. Provavelmente não cobrem.
- O DIA DO SAAS COMEÇA SEM NENHUMA LINHA DE BASE DE CUSTO POR TURNO, porque hoje o turno de conversa sai da assinatura da pessoa e não passa pelo teto de gasto. É exatamente a informação necessária para precificar. Mitigação barata: gravar tokens e custo estimado do turno local mesmo sem cobrar ninguém.
- LGPD DO USO INTERNO TEM UMA ASSIMETRIA QUE NINGUÉM TRATOU. Com o executor na máquina da pessoa, dados pessoais passam a ser processados nos laptops de cada pessoa, que a organização não controla. O diretório de trabalho por turno é apagado, mas ninguém perguntou o que o CLI do fornecedor guarda por conta própria (~/.claude, histórico de sessão, telemetria da assinatura pessoal). Isso é problema de agora, não de SaaS, e é o tipo de coisa que aparece numa auditoria.
- E3.5 (notificação externa) É P0 E PERDEU O DONO. A frente do desktop matou mobile com bom argumento e propôs WhatsApp como canal — mas E3.5 exige explicitamente NENHUM dado pessoal no corpo, 'porque e-mail e push saem do perímetro'. WhatsApp também sai do perímetro, e isso não foi checado.
- E1.2 (dono declarado no ato, sem caminho de promoção) COLIDE COM O LOGIN POR GOOGLE WORKSPACE. Login não é dono. Com um tenant só, 'dono = empresa' e 'dono = pessoa' viram a mesma linha se ninguém modelar a diferença, e a proibição de promoção — que é P0 e garantida pelo BANCO, não pela interface — perde sentido. Visibilidade de linha não é o mesmo que dono de agente, e confundir os dois é o erro que E1.2 existe para impedir.
- FAIL-CLOSED NA PONTE TEM UMA CONSEQUÊNCIA QUE VAI PARECER BUG. Internet caindo no meio de um turno faz a ferramenta ser negada, e a pessoa vai achar que o nod quebrou. Sem uma mensagem que diga exatamente isso em português, o time vai pedir para desligar a trava — e desligar a trava é perder a garantia inteira.
- A TENTAÇÃO DE REENFILEIRAR SOZINHO VAI APARECER NA PRIMEIRA SEMANA. Turno interrompido que volta para a fila é o comportamento padrão de toda fila de trabalho, e é veneno aqui: turno de agente não é idempotente. Vale escrever a proibição no código, não só no ADR.
- O ACERVO SAIU DE 20 PARA 23 ADRs. As quatro frentes propuseram 11 documentos novos depois que a premissa perdeu 69 clientes. Consolidei em três (ponte, localidade, autoria composta) e transformei o resto em emendas, mas o instinto de escrever ADR novo em vez de emendar um existente vai voltar na próxima rodada — e o sinal de alerta é simples: se o ADR novo repete o que um ADR existente já decidiu, era uma emenda.
