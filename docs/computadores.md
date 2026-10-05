# Computadores dos bots

Na conversa do bot, abra **Computador**. Use **Ligar computador** e **Assumir controle**, entre nos apps e escolha **Devolver ao bot**. As sessões ficam nesse computador. Cada bot começa com um ambiente separado, portanto o login em um bot não autentica outro.

A política **Com aprovação por ação** pede autorização antes de interações que podem alterar o estado. Para permitir que o bot trabalhe nas tarefas pedidas usando suas sessões, escolha **Nas tarefas que eu pedir**. O limite de aprovação de uma rotina continua valendo. Pedidos de login/2FA acontecem pela tela, não pelo chat.

## Casos de uso e critérios de aceite

As referências de produto são os [guias](https://x.ai/bot/guides) e [casos de uso do Grok Bot](https://x.ai/bot/use-cases). Esta tabela descreve o comportamento buscado, não uma afirmação de que todos os serviços citados já foram homologados.

| Caso | O computador precisa fazer | Critério de aceite |
|---|---|---|
| Entrar em Zendesk ou outro portal | Pausar, pessoa autenticar na mesma tela, retomar | O bot continua autenticado após devolução e após reiniciar o computador. |
| Preparar campanha no Meta Ads | Abrir formulários, clicar em controles, preencher e anexar mídia | Draft conferível; publicação segue o limite de autorização da tarefa. |
| Triar suporte | Ler interface e histórico, preparar resposta, eventualmente enviar | Evidência da ação; falha não vira mensagem de sucesso. |
| Questionário de fornecedor | Navegar páginas, preencher campos, carregar documentos | Campos e anexos verificáveis antes do envio final. |
| Relatório recorrente | Entrar em dashboard, baixar CSV, analisar em Python e gerar arquivo | Arquivo recuperável em /workspace; rotina funciona com executor e servidor ativos. |
| Conferir vídeo | Reproduzir/pausar, ajustar volume, ver quadros, capturar áudio | Controle do player e captura reais; interpretação depende do modelo/harness. |
| Criar protótipo | Gerar código, iniciar servidor no computador e abrir localhost | Preview no navegador do mesmo ambiente e arquivos persistentes. |
| Aplicativo sem DOM utilizável | Usar mouse, teclado, arrastar e janelas | Controle nativo sem depender de seletor Playwright. |
| Trabalho paralelo de dois bots | Sessões, processos, redes e arquivos próprios | Um bot não lê o workspace ou o perfil do outro. |
| Recuperação | Desligar/religar; reobservar após falha; tratar aprovação antiga | Sem repetir efeitos automaticamente nem usar quadro invalidado. |

## Preparar o servidor

Requisitos: Docker Linux ou Docker Desktop, Node do repositório e espaço para a imagem de desktop. Reserve até 2 GiB e 2 CPUs por computador ativo; o proxy tem limite separado de 128 MiB. Esses são limites por ambiente, não uma medição de consumo típico.

```bash
npm run computador:build
npm run db:migrate
npm run db:migrate:test
```

No ambiente do servidor, configure `NOD_COMPUTADORES=docker` e uma `NOD_CREDENTIAL_KEY` de 32 bytes em hexadecimal, secreta e estável. Não use a chave pública de exemplo com contas reais. Reinicie o servidor nod. A imagem padrão é `nod-computador:1`; `NOD_COMPUTADOR_IMAGEM` permite fixar outra versão. `NOD_COMPUTADOR_RUNTIME` seleciona um runtime Docker já instalado e validado no host.

O computador é provisionado ao ligar pela interface ou na primeira ação autorizada do bot. A imagem precisa estar preparada antecipadamente: uma solicitação do bot não instala Docker nem constrói imagens.

Para rodar com o laptop desligado, hospede servidor, Docker e executor em uma máquina sempre disponível. Esta implementação não transfere por si só a assinatura ou login de um CLI do laptop para a nuvem.

## Verificar e operar

```bash
npm run check
node scripts/smoke-computador.ts
npm run desktop:build
node scripts/desktop/smoke-proxy.mjs node_modules/electron/dist/Electron.app/Contents/MacOS/Electron dist/desktop/proxy.mjs
```

O smoke cria dois computadores descartáveis, usa arquivos/cookies fictícios e não chama modelos pagos. Remove apenas seus próprios containers, redes e volumes. IDs para diagnóstico ficam em `/tmp/nod-computadores-smoke-ids.json`.

Os volumes têm nomes `nod-computador-<id>-home` e `nod-computador-<id>-workspace`. Faça backup com o computador desligado e preserve a chave do servidor separadamente; sem a chave, o cofre não abre. Não monte um mesmo perfil em dois Chromium ativos. Planeje recuperação e retenção antes de remover dados de bots excluídos.

### Ciclo de vida no host (NOD-170)

| Variável | Padrão | O que faz |
|---|---|---|
| `NOD_COMPUTADORES_MAX` | 3 | Máximo de computadores ligados neste host, somando todas as pessoas. O seguinte não liga: o bot recebe `limite_de_computadores`, nada é executado e não há fila. Não conta para a saúde do computador. |
| `NOD_COMPUTADOR_OCIOSO_MIN` | 15 | Minutos sem ação do bot nem da pessoa até o computador desligar sozinho (varredura a cada 60 s). `0` desliga a varredura. Pula computador com a pessoa no controle, aguardando a pessoa ou com ação em andamento. O fora do ar também desliga (a ação do bot não chega a ele, e ele seguraria uma vaga do teto) e segue fora do ar até o "Tentar de novo". Os volumes ficam; a próxima ação liga de novo. |

Valor ausente ou inválido usa o padrão. Reinicie o servidor nod depois de mudar. Os eventos no log são `computador_limite`, `computador_desligado_por_ociosidade` e `computador_imagem_recriada`.

**Reinício do Docker ou do host.** Os containers têm `--restart unless-stopped`: voltam sozinhos, com o cofre trancado. A próxima ação destranca e encontra arquivos e cookies (passo do smoke).

**Imagem nova.**

1. `npm run computador:build` (ou fixe outra tag em `NOD_COMPUTADOR_IMAGEM` e reinicie o servidor).
2. Nada mais. Ao ligar, um computador **parado** cuja imagem difere da tag é removido (máquina e proxy, sem `-v`) e recriado com a imagem nova e os mesmos volumes. Um computador **ligado** nunca é tocado; ele pega a imagem nova na próxima vez que ligar, depois de desligar por ociosidade ou pelo botão.

**Órfãos.** Containers e redes com o rótulo `nod.computador=true`, e volumes `nod-computador-<id>-home|workspace`, cujo `<id>` não está na tabela `computadores`.

```bash
npm run computador:orfaos              # só lista
npm run computador:orfaos -- --limpar  # remove containers e redes órfãos; volumes NUNCA
```

O script usa `DATABASE_URL` (o papel `nod_app`, do `.env` ou do ambiente) e lê `computadores` pessoa por pessoa, com escopo: sob FORCE ROW LEVEL SECURITY o `nod_dono` não tem policy e leria zero linhas. Ele imprime o host e o banco consultados. **Confira que é o banco do servidor que criou os computadores deste Docker**: contra outro banco, todo computador parece órfão. Por isso o `--limpar` se recusa quando o banco não tem nenhum computador e o Docker tem. Volumes órfãos guardam logins e arquivos de alguém; apague à mão (`docker volume rm <nome>`) só depois de decidir a retenção.

Detalhes e limites estão na [ADR-037](adr/adr-037-computadores-por-bot.md).

## Validação desta entrega

Medido em 2026-09-18, no checkout de desenvolvimento:

- `npm run check`: lint, quatro typechecks e cerca do domínio aprovados; 398 testes unitários, 227 de integração, 49 de conformidade e 55 de concorrência aprovados (729 no total). A execução limitou os workers do Vitest a dois para evitar competição com outros processos de desenvolvimento.
- Imagem Docker construída e smoke com dois ambientes reais aprovado: arquivos separados, navegador público e localhost, digitação com acentos, observações anteriores válidas até uma ação, bloqueio de quadro invalidado, terminal, reprodução/pausa/volume de vídeo sintético, captura de áudio com sinal, arquivos e cookies preservados após reinício, checkpoint cifrado e bloqueio de metadados privados.
- Web e desktop compilados; proxy MCP inicializado dentro do Electron, sem Node externo nem CLI/modelo real.
- Interface conferida em servidor temporário: ligar, assumir, navegar, executar comando, listar arquivos, devolver e desligar; abrir e fechar o painel preserva o rascunho da conversa. Os recursos descartáveis foram removidos ao terminar.

Não foram usados logins reais de Meta Ads, Zendesk ou outros SaaS. A captura de áudio e o transporte de imagens/áudio foram validados; a interpretação por cada modelo ainda depende de ensaio com o harness escolhido. Nenhuma infraestrutura de nuvem foi provisionada.
