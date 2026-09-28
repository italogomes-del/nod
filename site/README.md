# Site do nod

Primeira apresentação pública do produto, em português. O recorte é a experiência de bots como
contatos: perfil, conversa, colaboração entre bots, computadores próprios, memória e rotinas. A visão futura com colaboração entre pessoas fica
fora desta versão. Não há anúncio de licença, preço ou acesso público disponível.

O diferencial de escolha de IA aparece na abertura e na seção `#sua-ia`: cada bot pode ter sua
inteligência, mantendo perfil, conversas e memória no nod. Claude Code e Codex são as integrações
atuais. A pessoa confirmou que API própria, assim como modelos oferecidos pelo nod, são caminhos
planejados; Cursor também está identificado como em preparação. A escolha na ilustração só muda
o exemplo apresentado no site e não conecta contas nem altera o produto.

Usamos os símbolos e nomes Claude, ChatGPT e Cursor para facilitar o reconhecimento. Os SVGs
ficam em `public/providers/`, com fontes e atribuições em `public/providers/SOURCES.md`. “ChatGPT” vem
qualificado como acesso pelo Codex, conforme a
[documentação oficial de acesso pelo plano ChatGPT](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan).
O site não promete acesso a todo modelo, uso ilimitado, gratuidade ou intercâmbio entre cobrança
por assinatura e API. “Modelos pelo nod” significa acesso a provedores pelo produto, não modelos
treinados pelo nod.

`#bots-em-equipe` anima Vera consultando Lume para escrever uma abertura: pedido, consulta,
indicador de pensamento, resposta e entrega em 14 segundos. `#computadores` anima um computador
com desktop, dock, janela, abas, endereço digitado, leitura/rolagem e resumo salvo em 15,5 segundos.
O endereço `projeto.example/briefing` é fictício; não há iframe nem navegação remota. Os aplicativos
podem ser explorados, e assumir/devolver controle é uma simulação local.

As cenas começam quando visíveis: a colaboração roda uma vez e o computador repete em loop.
A tela do computador tem moldura sem apoio, com azul, cinza e detalhes quentes. Ambas as cenas
podem ser pausadas e continuadas; a colaboração também pode ser repetida. O relógio
pausa fora da tela ou com a aba oculta; `prefers-reduced-motion` apresenta a cena completa estática.
As animações preservam a altura da página e não executam IA nem tarefas reais. As cenas são independentes: a delegação atual
não permite ao destinatário usar computador, workspace, rotinas ou delegar novamente (ADR-047).
Os computadores dependem da configuração do ambiente; não há promessa de nuvem ou execução com a
máquina desligada. A cópia segue `docs/computadores.md` e as ADRs 037 e 047.

## Rodar e compilar

Na raiz do repositório, com Node 24.19.0 e dependências já instaladas:

```sh
npm run site:dev
npm run site:build
npm run site:preview
```

Desenvolvimento e prévia usam `http://127.0.0.1:5275`, com porta estrita. Não executam o servidor
do produto, Postgres, CLI de IA ou migrações. O build estático fica em `dist/site/` e pode ser
servido na raiz de um domínio por uma hospedagem de arquivos estáticos.

## Lista de interesse

A integração está preparada; o serviço de e-mail ainda será escolhido. Sem endpoint configurado,
a página mostra “Inscrições em breve”, mantém os campos desabilitados e não envia nem armazena e-mails.

1. Criar a lista/formulário no serviço escolhido, com confirmação e cancelamento de inscrição.
2. Copiar `site/.env.example` para `site/.env`.
3. Preencher `VITE_NOD_WAITLIST_URL` com o endpoint público do formulário (por exemplo, um formulário
   do Formspree que aceite JSON). Uma API que exige chave secreta precisa de um intermediário no
   servidor; segredos nunca entram em variáveis `VITE_*`.
4. Configurar a origem pública do site no serviço, proteção contra abuso e a política de uso dos
   e-mails. A página informa que a lista serve para novidades e aviso de acesso ao nod.
5. Compilar novamente e validar uma inscrição real, incluindo eventual confirmação por e-mail.

Contrato do POST: JSON `{ email, source: "nod-site", consent: "Novidades do nod e aviso de acesso" }`.
O serviço precisa permitir CORS para a origem publicada. Apenas uma resposta HTTP 2xx confirma o
recebimento. Falha HTTP, rede ou timeout de 15 segundos mostra erro e permite tentar novamente.
Não há sucesso simulado, armazenamento local ou envio de mensagens nesta prévia.

## Demonstração e identidade

As quatro conversas em `examples.ts` são ilustrativas e identificadas assim na página. A pessoa
pode trocar de bot, reproduzir o exemplo e abrir a entrega. Rotinas do exemplo não são ativadas.
Os textos são locais e não vão para um modelo. A interface é uma composição para apresentar o
produto, não uma captura do aplicativo nem uma conexão com ele.

Os SVGs usam os mascotes temporários existentes no nod, derivados de Bloub. A licença MIT está
em `public/mascots/LICENSE.txt`, aparece nos SVGs e pode ser acessada em “Sobre esta prévia”.
Para regenerar: `node site/scripts/generate-mascots.ts`.

Não há fontes remotas, analytics, cookies ou dependências novas. O repositório do produto segue
privado. Nenhum link para o código privado é exposto no site.

## Referências de direção

- [Grok Bot](https://x.ai/bot): experiência explicada por funções e conversas.
- [OpenBot](https://www.copilotkit.ai/openbot): demonstração do produto logo na abertura.
- [Twenty](https://twenty.com/): interface como peça central da apresentação.
- [Ghost](https://ghost.org/about/) e [Supabase](https://supabase.com/): apresentação de um projeto
  que pode combinar código aberto e hospedagem, ainda como hipótese para o nod.

## Referências das animações

- [Manus Browser Operator](https://manus.im/features/manus-browser-operator): separação entre abas, barra de navegação e conteúdo; janela contida no desktop.
- [Browser Use — seleção de assentos](https://browser-use.com/showcase/pick-adjacent-cinema-seats): etapas curtas, cursor e ação atual legível.
- [Browserbase — Observability](https://www.browserbase.com/observability): enquadramento de janelas, cursor e reprodução.

Referências de linguagem visual; as cenas do nod são composições próprias em HTML/CSS/TypeScript,
sem reutilizar capturas, vídeos ou código dessas páginas.
