# ADR-014 — CLI do fornecedor: dois executores

**Status** invertido

## Decisão

Dois executores, mesmo SPI. (A) LOCAL, o caminho padrão: o CLI é o que já está na máquina da pessoa, o nod NÃO instala e NÃO pina versão, e o processo filho HERDA o ambiente para o CLI resolver a própria credencial. Some o pin exato, some a imagem, some o teste de fumaça contra imagem construída. Entram: a resolução de caminho do binário (o PATH pelado de app aberto pelo Finder) e a tabela de flag floors, que fica MAIS necessária. (B) SERVIDOR, só para rotinas noturnas: o ADR-014 original sobrevive inteiro — container, CLI pinado em versão exata, teste de fumaça no CI, chave da Leapy. Em ambos: --strict-mcp-config e --setting-sources project desde o primeiro dia, e diretório de trabalho por turno apagado ao fim.

## O que mudou

A inversão. O CLI sai do container e vai para a máquina no caminho padrão; o container fica vivo no caminho noturno.

## Por quê

A premissa que sustentava 'CLI no container' era que a Leapy pagava a conta de todos os turnos de 70 clientes. Cada pessoa já paga a própria assinatura e já está logada. Duas coisas que o código obriga a incluir e que o container não tinha: (1) augmentedPath() existe porque app aberto pelo Finder herda PATH pelado, e eles rodam o shell de login em background para capturar exports do .zshrc — isso é trabalho real que a inversão traz; (2) a linha que impede a chave da Leapy 'riding along in the parent env' de 'flip a subscription login to pay-as-you-go' é obrigatória, porque é a diferença entre o turno sair da assinatura da pessoa (custo zero) ou cair na fatura da empresa sem ninguém perceber. Os flag floors ficam mais necessários: agora são 19 versões de CLI em vez de uma pinada, e sem eles a colega que não atualiza há quatro meses tem todo turno falhando com erro de argumento.

