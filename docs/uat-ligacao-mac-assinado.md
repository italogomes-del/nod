# UAT da ligação no Mac assinado (NOD-165)

Roteiro da sessão de hardware do modo ligação no app **assinado** (Developer ID, depende da NOD-133). Ela fecha o que o
e2e e a UAT de 2026-10-04 (`docs/uat-modo-ligacao.md`) não alcançam: eco do alto-falante real, AEC do Chromium,
permissão do microfone pelo macOS e troca de aparelho no meio da ligação. Quem roda é o Marlon, em **dois Macs**. A
preparação (scripts, frases e testes) já está no repositório.

Nada de áudio é gravado (ADR-071). O relatório sai do log do servidor e de uma consulta só de leitura ao banco.

## Antes da sessão

1. **App:** build assinado e notarizado da NOD-133, instalado em `/Applications` nos dois Macs. Anote a versão (menu
   nod › Sobre).
2. **Servidor:** o de produção, o mesmo que o app usa no dia a dia. O app empacotado só aceita servidor `https:`
   (`src/adapters/executor/ponte-http.ts`, `urlServidor`) e só conecta em `NOD_MODO=compartilhado` (`autorizarMaquina`,
   `src/adapters/http/boot.ts`). Por isso um `npm start` local em `http://127.0.0.1` não serve aqui. O executor é a IA de
   verdade do Mac, porque o app só tem os drivers `claude-cli` e `codex-cli` (`desktop/main.ts`). **No app não existe
   catcher:** um `[[delta: …]]` colado na ligação é só texto para o modelo. Anote no relatório o commit de produção
   (`/api/saude`) e a IA usada.
3. **Frases de eco:** gere a lista das 50 leituras, igual nos dois Macs, no formato de pedido de leitura para a IA:
   ```sh
   node scripts/uat/ligacao-voz.ts --eco --listar --ia > /tmp/frases-eco.txt
   ```
   Sem `--ia`, a lista sai em `[[delta: …]]`, que só o catcher lê (servidor local, no navegador).
4. **Pré-teste sem hardware (opcional, recomendado):** num servidor **local** em `catcher` e voz `local` (whisper.cpp; rode
   `scripts/voz/preparar-local.sh`), o laço devolve o áudio do bot como microfone, sem AEC, que é o pior caso. Precisa dar
   `leituras feitas: N/N ✅` e `comandos: 0 ✅`, com exit 0. Se o cérebro não ficar online, o script sai com ❌ e exit 1.
   Isole o servidor num banco e num `NOD_HOME` só dele: outro nod de pé no Mac com o mesmo banco e o mesmo `machine-id`
   (`~/.nod`) puxa o turno da ligação e roda o `claude-cli` de verdade no lugar do catcher.
   ```sh
   docker exec nod-postgres psql -U postgres -c 'create database nod_uat owner nod_dono'
   export DATABASE_URL_DONO=postgres://nod_dono:<senha>@127.0.0.1:5434/nod_uat DATABASE_URL=postgres://nod_app:<senha>@127.0.0.1:5434/nod_uat
   node scripts/migrate.ts && node scripts/seed.ts
   NOD_HOME=/tmp/nod-uat NOD_API_PORT=8897 NOD_LOGIN=stub NOD_EXECUTOR=catcher NOD_VOZ_STT=local NOD_VOZ_TTS=local \
     node src/adapters/http/server.ts 2>&1 | tee /tmp/nod-uat-servidor.log
   # noutro terminal:
   node scripts/uat/ligacao-voz.ts --url http://127.0.0.1:8897 --eco [--quantas 10]
   ```
   As senhas são as do seu `.env` (`DATABASE_URL_DONO` e `DATABASE_URL`); só troque o nome do banco.
5. **Permissão zerada:** para testar o primeiro pedido, rode `tccutil reset Microphone app.nod.desktop` (o `appId` de
   `electron-builder.yml`) antes de abrir o app.
6. Alto-falante embutido, sem fone, Mac a ~50 cm, sala quieta. Volume do sistema em 50%.

## Roteiro (por Mac)

Marque o horário de início e de fim de cada bloco: é o intervalo do relatório.

### 1. Permissão do microfone

1. Com a permissão zerada, abra o app e toque em **Ligar**.
2. O macOS pede o microfone com o texto de `electron-builder.yml:32`: *"O nod usa o microfone só durante as ligações
   com os seus bots."* Confira o texto exato.
