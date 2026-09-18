# ADR-037 — Um computador persistente por bot

Definido em 2026-09-18. O produto começa com um ambiente completo por bot, com navegador com interface, desktop Linux, arquivos, terminal e áudio. A pessoa pode assumir a mesma tela para entrar nas contas e devolver o controle. Fechar a janela não desliga o ambiente.

## Referências e escolha

| Opção | O que aproveitamos | Decisão |
|---|---|---|
| [Grok Bot](https://docs.x.ai/grok-bot/computer-and-apps) | Computador persistente, takeover para autenticação, conectores e navegador complementares | Referência da experiência. O Grok compartilha o computador da pessoa entre bots; nosso primeiro recorte é um computador por bot. |
| [OpenBot, CopilotKit](https://github.com/CopilotKit/openbot) | Volumes persistentes por bot, supervisor de computadores, separação do ambiente e autorização das ações | Referência de implantação. Integramos ao plano de turno, proxy, RLS e decisões que o nod já possui. |
| [OpenMausBot](https://github.com/milind-soni/OpenMausBot) | Harnesses separados do computador remoto | Mantemos o driver de computador substituível; não acoplamos identidade do bot ao fornecedor ou ao CLI. |
| Apenas navegador remoto | Provisionamento menor, sessões web persistentes | Insuficiente para terminal, aplicativos Linux, arquivos locais e controle do desktop. |
| Desktop e navegador compartilhados desde o início | Evita repetir login entre bots | Adiado: exige arbitragem e permissões para os recursos compartilhados. |

O `DriverComputador` permite substituir Docker por um provedor de máquinas remotas sem mudar as ferramentas e a interface. Nesta entrega o computador roda no host Docker do servidor nod. Isso é uma base implantável em servidor; não provisiona uma conta de nuvem automaticamente.

## Arquitetura

```mermaid
flowchart LR
    Pessoa["Pessoa · abrir / assumir / devolver"] --> API["API nod · sessão + tenant + pessoa"]
    Bot["Bot · Claude / Codex"] --> MCP["Proxy MCP · token do turno"]
    MCP --> API
    API --> Gate["Catálogo, permissões, parada, aprovação e reserva exclusiva"]
    Gate <--> Banco["Postgres com RLS\nBot → computador_id\nControle e registro das ações"]
    Gate --> Driver["Driver Docker no servidor"]
    Driver --> A["Computador A\nChromium + desktop + terminal + áudio"]
    Driver --> B["Computador B"]
    A --> VA["Volumes A\n/workspace + perfil + cofre cifrado"]
    B --> VB["Volumes B"]
    A --> EA["Proxy de saída A"]
    B --> EB["Proxy de saída B"]
    EA --> Internet["Sites públicos HTTP/S"]
    EB --> Internet
```

`computadores.id` é independente de `agentes.id`. O vínculo fica em `agentes.computador_id`, com unicidade para o primeiro recorte. Compartilhar computador no futuro exige mudar essa unicidade, adicionar associação/permissões e preservar um controlador por vez. Compartilhar apenas navegador exige um recurso independente e um protocolo para arquivos, abas, áudio e controle; não é simplesmente ligar dois processos ao mesmo diretório de perfil.

O harness segue executando onde a arquitetura existente do nod determina; só o acesso ao desktop, navegador e terminal passa pelo driver. Rotinas com o laptop desligado exigem **servidor, Docker e um executor compatível disponíveis fora do laptop**. O modo de servidor compartilhado com um único executor no Mac não satisfaz essa condição sozinho.

## Capacidade e experiência

Playwright faz navegação, abas, uploads e downloads. Mouse, teclado, rolagem e arrastar operam o desktop via X11. Portanto, um controle sem representação no DOM não fica inacessível por esse motivo. As imagens incluem a tela inteira, incluindo janelas e barras do navegador. Diálogos JavaScript têm resposta explícita.

O quadro é uma revisão da interação, não o hash dos pixels: animações e vídeos não invalidam um clique. Navegação, troca de aba e ações anteriores invalidam a revisão. O limite de dois minutos evita executar aprovações sobre uma observação muito antiga. A página pode mudar espontaneamente dentro desse intervalo; isso não fornece uma transação atômica sobre um site externo. Após falha ou timeout, a instrução é observar e verificar antes de repetir.

Áudio tem captura explícita em WAV por até dez segundos, encaminhada como conteúdo MCP de áudio. O modelo/harness precisa aceitar e interpretar esse conteúdo; screenshot sozinho não permite ouvir. A interface permite escutar a captura. O fluxo visual usa screenshots periódicos, não streaming de vídeo de baixa latência.

## Acesso e efeitos

- Cada recurso é acessado por bot sob a pessoa proprietária. Compartilhar o perfil do bot em leitura com a equipe não compartilha o computador.
- O token identifica o turno e seu catálogo. O corpo nunca escolhe tenant, pessoa, computador ou permissões. A permissão é verificada novamente depois da inicialização, antes do efeito.
- A reserva é confirmada no banco antes de executar fora da transação. Um identificador de operação impede uma conclusão atrasada de liberar outra reserva. O runtime recusa concorrência e tem watchdog de 55 segundos. A inicialização tem prazo de dois minutos; a reserva dura cinco minutos e cobre inicialização e ação.
- `Assumir controle` bloqueia ferramentas do bot até `Devolver`. Não há devolução automática por tempo. O pedido de login cria uma decisão; devolver a resolve e retoma usando a inteligência original.
- A política inicial é supervisionada. A pessoa pode permitir ações nas tarefas pedidas. Rotinas que exigem aprovação continuam exigindo, mesmo com esse modo ligado. A aprovação é vinculada à ação cifrada; sua descrição não pode ser editada separadamente dos argumentos.
- Ações da pessoa não gravam texto digitado, senhas, comandos ou screenshots no registro de atividade. Argumentos de ações pendentes do bot são cifrados e descartados após execução/recusa. A descrição de uma aprovação é visível à pessoa.
- A saída web, imagens e arquivos chegam ao modelo como dados não confiáveis. Isso reduz confusão entre conteúdo e autorização; não elimina o problema de prompt injection em agentes com acesso a contas.

## Infraestrutura e limites

Cada computador tem rede interna própria, volumes próprios e um proxy de saída. O proxy resolve e fixa IPv4 público, recusando endereços privados, loopback remoto e metadados. Acesso direto à internet não está disponível na rede interna. `localhost` dentro do computador serve previews e ferramentas do próprio bot. Saída é HTTP e HTTPS nas portas 80/443, incluindo túneis HTTPS; SSH e UDP não estão incluídos.

O runtime não expõe porta de controle nem recebe socket Docker, tokens do nod ou variáveis de credenciais do servidor. O driver usa `docker exec` e socket Unix. Os containers rodam como usuário sem privilégios, sem capabilities, com filesystem base somente leitura e limites de CPU, memória e processos.

O isolamento padrão é **container Linux**, não uma VM por bot: compartilha o kernel do host Docker. Chromium está sem seu sandbox interno neste runtime; o limite de execução é o container. Hosts Linux podem selecionar um runtime reforçado com `NOD_COMPUTADOR_RUNTIME`. Para hospedagem de agentes mutuamente hostis, escolher microVM/gVisor e validar o driver nesse ambiente antes de oferecer essa garantia. Quem opera o servidor nod precisa ter permissão no Docker; isso é uma permissão poderosa do servidor, não concedida aos bots.

Credenciais do Chromium usam GNOME Libsecret e um keyring cifrado no volume do perfil. A senha do keyring deriva de `NOD_CREDENTIAL_KEY` + ID do computador; entra só por stdin/socket durante inicialização. Além do perfil, um checkpoint de cookies usa AES-256-GCM, com chave derivada por computador e gravação atômica. Não há `--password-store=basic`. Isso protege os segredos guardados pelo navegador em repouso; não cifra todo o workspace ou todo o armazenamento dos sites. Backup, disco do host e a chave do servidor precisam de proteção operacional. No ambiente em execução, o bot com controle pode usar as sessões logadas.

Limites iniciais: tela 1280×800; upload/download pela API de arquivos até 512 KiB; captura de áudio até 10 s; comando de terminal em primeiro plano até 20 s; processos de fundo precisam redirecionar os streams. Arquivos maiores podem ser produzidos e consumidos dentro do computador pelo navegador/terminal. DRM, passkeys/hardware local, câmera, bloqueios antibot e codecs dependem do site e da imagem instalada. Não prometemos que todo site aceitará um navegador automatizado em datacenter.

## Fora deste recorte

Compartilhamento de computadores ou sessões, streaming com baixa latência, snapshots/migração de host, quotas globais por conta, coleta automática de volumes órfãos e provisionamento de nuvem. Excluir o bot impede novas ações e desliga seus processos; os volumes permanecem para recuperação. Desligar encerra processos e preserva os volumes. Restaurar o bot recupera o vínculo anterior; duplicar cria outro vínculo e não copia sessões.
