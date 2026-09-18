# Como publicar cada versão do nod

Este roteiro é para quem mantém o projeto. Para instalar a versão já publicada, use o [guia da primeira pré-release](https://github.com/marlonwlv/nod/blob/desktop-v0.1.0-preview.1/docs/release-desktop.md).

## Ponto de partida e pendências

Registrado em 2026-09-17: a release `desktop-v0.1.0-preview.1` contém dois DMGs sem assinatura Apple. Seu código está na tag e na branch `codex/desktop-release-preview`; a main recebeu apenas o link de download, não a implementação desktop. **Antes da próxima release regular, integre essa implementação por PR, resolva sua compatibilidade com a main e passe os testes novamente.** A candidata `0.2.0-rc.1` integra essa implementação à main com as mudanças posteriores de agentes, rotinas e modelos.

Os comandos desktop abaixo pressupõem essa integração. O [workflow integrado](../.github/workflows/desktop-release.yml) preserva as exigências de assinatura, notarização e rascunho. Não crie uma tag `v*` esperando um build se esse arquivo não existir no commit marcado.

Ainda faltam servidor HTTPS de produção, credenciais Apple e aceite nativo em ambos os tipos de Mac. Um DMG gerado com sucesso não comprova que o time consegue instalar, autenticar e trabalhar.

## Exceção autorizada: preview 0.2.0-rc.1

Em 2026-09-17, o mantenedor pediu repetir a preview anterior e adiar a distribuição assinada até uma versão estável. Esta preview usa a tag `desktop-v0.2.0-rc.1`, pacote `0.2.0-rc.1`, DMGs Intel/ARM sem assinatura Developer ID ou notarização, guia e manifesto SHA-256. Declare nas notas o build cruzado ARM, a ausência de aceite nativo completo e o requisito de servidor HTTPS. Confira os hashes dos arquivos hospedados antes de publicar como pré-release.

O prefixo `desktop-v` mantém esta distribuição manual fora do workflow assinado de tags `v*`. Não se alteram `forceCodeSigning`, hardened runtime ou notarização da configuração de distribuição estável. Para gerar somente os artefatos desta preview, aplique os overrides explícitos na linha de comando: `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg --x64 --arm64 --publish never --config.mac.identity=null --config.mac.notarize=false --config.dmg.sign=false`. Os demais passos e requisitos abaixo descrevem a distribuição assinada.

## Uma vez: preparar a distribuição

- Integre e revise `desktop/`, `scripts/desktop/`, `electron-builder.yml`, scripts npm, ponte HTTP e workflow. Preserve os testes e migrações mais recentes da main.
- Disponibilize servidor e Postgres com backup, Google OAuth e `NOD_MODO=compartilhado`, seguindo o guia correspondente ao código integrado. Use as migrações daquela versão, não uma quantidade fixa copiada da preview. Registre URL, versão do servidor e compatibilidade com o app.
- Tenha acesso Apple Developer e certificado **Developer ID Application** com chave privada. Configure os secrets abaixo no GitHub; não inclua certificados, senhas, chaves de máquina ou dados locais nos commits e artefatos.
- Disponibilize um Mac Intel e um Mac com chip M para aceite, com Claude Code instalado e autenticado. Confirme os requisitos de macOS do Electron usado; não trate apenas `minimumSystemVersion` como prova de compatibilidade.

| Secret no GitHub | Uso no build |
| --- | --- |
| `APPLE_CERTIFICATE_P12` | Certificado e chave privada exportados em P12/base64; vira `CSC_LINK` |
| `APPLE_CERTIFICATE_PASSWORD` | Senha do P12; vira `CSC_KEY_PASSWORD` |
| `APPLE_ID` | Conta de notarização |
| `APPLE_APP_SPECIFIC_PASSWORD` | Senha específica de app |
| `APPLE_TEAM_ID` | Time Apple Developer |

O workflow exige assinatura (`forceCodeSigning=true`), hardened runtime e notarização. Não desligue esses controles para publicar uma versão estável. Veja a [configuração macOS do electron-builder usado na preview](https://www.electron.build/v26/docs/mac/).

## 1. Preparar a versão por PR

Escolha a versão antes do build: correção incrementa patch, funcionalidade incrementa minor e quebra de contrato exige planejamento explícito de compatibilidade. Mesmo em `0.x`, documente qualquer quebra. Use `vX.Y.Z` para release estável e `vX.Y.Z-rc.N` para candidata; a versão no `package.json` deve coincidir exatamente com a tag sem o prefixo `v`.

Em uma branch `codex/`, atualize pacote e lockfile juntos, sem criar tag antecipada:

```bash
npm version 0.2.0 --no-git-tag-version
```

`0.2.0` é exemplo, não a próxima versão obrigatória. Atualize `desktop/release-notes.md` e o guia de instalação com mudanças, correções, migrações, requisitos, limitações, versão compatível do servidor e instruções de atualização. Não anuncie Windows até haver build, instalação e execução validados nativamente.

Valide o commit candidato com Node pinado no projeto e banco de teste dedicado, migrado a partir de uma base limpa:

```bash
npm ci
npm run check
npm run build
npm run desktop:build
```

Configure `DATABASE_URL_TEST` antes do gate: testes de integração pulados não contam como aprovação. Não resete bancos compartilhados para ajustar uma versão antiga. Registre os resultados no PR, obtenha CI verde e faça merge na main. Se código mudar depois do teste, valide a mudança antes de marcar a versão.

## 2. Marcar o commit e acompanhar o build

Na main atualizada, limpa e com CI aprovado:

```bash
git switch main
git pull --ff-only origin main
git status --short
RELEASE_VERSION=$(node -p "require('./package.json').version")
RELEASE_TAG="v${RELEASE_VERSION}"
git rev-parse HEAD
git tag -a "$RELEASE_TAG" -m "nod $RELEASE_TAG"
git push origin "$RELEASE_TAG"
gh run list --workflow desktop-release.yml
```

Confira previamente que a tag não existe localmente nem no remoto. Nunca mova uma tag publicada. Anote SHA e execução do Actions nas notas. O workflow de referência verifica a versão, roda o gate com Postgres limpo e gera `arm64` e `x64` em runners nativos. Depois verifica proxy empacotado, assinatura, ticket e Gatekeeper; apenas então cria um **rascunho** com os DMGs e checksums.

A execução manual (`workflow_dispatch`) desse workflow guarda artefatos, mas não cria release. O workflow também **não marca automaticamente uma tag `-rc.N` como pré-release**, nem anexa o guia: faça esses passos antes da publicação. Ajustes futuros na automação devem preservar esse comportamento seguro de rascunho e ser revisados por PR.

## 3. Completar e conferir o rascunho

Use o guia do mesmo commit da tag. Anexe-o ao rascunho como `guia-instalacao-nod.md`, sem copiar silenciosamente uma documentação mais recente. Inclua nas notas um link permanente `https://github.com/marlonwlv/nod/blob/TAG/docs/release-desktop.md`, substituindo `TAG`, além do endereço do servidor e requisitos de acesso ao repositório.

Baixe os artefatos do rascunho em diretório vazio e confira os hashes dos bytes efetivamente hospedados. O workflow de referência escreve caminhos `release/` nos arquivos SHA; normalize para nomes de arquivo ao preparar o manifesto para distribuição, ou preserve essa subpasta ao verificar. Exemplo para produzir um manifesto portátil na pasta dos DMGs:

```bash
shasum -a 256 ./*.dmg > SHA256SUMS.txt
shasum -a 256 -c SHA256SUMS.txt
```

Compare com os hashes originados no build; gerar um novo manifesto de um download, sozinho, não prova correspondência com o build. Anexe o manifesto final ao rascunho e confira que todos os assets estão `uploaded` e com tamanho esperado. O mínimo por versão é: DMG Intel, DMG ARM, guia e SHA-256. Nunca inclua `.env`, credenciais, `conexao.enc` ou arquivos de outra versão.

Se um upload falhar, consulte primeiro os assets existentes. Reenvie apenas o arquivo ausente; substitua arquivo parcial somente no rascunho e confira o hash novamente. Não reconstrua nem recomprima um artefato assinado para contornar upload: isso exige nova validação de assinatura, notarização e checksums.

## 4. Aceitar os instaladores baixados

Em **cada arquitetura**, registre pessoa, modelo do Mac, macOS, versão/SHA, data e resultado:

- Baixar pelo GitHub, abrir DMG, arrastar para Aplicativos e abrir normalmente sob Gatekeeper, sem remover quarentena nem desabilitar proteções.
- Verificar assinatura e ticket no app instalado:

  ```bash
  codesign --verify --deep --strict --verbose=2 /Applications/nod.app
  xcrun stapler validate /Applications/nod.app
  spctl --assess --type execute --verbose=2 /Applications/nod.app
  ```

- Configurar HTTPS, autenticar via navegador, gerar chave individual e conectar.
- Executar um turno real curto e testar Parar, reconexão, fechar/reabrir e revogação da chave. O turno e a sonda usam a assinatura Claude: registrar o custo e evitar repetições desnecessárias.
- Atualizar a partir da versão anterior, preservando configuração, e verificar compatibilidade com o servidor que o time vai usar.

Falha de assinatura, login, executor ou compatibilidade impede release estável. Build cruzado e inspeção Mach-O não substituem execução nativa. Publique os resultados e limitações nas notas; não copie contagens de testes de outra versão.

## 5. Publicar e atualizar o README

Confirme os quatro tipos de artefato, aceite nas duas arquiteturas, notas, servidor disponível e plano de recuperação. Para candidata, marque explicitamente pré-release **enquanto ainda está em rascunho**:

```bash
gh release edit "$RELEASE_TAG" --prerelease
```

Para versão estável, confirme que essa marca está desativada. Publique só após conferir o rascunho completo:

```bash
gh release edit "$RELEASE_TAG" --draft=false
gh release view "$RELEASE_TAG" --json url,isDraft,isPrerelease,assets
```

Os exemplos usam `gh` dentro do checkout do repositório e reutilizam `RELEASE_TAG` da etapa 2. Em outra sessão, defina a tag explicitamente. Confirme a página de download e atualize via PR o README da main para apontar à release e ao guia daquela tag. Preserve as releases antigas para rastreabilidade. Considere habilitar [releases imutáveis do GitHub](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases); com essa opção, todos os assets precisam estar anexados antes de publicar.

Não há atualização automática no app da preview. Oriente o time a baixar e instalar a nova versão; só aumente a versão mínima exigida pelo servidor depois de disponibilizar e validar os clientes correspondentes.

## Recuperação e aprendizado por versão

Se o problema surgir após publicar, registre o defeito e a versão afetada; publique correção com **nova versão e nova tag**, sem substituir silenciosamente os DMGs antigos. Se necessário, retire a versão da indicação de download no README e recomende a anterior somente após confirmar compatibilidade com o servidor. Migração de banco não se desfaz reinstalando DMG: siga um plano de restauração testado ou migração corretiva, com backup e janela definidos antes do deploy.

Inclua este registro nas notas de cada release:

```text
Versão / tag / SHA:
PR e execução do Actions:
Servidor e migrações compatíveis:
DMGs e hashes:
Assinatura e notarização:
Aceite Intel (pessoa, Mac, macOS, resultado):
Aceite ARM (pessoa, Mac, macOS, resultado):
Atualização desde a versão anterior:
Limitações e recuperação:
O que falhou e o que melhorar na próxima versão:
```

Aprendizados de 2026-09-17: a primeira preview saiu de um snapshot diferente da main, então o servidor deve usar sua tag; não havia certificado Apple nem servidor HTTPS configurado; ARM foi empacotado, mas não executado nativamente. O upload Intel retornou HTTP 500 e precisou ser repetido. A release permaneceu em rascunho até os dois DMGs estarem enviados e seus hashes conferidos. Esses limites explicam a classificação de preview, não são o padrão de uma release estável.