3. **Negue.** A ligação mostra o estado de microfone negado (`microfone-negado`), sem travar e sem `microfone-indisponivel`.
4. Libere em Ajustes do Sistema › Privacidade › Microfone, volte e ligue de novo: a ligação abre e ouve.
5. Desligue e ligue de novo: **a segunda ligação não pede permissão** (`desktop/permissoes-midia.ts`: só áudio, só a
   origem do servidor, só o frame de topo).

### 2. Ligações de 3 min (10 por Mac)

Faça **10 ligações de 3 min**: 4 com o volume em 50%, 3 em 80% e 3 em 100%. Em cada uma:

1. **Ligar:** ouça a saudação inteira.
2. **Falar:** duas ou três frases normais e espere a resposta.
3. **Interromper:** fale por cima do bot no meio de uma resposta longa. Ele tem de parar.
4. **Aprovar por voz:** peça em voz alta *"Cria uma rotina que todo dia útil, às 8 da manhã, posta um resumo dos PRs
   abertos. Nada sai sem aprovação."* O bot propõe a rotina, o servidor lê o card e fecha com *"Pode confirmar? Diga:
   pode criar."* (`src/adapters/voz/orquestrador.ts`). **Fique calado até a janela abrir:** o eco da leitura não pode
   criar a rotina. Depois diga "pode criar": a rotina é criada e o bot fala "Pronto, aprovado.". Se a IA perguntar algo
   antes de propor, responda e anote no relatório; se não propuser, conte a ligação como "sem proposta", não como falha
   do eco.
5. **Desligar** pelo botão.

### 3. As 50 leituras com frase de comando

Numa ligação no volume 100% (o pior caso), cole as linhas de `/tmp/frases-eco.txt` uma a uma no campo de texto (o
trecho que começa em "Leia em voz alta"). Espere cada leitura acabar antes da próxima. **Não fale e não clique em
nada.** Confira na legenda do bot que a frase entre « » foi lida inteira, com o comando dentro; se a IA resumir ou
comentar, cole a mesma linha de novo e anote. Nenhuma pode virar comando ou decisão. Repita no outro Mac com as mesmas
linhas.

### 4. AirPods no meio da ligação

Com a ligação em curso e o bot falando, conecte os AirPods. Em ~500 ms o app reabre a captura (`devicechange` em
`web/lib/ligacao.ts`). A voz passa para o fone e a ligação segue ouvindo. **Não pode aparecer `microfone-indisponivel`.**
Desconecte e confira a volta para o alto-falante.

### 5. Relatório

Para cada Mac, com o intervalo da sessão (horário em UTC). Primeiro, baixe o log de produção da VM; o relatório ignora o
prefixo `nod-1  | ` que o `docker compose logs` põe em cada linha:

```sh
gcloud compute ssh nod-vm --zone=southamerica-east1-b --tunnel-through-iap --project=nod-producao \
  --command='sudo docker compose -f /opt/nod/compose.yml logs --no-color --since 2026-10-06T13:00:00Z nod' > /tmp/nod-servidor-mac1.log
```

O banco de produção só tem IP privado. Abra um túnel pela VM num terminal e deixe aberto:

```sh
gcloud compute ssh nod-vm --zone=southamerica-east1-b --tunnel-through-iap --project=nod-producao -- -N -L 5433:10.183.96.3:5432
```

Noutro terminal, a partir de um clone do repositório:

```sh
DATABASE_URL="postgres://nod_app:$(gcloud secrets versions access latest --secret=nod-pg-senha-app --project=nod-producao)@127.0.0.1:5433/nod?sslmode=require" \
  node scripts/uat/relatorio-ligacao.ts --log /tmp/nod-servidor-mac1.log --de 2026-10-06T13:00:00Z --ate 2026-10-06T14:30:00Z
```

O `DATABASE_URL` da linha de comando vale mais que o do `.env` do clone. Log sem ligação no intervalo, `--de` depois
de `--ate` ou opção sem valor saem com erro em pt-BR e exit 1, sem tabela.

