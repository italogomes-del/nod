# ADR-047 — GitHub: um conector, vários jeitos de conectar

Status: aceito · Data: 2026-09-24 · Emenda ADR-013, ADR-015, ADR-041 e ADR-044.

## Contexto

Marlon pediu ao Taga que o Dev 1 revisasse o PR #466. O Dev 1 não tinha acesso ao GitHub. O `gh`
do Mac estava logado, mas o claude-cli roda com `--tools ""` e `--strict-mcp-config`
(`claude-cli.ts:94-131`), então nem Bash nem os servidores MCP da própria pessoa chegam ao modelo.
Isso é de propósito: o proxy é o ponto de decisão (ADR-013). O único GitHub do nod era o do
Composio, que pede OAuth no navegador, uma chave de projeto e um auth config no painel. Os nomes
das ferramentas (`GITHUB_GET_A_PULL_REQUEST`…) também são do Composio. Trocar o jeito de conectar
trocaria os nomes, e com eles as concessões e as regras de "Sempre permitir".

## Decisão

**Um conector `github`, com nomes de capacidade estáveis.** São nove:
- leitura (`readOnlyHint: true`): `pr_ver`, `pr_diff`, `pr_arquivos`, `pr_comentarios`, `pr_checks`,
  `arquivo_ler`, `issue_ver`;
- escrita: `pr_comentar`, `pr_revisar` (`comment`, `approve` ou `request_changes`).

Concessões e regras se prendem a `github__<capacidade>`, nunca ao jeito de conectar. O conector é
nativo do nod:
- no banco, `transporte = 'stdio'` e `comando = 'nod:github'`, uma marca e não um executável;
- a composição troca a marca pelo Node do processo mais
  `src/adapters/conectores-locais/github/servidor.ts`, um servidor MCP stdio em JSON-RPC puro;
- quem registra conector à mão não pode usar o prefixo `nod:`.

**O jeito é escolhido sozinho, a cada spawn** (`escolherJeitoGithub`, domínio puro):

| Onde o conector roda | Ordem |
|---|---|
| Máquina da pessoa (servidor local, `npm run dev`/`npm start` no Mac) | gh logado → token pessoal → Composio |
| Servidor compartilhado (`NOD_MODO=compartilhado`) | GitHub App da organização → Composio → token pessoal; **nunca gh** |

Quando nenhum jeito serve, a frase diz o que a pessoa faz: `gh auth login`, colar um token, ou,
no servidor, "para rotinas noturnas, conecte o GitHub da organização".

**Registro sem configuração.** Com o gh logado, o conector nasce habilitado e já sondado em dois
momentos:
- quando a pessoa clica em "Conectar" no card do GitHub;
- quando um agente chama `pedir_acesso("github")`.

O card de acesso sai direto com o botão de permitir (ADR-044), sem card de conexão.
- `capacidades: []` resolve pelo nível: leitura dá as sete de leitura, escrita dá o catálogo inteiro.
- No servidor compartilhado, o mesmo vale quando o tenant tem o App.
- Nada é concedido aqui: habilitar o conector só torna o app disponível.

O agente não troca o conector por baixo, e isso tem duas consequências:
- O `github` antigo do Composio por HTTP é convertido só pelo clique da pessoa. A conversão mantém
  o mesmo id e a linha de `composio_sessoes`.
- Um conector que a pessoa desligou continua desligado.

## Onde mora a credencial e em nome de quem o GitHub mostra a ação

| Jeito | Credencial | Autor no GitHub | Exige |
|---|---|---|---|
| gh | Keychain do Mac (o gh guarda; o nod nunca lê nem copia) | A conta logada no gh | Mac ligado, nod rodando nele |
| Token pessoal | `env_cifrado` do conector (`GITHUB_TOKEN`, `src/db/cifra.ts`) | A dona do token | Token conferido no GitHub (`GET /user`) antes de guardar |
| Composio | `env_cifrado` do conector (`COMPOSIO_URL`, `COMPOSIO_API_KEY`); o OAuth mora no Composio | A conta autorizada no Composio | Chave Composio do tenant (ADR-041) |
| GitHub App | `github_app_configuracoes` (0027): app id, instalação, chave privada cifrada; token de instalação só em memória | O App (`nome[bot]`) | Um admin cadastra; só serve ao conector no servidor |

**Ambiente do processo.** O conector nativo recebe só isto:
- a allowlist do servidor (ADR-015 B);
- `USER`, `LOGNAME`, `XDG_CONFIG_HOME`, `GH_CONFIG_DIR` e `GH_HOST`;
- `PATH` aumentado com `~/.local/bin` e Homebrew, porque o app aberto pelo Finder recebe um PATH
  pelado.

