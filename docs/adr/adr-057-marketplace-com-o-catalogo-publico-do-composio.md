# ADR-057 — Marketplace com o catálogo público do Composio

Status: aceito · Data: 2026-09-29 · Revê o item 3 do [ADR-041](adr-041-chave-composio-do-tenant-catalogo-vindo-do-provedor.md)
(catálogo vindo do provedor). Os itens 1, 2, 4, 5 e 6 continuam valendo.

## Contexto

Em 2026-09-29, o Marlon pediu: "o composio tem centenas de apps mas o meu marketplace mostra apenas
alguns. Quero mostrar todos". A grade tinha 12 apps: os 11 auth configs do painel e o GitHub nativo. O
motivo é o item 3 do ADR-041: a grade é o `GET /auth_configs`, ou seja, o que alguém configurou no painel.

Esse item partiu de uma premissa: "Notion, Linear e Google Sheets estão no array e não têm auth config no
Composio. Apareciam como 'Conectar' e nunca conectariam". A documentação do Composio, lida em 2026-09-29,
diz outra coisa (páginas "Managed Auth" e "Authentication" das sessions):

- **123 toolkits têm login gerenciado pelo Composio.** O Composio mantém o app OAuth, e a sessão conecta
  sem auth config nenhum no painel. O campo que diz isso é `composio_managed_auth_schemes`, no
  `GET /toolkits`.
- **189 toolkits exigem OAuth próprio.** Sem auth config no painel, a sessão devolve erro pedindo um.
- **O total é 312.**

A premissa valia para os 189, não para os 123. Os números são da documentação, não de uma medição nossa: a
sonda com a chave do tenant não rodou nesta sessão (ver "Não medido").

## Decisão

1. **A grade mostra o painel mais o catálogo público com login gerenciado.** O `catalogo()` continua lendo
   `/auth_configs`. Um `gerenciados()` novo lê `GET /toolkits?limit=1000` (segue o `next_cursor` até 5
   páginas) e fica só com o toolkit que tem `composio_managed_auth_schemes` não vazio. Saem também o
   `no_auth` (não há login a fazer, e conectar aqui termina numa conta conectada), o `is_local_toolkit` e
   o `type: "custom"` (o customizado, com auth config, já vem do painel).
2. **Os 189 sem login gerenciado ficam fora.** Um botão "Conectar" que dá erro é o problema que o ADR-041
   veio corrigir. Quem quiser um deles cria o auth config no painel, e ele aparece em até um minuto, pelo
   caminho de sempre.
3. **Toolkit com `_` no slug fica fora.** O slug vira o slug do conector, e `registrarConector` só aceita
   `[a-z0-9-]` (`src/use-cases/registrar-conector.ts`), assim como as rotas `/marketplace/:slug/conectar`
   e `/verificar`. Sem esse filtro, o cartão apareceria e o clique daria 404.
4. **Duas seções na tela.** Em cima fica o dia a dia: a curadoria, o painel e o GitHub nativo. Os apps
   curados que só existem no catálogo público (Notion, Linear, Sheets) voltam para cá com o nome em
   português. Embaixo vem **"Mais apps · N"**, com o resto em ordem alfabética, marcado `doCatalogo`. Um
   app de "Mais apps" que a pessoa conecta sobe para a grade de cima. Enquanto conecta, fica onde foi
   clicado. A busca que já existia cobre as duas seções, e "Mais apps" some quando a busca não deixa
   nenhum cartão dela. Isso atende o gatilho do ADR-041 ("mais de ~40 itens: … precisa de filtro ou
   paginação") com busca e seção, sem paginação.
5. **O app sem curadoria mostra a descrição do provedor, em inglês.** Ela é cortada em 160 caracteres, na
   palavra. A categoria sai em português por uma tabela de palavras (`categoriaEmPortugues`), e o que não
   casa vira "Integrações". A descrição padrão em português repetida em ~100 cartões não diria nada. Com
   ela, a busca por "crm" não acharia o HubSpot.
6. **Os dois catálogos têm caches separados, e um não derruba o outro.** O painel continua com janela de
   60 s. O catálogo público fica com janela de 1 h, porque muda quando o Composio lança um toolkit e é a
   resposta pesada. Se o catálogo público falhar, a grade fica com o painel e o último catálogo público
   bom (log `marketplace_catalogo_publico_falhou`). Se o painel falhar, a grade continua caindo no piso
   curado, como antes. O cache saiu de `rotas/conectores.ts` para `src/adapters/integracoes/catalogo-composio.ts`,
   e a rota de conectar lê o mesmo cache. Assim, o conector de um app do catálogo nasce com o nome que a
   grade mostrou ("HubSpot"), não com o slug.
7. **O modelo continua vendo só a curadoria (item 5 do ADR-041).** `pedir_acesso` para um app que não foi
   curado nem conectado continua recusado. Depois de conectado pela tela, o app é um conector como
   qualquer outro, e o pedido de acesso vale.

## O que isso custa

- Cerca de 100 cartões a mais na página. O logo de cada um passa pelo proxy do servidor (ADR-041 §6), com
  `loading="lazy"`: só os cartões visíveis buscam.
- Uma chamada pesada ao Composio por tenant por hora, feita no primeiro GET `conectores` depois que a
  janela vence. A pessoa que abre a tela nesse momento espera por ela.
- Descrições em inglês no meio de uma tela em português, até alguém curar o app.

## Alternativas descartadas

- **Mostrar os 312** (a opção B do pedido), com "Configure no painel" no lugar de "Conectar" para os 189.
  Mostraria tudo, mas um terço da grade seria vitrine sem ação, o que o ADR-041 tirou de propósito.
- **Filtrar com `managed_by=composio` no provedor.** A documentação descreve o parâmetro como "quem gerencia
  o toolkit", sem dizer se é o login. O campo `composio_managed_auth_schemes` é o que a página "Managed
  Auth" manda conferir, então o filtro é nosso.

## Gatilho de reversão

- **Dois apps de "Mais apps" falharem ao conectar pedindo auth config** (erro em `criarSessao` ou
  `autorizar` para um slug `doCatalogo`). Isso prova que `composio_managed_auth_schemes` não basta, e a
  grade volta ao painel mais uma lista conferida.
- **O `GET /api/conectores` com o catálogo público frio passar de 2 s**, medido na tela com a chave real.
  Nesse caso, a busca vai para um laço de fundo em vez de rodar na abertura da tela.
- **Nenhum app de "Mais apps" conectado em 30 dias** (conectores cujo slug não está em `APPS_MARKETPLACE`
  nem no painel). A seção é ruído, e passa a abrir fechada.

## Não medido

- A sonda que confirmaria os números e o formato real de `meta.categories` (`{ id, name }` ou texto) com
  a chave do tenant não rodou nesta sessão: o modo automático bloqueou a leitura da chave. O código lê as
  duas formas e descarta o resto. O script está descrito no PR.
- Os hosts de `meta.logo` do catálogo público. O que estiver fora de `logos.composio.dev`,
  `assets.composio.dev` e `cdn.composio.dev` vira a inicial do nome, como no ADR-041.

## Fora deste ADR

- O `github_mcp` do painel tem `_` no slug e continua aparecendo pela curadoria. Pela regex da rota, o clique em "Conectar" não
  casa com a rota `[a-z0-9-]+` e dá 404, como já acontecia antes. Corrigir isso é mexer no slug do
  conector, e fica para uma decisão própria.