Ele dá uma linha por ligação: motivo, trocas, interrupções, latência p50 (de `voz_ligacao_encerrada`), ecos descartados
(`voz_eco_descartado`), sugestões de fone (mais de 3 ecos por minuto, pela regra de `contadorDeEco`), rota de saída e as
**decisões tomadas durante a ligação**. Essas vêm do banco, numa transação `read only` com `DATABASE_URL` (o `nod_app`),
lendo uma pessoa por vez com o escopo dela. Não use `DATABASE_URL_DONO`: `ligacoes` e `decisoes` têm FORCE ROW LEVEL
SECURITY e o dono não enxerga linha nenhuma, o que daria sempre "0 ✅". O `--sem-banco` pula essa consulta.

**Interrupções:** a coluna conta toda vez que o bot parou por fala da pessoa. No passo 2.3 a interrupção proposital
conta 1 por ligação; acima disso, o bot parou sozinho (eco ou ruído que passou pela guarda) e vale anotar.

## Bordas que a sessão confere

- **AEC:** o app pede `echoCancellation: true` (`web/lib/ligacao.ts:67`). Use `'all'` só se `true` falhar, e só no app.
  Em 2026-10-04 o `'all'` mandou só zeros no Chrome do Mac.
- **Troca de aparelho:** a captura reabre 500 ms depois do `devicechange`, sem `microfone-indisponivel`.
- **Permissão:** o texto do pedido é o de `electron-builder.yml:32`, e a segunda ligação não pede de novo.
- **Eco na janela de aprovação:** dentro da janela a guarda por similaridade fica desligada (ADR-074). Quem protege é o
  tempo: só vale fala que começou depois da abertura. O teste `tests/integration/ligacao-eco-aprovacao.test.ts` cobre
  isso com uma aprovação real no banco. A sessão confirma com o alto-falante de verdade.

## Limitações do relatório

- **Decisão por voz não é marcada no banco.** O servidor não grava `canal: "voz"` na decisão; o marcador vive só em
  memória (`decididasPorVoz`, em `src/adapters/http/compor.ts`). Por isso o relatório conta **toda** decisão da conversa
  da ligação decidida entre o início e o fim dela. Uma decisão pela tela no meio da ligação também entra: o número
  pode sair maior que o de decisões por eco, nunca menor, o que é o lado seguro para o critério "zero decisões por
  eco". Na sessão ninguém decide pela tela durante as leituras, então
  qualquer número diferente de zero no passo 3 é falha. No passo 2.4 é esperada uma decisão por ligação: a rotina
  aprovada de propósito.
- **A sugestão de fone ainda não chega ao app.** `contadorDeEco` existe no domínio, mas não está ligado no servidor nem
  na tela. O relatório recalcula a regra a partir das linhas `voz_eco_descartado`, para saber quantas vezes a sugestão
  teria aparecido.

## Modelo de relatório

Copie uma vez por Mac.

```markdown
### Mac <modelo> · macOS <versão>

- Data: AAAA-MM-DD, HH:MM–HH:MM (UTC)
- Build do app: <versão> (assinado, notarizado: sim/não)
- Servidor: produção, commit <de /api/saude>, IA <claude-cli | codex-cli>, STT <provedor>, TTS <provedor>
- Saída: alto-falante embutido, Mac a ~50 cm

| Bloco | Volume | Ligações | Interrupções certas / tentadas | Ecos descartados | Sugestões de fone | Decisões indevidas | Latência p50 (ms) | Resultado |
|---|---|---|---|---|---|---|---|---|
| Permissão (negar → liberar → 2ª ligação sem pedido) | 50% | 3 | — | — | — | — | — | ✅/❌ |
| Ligações de 3 min | 50% | 4 | | | | | | |
| Ligações de 3 min | 80% | 3 | | | | | | |
| Ligações de 3 min | 100% | 3 | | | | | | |
| 50 leituras com comando | 100% | 1 | — | | | **0 esperado** | — | |
| AirPods no meio | 50% | 1 | — | | | — | | |

- Rotina aprovada por voz no passo 2.4: X de 10. O eco da leitura criou alguma rotina? sim/não
- `microfone-indisponivel` apareceu? sim/não (em qual passo)
- Saída do `relatorio-ligacao.ts`: (cole a tabela)
- **Veredito:** aprovado | reprovado (o que falhou e em qual passo)
```

O código de produto só muda se a sessão reprovar. Nesse caso, abra uma issue por falha com o trecho do relatório.
