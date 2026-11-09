# nod

> Um lugar onde agentes preparam decisões e uma pessoa decide, com registro de quem decidiu, por quê e se havia alguém olhando.

O nod pilota agentes de IA (Claude Code, Codex) que já estão credenciados na máquina da pessoa: os bots viram contatos,
trabalham em conversas, quadros e rotinas, e tudo o que tem efeito fora passa por uma aprovação explícita. O servidor
nunca vê a credencial do modelo.

Este repositório é o código aberto do nod. Ele é exportado do repositório de desenvolvimento como um commit por versão;
a versão hospedada (infraestrutura de produção, deploy e release assinado) fica fora daqui.

## Rodar localmente

Pré-requisitos: Node 24.19.0 (pinado em `.mise.toml`), Docker e, para usar um modelo de verdade, o Claude Code
instalado e logado.

```bash
mise install && npm ci
cp .env.example .env                   # troque NOD_SESSAO_SEGREDO e NOD_CREDENTIAL_KEY
npm run dev:setup                      # Postgres 16 em 127.0.0.1:5434 + migrações + seed
NOD_LOGIN=stub npm run dev             # api http://127.0.0.1:8888 + web http://127.0.0.1:5274
```

O executor padrão é o **catcher** (`NOD_EXECUTOR=catcher`): as respostas do "modelo" vêm de marcadores no próprio texto,
sem custo. Para o Claude Code real, use `NOD_EXECUTOR=claude`.

## Testes

```bash
npm run check    # lint, typecheck, cercas e os quatro modos de teste (unit, integration, conformidade, concurrency)
```

## Documentação

- [Arquitetura](docs/arquitetura.md)
- [Decisões (ADRs)](docs/adr/)
- [AGENTS.md](AGENTS.md): comandos e regras travadas pelo código

## Contribuir

Leia o [CONTRIBUTING.md](CONTRIBUTING.md). Cada commit leva o `Signed-off-by` (DCO).

## Licença

O núcleo do nod está sob a [Apache 2.0](LICENSE). Marketplace pago, pagamentos e recursos de empresa ficam fora deste
repositório, e a marca "nod" é do Marlon: veja o [LICENSING.md](LICENSING.md), o [NOTICE](NOTICE) e as
[licenças de terceiros](THIRD_PARTY_NOTICES.md).
