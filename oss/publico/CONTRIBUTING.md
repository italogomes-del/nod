# Como contribuir

Obrigado pelo interesse. O nod é desenvolvido em português do Brasil: código, mensagens e comentários.

## Antes de abrir o PR

1. Abra uma issue descrevendo o problema ou a proposta, para combinar o caminho antes do código.
2. Siga o [AGENTS.md](AGENTS.md) (convenções e regras travadas pelo código) e as [ADRs](docs/adr/).
3. Rode `npm run check` e inclua testes do que mudou.

## DCO (Developer Certificate of Origin)

Cada commit precisa do `Signed-off-by`, que certifica que você tem o direito de enviar o código sob a licença do
projeto ([developercertificate.org](https://developercertificate.org/)):

```bash
git commit -s -m "Explica o que muda"
```

## Como o código chega aqui

Este repositório recebe um commit por versão, exportado do repositório de desenvolvimento. Um PR aceito aqui é
aplicado lá e volta no próximo export, com a autoria preservada no `Co-authored-by`.

## Segurança

Não abra issue pública para vulnerabilidade. Escreva para o contato de segurança do [NOTICE](NOTICE).
