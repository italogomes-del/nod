# Auditoria para abrir o código do nod (ADA-282)

Data: 09/11/2026. Base: `gamefik/nod` na `main` `90872eb00` (1212 commits na main, 5080 em todas as refs). Decisão de
arquitetura: [ADR-160](../adr/adr-160-open-core-por-exportacao-e-historico-zerado.md). O que sai do repo público e para
onde vai: [o-que-fica-fechado.md](o-que-fica-fechado.md). **Este arquivo não vai para o repo público** (o manifesto
exclui `docs/open-source/**`): ele cita os dados que o export esconde.

## Veredito

1. **Nenhuma credencial real vazou**, nem na árvore nem no histórico. Os 41 achados do gitleaks são falsos positivos
   conferidos um a um.
2. O histórico tem **dado de produção sem segredo** (formato do env de produção, estado local do wrangler) e muita
   referência a pessoas e clientes reais. Por isso o histórico **não é publicado**: o repo público nasce com um commit
   só, tirado de um snapshot limpo (histórico zerado).
3. A árvore atual, depois do manifesto (exclusões e reescritas), **passa na varredura**: 0 padrão proibido, 0 achado do
   gitleaks, 3328 arquivos (354 excluídos), o typecheck do snapshot passa e os testes unitários do snapshot passam (ver "Prova do
   snapshot").
4. Falta decisão do Marlon para publicar: titular do copyright no `NOTICE`, conta do repo público e transferir x
   exportar (ver "Decisões pendentes").

## Como foi auditado

| Passo | Comando | Resultado |
|---|---|---|
| Segredos no histórico inteiro | `gitleaks git --log-opts=--all --report-format json` (8.28.0) | 27 achados, todos falsos positivos |
| Segredos na árvore | `gitleaks dir .` | 14 achados, todos falsos positivos (os mesmos arquivos) |
| Arquivos apagados sensíveis | `git log --all --diff-filter=D --name-only` + leitura | `nod-.env` e `site/.wrangler/` (achados 2 e 3) |
| Dados dirigidos | `git grep` por tenant, projeto GCP, IPs, e-mails, clientes e bots internos | achados 4 a 7 |
| Licenças das dependências | `package-lock.json` (só `dependencies` de runtime) | achado 8 |
| Snapshot público | `node scripts/oss/exportar.mjs` | varredura limpa (seção "Prova do snapshot") |

## Achados

### 1. Gitleaks: 41 falsos positivos (27 no histórico, 14 na árvore)

| Regra | Onde | Por que não é segredo |
|---|---|---|
| `generic-api-key` | `.github/workflows/deploy.yml`, `ensaio-restauracao.yml` | é o SHA de pin da action `google-github-actions/auth` |
| `generic-api-key` | `src/adapters/nuvem/conta-gcp.ts` | a constante `KEY_ALG_RSA_2048` |
| `generic-api-key` | `tests/integration/github-conector.test.ts` | `ghp_recusado…`, token de mentira do teste de recusa |
| `generic-api-key`, `curl-auth-user`, `private-key` | `tests/unit/domain/segredos.test.ts`, `revisor.test.ts` | fixtures dos testes de redação de segredo (`maria:s3nh4`, `abc123segredo`, PEM montado de `${corpo}`) |
| `private-key` | `tests/unit/web/chave-ssh.test.ts`, `tests/unit/nuvem-gcp.test.ts` | PEMs de mentira (`lixo`, `Proc-Type: 4,ENCRYPTED` sem corpo real) |

Os que continuam no snapshot público estão aceitos em `oss/gitleaks.toml`, cada um por **arquivo E trecho** (condição
AND): um segredo de verdade colado no mesmo arquivo de teste continua sendo achado.

### 2. `nod-.env` no histórico (02/11)

Entrou em `95f2d83e6` e saiu em `cd4e2eff1` (NOD-421), sobra do teste do `deploy.sh`. Conferido: `NOD_SESSAO_SEGREDO`,
`NOD_CREDENTIAL_KEY`, `NOD_GOOGLE_CLIENT_SECRET` e `NOD_QUADRO_GITHUB_TOKEN` estão **vazios**; o `DATABASE_URL` não tem
host nem senha. Não vazou segredo, mas mostra o formato do env de produção. **Sai junto com o histórico.** O
`.gitignore` já tem `nod-*.env` desde o NOD-421.

### 3. `site/.wrangler/` no histórico (22/10)

Estado local do `wrangler dev` (sqlite do D1, KV, R2, cache), entre `68bc1fce7` e `a2508d40e` (2 commits). Bancos locais
de desenvolvimento do site. **Sai junto com o histórico**; o `.gitignore` já tem `.wrangler`.

### 4. Infra de produção na árvore

`infra/gcp/**` (projeto `nod-producao`, região, IP privado do Cloud SQL, Artifact Registry, service account `nod-vm@`,
`NOD_ADMINS`, domínio admitido), os workflows `deploy.yml`, `ensaio-restauracao.yml`, `release-pendente.yml`,
`desktop-release.yml` e os runbooks. Não são segredos, mas mapeiam a produção. **Ficam só no `gamefik/nod`**.

### 5. Tenant do seed cravado em migração

O id do tenant do Marlon (`172e1fdf-…`) está em `src/db/seed/index.ts`, `.env.example` e nas migrações `0001`, `0004` e
`0110`. Migração aplicada não se edita (`npm run fence:migrations`), então o id continua público. É um identificador,
não dá acesso sozinho (RLS + sessão). **Aceito e registrado** no manifesto (`aceitos`, só nesses caminhos e nos testes).

### 6. Pessoas e clientes reais

E-mails do Marlon (`@gamefik.com`, `@leapy.com.br`, `gmail`), clientes (Leapy, LIPE, Doze Contábil), uma pessoa do time
e o IP público da produção (`34-39-164-139.sslip.io`). Nos arquivos que ficam públicos, o export **reescreve** para
exemplos neutros, preservando a caixa (`Marlon@Leapy.com.br` vira `Pessoa1@exemplo.com`) e o tamanho, para os testes
que medem texto continuarem passando. Docs que só existem por causa deles (planos, UATs, auditoria forense,
comparações, roadmap) **saem**.

Imagens: o repo tem 157; 12 ficam no snapshot. A captura `docs/roadmap/evidencias/…pr399.png` mostrava dado real
(Slack, cliente, nomes) e saiu com o `docs/roadmap/**`; as capturas do Grok (`docs/referencias/ditado-grok/`) são
interface de terceiro e saíram. Ficam 12 binários, todos listados em `imagensRevisadas`: 8 PNG (ícones e a imagem do site) e as 4 fontes
`woff2`. **Binário novo fora dessa lista reprova a varredura**, porque um print, PDF ou planilha nova pode ter dado
real que nenhum padrão de texto pega.

### 7. Docs internos e bots da esteira

As 159 ADRs ficam públicas (com os nomes reescritos). Saem `docs/auditoria-2026-10-15/**`, `docs/uat-*`, `docs/planos/**`,
`docs/plano-*`, `docs/comparacao-*`, `docs/prototipos/**`, `docs/design/**`, `docs/roadmap/**` e os protótipos. Os bots
internos da esteira (Xumbrega, Tarsila, EngNod) viram nomes neutros nos testes que ficam.

### 8. Licenças das dependências de runtime

Compatíveis com Apache 2.0: 81 MIT, 33 ISC, 7 Apache-2.0, 6 BSD, MPL-2.0, EPL-2.0 e Unlicense; **nenhuma GPL, AGPL,
SSPL ou BUSL**. O `khroma` não declara licença no lock (é MIT no repo de origem). MPL-2.0 e EPL-2.0 são copyleft fraco
por arquivo: usados sem modificação, não mudam a licença do nod. O `THIRD_PARTY_NOTICES.md` já existe e vai junto.

## Plano de limpeza: histórico zerado

Publicar um **repo novo com um único commit inicial**, tirado de um snapshot já limpo. O `gamefik/nod` continua
**privado**, como fonte da verdade e arquivo do histórico completo.

Por que não `git filter-repo`: com 5080 commits e 157 imagens, a limpeza deixaria resíduo (o tenant, e-mails e telas em
versões antigas) e exigiria provar commit a commit. O histórico zerado nasce limpo e a prova é uma varredura só. O custo
é perder o blame público, que fica no privado.

Como roda (`scripts/oss/exportar.mjs`, ADR-160):

1. Lê o **ref commitado** (não a árvore de trabalho), aplica `oss/manifesto.json`: exclusões, reescritas, o
   `package.json` (tira o `private`, põe `"license": "Apache-2.0"`, remove os scripts que apontam para arquivo excluído) e
   copia `oss/publico/` (LICENSE, NOTICE, LICENSING.md, README.md, CONTRIBUTING.md) para a raiz.
2. Varre o snapshot: padrões proibidos (tenant, projeto GCP, IPs, e-mails e clientes reais, bots internos, segredo
   preenchido), imagens fora da lista revisada e o gitleaks com `oss/gitleaks.toml`.
3. Publica **só** com `--push=marlonwlv/nod` (igual ao manifesto), varredura limpa, gitleaks instalado, `NOTICE` sem
   titular pendente e privado sem alteração por commitar. Cada export vira **um commit** sobre a `main` pública, com a
   mensagem `Export de gamefik/nod@<sha>`.
4. A CI do privado roda o job `oss` (export a seco + varredura + typecheck do snapshot), sem push e sem bloquear na
   primeira fase.

## Prova do snapshot

Em `90872eb00` + este PR: `node scripts/oss/exportar.mjs` sai 0 com 0 proibido e 0 gitleaks; a única pendência é o
titular do `NOTICE`. No snapshot (3328 arquivos), com o `node_modules` do privado:
`npm run typecheck` passa e `vitest run --project unit` passa (870 arquivos, 12696 testes, 0 falha). Os testes do export (`tests/unit/scripts/oss-exportar.test.ts`) provam o manifesto
aplicado, a varredura barrando um PAT e um tenant plantados, o export determinístico e o push só com a flag certa, para
um repo bare local, como um commit por export.

## Se o Marlon escolher transferir o `gamefik/nod`

A alternativa ao export é transferir o próprio `gamefik/nod` para a conta do Marlon e torná-lo público. **Não
recomendado** enquanto o histórico tiver os achados 2, 3 e 6, mas, se for o caminho, isto quebra ou muda. Conferido na
`main` `90872eb00` e na API do GitHub em 09/11/2026:

- **WIF do deploy preso ao repo.** `infra/gcp/provisionar.sh` cria o provider com
  `--attribute-condition="assertion.repository == '$GITHUB_REPO' && assertion.ref == 'refs/heads/main'"` e o binding da
  SA usa `principalSet://…/attribute.repository/$GITHUB_REPO`, com `GITHUB_REPO=gamefik/nod` em `infra/gcp/config.env`.
  Depois da transferência o token OIDC traz o repo novo e **o `deploy.yml` e o `ensaio-restauracao.yml` param de
  autenticar** até rodar de novo o provisionamento com o repo novo (condição e os dois bindings, o do deploy e o do
  ensaio).
- **Variáveis e secrets.** O ambiente `producao` existe (usado por `deploy.yml` e `ensaio-restauracao.yml`), mas
  **as variáveis estão no repo, não no ambiente**: `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`, `NOD_VM_LOCAL` e
  `NOD_SERVIDOR_PADRAO`. `GCP_ENSAIO_SA` e `NOD_WINDOWS_ASSINAR` são lidas pelos workflows mas **não estão definidas**.
  Secrets do repo: só os 5 `APPLE_*` (`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_CERTIFICATE_P12`,
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_TEAM_ID`). O `desktop-release.yml` cita `WIN_CSC_LINK` e
  `WIN_CSC_KEY_PASSWORD`, que não existem: o Windows **não é assinado** (só assina com `NOD_WINDOWS_ASSINAR == '1'`).
  A transferência leva variáveis, secrets e ambientes junto, mas vale reconferir.
- **Runners self-hosted.** `nod-ci-3` (labels `self-hosted,Linux,X64,nod-ci`) e `nod-ci-integracao-2`
  (`nod-integracao`) estão registrados no repo e são usados por `ensaio-restauracao.yml`, `fuzz-noturno.yml` e
  `release-pendente.yml` (o `deploy.yml` roda no Blacksmith). **Num repo público, runner self-hosted não pode rodar PR de fork** (código de qualquer pessoa na
  VM da produção). Antes de abrir: restringir esses workflows a `push` na `main`/`schedule`, ou mover para runner
  hospedado.
- **Blacksmith existe.** Ao contrário do que estava no pedido, a CI usa o Blacksmith desde 04/11: 7 jobs do `ci.yml`, 1
  do `deploy.yml` e 1 do `desktop-release.yml` rodam em `blacksmith-*-ubuntu-2404`, pelo app `blacksmith-sh` instalado
  na **organização Gamefik**. Numa conta pessoal o app precisa ser instalado de novo (ou os jobs voltam para
  `ubuntu-latest`/self-hosted).
- **Repo fixo no código.** `scripts/desktop/release-mac.sh` tem `REPO_GH=gamefik/nod`. Ao contrário do que estava no
  pedido, `desktop/vm-local/origem.ts` **não** cita o repo: baixa o disco do bucket público `nodbot-downloads` desde a
  1.0.0-rc.3. Também citam `gamefik/nod`: `infra/gcp/config.env` (`GITHUB_REPO`, `NOD_QUADRO_GITHUB_REPOS`),
  `desktop/release-notes.md`, os links de release no `README.md` e fixtures de teste do quadro. O GitHub redireciona o
  repo transferido, mas o WIF não segue o redirecionamento.
- **Links publicados.** O feed de atualização e os DMGs vêm do bucket `nodbot-downloads`, não do GitHub Releases: não
  quebram. Links antigos para `github.com/gamefik/nod/releases` passam a redirecionar.

## Decisões do Marlon (09/11/2026)

1. **Titular do copyright**: Marlon Wanderllich (`NOTICE` e `LICENSING.md`). Licença: **Apache 2.0** (o núcleo); a
   marca "nod" é do Marlon (`LICENSING.md`).
2. **Repo público**: `marlonwlv/nod` (publicado como `marlonwlv/nod-oss` em 09/11 para não matar o redirecionamento do nome antigo do `gamefik/nod`; renomeado para `marlonwlv/nod` em 10/11, depois de conferir que nenhum remote, workflow ou WIF dependia do nome antigo).
3. **Exportar** com histórico zerado (o `gamefik/nod` não é transferido e continua privado, com WIF, secrets e
   ambiente `producao` como estão).
4. **Criar o repo público e rodar o primeiro `--push`**: autorizado; feito depois do merge deste PR.

Pendente: criar a caixa `seguranca@nodbot.ai` (contato de segurança no `NOTICE`, suposto).
