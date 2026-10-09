# Motor na VM: como conectar e testar

Guia do teste real da [ADR-088](adr/adr-088-o-motor-numa-maquina-linux-da-pessoa.md). O servidor precisa estar com a
versão que tem o motor (o deploy do `main` depois do merge desta feature).

## 1. A VM

Qualquer provedor. Debian 12 ou Ubuntu 22.04/24.04, x64 ou arm64. Para começar, 2 vCPU e 4 GB; com vários bots
rodando testes e builds, 4 vCPU e 8 GB. Nenhuma porta precisa ficar aberta além do SSH que você usa para entrar. Use a
VM só para o Nod: ela vai guardar o login das suas IAs.

## 2. Instalar

No terminal da VM, como root ou com sudo:

```bash
curl -fsSL https://<seu-nod>/motor | sh
# com o Codex também:
curl -fsSL https://<seu-nod>/motor | NOD_COM_CODEX=1 sh
```

No fim ele mostra um código (ex.: `K7QM-4F2X`) e um link. Abra o Nod (no Mac ou no navegador) em **Seu espaço ›
Máquinas › Conectar uma máquina**, digite o código e confirme. O terminal diz "Conectada como <nome>".

## 3. Entrar nas IAs (na VM)

```bash
nod-motor entrar claude    # o Claude Code mostra um link: abra em outro aparelho e cole o código de volta
nod-motor entrar codex     # opcional
nod-motor entrar github    # opcional (para o bot usar gh)
nod-motor estado           # o servidor conectado e o estado de cada IA
```

O login é seu, direto com o fornecedor. O Nod não vê a senha nem a chave. Com o serviço ainda sem IA pronta, ele percebe
o login sozinho em segundos e a tela do Nod marca a IA como pronta. Se você entrar numa segunda IA com o motor já
trabalhando, ela passa a valer no próximo `sudo systemctl restart nod-motor` (que interrompe o que estiver rodando).

## 4. Escolher onde cada bot trabalha

Em **Máquinas**: marque os bots que vão para a VM no último passo do "Conectar", ou depois em "Onde cada bot trabalha".
"Bot sem escolha" define onde trabalha bot novo.

## 5. O que conferir

- Mande uma mensagem a um bot preso à VM: a resposta mostra "rodou em" a VM e o bot diz que está na máquina Linux.
- Feche o app do Mac: o bot da VM continua respondendo pelo navegador.
- Pare o serviço na VM (`sudo systemctl stop nod-motor`) e mande uma mensagem: a linha da fila diz "<vm> não responde
  desde HH:MM" e oferece "Rodar em <Mac> desta vez".
- `journalctl -u nod-motor -f` mostra o log do motor.

## Atualizar e desligar

- Atualizar: rode o mesmo `curl … | sh`. Ele troca os arquivos e mantém a conexão e os logins.
- Desconectar: em **Computadores**, cancele a chave da VM. Os bots presos a ela voltam a rodar em qualquer máquina.
- Remover da VM: `sudo systemctl disable --now nod-motor` e apague `/opt/nod-motor` e o usuário `nod`.

## Problemas conhecidos

- **O pareamento venceu:** o código vale 10 min. Rode `nod-motor parear https://<seu-nod>`.
- **"Chave não vale mais":** a chave foi cancelada (o motor só desiste depois de três recusas seguidas, a 1 min uma da
  outra). Rode `nod-motor parear https://<seu-nod>` e mova os bots para a máquina nova em Máquinas.
- **Segurança:** a chave do motor, o login do Claude Code (`~/.claude/.credentials.json`) e o do Codex
  (`~/.codex/auth.json`) contam como credenciais para o terminal do bot: ele não os lê sem você aprovar.
- **"O servidor pede um motor mais novo":** rode o `curl … | sh` de novo.
