# Referência: o ditado do Grok (ADR-095)

Fotos que o Marlon mandou em 2026-10-11, às 00:55, de como o Grok dita no campo de mensagem. Do celular, ficou só a faixa
do campo; o resto da tela tinha conversa de outro projeto.

## Celular (iPhone)

| Arquivo | O que mostra |
|---|---|
| [celular-1-parado.png](celular-1-parado.png) | `(+)  [Ask Picasso   🎤  ● onda]`: o 🎤 cinza dentro do campo, ao lado do botão preto do modo voz. |
| [celular-2-gravando.png](celular-2-gravando.png) | Gravando: a linha inteira vira três pílulas, `[ ■ ]  [ 0:05 ||||||| ]  [ ↑ ]`, e o ↑ é preto e largo. |
| [celular-3-enviado.png](celular-3-enviado.png) | Depois do ↑: "Oi, teste falando." já está no chat, sem prévia do texto. O campo volta ao normal. |

## Computador

As três capturas eram arquivos temporários do macOS e sumiram antes de entrar no repositório. Pela descrição do
Marlon e pelas imagens da conversa:

1. **Parado:** `[+]  Mensagem para QA localhost   (🎤 cinza) (● preto com onda)`.
2. **Gravando:** o placeholder vira "Ouvindo…". À direita aparece a pílula cinza `■ 0:08 •••••` (parar, tempo e um nível
   que pulsa), e o botão preto vira `↑`.
3. **Depois do ■:** o texto transcrito ("Oi, teste, fala no teste, um, dois, três, testando.") fica no campo, editável,
   com 🎤 e `↑` de volta. A pessoa confere e envia.

## Como o nod segue

- **O mesmo DOM nos dois tamanhos.** O ■ põe o texto no campo e o ↑ envia direto. O CSS do celular (`web/mobile.css`)
  monta as três pílulas.
- **O enviar do nod continua sendo o ➤.** Ele não vira um ↑ desenhado; durante a gravação, o rótulo dele passa a ser
  "Parar e enviar".
- **O botão preto do modo voz fica de fora.** No nod, a ligação continua sendo o "Ligar" do cabeçalho da conversa.
