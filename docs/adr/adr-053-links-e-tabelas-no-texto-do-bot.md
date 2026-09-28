# ADR-053 — Links e tabelas no texto do bot

Status: aceito · Data: 2026-09-28 · Revê a regra de 2026-09-17 em `web/lib/texto-formatado.ts` ("links do modelo continuam texto") · Emenda ADR-026

## Contexto

Desde 17/09 o texto do bot na conversa entendia só negrito, itálico e código. Todo o resto aparecia como texto, de propósito. O bot lê Slack, e-mail e web, e um texto de fora pode fazê-lo escrever um link com nome bonito e destino ruim.

Em 28/09 isso apareceu duas vezes no uso real:

- **Links:** a Clarice citou duas mensagens do Slack com a URL crua. A URL quebrava no meio da linha e não abria com clique. A própria Clarice prometeu "coloco o link sempre que citar Slack ou ClickUp", mas o link continuava sem clique.
- **Tabelas:** o Dev 1 listou PRs numa tabela em markdown. Chegou como linhas de `|` e `|---|`, e a pessoa lia coluna por coluna no olho.

Os mockups aprovados estão nas páginas "Links nas mensagens" e "Tabelas nas mensagens" do canvas de design.

## Decisão

1. **Só http e https viram link.** Endereço com usuário e senha (`https://github.com@outro.site`) não vira. `file:`, `javascript:`, `mailto:` e esquemas de outros apps continuam como o bot escreveu.
2. **Link solto vira um chip.**
   - O nome do chip sai do próprio endereço:
     - `Slack · mensagem das 16:38` (a hora vem do `p<ts>` do link);
     - `ClickUp · tarefa 86b4x2qd`;
     - `backoffice #466`;
     - `Google Docs · documento`;
     - `NOD-123` (Linear).
   - **Site comum:** globo, domínio sem `www.` e o começo do caminho. Termina em `…` quando algo ficou de fora.
   - O domínio nunca é cortado. Caracteres invisíveis (bidi, largura zero) saem do caminho mostrado.
   - Sem https, o globo dá lugar a um cadeado aberto. `localhost` ganha o ícone de computador.
3. **`[nome](link)` fica na frase.**
   - Link de app ganha o ícone do app antes do nome. Link de site comum mostra o domínio ao lado.
   - **Nome que parece endereço** (`github.com/leapy`, `https://…`) não vale, porque quem lê acredita nele. Nesse caso aparece o chip do destino real.
4. **Passar o mouse, ou focar com o teclado, mostra o endereço inteiro.** A dica traz o host, o caminho com o que vem depois do `?`, o aviso "sem https" quando for o caso e "Abre no navegador". A dica é um elemento fixo na janela, para não ser cortada dentro de uma tabela que rola.
5. **O clique abre fora.**
   - No navegador: `target="_blank"` e `rel="noopener noreferrer nofollow"`, então o site não fica sabendo de onde veio.
   - No app do Mac: o `setWindowOpenHandler` passa http(s) para o navegador padrão (`abreNoNavegador`). Antes ele negava. A janela nunca abre dentro do app.
6. **Tabela como no GitHub:** cabeçalho com `|` e, logo abaixo, a linha `|---|` com o mesmo número de colunas.
   - Aparece num card branco dentro da mensagem.
   - A célula é o mesmo texto escapado, com negrito, código e link, e **nunca HTML do modelo**.
   - Os dois-pontos alinham a coluna. Célula curta não quebra linha.
   - Linha torta completa com vazio e ignora o que sobra. `\|` é barra dentro da célula.
   - Tabela larga rola para o lado com a primeira coluna parada.
   - **Tabela com mais de 10 linhas** mostra 8 e "Mostrar as outras N linhas". O que foi aberto sobrevive ao novo render (`data-disclosure`).
   - **Copiar** aparece ao passar o mouse e põe a tabela na área de transferência separada por tabulação. Cada célula vai com o texto que a pessoa lê.
7. **Prompt:** uma linha diz o que a conversa mostra e pede o link no próprio nome (`[PR #481](…)`). O artefato fica para o que é interativo ou visual; tabela simples vai no texto.

## Emenda ao ADR-026

O conteúdo de fora continua marcado para o modelo. Na tela, porém, o link que o bot escreve a partir dele passa a abrir com clique.

Esse risco é aceito com três proteções:

- o destino real sempre aparece: pelo app reconhecido no endereço, pelo domínio ao lado do nome ou no chip, e pelo endereço inteiro na dica;
- o nome que imita um endereço é descartado;
- só http(s) abre, e sempre fora do app.

## Gatilho de reversão

Qualquer um destes leva a voltar o link a texto (tirar `chipDoLink` e `linkComNome` de `emLinha`), mantendo as tabelas:

- um relato de link enganoso clicado, ou seja, destino diferente do que a pessoa leu;
- um endereço que passe pela dica com host diferente do que o navegador abriu.
