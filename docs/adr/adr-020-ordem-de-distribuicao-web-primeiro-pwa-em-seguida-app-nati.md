# ADR-020 — Ordem de distribuição: web primeiro, PWA em seguida, app nativo só com gatilho

**Status** decidido · **Origem** perguntas sobre alvos de distribuição e execução local

## Decisão

O nod distribui em duas superfícies na v1: web responsiva e PWA instalável, com notificação por e-mail e WhatsApp. Desktop instalável e app mobile nativo ficam adiados com GATILHOS ESCRITOS, não com 'depois'. Quando o desktop vier, ele é CLIENTE FINO do container — janela carregando a URL, notificação nativa, deep link — nunca um segundo servidor. Mobile NUNCA executa agente: no telefone a pessoa decide, e isso é lei de plataforma além de posicionamento. Linux desktop: provavelmente nunca. Daemon local na máquina do usuário: não é produto.

## Contexto

A arquitetura foi desenhada assumindo um alvo de distribuição, e três alvos entraram na conversa. Um time de 2-3 engenheiros, com zero linha de produto escrita, precisa de uma ordem com gatilhos — senão a discussão volta a cada trimestre e cada retorno custa uma rodada de investigação.

## Alternativas rejeitadas

### Construir desktop e mobile nativos na v1, como o OpenMausBot

No OpenMausBot os alvos de distribuição custam cerca de 149 mil linhas (ios ~33k, android ~67k, electron ~40k, companion ~8k) contra ~246 mil de produto — 60% de imposto, pago por um time maior, para vender o MESMO produto em telas diferentes. Nenhuma dessas linhas é uma decisão que um gestor de RH toma. E os custos não somam, multiplicam: cada alvo novo multiplica a matriz de teste dos anteriores. O release.yml deles tem 616 linhas e 12 workflows; o do Buzz, 949 linhas e 20.

### Duas bases nativas para o mesmo protocolo (Swift + Kotlin)

É o que o OpenMausBot fez: ~31 mil linhas de Swift e ~66 mil de Kotlin, com o README do Android admitindo que :core é porte manual do CompanionCore do iOS — testes incluídos, um a um. Para 2-3 pessoas é o modo mais rápido de ter dois apps sempre meio desatualizados um em relação ao outro.

### Flutter ou React Native para nivelar

O Buzz mostra a conta honesta: ~175 mil linhas de Dart e AINDA ASSIM 30+ arquivos Swift nas bordas (picker de emoji, sanitizador de mídia, headers). Flutter não eliminou o Swift, empurrou para a periferia — o time mantém Dart E Swift.

### Lançar Linux junto

.deb, .rpm e pacman não têm auto-update: o OpenMausBot copia o comando de instalação para o clipboard e abre um terminal em branco, porque a alternativa levanta prompt de root do polkit dentro de um app de chat e substitui o binário com o processo rodando. Some AppArmor, Xorg/Wayland e uma cauda permanente.

### Decidir Electron vs Tauri agora

Decidir motor de empacotamento antes de existir demanda é congelar uma escolha sem informação. O ADR registra 'quando chegarmos lá, a evidência atual favorece Electron e eis o porquê', não 'decidimos Electron'. E a evidência é forte: o Buzz precisou de um módulo só para reativar getUserMedia no Linux (o WebKitGTK desliga por padrão e nega toda permission-request) e outro que adivinha GPU NVIDIA lendo /sys/class/drm ANTES de qualquer init, porque o WebKit lê a variável uma vez por processo.

## Evidência

electron/main.mjs (bifurcação de boot em if/else: com acesso remoto sobe relay e nunca inicia o servidor embutido — logo cliente fino não fecha a porta do modo embutido); electron/capabilities.cjs:152 (reasonCode 'remote-server' desliga screenPreview, ditado e controle local no modo remoto); electron-builder.yml (seção win sem assinatura, com o aviso de que setar publisherName sem assinar rejeita toda atualização da base instalada); electron/updater.mjs e package-install-command.mjs (hand-off por clipboard no Linux); ios/README.md:245 e ios/TESTING.md:290 (sem APNs com app terminado); ios/App/Session.swift (janela de 25s); android AndroidManifest.xml:207 (foreground service que o iOS não pode ter); companion/src/routes.ts (allowlist do celular: ler, mensagem, aprovar — nunca executar); docs/ios-companion.md ('The Mac must be running OpenMausBot and must not be asleep').

## Consequências

- A v1 sai sem nenhum pipeline de assinatura, notarização ou loja — zero custo recorrente de distribuição, e a correção de um bug chega a todo mundo no próximo carregamento.
- O nod não precisa de pareamento QR, sidecar, Bonjour, Tailscale nem túnel Cloudflare, porque o harness está no container (ADR-017) e não atrás de um NAT doméstico.
- A notificação primária é e-mail e WhatsApp. Web Push em PWA é bônus, nunca dependência — a taxa real de instalação de PWA entre gestores de RH é medição de campo que ainda não foi feita.
- Se um cliente exigir app instalado e a TI dele bloquear, a resposta já está pronta: o produto funciona inteiro no navegador.
- Fica registrado que o desktop, quando vier, não pode virar um segundo servidor: duas implantações do mesmo harness significam versionar, migrar e auditar duas vezes — e o ADR-003 perde sentido numa máquina de um tenant só.

## Reversibilidade

Alta nos dois sentidos, e é o ponto mais confortável desta decisão. Adiar não fecha porta nenhuma: o mesmo binário Electron comporta cliente fino e servidor embutido com um flag de boot. E a web responsiva feita desde o começo é pré-requisito de todos os alvos futuros — nada do que se faz agora precisa ser desfeito.

## Revisitar quando

Quatro gatilhos, escritos como fatos e não como sensação: (1) um cliente PAGANTE pedir notificação nativa com app fechado — aí entra desktop cliente fino, ou wrapper iOS conforme o canal pedido; (2) a medição mostrar que a decisão demora porque a pessoa não é avisada, APÓS e-mail e WhatsApp estarem no ar; (3) a Leapy decidir VENDER 'app no celular' como item de proposta comercial — decisão do Marlon, que muda a conta inteira; (4) alguém pedir para usar a própria assinatura E o ADR-014 não resolver. Fora desses quatro, a resposta é a ordem que está aqui.