Conector de terceiro não recebe essa lista. No jeito gh, o `gh` não recebe nenhuma variável `NOD_*`:
um token esquecido no ambiente não vale.

**Segurança do gh.**
- Sempre `execFile`, nunca shell.
- `dono/repo`, número, caminho e ref são validados no domínio antes de existir processo.
  `foo/bar;rm -rf ~` e `--repo=x` são recusados.
- O caminho vai como argumento posicional `repos/…`, que não começa por `-`.
- O corpo do POST vai pelo stdin (`--input -`), nunca pela linha de comando.
- O diff e o conteúdo de arquivo são cortados ao orçamento (`corte.ts`).

**Composio: tabela explícita.** O mapeamento está em `GITHUB_PELO_COMPOSIO`
(`integracoes/composio.ts`). Os slugs e parâmetros foram conferidos em
`docs.composio.dev/toolkits/github.md` em 2026-09-24.
- `pr_diff` não tem par: o Composio não oferece diff unificado.
- `pr_checks` também não: exigiria extrair o SHA do head de um `data` em texto livre.
- As duas saem de `tools/list` nesse jeito, e a tela de Conectores as mostra como indisponíveis.

## Alternativas descartadas

- **Liberar Bash ou o MCP do GitHub da pessoa no claude-cli.** Contorna o proxy, e junto a
  aprovação, a moldura de não confiável e a trilha (ADR-013).
- **Um conector por jeito (`github_gh`, `github_token`…).** Cada troca de jeito perderia as
  concessões e as regras de "Sempre permitir", e o agente teria de saber qual existe.
- **Guardar o jeito escolhido no banco.** Ficaria velho no primeiro `gh auth logout`. A escolha é
  refeita a cada spawn, a partir do que está pronto agora (o detector tem cache de 60 s quando está
  logado e de 10 s quando não está).
- **Rodar o gh da pessoa no modo compartilhado.** Hoje o conector roda no processo do servidor e o
  servidor nunca disca a máquina (ADR-021). Executar o conector no Mac exigiria um verbo novo na
  ponte. Ficou fora; ver abaixo.

## Validação

- `tests/unit/domain/github.test.ts`: ordem por onde roda, e o servidor nunca escolhe gh; argumentos
  maliciosos recusados.
- `tests/unit/conectores-locais/github-gh.test.ts`: o processo de verdade com um `gh` FALSO primeiro
  no PATH. Cobre sucesso por `gh api` com argv separado, diff cortado, comentário pelo stdin, sem
  login, 404, gh ausente, e argumento malicioso sem processo nenhum.
- `github-rest.test.ts`: o backend REST contra um GitHub falso em porta 0.
- `github-composio.test.ts`: a tabela e a indisponibilidade.
- `github-nativo.test.ts`: a tradução da escolha em ambiente e o detector.
- `github-app.test.ts`: JWT RS256 verificado pela chave pública, token de instalação e cofre.
- `tests/integration/github-conector.test.ts`, no Postgres com rollback:
  - `pedir_acesso` com gh cria o conector e o card de um clique, e permitir concede
    `github__pr_comentar`;
  - sem gh, vira o card de conexão;
  - o legado HTTP não é convertido pelo agente, mas é pelo clique;
  - token cifrado e sonda pelo jeito token;
  - Composio dentro do nativo;
  - App por tenant: a Ana lê e não troca (`42501`), e o jeito app funciona no servidor.

## Gatilho de reversão

- **Falha frequente com o gh logado.** Se mais de 1 em 10 chamadas do jeito gh falharem com
  `sem_login` enquanto `gh auth status` diz logado, o ambiente mínimo não basta. Medir antes de
  alargar a lista.
- **Comentário ou revisão sem clique fora do esperado.** Se aparecer um comentário ou revisão
  publicado sem clique que a pessoa não esperava, reabrir junto com a ADR-046: a regra "Sempre
  permitir" vale pelo nome estável, qualquer que seja o jeito.
- **Composio ganhar diff ou checks.** Se o Composio publicar uma ferramenta de diff ou de checks por
  PR, a tabela ganha a linha; não adivinhar antes.

## Não implementado

- **gh no modo compartilhado.** O conector roda no servidor, então lá o gh nunca é usado.
- **Estado do App na tela.** A tela mínima só cadastra; não mostra se já há App (o
  `GET /marketplace/github/app` existe e a tela não o lê). Quem não cadastrou não troca o App; a
  troca por outra pessoa passa por `nod_dono`.
- **Revogação do token de instalação.** Trocar o App esquece o token em memória, mas não o revoga no
  GitHub; ele vence em até 1 h.
- **"Sempre permitir".** As capacidades que nunca viram permanentes (aprovar PR, merge) são da
  Parte A (ADR-046, `aprovacao-permanente.ts`), não desta.
