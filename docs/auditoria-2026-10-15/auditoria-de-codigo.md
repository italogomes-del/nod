# Auditoria do núcleo do Nod

Data: 15/10/2026. Base: worktree `nod-auditoria` em `origin/main 81a1c532`. Para: Marlon.

Como ler este relatório. Cada achado passou por um autor, que o encontrou, e por pelo menos um cético, que tentou derrubá-lo lendo o código e, em alguns casos, contando linhas em produção (só leitura). A severidade mostrada é a **final, depois do cético**; a do autor aparece entre parênteses quando mudou. "Confirmado" quer dizer que o caminho foi conferido linha a linha no código. Não quer dizer que foi reproduzido rodando, e quase nenhum foi. A frequência real em produção só é citada quando houve contagem. Os números de linha são do worktree.

---

## 1. Resumo executivo

**Tese.** O caminho feliz do Nod funciona. As falhas se concentram em quatro padrões, e os quatro se repetem em vários subsistemas:

1. **O limite passou da IA para a conta (ADR-102), mas a lógica de espera e de socorro ainda decide pela origem do turno ou pela presença de `trabalho_id`.** Por isso frentes da pessoa, triagens de colega, rotinas sem frente e o retorno do lote morrem em vez de esperar, o que contraria a promessa "nenhuma frente falha por limite" (ADR-099 §7).
2. **Estados sem saída e sem aviso.** Parada que nunca fecha, card Retomar esquecido, pedido de colega sem resposta, máquina "zumbi", turno da ligação envenenando a fila. Nada avisa a pessoa e nenhum varredor resolve.
3. **O que um turno carrega é copiado quando ele nasce e não é herdado pelos seguintes.** Ficam para trás o anexo, a marca de contaminação, o pedido original da frente e a IA da sessão. Também se usa o relógio errado: a criação do turno no lugar da queda, do despacho ou do gasto.
4. **O que o servidor sabe não chega à tela.** A barra e a tela de Trabalhos só releem quando o *estado* de um trabalho muda. Notas prometem "Seguindo com X" sem que nada siga, e botões não fazem nada.

**Os achados que mais ameaçam a confiança no produto:**
- **A1.** Desde 13/10 (commit d14c7b1e), um Mac ou VM que só tem o Codex pronto anuncia o inventário do Claude como principal. A máquina nunca puxa turno e toda mensagem é negada com "entre no Claude Code". É regressão.
- **A2.** Se a máquina fica muda entre 60 e 90 s (tampa fechada, troca de Wi-Fi), ela volta "zumbi": aparece online na tela, nunca mais recebe turno, e o servidor nega toda mensagem dizendo "IA ausente".
- **A3.** Uma ligação que termina antes de o Mac pegar o turno-cérebro deixa esse turno pendente para sempre. A máquina com voz fica travada: todo puxar falha e o bot inteiro para.
- **G1.** O retorno do lote, que é a resposta integrada depois das frentes, morre se a IA estiver no limite. Como o lote já foi marcado devolvido, o resultado de horas de trabalho nunca chega à pessoa.
- **E1.** A retomada automática mede a queda pela hora em que o turno *nasceu*. Uma frente longa que cai por infraestrutura é dada como perdida na hora. É o caso que a ADR-099 queria cobrir.
- **H1 e F1.** Pedidos entre bots entregam um resultado parcial como final quando dois colegas respondem em sequência. Além disso, apertar Parar não cancela o pedido ao colega, e a resposta dele reabre o trabalho que a pessoa parou.
- **B1 e C1.** Há um laço rápido de "O Claude chegou ao limite · respondendo pelo Codex" quando a máquina-alvo só tem o Claude. E o botão "Rodar no <máquina> desta vez" da nota de contas não faz nada.

**Ordem de ataque sugerida:**
1. **Lote 1:** máquina e fila (A1, A2, A3, A4). São correções pequenas que destravam bots inteiros.
2. **Lote 2:** uma regra única de espera por limite (G1, C2, C7, D1, H2, G2 e outros). Precisa de uma emenda curta à ADR-099 §7.
3. **Lote 3:** queda, deploy e retomada (E1 a E6).
4. **Lote 4:** pedidos entre bots e Parar (H1, F1, F2, H3, H4, H5).
5. Depois: notas e botões de contas (lote 5), tela contra servidor (lote 6), rotinas (lote 7), herança entre turnos (lote 8). O resto fica para os lotes 9 a 11.

---

## 2. Padrões de causa raiz

### P1. "Espera por limite" decidida pela origem ou pelo `trabalho_id`, não pelo que o turno é
`aposLimiteNoFundo` (assentar-turno.ts:636) exige `turno.trabalhoId`. `aposLimite` (assentar-turno.ts:417) exige `origem === 'conversa'`. O pré-spawn (despachar-turno.ts:159) decide pela origem. Isso deixa vários turnos sem nenhum caminho de espera:
- a frente aberta pela pessoa, que nasce com origem `conversa`: C2, C7;
- a triagem de pedido de colega: H2;
- a rotina sem frente: D1;
- o retorno do lote: G1;
- o turno de sala: L1.

Quando a espera existe, ela não carrega o pedido original (G2), não acorda quando a pessoa resolve o problema (C6) e conta no teto de voltas (D8).
**Achados:** C2, C3, C6, C7, D1, D7, G1, G2, H2, L1, D8.

### P2. O portão olha a IA, mas o limite agora é da conta, e a fila olha a máquina sem olhar contas
- A fila (`reivindicar`) e `iasParaOAutomatico` leem só `ias_no_limite`, que o caminho das contas não grava (C12).
- A reprovação por `conta_sem_acesso` derruba a IA inteira na máquina (C4, A5).
- `no_limite_ate` nunca se cura sozinho (C5).
- A troca de IA no limite usa os prontos da *pessoa*, mas a fila entrega o turno só à *máquina-alvo* (B1, B7).
- A tela e a fila calculam "espera a cota" de formas diferentes (D3).

**Achados:** B1, B7, C4, C5, C12, D3, A5, K1.

### P3. Estado sem saída e sem aviso
São situações em que nenhum varredor resolve e a pessoa não vê o motivo:
- parada aberta indefinida (F2);
- card Retomar esquecido (G3);
- pergunta de triagem dispensada (H3);
- espera de comando cancelada (H4);
- pedido segurado mais de 24 h (H5);
- lote de bot excluído (G9);
- frente de rotina presa que pula janelas para sempre (I7);
- agenda que trava (I5);
- 409 permanente (A4);
- máquina zumbi (A2);
- turno-cérebro órfão (A3);
- retomada presa à VM morta (G8);
- lead da sala excluído (L3).

**Achados:** A2, A3, A4, F2, G3, G8, G9, H3, H4, H5, I5, I7, L3.

### P4. O relógio errado ou o fato copiado no nascimento
- `lease_ate` é zerado ao interromper, e a queda passa a ser medida pela criação do turno (E1).
- A tolerância ao reinício conta desde a última resposta, não desde a primeira falha (E4).
- "Trabalhando há 3 h" conta desde a criação do turno (J3).
- O custo é atribuído pela data de criação do turno (D5).
- A leitura "esgotado" vale por uma janela que já renovou (D6).
- A herança entre turnos falha para contaminação (D2), sessão sem IA (B2), anexo (K2), pedido da frente (G2) e máquina da cópia (M1).

**Achados:** B2, D2, D5, D6, E1, E4, G2, J3, K2, M1.

### P5. Notas e botões que prometem e não cumprem
- "Seguindo com X" sem que nada siga: C3, L1.
- "Rodar desta vez" que é um botão morto: C1.
- "Seguir com" que não refaz, ou refaz o turno errado: C9, L2.
- A nota não oferece passo nenhum (C8), ou se duplica a cada reconexão (B5).
- O botão "Tentar de novo" não existe (C5).

**Achados:** B5, C1, C3, C5, C8, C9, L1, L2.

### P6. O fecho trata falha como sucesso, ou sucesso como falha
- Aprovação vencida vira "terminado" (G5).
- Entrega parcial é apresentada como final (H1).
- Parar vira "falhou por erro técnico" (I2).
- "Executou" é registrado duas vezes (I3).
- Sucesso tardio vira "parcial" (E8).
- Recusa no despacho não é tratada como queda (G4).
- O lote de colega todo parado é entregue como resposta (ver os não verificados).

**Achados:** E8, G4, G5, G7, H1, I2, I3.

### P7. Falha transitória de transporte tratada como definitiva, ou o contrário
- Exceção na adoção mata o CLI (E5).
- Um 400 por mais de 1000 ferramentas é repetido por 120 s e depois abandonado (E6).
- Hook e proxy negam na primeira falha durante o deploy (E7).
- A oferta de mensagem que se perde não é refeita (E9).
- A rajada de 409 na abertura (A9).

**Achados:** A4, A9, E4, E5, E6, E7, E9.

### P8. O que o servidor sabe não chega à tela
- A barra só relê em `trabalho.mudou` (J1).
- A janela de 24 h só existe no dono (J2).
- O custo não enxerga o Codex (D4) e o ritmo erra na troca de IA (D9).
- A frente espera uma máquina fora do ar sem dizer isso (G8, G12).
- O histórico da rotina não mostra a recusa (I6).

**Achados:** D3, D4, D9, G8, G12, I6, J1, J2, J3.

### P9. Efeito externo em dobro
- Gate de aprovação que não segura a janela seguinte (I1).
- Card velho aprovado depois que a ação já saiu (G6).
- "Testar agora" com execução já pendente (I10).
- Duplicar pelo Nod com rotinas ativas (M2).
- Duas cópias com o mesmo nome e a mesma pasta (M3).

**Achados:** G6, I1, I10, M2, M3.

---

## 3. Achados confirmados, por subsistema

Severidade final: **9 altas**, a maioria média, algumas baixas. Dentro de cada subsistema a ordem é da mais grave para a menos grave.

### A. Máquinas, inventário, conexão e fila

#### A1. Mac e motor anunciam o inventário do Claude como principal: máquina só com Codex nunca puxa turno e toda mensagem é negada culpando o Claude (regressão de 13/10)
- **Severidade:** alta (crítica). **Tipo:** bug.
- **Cenário:**
  1. Mac com o Codex logado e o Claude sem login (ou ausente); bot em "Uma IA só: Codex".
  2. A vigia calcula `principal` = Codex pronto.
  3. `desktop/main.ts:529` envia `inventario: comContas['claude-cli'] ?? principal`. O inventário do Claude sempre existe no mapa (registry.ts:108-111), então o `??` nunca cai no principal.
  4. O servidor persiste "Claude nao_autenticado" como inventário principal (ponte.ts:137-140, compor.ts:593).
  5. "oi" → enviar-mensagem.ts:89-90 → `resolverLocalidade` recusa (localidade-turno.ts:23-24) → "Nenhum trabalho começa… Claude Code sem conta conectada".
  6. O puxar exige `c.inv.estado === 'pronto'` (ponte.ts:280), então a máquina nunca recebe turno. O despacho também recusaria (despachar-turno.ts:102-103). A VM tem o mesmo problema (motor/main.ts:247).
- **Mecanismo:** `inventariosComContas` (desktop/contas-locais.ts:57-64) só promove o inventário quando há conta pronta e não escolhe o principal. O servidor confia nesse campo único em três portões. A linha foi introduzida em d14c7b1e (confirmado com `git log -S`).
- **Impacto:** quem só tem o Codex utilizável, ou tem o Claude deslogado ou desatualizado, não consegue rodar nenhum bot, e a mensagem de erro aponta a IA errada.
- **Correção:** nos dois anúncios, usar `Object.values(comContas).find(i => i?.estado === 'pronto') ?? comContas['claude-cli'] ?? principal`. No servidor, derivar "alguma IA pronta" de `harnesses` em `lerAnuncio`/`atual()` para não depender do campo único. Teste: anúncio `{claude: nao_autenticado, codex: pronto}` → a máquina puxa e o envio a um bot do Codex é aceito.
- **Conhecido:** mesmo sintoma das NOD-213 e NOD-220 (concluídas), mas com causa nova e posterior a elas. Não há issue aberta.
- **Cético:** confirmou a cadeia inteira e o commit. Em produção o dono tem o Claude pronto, então o bug não aparece nos dados dele. Rebaixou para alta porque o alcance se limita a máquinas sem o Claude pronto.

#### A2. Silêncio de 60–90 s deixa a conexão viva com inventário "ausente" para sempre: a máquina para de receber turnos, a tela diz "pronto" e o servidor nega toda mensagem
- **Severidade:** alta (crítica). **Tipo:** bug.
- **Cenário:**
  1. A máquina fica sem falar com o servidor entre 60 e 90 s (tampa fechada por um minuto, troca de Wi-Fi ou VPN).
  2. Aos 60 s o `varrer` faz `c.inv = ausente()` e persiste; a conexão só é apagada aos 90 s (ponte.ts:426-433).
  3. A máquina volta dentro da janela. O puxar responde 200 (a conexão existe), mas só reserva turno com inventário `pronto` (ponte.ts:280).
  4. Nada restaura `c.inv`. Só `conectar`, `inventario` e a entrega com `causaSemIa` escrevem nele (:201, :226, :338).
  5. O cliente não reanuncia: não recebe 409, a chave da vigia não mudou (vigia-ias.ts:263, 283-290) e não há `powerMonitor`.
  6. A tela usa `harnesses()`, que lê o anúncio guardado e diz "pronto". O envio usa o `inventario_motores` persistido (ausente) → `resolverLocalidade` recusa (enviar-mensagem.ts:91-93 → localidade-turno.ts:23-25).
- **Mecanismo:** presença e inventário são a mesma variável, com duas fontes de verdade que divergem justamente nessa janela. Nenhum teste chama `varrer()`.
- **Impacto:** a máquina para de trabalhar em silêncio por tempo indefinido (horas ou dias numa VM). As mensagens da pessoa recebem uma negação falsa e a tela diz que está tudo bem. Combina com os sintomas de NOD-215 e NOD-216.
- **Correção:** separar presença de inventário. O `varrer` não sobrescreve `c.inv` (`atual()` e o puxar já filtram por `c.ultimo`). A opção mais simples é o puxar responder 409 `reconectar` quando chega depois de 60 s ou mais de silêncio, o que reaproveita o reanúncio que já existe. No cliente, adicionar `powerMonitor.on('resume')` → reanunciar. Teste: relógio +61 s → puxar → reserva o turno ou responde 409.
- **Conhecido:** vizinho de NOD-215 e NOD-199 (concluídas); nenhuma cobre a janela de 60 a 90 s.
- **Cético:** confirmou a cadeia linha a linha. A frequência real (quanto silêncio um sono de tampa produz) não foi medida. Rebaixou para alta porque reabrir o app recupera.

#### A3. Turno-cérebro de uma ligação já encerrada fica pendente para sempre e envenena a fila da máquina com voz
- **Severidade:** alta (crítica). **Tipo:** bug.
- **Cenário:**
  1. A pessoa liga. `ligar` enfileira um turno com origem `ligacao` (ligacoes.ts:190-200).
  2. A ligação termina antes de o Mac reivindicar o turno: o timeout `cerebroPrimeiroMs` (orquestrador.ts:1431-1435), o deploy ou o Mac dormindo, ou a pessoa desliga.
  3. `encerrar()` (orquestrador.ts:1923-1960) só limpa o cérebro se ele já estiver anexado (:1952). `ligacoes.encerrar` só atualiza a tabela de ligações.
  4. No próximo puxar de qualquer máquina com voz, `reivindicar` pega esse turno primeiro: ligação vem antes de tudo e ignora alvo, faixa e cota (turnos.repo.ts:250, 257, 291, 299).
  5. `emitirPlanoTurno` lança `estado_invalido` (:367-369). `despacharTurno` só captura `executor_indisponivel` (:132-141). A ponte faz rollback e devolve null (ponte-interna.ts:384-396). A rota repete a cada 250 ms (ponte.ts:270-290).
- **Mecanismo:** três regras se somam: a ligação só limpa o cérebro já anexado, um erro de domínio no plano vira rollback silencioso, e a ligação tem precedência absoluta na fila. Nenhum varredor pega o caso (turno-orfao.ts:50; turnos.repo.ts:661, 692; parar.ts:38).
- **Impacto:** o bot inteiro, com todas as conversas, rotinas e frentes da pessoa, para de receber turnos no Mac com voz. A tela não mostra nada. As únicas saídas são acidentais: Parar naquela conversa ou excluir o bot.
- **Correção:**
  1. Em `despacharTurno` (ou no WHERE do `reivindicar`), um turno de ligação cuja ligação não está `chamando`/`em_curso` é assentado como interrompido e o puxar segue. Isso também resolve o estado que já está preso.
  2. Em `encerrarLigacao`, interromper na mesma transação os turnos pendentes com aquele `ligacao_id`, usando um motivo próprio.
  3. Não generalizar para "qualquer ErroDeDominio".
- **Conhecido:** não. Vizinho de NOD-168 (concluída).
- **Cético:** confirmou toda a cadeia. Em produção: 17 turnos de ligação, todos concluídos, e 0 pendentes com ligação morta. A janela é estreita.

#### A4. Processo morre sem `desconectar` e volta em menos de 90 s: `conectar` responde 409 para sempre e a máquina fica surda para o servidor
- **Severidade:** média (alta). **Tipo:** risco.
- **Cenário:**
  1. O motor ou o app morre com SIGKILL (OOM, "Forçar Encerrar") enquanto há um turno em voo, e o systemd o sobe de novo em 5 s.
  2. O laço novo puxa pela mesma conexão e renova `c.ultimo` a cada 250 ms (ponte.ts:278).
  3. `conectar` recusa enquanto `c.planos` não estiver vazio e `c.ultimo` tiver menos de 90 s (ponte.ts:196-198). `c.planos` só perde ids pela entrega (:342).
  4. O cliente só passa para a rota `inventario` depois de um `conectar` aceito (ponte-http.ts:122, 130).
  5. Resultado: 409 → reanúncio → 409 a cada 10 s. Conta nova, IA pronta, capacidades e reprovações nunca chegam ao servidor (compor.ts:625-629).
- **Impacto:** a máquina roda turnos, mas o servidor não recebe mais nenhum anúncio dela. Só o próximo deploy cura.
- **Correção:** o cliente manda no `conectar` a lista de turnos que tem em andamento, e o servidor descarta de `c.planos` os ids que o cliente não reconhece. Um processo novo manda lista vazia. Teste em ponte-http.test.ts.
- **Conhecido:** vizinho de NOD-199 e NOD-214.
- **Cético:** confirmou. O gatilho exige queda com turno em voo e volta em menos de 90 s, e a situação se cura no deploy seguinte.

#### A5. `inventariosComContas` sobrepõe o veredito da vigia: IA reprovada por `conta_sem_acesso` é anunciada como pronta e o servidor nunca grava `sem_acesso`
- **Severidade:** média. **Tipo:** risco.
- **Cenário:**
  1. Uma organização desativa o uso por assinatura do Claude, mas `claude auth status` continua dizendo logado.
  2. A vigia ou a sonda reprova a IA com causa `conta_sem_acesso`.
  3. No anúncio, a promoção ignora a `causa` e anuncia `pronto` (contas-locais.ts:60-61).
  4. Com `p.conta` presente, o Mac não chama `vigia.reprovar` (desktop/main.ts:499, motor/main.ts:220).
  5. O servidor reprova só em memória (ponte-interna.ts:233-242), e o próximo anúncio desfaz a reprovação.
- **Impacto:** a conta bloqueada volta a receber turnos pagos que falham, e a tela mostra "pronta". É regressão da emenda da ADR-019 de 05/10.
- **Correção:**
  1. Não promover quando a `causa` for `conta_sem_acesso` ou `teste_falhou`.
  2. Marcar a conta local como `sem_acesso` e anunciá-la assim.
  3. Gravar o vínculo como `sem_acesso` no servidor (prometido no item 3 da ADR-101, mas nenhum código escreve esse estado).
- **Cético:** confirmou. Nenhum teste referencia `inventariosComContas`.

#### A6. "Rodar em X desta vez" na conversa arrasta também os turnos pendentes das frentes
- **Severidade:** baixa (média). **Tipo:** bug.
- **Cenário:** `rodarDestaVez` marca todos os pendentes da conversa sem filtrar `trabalho_id` (turnos.repo.ts:622-625). Os turnos das frentes moram na conversa do bot (frentes.ts:59, 71-84), então a frente passa a rodar na outra máquina, onde a pasta dela não existe (ADR-090 §7).
- **Correção:** acrescentar `and trabalho_id is null` no UPDATE e no repositório em memória, mais um teste.
- **Cético:** só esta variante se sustentou. A variante "turno preso na VM" foi derrubada: a VM pega o turno e o recusa de forma visível. A lista de Trabalhos usa o alvo real.

#### A7. Chave de máquina revogada com turno rodando: incidente "sem contato" que nunca fecha, e o Retomar manda o trabalho para outra máquina
- **Severidade:** baixa (média). **Tipo:** risco.
- **Mecanismo:**
  - A revogação é só um UPDATE (chaves-maquina.ts:25-28).
  - O varredor assenta o turno como `maquina_sem_contato` e abre um incidente com `voltouEm` nulo. `registrarVoltaDasMaquinas` (interromper-por-maquina.ts:168-178) nunca o fecha.
  - `alvoDoTurno` pula a chave revogada (alvo-da-maquina.ts:14-20), então a retomada vai para outra máquina, sem a pasta.
- **Correção:** no varredor, se a chave da máquina estiver revogada, assentar com motivo `maquina_removida`, sem incidente e sem card, e fechar os incidentes em curso dessa máquina.
- **Cético:** confirmou. É caso de canto e o aviso pode ser dispensado com "Entendi".

#### A8. Toda autorização de chave grava `ultimo_uso_em`, e o long-poll reautoriza a cada 250 ms
- **Severidade:** baixa (média). **Tipo:** melhoria.
- **Mecanismo:** autorizar-chave-maquina.ts:27-32 e ponte.ts:272-289. Gera cerca de 4 UPDATEs por segundo por máquina ociosa.
- **Correção:** em `marcarUso`, gravar só se a última marca tiver mais de 30 s. Deve ficar abaixo da janela de 2 min de contas-do-turno.ts:34.
- **Cético:** produção mostrou 99,95% de HOT updates e 98 tuplas mortas, então não há bloat. Sobra o desperdício de uma transação com escrita por volta.

#### A9. Na abertura do app ou do motor, o laço puxa antes do primeiro `conectar`: um 409 por inicialização, "Reconectando…" e três anúncios em rajada
- **Severidade:** baixa (média). **Tipo:** risco.
- **Mecanismo:** `publicar` chama `aoRegistry` antes de `anunciar` (vigia-ias.ts:262-265). O laço não recebe `anuncio` (desktop/main.ts:491) e puxa antes de conectar (laco.ts:380-392). Recebe 409 (ponte.ts:147-151), e o cliente dispara `reconectar` e `aoFalhar` (ponte-http.ts:156-159; desktop/main.ts:386-393).
- **Correção:** subir o laço só depois do primeiro anúncio aceito. Enquanto `conectado === false`, não reconectar por causa de um 409 do puxar.
- **Cético:** confirmou. A ordem depende de uma corrida e o efeito é ruído; mascara 409 reais na investigação.

### B. Harness, IA e sessão do CLI

#### B1. Laço rápido no limite: `aposLimite` repete a fala na IA que só está pronta noutra máquina, mas a fila devolve o turno à máquina-alvo, que só tem a IA no limite
- **Severidade:** alta. **Tipo:** bug.
- **Cenário:**
  1. Mac A (alvo do bot ou da pessoa) só com o Claude; máquina B com o Codex; bot em Automático. O Claude bate no limite.
  2. `aposLimite` usa `prontosDaPessoa` (ponte-interna.ts:518), que inclui o Codex de B, grava "respondendo pelo Codex" e reenfileira com `reenvios+1` (assentar-turno.ts:412-457).
  3. A cláusula `alvo = machineId` (turnos.repo.ts:236-240) entrega o turno de volta a A. `iaDoAutomatico` cai em "todas no limite = a primeira pronta" (inteligencia.ts:66-69), que é o Claude, e ele é rejeitado de novo.
  4. Repete a cada poucos segundos, sem teto de reenvios. O único teto existente está em `aposContaAusente`, assentar-turno.ts:577.
- **Impacto:** a conversa é inundada de linhas "O Claude chegou ao limite · respondendo pelo Codex" e um `claude -p` rejeitado roda por volta, até o limite renovar ou a pessoa apertar Parar.
- **Correção:**
  1. Só trocar se a IA de destino estiver pronta numa máquina que *pode* pegar o turno. Senão, mostrar um aviso com a hora: "o Codex está pronto no B; este bot roda no A".
  2. Criar um teto de reenvios comum aos caminhos de limite, conta e IA.
- **Conhecido:** vizinho de NOD-171 e NOD-211.
- **Cético:** confirmou. Produção tem uma cadeia de `reenvios` de 2 a 30 ou mais, com cerca de 3 s entre cada um, em 12/10 às 18:28. A causa exata daquele laço não foi cruzada.

#### B2. Retomada de rotina ou delegação herda a sessão do turno anterior sem conferir a IA: `--resume` com id de sessão da outra IA
- **Severidade:** média (alta). **Tipo:** bug.
- **Cenário:**
  - Uma rotina no Automático roda no Codex (o Claude estava no limite) e para numa aprovação. Na retomada, o Claude já voltou e é escolhido.
  - `sessaoDaCadeia` compara só o executor (emitir-plano-turno.ts:223-226). `sessaoDoTurno` não devolve a IA (turnos.repo.ts:485-488).
  - O Claude recebe `--resume <thread do Codex>`, o que vira `sessao_rejeitada` e a rotina registra "falhou".
  - No sentido inverso, o Codex abre thread nova e sem histórico (:238).
- **Correção:** gravar a IA e a conta da sessão no turno e exigir igualdade, como já fazem :216-217. Como defesa adicional, refazer o turno uma vez sem resume quando vier `sessao_rejeitada`.
- **Cético:** confirmou. Produção não tem nenhuma `sessao_rejeitada` em retomadas, e o uso misto de IAs ainda é raro.

#### B3. Produção (`NOD_MODO=compartilhado`) nunca retoma sessão do CLI
- **Severidade:** média (alta). **Tipo:** risco. **Precisa de decisão e ADR.**
- **Mecanismo:**
  - compor.ts:440-441 usa `permitirResume: !daPonte`, e `daPonte` é verdadeiro sempre no compartilhado.
  - Todo turno vai com histórico de 20 falas × 1000 caracteres (emitir-plano-turno.ts:236-246).
  - O `thread/resume` do Codex (ADR-103 §7) nunca é pedido (codex-chat.ts:424-425), mas `sessao_cli` continua sendo gravada.
- **Impacto:** em todo turno, a pessoa paga o histórico de novo e o bot perde o que fez com ferramentas. O que o Marlon testa no modo local não é o que o cliente vê. Isso também agrava K2 (anexos).
- **Correção:** decidir entre sessão por máquina (`sessao_maquina_id`, com resume quando o turno cai na mesma máquina) e assumir "sem sessão" (desligar `retomaSessao`, tirar `/compactar` do catálogo, medir o custo). Registrar a escolha em ADR.
- **Cético:** confirmou que é uma limitação já admitida na ADR-092, não uma regressão. Produção: 26 de 31 conversas com mais de um turno têm sessões distintas.

#### B4. Codex com terminal perde o Bash depois do deploy se o hook pergunta antes de a máquina reconectar
- **Severidade:** média. **Tipo:** bug.
- **Mecanismo:**
  - `recomporPlano` usa `capacidadesDaMaquina`, que devolve `{}` sem conexão (compor.ts:484; ponte.ts:481-484).
  - Com isso `terminal=false` (emitir-plano-turno.ts:346), o Bash e o apply_patch saem do plano e a rota responde 403 (interno.ts:204-206).
  - O plano recomposto fica em cache pelo resto do turno (token-turno.ts:176-177).
- **Correção:** na recomposição sem conexão viva, passar `undefined` (não sei) em vez de `{}`, ou gravar `terminal` em `turno_credenciais` no despacho. Não guardar em cache um plano recomposto sem conexão.
- **Cético:** confirmou. A janela vai até 30 s, até o 409 e a reconexão.

#### B5. `repetirBarradosPorIa` repete turnos barrados por falta de conta e duplica a nota "Seguir com…" a cada reconexão
- **Severidade:** média. **Tipo:** bug.
- **Mecanismo:**
  - `semContaNaMaquina` usa `executor_indisponivel` + `limite_do_plano` (despachar-turno.ts:157).
  - `barradosPorFaltaDeIa` não filtra `motivo_falha` (turnos.repo.ts:816-824), e é chamada em todo conectar e inventario (ponte.ts:128-133).
  - Cada deploy gera uma nota nova com botões em cada conversa barrada nos últimos 30 min. No modo "Trocar sozinho", a fala pode rodar sem a pessoa pedir.
- **Correção:** criar um `motivo_falha` próprio (`sem_conta`) para a recusa por conta, ou excluir `limite_do_plano` da repetição. Ver também C7.
- **Cético:** confirmou.

#### B6. Bot fixo numa IA que a máquina-alvo não tem, mas outra máquina viva tem: negação "Codex indisponível" com o Codex pronto, repetida a cada anúncio
- **Severidade:** baixa (alta). **Tipo:** bug.
- **Mecanismo:**
  - O alvo reivindica o turno (turnos.repo.ts:236-240).
  - `recusarPorExecutor` usa o inventário pronto da outra máquina, e o texto sai como "indisponível" (harness.ts:100).
  - `repeteNosProntos` usa os prontos da pessoa (repetir-barrados-por-ia.ts:51-59).
- **Correção:** repetir só se a IA fixa estiver pronta na máquina-alvo. Mudar a frase para "o Codex está pronto no <B>; este bot roda no <A>". A sugestão "deixar para B" não serve: o turno ficaria preso, que era o problema da NOD-171.
- **Cético:** produção não tem nenhum turno com `reenvios` maior ou igual a 2 nesse padrão.

#### B7. Codex app-server: `turn/start` recusado descarta a mensagem de erro, e a guia manda `effort: max` ao gpt-6-astra
- **Severidade:** baixa (média). **Tipo:** risco.
- **Mecanismo:**
  - codex-chat.ts:354-357 grava `turno_recusado` e joga fora `r.mensagem`. cliente-app-server.ts:99 faz o mesmo.
  - `guiaNoMaisPotente` troca o modelo, mas mantém o raciocínio (emitir-plano-turno.ts:303-304, 312).
- **Correção:** recalcular o raciocínio depois de `modeloEscolhido` e preservar `r.mensagem` (redigida) como `erroCru`. Medir com a sonda o que o 0.162 devolve antes de criar uma classe `modelo_indisponivel`.
- **Cético:** não confirmou que o app-server recusa. O custo de diagnóstico é certo; o dano à pessoa é hipótese.

#### B8. Frente no Codex perde a sessão a cada troca de conta e a cada volta (ping-pong entre a conta preferida e a substituta)
- **Severidade:** baixa (média). **Tipo:** melhoria. **Decisão de produto (ADR-101 §5).**
- **Mecanismo:** `contaEmUsoDaIa` sempre devolve a preferida livre (contas-da-pessoa.ts:52). `mesmaContaDaSessao` só decide se retoma ou não (emitir-plano-turno.ts:213-214).
- **Correção:** primeiro, avisar na linha de sistema que a frente recomeçou do histórico. Depois, se valer a pena, dar preferência à conta da sessão em frentes do Codex. Isso contraria "a ordem é da pessoa".
- **Cético:** só a volta é evitável; a ida já é aceita pela ADR-102 R1.

### C. Contas (ADR-101/102)

#### C1. "Rodar no <máquina> desta vez" da nota de contas não faz nada: só marca turno pendente, e o turno já está interrompido
- **Severidade:** alta. **Tipo:** bug.
- **Cenário:**
  1. A Max está no limite no Mac (o alvo); a Team está livre só na VM; modo "perguntar".
  2. `semContaNaMaquina` assenta o turno como interrompido (despachar-turno.ts:157) e depois cria a nota com o botão (:170).
  3. O clique chama `rodarDestaVez`, que faz UPDATE `where estado='pendente'` (turnos.repo.ts:622-627) e afeta 0 linhas. A rota devolve `{turnos:0}` e a tela só invalida a conversa (web/main.ts:2828-2832).
  4. O mesmo acontece com a nota criada no assentamento (assentar-turno.ts:282 antes de :548-550).
  5. Três contas na mesma VM geram três botões idênticos (ia-fora.ts:253-258).
- **Impacto:** o caminho previsto para "conta livre só noutra máquina" é um botão morto. Com alvo fixo, reenviar cai na mesma nota.
- **Correção:**
  1. Criar o caso de uso `rodarDestaVezComConta`, no molde de `seguirComConta`: acha o turno interrompido por `limite_do_plano`, reenfileira com `maquinaDestaVez`, `reenvios+1` e a guarda `jaRefeito`, e grava a linha "Rodando na <VM> desta vez".
  2. Deduplicar os botões por máquina.
- **Cético:** confirmou. O docs/plano-contas-mac-vm.md:258-259 reaproveitou "a rota de hoje" sem notar que o turno já estava interrompido.

#### C2. Frente aberta pela pessoa que chega a uma máquina com a conta no limite não espera: é interrompida, vira "falhou" e fecha o lote
- **Severidade:** média (alta). **Tipo:** bug.
- **Cenário:**
  1. O dono abre frentes a partir da conversa. Elas nascem com origem `conversa` e `trabalho_id` (frentes.ts:86; pedido-de-colega.ts:70).
  2. A única conta do Claude está no limite e o modo é "perguntar".
  3. despachar-turno.ts:159 testa `origem !== 'conversa'` e pula `esperarContaNaFrente`, criando a nota (:168-174).
  4. A frente vira `falhou` (trabalho.ts:124), o lote fecha e o varredor não a recupera (frentes.repo.ts:179).
- **Mecanismo:** o pré-spawn decide pela origem; o assentamento decide pelo trabalho (assentar-turno.ts:543). O teste cobre só origem `rotina` (contas-no-turno.test.ts:138).
- **Correção:** `if (turno.trabalhoId || turno.origem !== 'conversa')` → `esperarContaNaFrente`. Teste com `conversa + comTask`.
- **Conhecido:** citado de passagem no mapa como "ponto fraco 5"; não há issue.
- **Cético:** confirmou. Rebaixou porque exige a máquina sem nenhuma conta utilizável.

#### C3. Pré-spawn com IA fixa decide "outra_ia": a conversa lê "Seguindo com ChatGPT · B" e nada é refeito; a nota sai sem botão
- **Severidade:** média (alta). **Tipo:** bug.
- **Mecanismo:**
  - `semContaParaOTurno` passa `naMaquina` inteira, sem filtrar pela IA do turno (contas-do-turno.ts:67).
  - Com isso a decisão vira `outra_ia` (contas-da-pessoa.ts:136-137) e a frase "Seguindo com" (:181).
  - `livres` fica vazia (contas-do-turno.ts:95), e o despacho só sabe criar nota (despachar-turno.ts:168-174).
- **Correção:** filtrar `naMaquina` pelas IAs do turno, como assentar-turno.ts:522-525 já faz, e tirar de `livres` as contas de outra IA. Não refazer no despacho, porque isso quebraria a regra da IA fixa.
- **Cético:** confirmou. Há contorno: pôr o bot no Automático.

#### C4. Conta corporativa sem acesso (Team) derruba o Claude inteiro na máquina, na memória do servidor, mesmo com a Max pronta
- **Severidade:** média (alta). **Tipo:** bug.
- **Mecanismo:**
  - ponte-interna.ts:516 chama `reprovarHarness` sem olhar `plano.conta`.
  - O Mac, com `p.conta`, não reanuncia (main.ts:499).
  - Nenhum código grava `sem_acesso` (contrato e CHECK da 0074 existem, mas sem escritor).
  - A reprovação só cai num 409 ou reconexão.
- **Impacto:** todo turno fixo em Claude dessa máquina é recusado; o Automático só roda no Codex.
- **Correção:** reprovar a IA só quando o turno não tem conta. Com `contaDoTurnoId`, gravar o vínculo como `sem_acesso`, limpar a escolhida e repetir o turno.
- **Cético:** confirmou.

#### C5. `no_limite_ate` nunca se cura sozinho: upgrade pago fica preso até o horário gravado
- **Severidade:** média (alta). **Tipo:** bug.
- **Mecanismo:**
  - `contaDoTurno` só devolve conta livre (contas-da-pessoa.ts:44, 54-62), e o pré-spawn barra antes do CLI (despachar-turno.ts:113-118).
  - O único limpador é um turno concluído na conta (assentar-turno.ts:325), que nunca roda.
  - Não há rota nem botão para "tentar de novo".
  - O prazo pode chegar a 31 dias (ponte-validacao.ts:313), contra 8 dias do caminho por IA (inteligencia.ts:88-90).
- **Correção:**
  1. Aplicar o teto de 8 dias (`PRAZO_LIMITE_MAXIMO_MS`) no `marcarLimite`.
  2. Botão "Tentar de novo com <conta>" na nota e em Provedores, que limpa o limite e refaz o turno.
  3. Opcional: deixar a conversa sondar a conta no limite quando ela é a única da IA.
- **Cético:** produção tem 1 conta Max no limite. O dono tem alternativas; o impacto cheio é para quem tem uma conta só.

#### C6. Frente sem conta utilizável dorme até o `no_limite_ate` do fornecedor; "Seguir com" e a troca de modo não a acordam
- **Severidade:** média (alta). **Tipo:** risco.
- **Mecanismo:**
  - No ramo da frente (despachar-turno.ts:159-167; assentar-turno.ts:543), a retomada nasce com `acordar_em` igual à volta do fornecedor, que pode ser dias.
  - Nenhum código reescreve `acordar_em` (só aparece no INSERT, turnos.repo.ts:167).
  - `seguirComConta` só refaz turno com origem `conversa` (contas-ia.ts:92).
- **Correção:** manter a espera sem pergunta, que é decisão do QA da NOD-211 (redacao.ts:72-74), mas dar saída. "Seguir com", trocar para Automático ou logar uma conta nova antecipam a retomada pendente daquela IA, identificada pela IA do turno e não por texto. A linha da task diz "esperando a conta N" e oferece "Seguir com".
- **Cético:** produção tem 0 retomadas pendentes no futuro hoje.

#### C7. Frente aberta pela pessoa e barrada por conta é repetida como turno de CONVERSA solto, sem trabalho
- **Severidade:** média (alta). **Tipo:** bug.
- **Mecanismo:**
  - Começa como C2. Depois `barradosPorFaltaDeIa` (turnos.repo.ts:816-823) devolve o turno e `repetirBarradosPorIa` o reenfileira sem `trabalhoId` (repetir-barrados-por-ia.ts:31-45; turnos.repo.ts:172).
  - O texto "Frente: … Parta de origin/main" roda como fala, na pasta do bot.
- **Correção:** a correção de C2, mais `trabalho_id is null` em `barradosPorFaltaDeIa`.
- **Cético:** produção tem 0 ocorrências (o caminho das contas é de 13/10).

#### C8. Nota de limite sem passo quando a conta livre não está numa máquina viva; depois de "Entrar com X", a nota continua com os passos velhos
- **Severidade:** média. **Tipo:** melhoria.
- **Mecanismo:**
  - O botão "Entrar com" está aninhado em `else if (l.outraMaquina)` (ia-fora.ts:253-258).
  - O comentário promete "em nenhuma: Entrar com ela aqui" (contas-da-pessoa.ts:111).
  - O payload da nota é congelado na criação (contas-do-turno.ts:72), e o fim do login não refaz nada (compor.ts:641-644).
- **Correção:** desenhar "Entrar com X na <c.maquina>" sempre que `!l.naMaquina`, e recalcular "Seguir com" a partir de `estado.contasIa`.
- **Conhecido:** vizinho de C1.
- **Cético:** confirmou a parte 1; a parte 2 é mais fraca.

#### C9. "Seguir com <conta>" não refaz nem avisa quando uma fala de frente ou colega do próprio bot entrou depois da nota, ou quando há 30 mensagens ou mais depois dela
- **Severidade:** baixa (média). **Tipo:** bug.
- **Mecanismo:** `jaRefeito` conta qualquer fala de agente (contas-ia.ts:90), e a nota é buscada só entre as 30 últimas mensagens (:85; mensagens.repo.ts:144-151).
- **Correção:** decidir pelo estado do turno (o último interrompido por `limite_do_plano`, mais um turno posterior com a mesma `mensagemOrigemId`). Quando nada for refeito, devolver o motivo.
- **Cético:** confirmou. A escolha da conta fica gravada; o dano é um botão que não faz nada.

#### C10. Conta removida "de todas" volta sozinha quando uma máquina que já estava logada nela a lê pela primeira vez
- **Severidade:** baixa (média). **Tipo:** risco.
- **Mecanismo:**
  - Na primeira leitura, `logadaEm = agora` (desktop/contas-locais.ts:108; padraoDe :80; sincronizar :261).
  - Isso faz `decidirAnuncio` devolver "voltar" (contas-da-pessoa.ts:161), e o repositório reativa a conta (contas-ia.repo.ts:117-121).
- **Correção:** na primeira leitura, usar a data de modificação do arquivo de credencial. Carimbar `agora` só quando o login passou pelo Nod.
- **Cético:** só acontece com estado local zerado (máquina nova ou reinstalação).

#### C11. "Sair desta máquina" e "Remover de todas" não olham turno em curso na conta: a pasta é apagada debaixo do CLI
- **Severidade:** baixa (média). **Tipo:** risco.
- **Mecanismo:** rotas/contas-ia.ts:99-122 e contas-ia.repo.ts:176-187 fazem UPDATEs cegos. `sairDe` → logout e `rm -rf` da pasta (contas-mac.ts:120-128). O `dispose` não faz nada (claude-cli.ts:682-684).
- **Correção:** no diálogo de confirmação (web/telas/contas-lista.ts:295-328), listar as frentes que estão rodando nessa conta e nessa máquina.
- **Cético:** o efeito exato no CLI não foi reproduzido. A ação é deliberada e confirmada pela pessoa.

#### C12. A fila ignora as contas: sem alvo, o Mac com a conta no limite pega o turno e o mata com uma nota, enquanto a VM com conta livre estava puxando
- **Severidade:** baixa (média). **Tipo:** bug. **Decisão de produto.**
- **Mecanismo:** `reivindicar` (turnos.repo.ts:225-260) não olha contas. `noLimite` vem só de `ias_no_limite` (ponte-interna.ts:262-264). O caminho das contas não grava `ias_no_limite` (assentar-turno.ts:309-321).
- **Correção:** decidir se no modo "perguntar" o turno sem alvo sempre pergunta ou roda onde há conta livre. No segundo caso, a máquina sem conta utilizável declina o turno enquanto outra máquina viva tiver conta.
- **Cético:** a inconsistência (o resultado depende do lock) é o defeito real. Produção tem contas espalhadas em 3 máquinas.

### D. Cota, limite e custo

#### D1. Rotina e pedido de colega sem task que batem no limite NO MEIO do turno falham de vez
- **Severidade:** média (alta). **Tipo:** bug. **Decisão de produto.**
- **Cenário:**
  - Rotina das 09:00 num bot fixo no Claude; a janela de 5 h chega a 100% no meio do turno.
  - `aposLimite` é null porque a origem não é `conversa` (:417). `aposLimiteNoFundo` é null porque não há `trabalhoId` (:636).
  - Cai no aviso (:358-385). `depoisDeAssentar` grava "falhou" (compor.ts:553-558) e nada roda às 11:30.
  - No caso do pedido de colega, `avisarFalhaDelegacao` sai na hora (entregar-resposta-peer.ts:275-285).
- **Correção:** criar a retomada com `acordar_em` igual à renovação, mantendo a cadeia `retoma_turno_id`, e não gravar "falhou" quando houver retomada por cota. Na prática, estender `aposLimiteNoFundo` à rotina sem trabalho.
- **Cético:** produção tem 13 turnos de rotina sem trabalho interrompidos por limite. Delegação sem trabalho: 0, então o caso do colega é hipótese.

#### D2. A repetição da fala por limite ou troca de conta/IA não herda a marca de contaminação (ADR-062 §6)
- **Severidade:** média. **Tipo:** bug.
- **Mecanismo:**
  - Cinco caminhos chamam `turnos.enfileirar` sem `contaminar`: assentar-turno.ts:437-452, 485-500, 590-608, 716-731, e repetir-barrados-por-ia.ts:30-44.
  - Só :660 e enfileirar-retomada.ts:52 herdam a marca.
  - O turno repetido retoma a sessão com a página de fora no contexto e ganha as aprovações automáticas de um turno limpo (autorizar-comando.ts:58-66).
- **Correção:** um helper `repetirTurno`, ou um parâmetro `herdaContaminacaoDe` no INSERT. Teste para os cinco caminhos.
- **Cético:** confirmou. Raro: exige ler a web e bater no limite no mesmo turno.

#### D3. "Esperando a cota da IA" na tela diverge da fila
- **Severidade:** média. **Tipo:** bug.
- **Mecanismo:**
  - A tela usa `iasConhecidas` (usos mais limites; cota-da-ia.ts:153-155) e a IA *atual* do bot (trabalhos.ts:222-230).
  - A fila usa as IAs prontas e a IA do turno (turnos.repo.ts:233-234).
  - O Codex nunca tem leitura (claude-cli.ts:555 é o único driver que a produz).
- **Impacto:** com Claude e Codex prontos e o Claude no limite, as tasks aparecem "esperando a cota" enquanto rodam no Codex. No inverso, a task fica "na fila" sem motivo.
- **Correção:** para o Automático, usar `iasParaOAutomatico` com as IAs prontas das máquinas vivas. Para IA fixa, usar o harness do turno pendente mais antigo. Na dúvida, mostrar "livre".
- **Conhecido:** vizinho do "turno pendente guarda o harness" (15/10).

#### D4. "Custo de hoje" e o total do modo dev não enxergam o Codex
- **Severidade:** média. **Tipo:** bug.
- **Mecanismo:** o Codex emite `custoUsd: null` (codex-chat.ts:229; codex-ligacao.ts:306; codex-stream.ts:25). A soma filtra `custo_usd is not null` (turnos.repo.ts:807). `custoDosBots` só lista quem tem custo maior que zero (custo-do-dia.ts:92). Os tokens são gravados (turnos.repo.ts:524-525), mas nenhuma leitura os usa.
- **Correção:** somar os tokens e mostrar "N mil tokens · o Codex não informa custo". O modo dev conta turnos sem o filtro. A frente mista é marcada como parcial.
- **Conhecido:** vizinho de NOD-125 (backlog).
- **Cético:** confirmou. É lacuna de exibição.

#### D5. O custo só nasce quando o turno termina e é atribuído pela hora de criação
- **Severidade:** média. **Tipo:** bug.
- **Mecanismo:**
  - `custoPorAgente` agrupa por `t.criado_em` (turnos.repo.ts:806-807), e o custo só é gravado ao assentar (assentar-turno.ts:282-292).
  - Hoje parece menor que a média sempre que há turnos longos, e o aviso de ritmo não dispara durante um descontrole.
- **Correção:** somar a tabela `gastos` por `g.em`. Depois, se quiser, mandar o custo parcial na renovação.
- **Cético:** produção (14 dias): 105 gastos registrados mais de 2 h depois da criação do turno e 46 que cruzam a meia-noite.

#### D6. A leitura "esgotado" segura o fundo do Claude até 1 h depois da renovação que o fornecedor anunciou; a pílula diz "volta em 3 dias"
- **Severidade:** baixa (média). **Tipo:** bug.
- **Mecanismo:** `vigentes` exclui a janela já renovada (cota-da-ia.ts:51), o que reabre o ramo "esgotado" (:58). O `voltaEm` é o máximo com a semana (:59), e o teste fixa 72 h (cota-da-ia.test.ts:48-49).
- **Correção:** usar `!janelas.some(utilizacao >= 1)` e `voltaEm = medidoEm + 1 h`. Antes, conferir com uma fixture real do CLI.
- **Conhecido:** vizinho de NOD-12.

#### D7. Frente em Automático que bate no limite com outra IA pronta é migrada na hora para a outra IA, perdendo a sessão
- **Severidade:** baixa (média). **Tipo:** risco. **Decisão de produto (ADR-099 §7).**
- **Mecanismo:** `aposLimite` (:354) vem antes de `aposLimiteNoFundo` (:356) e não olha `trabalhoId`. A frente nasce com origem `conversa`. A sessão só é retomada com o mesmo harness (emitir-plano-turno.ts:216).
- **Correção:** em `aposLimite`, devolver null quando houver `trabalhoId`, para a frente esperar na sessão dela.

#### D8. A volta criada pelo limite conta no teto de 24 voltas e abre retomada em dobro se uma aprovação chega durante a espera
- **Severidade:** baixa (média). **Tipo:** risco.
- **Mecanismo:** `voltasMarcadas` não distingue a origem da volta (turnos.repo.ts:407-411). `retomadaNaFila` ignora `acordar_em` futuro (:377-383).
- **Correção:** marcar a origem da volta numa coluna. Em `enfileirarRetomada`, juntar a entrada à volta da cota já pendente e zerar `acordar_em`.
- **Cético:** produção tem só 3 voltas por cota e nenhum caso de dobro.

#### D9. O aviso de ritmo erra quando o bot muda de IA
- **Severidade:** baixa (média). **Tipo:** bug.
- **Mecanismo:** `ritmoDoBot` divide sempre por 7 e trata um dia no Codex como zero (custo-do-dia.ts:71-76). Resultado: alarme falso de "7×" quando o Claude renova, e silêncio diante de um gasto alto.
- **Correção:** tirar da média os dias sem custo medido; com menos de 3 dias, "sem base".

#### D10. Turno do Claude cortado antes do primeiro `result` grava custo null e tokens 0
- **Severidade:** baixa (média). **Tipo:** bug.
- **Mecanismo:** stream-json.ts:377 trata a ausência de `result` como custo null. Em produção não há resume que recupere o valor pelo delta.
- **Correção:** somar os eventos `chamada` (usage por mensagem, stream-json.ts:139-149) e marcar o custo como "desconhecido".

### E. Turnos: queda, lease, deploy e retomada

#### E1. Retomada automática (pedido de colega e frente caída) mede a queda pela CRIAÇÃO do turno, porque interromper e assentar zeram `lease_ate`
- **Severidade:** alta. **Tipo:** bug.
- **Cenário:**
  - Uma frente começa às 10:00 e o Mac dorme às 12:30.
  - O varredor assenta o turno às 12:31. `frentesCaidas` devolve `quedaEm = coalesce(lease_ate, criado_em)` = 10:00.
  - `decidirPedidoParado` lê "mais de 2 h" e desiste: o Retomar é fechado, a frente vira "falhou", o lote fecha e o dono acorda.
  - Variante inversa: um turno novo é retomado antes de a máquina voltar.
- **Mecanismo:** turnos.repo.ts:528 e :548 zeram o lease. As três consultas usam o coalesce (frentes.repo.ts:160, 165; pedidos-de-colega.repo.ts:115, 120; trabalhos.repo.ts:470, 475). O teste só usa turnos recém-criados (pedidos-parados.test.ts:60).
- **Impacto:** a retomada só funciona para turnos curtos, o oposto do caso que a ADR-099 queria cobrir.
- **Correção:** coluna `ultimo_sinal_em`, gravada em `interromper`/`assentar` a partir do `perdidoDesde` que interromper-por-maquina.ts:150 já calcula. As três consultas passam a usá-la no `queda_em` e no sinal. Testes com turno longo e com turno curto.
- **Cético:** confirmou e manteve alta.

#### E2. Aprovação decidida enquanto o turno ainda está "despachando" numa máquina que já dormiu nunca é continuada
- **Severidade:** média (alta). **Tipo:** bug.
- **Mecanismo:**
  - `assentarAprovacao` confia no turno vivo (decidir.ts:254-256).
  - O varredor não chama `continuarAprovacoesDoTurno`, e a entrega tardia retorna antes (assentar-turno.ts:276 vs :392).
  - `aContinuarDoTurno` busca por `turno_id` exato (decisoes.repo.ts:168-173), e `retomarTurno` não consulta.
- **Impacto:** o efeito externo já executado nunca chega ao bot, que tende a refazê-lo.
- **Correção:** chamar `continuarAprovacoesDoTurno` depois de interromper no varredor e no ramo tardio, ou juntar `entradaDaAprovacao` em `retomarTurno`. Garantir uma única retomada.
- **Cético:** a janela é de até 90 s, e só causa dano se o processo do CLI morreu.

#### E3. Parar (ou excluir o bot) com a máquina fora do ar vira "máquina sem contato": card Retomar, incidente e, depois de um deploy, entrega recusada com 403
- **Severidade:** média (alta). **Tipo:** bug.
- **Mecanismo:**
  - `renovarLease` congela o lease quando há Parar (turnos.repo.ts:337).
  - `vencidos` e `motivoDaQueda` ignoram `parar_solicitado_em` (:709-715; incidente.ts:36-38). Só `desfechoDaEntrega` respeita (assentar-turno.ts:124).
  - Pedido de colega parado é retomado sozinho (pedido-parado.ts:94).
  - Na adoção, `recusado` vira 403 (ponte-interna.ts:624-625; ponte.ts:326-330).
- **Correção:** em `interromperPorMaquina`, com Parar pendente, usar o motivo `parado_pela_pessoa`, sem decisão, sem incidente e sem contar queda. Junto de E5, separar adotar para assentar de adotar para rodar.
- **Conhecido:** ponto fraco 1 do mapa.

#### E4. A tolerância ao reinício é de 30 a 60 s (conta desde a última resposta): deploy de 35 a 60 s mata o CLI, o turno assenta "trabalho_incompleto" sem Retomar e a frente vira "falhou"
- **Severidade:** média (alta). **Tipo:** risco.
- **Mecanismo:**
  - `ultimaResposta` é gravada em ponte-http.ts:153 e :180, e a comparação :185-187 conta a partir dela. Com renovação a cada 30 s, um deploy de D segundos mata o turno com probabilidade (D−30)/30.
  - A adoção renova o lease antes de assentar (ponte-interna.ts:624), o que leva a `trabalho_incompleto` (assentar-turno.ts:124).
- **Correção:**
  1. Servidor: entrega por adoção, interrompida sem motivo e sem Parar, assenta como `reinicio_servidor` com Retomar.
  2. Cliente: contar a tolerância desde a primeira falha e renovar a cada 10 s enquanto a resposta for "indefinido".
- **Conhecido:** lacuna de NOD-214 (concluída) e NOD-218 (aberta, deploy sem queda).
- **Cético:** a duração real do deploy não foi medida; se passar de 35 s com frequência, vira alta.

#### E5. Adoção pós-deploy frágil: exceção transitória vira `{ativo:false}`, que mata o CLI; e "recusado" vira 403 definitivo na entrega
- **Severidade:** média (alta). **Tipo:** risco.
- **Mecanismo:** `adocao()` junta exceção, recusado e token ausente em null (ponte.ts:156-165). Na renovação isso vira `{ativo:false}` (:297-298); na entrega, 403 (:326-330). O cliente trata `acao_recusada` como definitivo (ponte-http.ts:106, 184, 211-212).
- **Correção:** exceção vira 503 (o cliente já lê como transitório) e o 403 fica só para recusa real. Criar um modo de adoção para assentar que aceita Parar pendente.
- **Cético:** o cenário do Parar antes da adoção é determinístico, mas a janela é curta. A frequência de exceção não foi medida.

#### E6. Entrega com mais de 1000 chamadas de ferramenta é recusada com 400, o cliente a trata como "servidor fora", abandona depois de 120 s e o turno vira "máquina sem contato"
- **Severidade:** média (alta). **Tipo:** bug.
- **Mecanismo:** stream-json.ts:326 não tem teto. A validação usa `exigir` com limite de 1000 (ponte-validacao.ts:297). O cliente lê 400 como `servidor_fora` (ponte-http.ts:104-110) e tenta por 120 s (:209-213).
- **Correção:** cortar `ferramentasChamadas` e `negacoesPermissao` com `slice`, sem recusar a entrega. No cliente, `entrada_invalida` é definitivo.
- **Cético:** produção tem 1 turno com 2333 ferramentas, em cerca de 8,5 mil. Raro, mas sempre o turno mais caro.

#### E7. Hook PreToolUse e proxy MCP não toleram o reinício do servidor
- **Severidade:** baixa (média). **Tipo:** bug.
- **Mecanismo:** um único fetch (hook-nativas.ts:148-156); o catch nega tudo (:237-238).
- **Correção:** repetir só em ECONNREFUSED (1, 3, 5 s) e negar com "o servidor do nod está reiniciando".
- **Cético:** o proxy já devolve uma negação transitória (negacao.ts:34-35).

#### E8. Entrega tardia com SUCESSO: a resposta completa é gravada como "parcial", o card Retomar fica aberto e a frente é retomada sozinha
- **Severidade:** baixa (média). **Tipo:** risco.
- **Mecanismo:** assentar-turno.ts:140-142, 218, 276-280. O comportamento é intencional (ADR-010, teste assentar-turno-queda.test.ts:82-97).
- **Correção:** com tardia, `maquina_sem_contato` e sucesso, fechar por regra o Retomar e não marcar como parcial. Registrar como emenda da ADR-045.

#### E9. Mensagem do meio oferecida numa renovação cuja resposta se perdeu nunca é reoferecida
- **Severidade:** baixa (média). **Tipo:** risco.
- **Mecanismo:** `oferecidas` é um Set sem tempo (ponte-interna.ts:160, 488-491) e o filtro está em sessao-viva.ts:73-76. Também bloqueia a promoção da rede de 2 min.
- **Correção:** guardar o instante da oferta e reoferecer depois de cerca de 10 s sem confirmação. O cliente já descarta repetidas (laco.ts:213-217).

### F. Parar e cancelamento

#### F1. Parar na Clarice não cancela o pedido ao Milton: a resposta dele reabre a tarefa parada (conversa) ou o trabalho parado (frente)
- **Severidade:** alta. **Tipo:** bug.
- **Cenário:**
  - **A:** a pessoa para a Clarice e escreve outra coisa. O turno do Milton segue, porque está na conversa dele (parar.ts:38, 48). A resposta enfileira uma retomada "Siga a tarefa original" (entregar-resposta-peer.ts:203-219) sem checar parada.
  - **B:** a pessoa para a frente. A continuação herda o `trabalhoId` (:216). `estadoDoTrabalho` põe `pendentes > 0` antes de `parado` (trabalho.ts:117-118), e `mudarEstado` sai de estado final (trabalhos.repo.ts:207-215).
- **Impacto:** o trabalho que a pessoa parou volta sozinho e gasta cota. Na variante B, o lote já foi devolvido e o resultado se perde.
- **Correção:**
  - Em `entregar()`: se o turno que pediu foi interrompido por `parado_pela_pessoa` ou o trabalho está `parado`, gravar só a `peer_ask` e não abrir continuação.
  - No Parar, interromper também o turno de delegação nascido dos handoffs abertos.
  - Como defesa em profundidade, `mudarEstado` não sai de estado final sem ação explícita.
- **Conhecido:** a invariante está no mapa; a consequência não tem issue.
- **Cético:** confirmou. A ADR-084 já filtra a task parada no varredor, mas não na entrega normal.

#### F2. Parar no chat do bot deixa uma parada aberta por tempo indefinido: rotinas, "Executar agora" e pedidos de colega morrem no despacho sem registro nem aviso
- **Severidade:** média (alta). **Tipo:** bug. **Decisão de produto (ADR-083/099).**
- **Mecanismo:**
  - `paradas.ativa` cobre a conversa inteira, sem prazo (paradas.repo.ts:67-78).
  - O despacho interrompe o turno sem chamar `registrarDesfechoRotina` nem `avisarFalhaDelegacao` (despachar-turno.ts:88-96). O mesmo vale para parar.ts:38-45.
  - Só uma fala da pessoa encerra a parada (enviar-mensagem.ts:78).
- **Correção:**
  1. Registrar o desfecho "interrompida" com motivo `parada_aberta` e avisar quem pediu.
  2. "Executar agora" encerra a parada, como retomar-turno.ts:48.
  3. A faixa avisa que rotinas e pedidos estão suspensos, ancorada no elemento afetado e sem faixa âmbar.
- **Cético:** produção: 10 rotinas e 3 delegações interrompidas por `parado_pela_pessoa` entre 24/09 e 08/10. Hoje há 0 paradas abertas.

#### F3. Parar no chat da Clarice cancela os frames ainda não publicados de TODOS os bots da pessoa
- **Severidade:** baixa (média). **Tipo:** bug.
- **Mecanismo:**
  - `cancelarPendentesDaPessoa` (parar.ts:65; outbox.repo.ts:73-78) não filtra por conversa.
  - O outbox só leva frames de UI (parar.ts:66-67), e a tela do Milton fica sem a fala final até recarregar.
- **Correção:** remover o cancelamento, que não protege nenhum efeito externo, ou restringi-lo à conversa parada.
- **Cético:** produção tem só 2 linhas canceladas em todo o histórico.

### G. Frentes e lote

#### G1. O retorno do lote não tem rede: sai com a IA no limite, sem conta ou não pronta, morre interrompido, e o lote já está devolvido; os resumos nunca chegam
- **Severidade:** alta (crítica). **Tipo:** bug.
- **Cenário:**
  - As frentes consomem a janela do Claude.
  - `devolverAoDono` enfileira o retorno (origem `retomada`, sem trabalho, sem `acordar_em`) e marca o lote devolvido na mesma transação (fechar-lote.ts:66-85).
  - O portão da cota não segura o retorno (turnos.repo.ts:291-296; tipoParaCota em cota-da-ia.ts:82-93).
  - O CLI rejeita. `aposLimite` é null (:417) e `aposLimiteNoFundo` também (:636), e o turno morre (:358-385).
  - `fecharLoteSePronto` sai cedo (fechar-lote.ts:30) e ninguém refaz (turnos.repo.ts:819; contas-ia.ts:91).
- **Impacto:** perda silenciosa do resultado de um lote inteiro, horas de trabalho pago, no cenário mais comum de hoje.
- **Correção:**
  1. Tratar o retorno como fundo: o portão o segura no limite e `aposLimiteNoFundo` o aceita sem `trabalhoId`.
  2. Tornar o lote reabrível, limpando `devolvido_em` quando o retorno morre, ou só marcar devolvido quando o retorno concluir.
  3. Usar o harness atual do bot, não o de `abertoPor` (:78-79).
- **Cético:** confirmou. Rebaixou para alta porque exige que o limite coincida com o fecho. Não leu os ramos do despacho (IA fixa, sem conta).

#### G2. A volta da frente pela cota não leva o pedido: se o primeiro turno nunca rodou, a frente acorda só com "siga de onde parou" e o título
- **Severidade:** média (alta). **Tipo:** bug.
- **Mecanismo:**
  - O pedido só existe em `entrada_texto` (frentes.ts:83-97).
  - O pré-spawn assenta o turno e cria a volta com texto fixo (despachar-turno.ts:159-167; assentar-turno.ts:642-657; cota-da-ia.ts:165-176).
  - Sem `sessaoCli`, o histórico vem de `doTrabalho` (mensagens.repo.ts:165-175), que só tem a linha de sistema. O prompt leva só o título (prompt-sistema.ts:413).
  - Outras retomadas anexam o original (retomar-apos-acesso.ts:26).
- **Correção:** anexar `Pedido original da frente: …` lido da raiz da cadeia quando não há sessão retomável.
- **Cético:** produção: das 3 voltas por cota em frentes, 1 tem raiz sem sessão.

#### G3. Card "Retomar" de um turno caído fica aberto depois que um recado posterior da mesma frente roda e conclui: a frente prende em "Sua vez" e o lote não fecha
- **Severidade:** média (alta). **Tipo:** risco.
- **Mecanismo:** `enfileirarNoTrabalho` não fecha o card (coordenar-trabalhos.ts:58-97). `fatos.decisao` conta qualquer decisão do trabalho (trabalhos.repo.ts:330-331), e `precisa_de_voce` vence (trabalho.ts:116-119). O varredor perde a frente para sempre (frentes.repo.ts:181-182).
- **Correção:**
  1. Ao concluir um turno do trabalho, fechar por regra os `retomar_turno` de turnos anteriores.
  2. Em `fatos`, só contar o card do último turno terminal.
- **Cético:** confirmou. Resolve-se sozinho em 24 h.

#### G4. O fecho do lote usa `coalesce(motivo_falha, motivo_interrupcao)` e o varredor usa `motivo_interrupcao`: frente recusada no despacho não é "queda" para o fecho
- **Severidade:** média. **Tipo:** bug.
- **Mecanismo:** frentes.repo.ts:111-113 contra :160, :181. `ehQueda` só conhece valores de `motivo_interrupcao` (pedido-parado.ts:11, 64-66). Resultado: o dono só sabe da falha quando as outras frentes terminam, e sem `PERGUNTA_DA_QUEDA`.
- **Correção:** separar os dois campos e criar uma função única `ehQuedaDoTurno`. Validar se login expirado deve gerar uma pergunta própria ("reconecte a conta").
- **Cético:** latente; 0 casos em produção.

#### G5. Aprovação ou pergunta de uma frente que vence em 24 h leva a frente a "terminado" e o lote devolve como sucesso
- **Severidade:** média (alta). **Tipo:** bug.
- **Mecanismo:**
  - A decisão vencida some dos fatos (trabalhos.repo.ts:329-330). Com o último turno `concluido`, o estado vira `terminado` (trabalho.ts:122).
  - `resumoSeFaltar` grava como resumo "Preciso da sua aprovação…". `motivoDaFrente` é null (retorno-do-lote.ts:92-94).
- **Correção:** só para frente de lote, acordar a frente com "o pedido venceu sem resposta", ou derivar `falhou` com motivo `decisao_vencida`.
- **Cético:** produção tem 2 frentes nesse estado. Para task avulsa, o comportamento é intencional e testado.

#### G6. Card velho fica aberto depois que a mesma ação já saiu sozinha pelo modo novo: aprovar o card executa a ação de novo
- **Severidade:** média (alta). **Tipo:** risco.
- **Mecanismo:** `pedir_aprovacao` cria sempre uma decisão nova (pedir-aprovacao.ts:117-157). Não há gêmea para aprovação (fechar-gemeas.ts). `marcarEDecidir` executa o conector no clique sem conferir se a ação já saiu (decidir.ts:52-100). A troca de modo deixar o card esperando é intencional (mudar-modo-aprovacao.ts:19).
- **Correção:** em `marcarEDecidir`, se já existe um item executado equivalente num turno posterior da cadeia, fechar o card e dizer "essa ação já foi feita".
- **Cético:** depende de o bot refazer o pedido; 0 aprovações abertas hoje.

#### G7. "Reabrir" a aprovação vencida de uma frente não reabre a frente nem o lote
- **Severidade:** média. **Tipo:** bug.
- **Mecanismo:** `reabrirDecisao` não sincroniza (reabrir-decisao.ts:36-56). Depois de aprovar, a frente roda de novo, mas o resumo velho fica (resumo-sem-chamada.ts:16) e o lote não devolve (fechar-lote.ts:30).
- **Correção:** chamar `sincronizarDasDecisoes` ao reabrir e devolver ao dono um "retorno complementar" quando uma frente de lote já devolvido volta a final. É a mesma regra do plausível P5.
- **Cético:** produção tem 2 decisões vencidas em frentes terminadas.

#### G8. Retomada de frente presa a uma VM que não volta: a frente fica "trabalhando" para sempre, sem "Rodar em outra desta vez"
- **Severidade:** média (alta). **Tipo:** risco.
- **Mecanismo:**
  - O alvo considera a chave viva, sem olhar contato (alvo-da-maquina.ts:17). O estado é derivado como "rodando" (trabalho.ts:116), e a tela diz "trabalhando" (web/lib/trabalhos.ts:149-150).
  - O chip só existe na mensagem da pessoa (conversa.ts:328-349).
  - Os órfãos só são observados, por decisão (turno-orfao.ts:9-26).
  - A ADR-090 §6 promete "esperando <máquina> (sem contato)" também para task.
- **Correção:** a web mostra "esperando <máquina> · sem contato desde HH:MM" com o atalho de rodar em outra máquina (TrabalhoDto já traz a máquina). Um prazo que vira "precisa de você" é decisão de produto.
- **Conhecido:** vizinho de NOD-219 e NOD-216.
- **Cético:** produção tem 38 pendentes com mais de 1 h; a causa não foi verificada.

#### G9. Bot excluído com lote de frentes aberto para um colega: o lote nunca fecha e o remetente fica "rodando" para sempre
- **Severidade:** média (alta). **Tipo:** bug.
- **Mecanismo:** `agentes.excluir` faz UPDATE direto para `parado`, sem `fecharLoteSePronto` (agentes.repo.ts:156-168). Os varredores não pegam o caso (pedidos-de-colega.repo.ts:131; trabalhos.repo.ts:478-479). `fatos.colega` é verdadeiro com `trabalhoId` nulo (:335-340).
- **Correção:** a exclusão passa as frentes por `marcarParado`, ou avisa quem pediu com `avisarFalhaDelegacao`.
- **Cético:** 0 casos em produção.

#### G10. A rede de 2 min promove o próprio turno de retorno do lote a frente: segundo lote e segundo retorno
- **Severidade:** baixa (média). **Tipo:** risco.
- **Mecanismo:** `promoveNaRede` aceita retomada em modo conversa (trabalho.ts:186-189). `promoverNaRede` cria um lote com `abertoPor` igual ao retorno (coordenar-trabalhos.ts:294-329).
- **Correção:** não promover a retomada que é retorno de lote (`lotes.retorno_turno_id = turno.id`).
- **Cético:** produção tem 0 lotes da rede abertos por retomada.

#### G11. Frente que muda de máquina continua numa pasta vazia, sem aviso, e na retomada seguinte volta à máquina antiga
- **Severidade:** baixa (média). **Tipo:** bug.
- **Mecanismo:** o mesmo de A6, mais `pastaTrabalho` criada vazia (emitir-plano-turno.ts:348; claude-cli.ts:518). `trabalhos` não registra a máquina.
- **Correção:** a de A6. Depois, gravar a máquina no trabalho.

#### G12. Frente na fila com a máquina-alvo offline aparece só como "na fila"
- **Severidade:** baixa (média). **Tipo:** melhoria.
- **Mecanismo:** `esperaNaMaquina` só olha portões existentes (memoria-mac.ts:410-413). `MaquinaDoTrabalho` não leva presença (trabalhos.ts:245-253).
- **Correção:** a mesma tela de G8.

### H. Pedidos entre bots

#### H1. Fan-out: a continuação que ainda diz "falta o Dev 3" é entregue como resultado FINAL quando a segunda resposta chega enquanto a primeira continuação roda
- **Severidade:** alta. **Tipo:** bug.
- **Cenário:**
  - O Chico pede ao Dev 2 e ao Dev 3. O Dev 2 responde e nasce C1 ("ainda faltam…"). O Dev 3 responde enquanto C1 roda, e nasce C2 ("consolide").
  - C1 conclui. `aindaNaoEntrega` só considera retomada com `acordar_em` (entregar-resposta-peer.ts:100), então entrega à Clarice "Dev 2 aprovou; falta o Dev 3".
  - C2 cai em `ja_entregue` (:180-184).
- **Impacto:** resultado parcial apresentado como final, e a consolidação é jogada fora, no uso diário Chico→Devs.
- **Correção:** em `aindaNaoEntrega`, receber o turno assentado e esperar enquanto houver outra retomada viva da cadeia. Teste concorrente.
- **Conhecido:** a ADR-063 cobre só a ordem sequencial.

#### H2. Triagem de pedido de colega que bate no limite nunca espera: o pré-spawn morre e o varredor retoma 3 vezes em minutos
- **Severidade:** média (alta). **Tipo:** bug.
- **Mecanismo:**
  - `aposLimiteNoFundo` exige trabalho (assentar-turno.ts:636). O pré-spawn assenta direto (despachar-turno.ts:157).
  - O varredor trata `executor_indisponivel` como queda (pedido-parado.ts:11, 92-96).
  - O portão por IA não segura a retomada (turnos.repo.ts:291-296).
  - Resultado: quem pediu recebe "caiu 3 vezes".
- **Correção:**
  1. A triagem sem trabalho espera com `acordar_em`.
  2. O varredor não trata como queda o `executor_indisponivel` com `motivo_falha = limite_do_plano`, `harness_ausente` ou conta; espera ou avisa uma vez com texto próprio.
- **Conhecido:** generaliza a "rotina sem frente interrompida" de 15/10.
- **Cético:** produção tem 0 delegações sem trabalho com limite.

#### H3. Dispensar (×) a pergunta que a triagem fez à pessoa deixa quem pediu esperando para sempre
- **Severidade:** média (alta). **Tipo:** bug.
- **Mecanismo:** `dispensarDecisao` e `depoisDeDispensar` não olham delegação (dispensar-decisao.ts:35-45, 66-79). O varredor exige o último turno `interrompido` (pedidos-de-colega.repo.ts:132). É regressão da ADR-084 desde a triagem sem task (ADR-099 I7).
- **Correção:** em `depoisDeDispensar`, se o turno é delegação, chamar `avisarFalhaDelegacao` ("a pessoa deixou a pergunta sem resposta"), sem `semEsperar`.
- **Cético:** produção tem 6 perguntas em delegações e nenhuma foi dispensada.

#### H4. Parar no chat do bot que RECEBEU o pedido cancela a espera de comando de uma triagem já concluída: nenhuma volta nasce e quem pediu nunca é avisado
- **Severidade:** média. **Tipo:** bug.
- **Mecanismo:** `cancelarRodando` cancela todas as esperas da conversa (esperas.repo.ts:139-146). `cancelarEsperas` não acorda ninguém (esperar-comando.ts:154-158).
- **Correção:** devolver as esperas canceladas e enfileirar a volta com "a espera foi cancelada pela pessoa" pelo caminho de `acordar`.

#### H5. Pedido segurado na fila (cota, máquina-alvo fora, Mac apertado) é invisível para quem pediu; passadas 24 h, falhas posteriores ficam mudas
- **Severidade:** média (alta). **Tipo:** risco.
- **Mecanismo:** `triagensParadas` exige cadeia interrompida (pedidos-de-colega.repo.ts:132-134). Os órfãos só observam (turno-orfao.ts:54-56). A janela de 24 h é ancorada no handoff (:103). Parar e excluir não avisam (parar.ts:41; agentes.repo.ts:149-150).
- **Correção:** ancorar a janela no último turno da cadeia e mostrar na tela de quem pediu o motivo da espera.
- **Cético:** produção tem 30 delegações pendentes, 4 com mais de 24 h; a causa não foi verificada.

### I. Rotinas

#### I1. Gate de aprovação aberto não segura a janela seguinte: cada janela reexecuta a rotina e abre outro card idêntico
- **Severidade:** média (alta). **Tipo:** bug.
- **Mecanismo:** o pré-voo só olha `TIPOS_PEDIDO_A_PESSOA`, que não inclui `aprovacao` (pre-voo-rotina.ts:22, 45-51; contracts/pedido.ts:8). `turnoAberto` não vê o turno concluído (rotina-janelas.repo.ts:67-86). `pedir-aprovacao.ts:117-125` sempre cria uma decisão nova.
- **Impacto:** um card por janela; aprovar dois deles faz a ação externa duas vezes.
- **Correção:** usar `TIPOS_QUE_SEGURAM_A_EXECUCAO` (movido para contracts) no pré-voo. Opcional: reaproveitar o card pendente da rotina.
- **Cético:** produção: 29 aprovações sobrepostas a outra aprovação ainda aberta da mesma rotina, e 343 aprovações de rotina no total.

#### I2. "Parar" durante o turno de uma rotina grava "falhou" e escreve "A rotina falhou por erro técnico"
- **Severidade:** média. **Tipo:** bug.
- **Mecanismo:** compor.ts:554-561 só trata `maquina_sem_contato` como exceção. disparar-rotina.ts:284 usa "erro_execucao" como fallback, e redacao.ts:60, 119 produz a frase.
- **Correção:** `parado_pela_pessoa` vira desfecho "interrompida" (silencioso).

#### I3. Rotina que marca volta (`me_chame_as`) registra "executou" antes da volta e escreve "Rotina executou" duas vezes
- **Severidade:** média. **Tipo:** bug.
- **Mecanismo:** `registrarDesfechoRotina` não olha retomada pendente (disparar-rotina.ts:241-248). Escreve uma mensagem a cada registro (:286-294). Ao mesmo tempo, `turnoAberto` considera a execução aberta (rotina-janelas.repo.ts:76-83).
- **Correção:** devolver `aguardando_volta` usando a mesma consulta de `turnoAberto`, e só escrever a mensagem quando o desfecho muda de classe.

#### I4. Acesso concedido pela tela Conectores não fecha o card do pré-voo: 24 h depois o card vence e pausa a rotina com "ninguém liberou o acesso"
- **Severidade:** média. **Tipo:** bug.
- **Mecanismo:** `vencerPedidoDaRotina` não relê as concessões (decidir-acesso.ts:64-82). `concederLote` não fecha o card (conceder.ts:93).
- **Correção:** ao vencer, recalcular `faltaDeAcesso` e, se o acesso já existe, fechar como atendido. Ao conceder, fechar os cards cobertos.

#### I5. A agenda da rotina trava para sempre quando "Testar agora" reivindica a janela canônica antes do tick
- **Severidade:** média (alta). **Tipo:** bug.
- **Mecanismo:** o instante do "Testar agora" é o minuto cheio (executar-rotina-agora.ts:19), igual ao do cron. O turno termina antes do tick, `reivindicar` dá false e o caminho volta `janelaDeOutro` sem reagendar (disparar-rotina.ts:134-135). Repete a cada 30 s, sem log.
- **Correção:** reagendar no `janelaDeOutro` quando `proximaExecucao <= agora`, e logar. Opcional: o "Testar agora" usar um instante em milissegundos. Teste de que `proxima_execucao > agora`.

#### I6. Turno de rotina recusado no despacho não gera execução: a janela fica sem desfecho e o histórico não mostra que não rodou
- **Severidade:** média. **Tipo:** bug.
- **Mecanismo:** `recusarPorExecutor` e `semContaNaMaquina` (despachar-turno.ts:107-119, 144-175, 177-193) não chamam `registrarDesfechoRotina`.
- **Correção:** chamar `registrarDesfechoRotina({desfecho: 'falhou', motivo})` na mesma transação, ou num gancho comum de turno terminal.
- **Conhecido:** vizinho da "rotina interrompida por executor_indisponivel" de 15/10.
- **Cético:** produção tem **77 janelas** nesse estado, todas sem execução registrada.

#### I7. Frente aberta por uma execução de rotina que fica presa pula todas as janelas seguintes para sempre
- **Severidade:** média (alta). **Tipo:** risco.
- **Mecanismo:** `filhaAbertaDaRotina` não tem limite de idade (disparar-rotina.ts:124-131; trabalhos.repo.ts:197-204). Uma frente "rodando" esperando um colega que nunca responde (handoff sem `trabalhoId`, trabalhos.repo.ts:338-344) nunca fecha.
- **Correção:** consertar a causa no colega e dar à guarda um teto (24 h sem turno vivo); ao passar dele, fechar a execução antiga como "interrompida".
- **Conhecido:** vizinho de "frentes rodando sem turno" e de "janela pulada sem motivo".
- **Cético:** produção tem 2 frentes nesse estado, ambas com menos de 24 h.

#### I8. Pausar a rotina não cancela o turno pendente: a tela diz "nada será disparado" e o turno roda quando a máquina volta
- **Severidade:** baixa (média). **Tipo:** bug.
- **Mecanismo:** pausar-rotina.ts:20-38 não toca nos turnos. `reivindicar` não olha o estado da rotina.
- **Correção:** interromper os pendentes das janelas na mesma transação e, no `reivindicar`, excluir turnos de rotinas pausadas.

#### I9. "Testar agora" e as frentes que ele abre são tratados como fundo novo
- **Severidade:** baixa (média). **Tipo:** bug. **Decisão: o teste manual fura a reserva?**
- **Mecanismo:** tipoParaCota (cota-da-ia.ts:82-87); `pessoaEsperando: false` (pedido-de-colega.ts:69). Contraria a ADR-085:38-39.
- **Correção:** marcar no turno que o disparo foi da pessoa e propagar isso às frentes. Como mínimo, mostrar o motivo da espera na conversa.

#### I10. "Testar agora" com a execução agendada ainda pendente duplica a execução
- **Severidade:** baixa (média). **Tipo:** risco.
- **Mecanismo:** o comportamento é intencional pela ADR-045:48-49. `preservarAgenda` pula a checagem de `turnoAberto` (disparar-rotina.ts:122).
- **Correção:** perguntar "já há uma execução na fila; rodar mais uma?" em vez de cancelar a pendente.

### J. Tela contra servidor

#### J1. O sinal da barra e a tela de Trabalhos só releem o dono quando o ESTADO de um trabalho muda
- **Severidade:** média (alta). **Tipo:** bug.
- **Mecanismo:**
  - Os eventos `turno.*` não invalidam `trabalhos` (reducer.ts:697-711, 754-755). Só `trabalho.mudou` leva `estadoDono` (despachar-outbox.ts:100), e `sincronizarTrabalho` não emite nada se o estado não mudou (trabalhos.ts:71).
  - Uma rotina sem frente fica "1 na fila" depois de concluir. Uma frente que passou a esperar colega continua "Trabalhando".
- **Correção:** invalidar `trabalhos` em `turno.*` dos bots da pessoa, com debounce, e reler ao entrar na tela de Trabalhos. Opcional: um evento `dono_mudou`.
- **Conhecido:** vizinho de NOD-216, mas em outra camada.

#### J2. A janela de 24 h do pedido a colega existe só no dono: depois de 24 h a frente vira "1 na fila" enquanto a lista diz "esperando X"
- **Severidade:** baixa (média). **Tipo:** bug.
- **Mecanismo:** donos.repo.ts:94 filtra por 24 h; `fatos.colega` e `extras` não filtram (trabalhos.repo.ts:335-340, 406-415).
- **Correção:** tirar a janela da consulta do dono.

#### J3. "Trabalhando · há 3 h" conta desde a CRIAÇÃO do turno, não desde o despacho
- **Severidade:** baixa (média). **Tipo:** bug.
- **Mecanismo:** donos.repo.ts:57; enviar-mensagem.ts:193; reducer.ts:710, 943. Não existe coluna de despacho.
- **Correção:** coluna `despachado_em`, exposta no DTO e no frame. "Na fila há N min" continua usando `criadoEm`.

### K. Anexos

#### K1. Bot em Automático aceita PDF, mas o despacho escolhe a IA sem olhar o anexo: com ordem [Codex, Claude], só o Codex na máquina ou o Claude no limite, todo PDF vai para o Codex
- **Severidade:** média (alta). **Tipo:** bug.
- **Mecanismo:**
  - O servidor só confere o anexo quando a IA é fixa (enviar-mensagem.ts:82-86). A web trata "auto" como Claude (web/lib/capacidades.ts:6-8; anexos.ts:15).
  - `escolherHarness` não recebe os anexos (emitir-plano-turno.ts:160-172). O Codex troca o PDF por "não pôde ser lido" (anexos-turno.ts:80).
  - A repetição para outra IA leva o PDF do mesmo jeito.
- **Correção:** passar os tipos de anexo a `escolherHarness` e preferir uma IA pronta que leia todos. Se nenhuma ler, negar com a causa `anexo_nao_lido` antes de gastar o turno.
- **Conhecido:** NOD-207 (concluída) cobriu só a IA fixa.
- **Cético:** produção tem 0 turnos com PDF; o risco é latente.

#### K2. O anexo só existe no turno que nasceu com ele: retomada após card ou queda, pergunta seguinte e frente ou colega perdem o arquivo
- **Severidade:** média (alta). **Tipo:** bug.
- **Mecanismo:** `enfileirarRetomada` não copia `entradaAnexos` (enfileirar-retomada.ts:30-46). O plano usa só os anexos do turno (emitir-plano-turno.ts:323) e um histórico sem marcador de anexo (:236). Em produção não há sessão (B3). A rota interna só serve os anexos do plano (interno.ts:80). O texto "nada foi reenviado" (decidir.ts:173) engana o modelo.
- **Correção:**
  1. A retomada herda e une os anexos.
  2. Sem sessão, marcar "[anexou X]" no histórico e reanexar os da última fala com arquivo.
  3. Só dizer "nada foi reenviado" quando houver sessão.
  4. Frente e colega: decisão de produto.

#### K3. A sessão viva inverte a ordem das falas: o texto mandado depois do print entra ao vivo e o print vira turno próprio depois
- **Severidade:** média. **Tipo:** bug.
- **Mecanismo:** o filtro de anexo é aplicado fala por fala (sessao-viva.ts:74; turnos.repo.ts:594, 612).
- **Impacto:** em "olha esse erro" + print seguido de "ignora, já resolvi", o bot responde ao "ignora" e depois investiga o erro.
- **Correção:** cortar a absorção na primeira fala com anexo (ordenar e usar `takeWhile`; no SQL, `criado_em < min(pendente com anexo)`).

### L. Salas

#### L1. Na sala, a nota "Seguindo com <conta/IA>" é falsa: o turno de sala que bate no limite no meio não é refeito
- **Severidade:** média. **Tipo:** bug. **Decisão: a sala repete?**
- **Mecanismo:** todas as repetições exigem origem `conversa` (assentar-turno.ts:417, 470, 548). A frase não olha a origem (contas-da-pessoa.ts:181; contas-da-ia.ts:151). Além disso, a fala parcial roda os responders (:195-203).
- **Correção:** criar `repetirNaSala` com teto, ou usar a frase "fale de novo para seguir com X". Postar a fala parcial sem disparar os responders.

#### L2. Nota de contas na sala: "Seguir com" grava a escolha para todos os bots em silêncio e não refaz nada; com dois bots, refaria a nota errada
- **Severidade:** média. **Tipo:** bug.
- **Mecanismo:**
  - `definirEscolhida` roda antes de qualquer checagem (contas-ia.ts:84). A nota buscada é a última (:86), `jaRefeito` aceita qualquer agente (:90) e a origem `sala` é recusada (:91).
  - O botão não leva `turnoId` (ia-fora.ts:254).
- **Correção:** levar o `turnoId` no botão e no POST, aceitar `sala`, calcular `jaRefeito` só com o mesmo agente e gravar a escolha só depois de validar.

#### L3. Lead da sala excluído: todo post sem @menção cai no vazio, sem nenhuma linha, e não há como trocar o lead nem a política
- **Severidade:** média. **Tipo:** bug.
- **Mecanismo:**
  - A exclusão não toca as salas (agentes.repo.ts:145-165).
  - `quemResponde` devolve [] (canal-responde.ts:42), e a linha explicativa só sai na política `so_mencoes` (postar-na-sala.ts:181-184).
  - `atualizarPolitica` não tem rota (salas.repo.ts:138).
- **Correção:** escrever o motivo sempre que ninguém responder, reatribuir o lead ao excluir e expor uma rota de lead e política.

#### L4. Turno de sala barrado no despacho nunca é repetido quando a IA ou a conta volta
- **Severidade:** baixa (média). **Tipo:** bug.
- **Mecanismo:** `barradosPorFaltaDeIa` só pega origem `conversa` (turnos.repo.ts:819). O comentário sobre "vínculos próprios" (repetir-barrados-por-ia.ts:19) não corresponde a nada. `encaminhar` gasta um handoff mesmo para um destinatário sem IA (encaminhar.ts:58-84).
- **Correção:** repetir também os turnos de sala, contando "nada do mesmo agente depois", ou gravar um passe tipado. No `encaminhar`, conferir antes se o destinatário tem IA pronta.

### M. Duplicar bot e as mãos do Nod

#### M1. A cópia perde a máquina do bot (`maquina_id`): com IA fixa, toda janela de rotina da cópia é recusada no Mac
- **Severidade:** média (alta). **Tipo:** bug.
- **Mecanismo:** `NovoAgente` e o INSERT não têm `maquina_id` (agentes.repo.ts:81-98, 170-174), e duplicar não chama `definirMaquina`. O alvo cai na máquina padrão (alvo-da-maquina.ts:17-19), e o alvo pega o turno sem a IA pronta (turnos.repo.ts:242).
- **Correção:** na duplicação feita pela dona, copiar `maquina_id` se a chave ainda estiver viva.

#### M2. Duplicar pelo Nod (gerir_bots) no modo automático roda sem caixa nem card: as rotinas ativas passam a rodar em dobro sem aviso
- **Severidade:** média. **Tipo:** bug.
- **Mecanismo:** `riscoDaAcao('duplicar')` só considera contaminação mais acessos (lote-bots.ts:134-143). O aviso existe só na web (main.ts:1570). A ADR-034:75-79 condiciona o custo aceito ao aviso.
- **Correção:** na cópia pedida pelo Nod, as rotinas vêm pausadas e o Nod avisa (é o fallback que a própria ADR-034 prevê).

#### M3. Duplicar duas vezes gera dois bots "Nina (cópia)", com a mesma pasta e nome ambíguo
- **Severidade:** média. **Tipo:** risco.
- **Mecanismo:** o nome é fixo (duplicar-agente.ts:34). `pastaDoBot` usa só o nome (nativas.ts:111-114). `pedir_a_bot` responde "nome ambíguo" (apoio-l7.ts:147).
- **Correção:** escolher o primeiro nome livre ("cópia 2"). A médio prazo, pasta derivada de nome mais id, ou guardada no bot.

#### M4. "Rotina ativa continua ativa, com a aprovação como estava" é falso: a cópia nasce em Manual
- **Severidade:** baixa (média). **Tipo:** risco.
- **Mecanismo:** a cópia nasce Manual de propósito (ADR-059 §1; teste mudar-modo-aprovacao.test.ts:45-50). `exige_aprovacao` é copiado, mas ninguém o lê (duplicar-agente.ts:72).
- **Correção:** manter Manual e avisar na caixa de duplicar. Corrigir o comentário e a ADR-034, e remover o campo morto.

---

## 4. Achados plausíveis (o cético refutou, mas o autor tinha confiança alta)

#### P1. Turno pendente preso a uma máquina-alvo que não volta: rotinas do bot param em silêncio por dias
- **Severidade do autor:** alta; do cético: baixa.
- **Cenário:** bot fixado numa VM desligada. O alvo considera a chave viva (alvo-da-maquina.ts:14-20) e só ela pega o turno (turnos.repo.ts:250). `turnoAberto` pula as janelas seguintes, e o varredor de órfãos só observa (turno-orfao.ts:54-56).
- **Por que o cético derrubou:** "só observar" é decisão da ADR-017/NOD-219, de dois dias atrás, com métrica `turno_velho_na_fila`. A tela mostra "espera pela máquina X". Produção tem 0 máquinas-alvo mortas.
- **O que falta para confirmar:** dado real de `turno_velho_na_fila{condicao_da_maquina}`. Também vale investigar os 38 pendentes com mais de 2 h vistos hoje. Ver G8.

#### P2. Toda a cadeia (retomadas, voltas, volta da cota, retorno do lote, recado) fica presa ao harness e modelo do turno de origem
- **Severidade do autor:** média; do cético: baixa.
- **Mecanismo:** enfileirar-retomada.ts:40-41, assentar-turno.ts:653-655, fechar-lote.ts:78-79, coordenar-trabalhos.ts:80-81.
- **Por que o cético derrubou:** a cópia é intencional (ADR-036) e protege a sessão da task (emitir-plano-turno.ts:216). O Automático relê a ordem no momento do plano.
- **O que falta:** uma decisão de produto dizendo que "Uma IA só" deve alcançar as frentes abertas, e uma contagem de frentes esperando a cota com o bot já em outra IA.
- **Mínimo útil:** um aviso na tela 2B. O retorno do lote (G1) já pede que se use o harness atual.

#### P3. Frente e rotina de bot fixo numa VM sem a IA: retomada sozinha 2 vezes, "caiu 3 vezes"
- **Severidade do autor:** média; do cético: baixa.
- **Por que o cético derrubou:** a frente recusada vira `falhou` e `frentesCaidas` só lê `precisa_de_voce` (frentes.repo.ts:179), então a retomada em cadeia não acontece.
- **O que sobra:** a parte da rotina sem execução registrada, que é I6.
- **O que falta:** nada. Considere o achado absorvido por I6 e G4.

#### P4. Enquanto a triagem está na fila do Milton, ele não consegue responder à Clarice num turno com a pessoa (espera circular)
- **Severidade do autor:** média; do cético: baixa.
- **Por que o cético derrubou:** a recusa é intencional (ADR-099 item 8) e a triagem lê o histórico da conversa com a decisão da pessoa (emitir-plano-turno.ts:238).
- **O que falta:** mostrar que a triagem ignora esse histórico.
- **Ajuste barato:** mudar o texto do `espera_circular` no turno com a pessoa.

#### P5. Frente reaberta pela pessoa depois do lote devolvido nunca devolve ao dono
- **Severidade do autor:** média; do cético: baixa.
- **Mecanismo:** fechar-lote.ts:30; o comentário em retorno-do-lote.ts:62 prevê "uma frente que voltou a rodar depois".
- **Por que o cético derrubou:** é a própria pessoa quem reabre e ela vê o resultado.
- **O que falta:** decisão de produto. A mesma regra de "retorno complementar" resolve G7.

---

## 5. Refutados (não reabrir)

- **O driver descarta `account/rateLimits/updated` do Codex.** É limitação conhecida e adiada nas ADR-085, 076 e 101, sem amostra real do formato. A correção depende de homologar com conta real.
- **Plano reservado cuja resposta do puxar se perde vira "sem contato".** Produção tem 1 caso em toda a tabela, e reentregar arrisca rodar o turno duas vezes.
- **Tolerâncias medidas pelo relógio de parede no sono longo.** A entrega toma o `inicio` na hora em que acontece, e no sono longo o turno já foi assentado de qualquer forma. A janela real é de segundos.

### 5b. Não verificados (baixa severidade, pulados pelo cético para poupar cota)

Todos são **não verificados**:
- Frente cuja conta trocou recebe a linha da "cota renovada". Mecanismo: `aposLimiteNoFundo` escolhe o texto por `conta?.tipo` da ADR-101, ausente no caminho da ADR-102 (assentar-turno.ts:543, 650, 673).
- Frente de rotina tem `sem_novidade` no catálogo, o que silencia a fala e gera o resumo "terminou sem dizer o que fez" (frente.ts:30; plano-turno.ts:259-260).
- Depois de o varredor desistir de uma frente, "Tentar de novo agora" não tem caminho no catálogo do dono (frentes-caidas.ts:21-33; plano-turno.ts:101-106).
- Pergunta pendente da rotina gera uma linha "bloqueada" por janela e lava o histórico de 20 (pre-voo-rotina.ts:70; rotina-execucoes.repo.ts:80-85).
- Modelo inválido ou IA pronta noutra máquina assentam como `motor_ausente` com frase "X indisponível" (despachar-turno.ts:182, 187; harness.ts:97-100).
- Um só slot de sessão por conversa e por trabalho: cada troca de IA apaga a sessão da anterior (conversas.repo.ts:103-107; sessao-do-turno.ts:35, 53).
- Mudar modelo ou raciocínio com turno rodando: o turno vivo regrava a sessão, e o plano só confere a IA (inteligencia.ts:37-41; sessao-do-turno.ts:34-37).
- O chip "máquina sem IA pronta" manda rodar `nod-motor entrar claude` mesmo para bot do Codex (web/telas/conversa.ts:344-347).
- O aviso do vigia só vive no frame e some ao recarregar a página (vigia-turno.ts; live-events.ts:69; atividade.ts:28-29).
- Mac dormindo mais de 30 min: todas as frentes caídas são desistidas, porque os tetos vêm da ADR-084 (pedido-parado.ts:20, 92-96).
- Horário de verão: a hora repetida dispara duas vezes e a hora inexistente perde a janela (rotina-janela.ts:140-149).
- Excluir o Milton com pedido pendente avisa a Clarice "você pediu para parar" (agentes.repo.ts:149-152; redacao.ts:109).
- Lote de pedido de colega todo parado ou falho é entregue como resposta normal (fechar-lote.ts:110; entregar-resposta-peer.ts:232-233).
- Frente que nunca rodou e espera conta ganha `iniciado_em` e deixa de ser "fundo novo" (trabalho.ts:117-120; trabalhos.repo.ts:207-216).
- Turno que esperou mais que `prazo_em` na fila sai com `MCP_TOOL_TIMEOUT` de 60 s (plano-turno.ts:307; claude-cli.ts:328-335).
- A volta do `me_chame_as` entra em `turnosVivos` como "na fila" no web (reducer.ts:697, 707; me-chame-as.ts:122).
- Pendente de origem `retomada` sem trabalho não entra na fila do dono: a conversa diz "na fila" e a barra diz "livre" (donos.repo.ts:111).
- A adoção depois do deploy grava `conta_id` num turno que começou sem conta, e o limite cai na conta errada (emitir-plano-turno.ts:162-181).
- O servidor nunca escreve passe tipado `ausente_offline`/`cota_esgotada`, e a rodada da sala nunca assenta (postar-na-sala.ts:26-31; rodada-sala.ts:39-50).
- A entrega tardia grava o custo em `gastos` e na frente, mas não em `turnos.custo_usd` (assentar-turno.ts:233-244, 276-280).

---

## 6. Plano de correção proposto

Os lotes agrupam o que mexe nos mesmos arquivos, para cada um caber num PR revisável. **[DECISÃO]** marca o que precisa de decisão de produto ou de ADR nova antes de codar.

**Lote 1: a máquina recebe trabalho de novo (urgente, 1 a 2 dias)**
- **Itens:** A1, A2, A3, A4, A9.
- **Arquivos:** desktop/main.ts, motor/main.ts, rotas/ponte.ts, despachar-turno.ts, ligacoes.ts.
- **Destrava:** quem só tem o Codex volta a rodar; o Mac que dormiu um minuto não fica zumbi; a ligação abortada não trava o bot. São correções pequenas com teste unitário direto e o maior efeito por linha de todo o relatório.

**Lote 2: uma regra única de espera por limite (3 a 5 dias) [DECISÃO: emenda curta à ADR-099 §7]**
- **Itens:** C2, C7, G1, G2, D1, H2, C6, D7, D8 e a parte de repetição de B5.
- **Arquivos:** despachar-turno.ts:159, assentar-turno.ts (`aposLimite`, `aposLimiteNoFundo`), fechar-lote.ts, pedido-parado.ts, turnos.repo.ts (`barradosPorFaltaDeIa`, portão da cota), cota-da-ia.ts.
- **Regra proposta:** todo turno de fundo (frente, retorno do lote, rotina, triagem) espera com `acordar_em`, decidido pelo *tipo do turno* e não pela origem. A volta carrega o pedido quando não há sessão. Qualquer decisão da pessoa sobre contas antecipa a volta. O varredor distingue limite de queda. O lote é reabrível.
- **Decidir:** (a) a rotina sem frente espera ou falha com a hora de volta; (b) a frente em Automático espera na sessão ou troca de IA na hora.
- **Destrava:** a promessa "nenhuma frente falha por limite" passa a ser verdade, no caso que mais aparece em produção hoje.

**Lote 3: queda, deploy e retomada (3 a 4 dias)**
- **Itens:** E1, E2, E3, E4, E5, E6, E8, G3 e o cancelamento de F2 no varredor.
- **Arquivos:** turnos.repo.ts (`ultimo_sinal_em`), interromper-por-maquina.ts, ponte-interna.ts (adotar), rotas/ponte.ts, ponte-http.ts, assentar-turno.ts.
- **Destrava:** frente longa caída volta sozinha; Parar com o Mac dormindo não vira "queda"; o deploy não mata turnos como "incompleto". Complementa a NOD-218.

**Lote 4: pedidos entre bots e Parar (2 a 3 dias) [DECISÃO: a parada vale para rotina e delegação?]**
- **Itens:** H1, F1, F2, H3, H4, H5, G9, F3.
- **Arquivos:** entregar-resposta-peer.ts, parar.ts, dispensar-decisao.ts, esperar-comando.ts, pedidos-de-colega.repo.ts, agentes.repo.ts (excluir), outbox.repo.ts.
- **Destrava:** fan-out confiável; Parar significa parar; nenhum pedido fica "esperando para sempre".

**Lote 5: notas e botões de contas (2 a 3 dias) [DECISÃO: a sala repete o turno? o modo "perguntar" sem alvo roda onde há conta?]**
- **Itens:** C1, C3, C4, C5, C8, C9, B5, L1, L2, C12, A5.
- **Arquivos:** contas-ia.ts, contas-do-turno.ts, contas-da-pessoa.ts, ia-fora.ts, ponte-interna.ts (`reprovarHarness`), contas-locais.ts.
- **Destrava:** toda nota de limite tem um passo que funciona e nenhuma promete "Seguindo com" sem seguir. Depende do lote 2, que cuida da parte da frente.

**Lote 6: tela contra servidor (2 dias)**
- **Itens:** J1, J2, J3, D3, G8, G12, I6 (histórico), D4, D5, D9, D10.
- **Arquivos:** web/estado/reducer.ts, donos.repo.ts, trabalhos.ts, web/lib/trabalhos.ts, turnos.repo.ts (custo).
- **Destrava:** a barra e a tela de Trabalhos dizem a verdade, e o custo de hoje inclui o Codex.

**Lote 7: rotinas (2 a 3 dias)**
- **Itens:** I1, I2, I3, I4, I5, I6, I7, I8, I9, I10.
- **Arquivos:** disparar-rotina.ts, pre-voo-rotina.ts, compor.ts (`depoisDeAssentar`), decidir-acesso.ts, pausar-rotina.ts.
- **Destrava:** acabam o efeito externo em dobro e a agenda travada, e o histórico fica honesto.
- **Decidir:** se o "Testar agora" fura a reserva da cota (I9).

**Lote 8: herança entre turnos (2 a 3 dias) [DECISÃO + ADR: B3, sessão em produção]**
- **Itens:** D2, B2, K1, K2, K3, B4.
- **Arquivos:** enfileirar-retomada.ts, turnos.repo.ts (enfileirar, `sessaoDoTurno`), emitir-plano-turno.ts, sessao-viva.ts.
- **Destrava:** uma retomada é o mesmo pedido, com anexo, contaminação e IA corretos.
- **B3 vem primeiro:** decidir entre sessão por máquina e "sem sessão" muda o desenho de K2 e B8.

**Lote 9: frentes e fecho (2 dias)**
- **Itens:** G4, G5, G6, G7, G10, A6/G11.
- **Destrava:** sucesso e falha da frente chegam corretos ao dono.

**Lote 10: salas, duplicar e máquinas (1 a 2 dias)**
- **Itens:** L3, L4, M1, M2, M3, M4 [DECISÃO M4: a cópia herda o modo?], A7, A8, C10, C11.

**Lote 11: polimento de harness e transporte (quando houver folga)**
- **Itens:** B1, que entra no lote 2 se o laço aparecer de novo em produção. E também B6, B7, B8, E7, E9.

**Resumo das decisões de produto pendentes:**
1. Rotina sem frente, triagem e retorno do lote esperam o limite (lote 2).
2. Frente em Automático troca de IA ou espera (D7).
3. Escopo da parada (F2).
4. Sala repete turno (L1, L4).
5. Turno sem alvo no modo "perguntar" (C12).
6. Sessão em produção (B3).
7. Cópia herda o modo de aprovação (M4).
8. "Testar agora" fura a reserva (I9).
9. Prazo para turno preso a máquina morta (G8, P1).
10. Retorno complementar de frente reaberta (G7, P5).

---

## 7. Lacunas da auditoria

- **Nada foi reproduzido rodando.** Os achados foram confirmados por leitura de código. Só uns poucos tiveram contagem em produção (somente leitura). As frequências citadas sem número são hipótese. Antes de priorizar E4, B1, A2 e E5, vale medir em produção: a duração do deploy, as cadeias de `reenvios`, os eventos `laco_renovar_falhou` e `adocao_falhou`.
- **Fora do escopo ou com pouca cobertura:**
  - voz e ligações além do A3;
  - computador (tela do bot);
  - conectores e marketplace;
  - segurança do hook e da cerca do git (só tocada em D2 e B4);
  - migrações e o gate de destrutivas;
  - performance do web;
  - isolamento entre tenants;
  - app desktop (atualização, instalação);
  - o modo local (servidor no Mac) em profundidade, porque a análise focou no compartilhado.
- **Cenários percorridos sem achado consolidado aqui.** Estes títulos aparecem como cenários percorridos, mas não chegaram com veredito à consolidação e precisam de verificação:
  - tarefa pedida por voz absorvida pelo turno vivo;
  - decidir o "×N" de acesso fecha a gêmea de outro turno sem retomá-lo;
  - aprovar, permitir ou escolher pasta depois do Parar morre em silêncio;
  - renomear o bot muda a pasta dele e deixa os clones fora da cerca;
  - o deploy drena o motor da VM durante uma frente longa e derruba esperas de comando.
- **Linear:** conferi as issues do time NOD por título. Os achados não têm issue própria. As relacionadas citadas (NOD-213/220, 214, 215, 216, 199, 207, 211, 219) estão concluídas. Seguem abertas NOD-218 (deploy sem queda), NOD-12 (uso do plano na tela), NOD-10 (contas por bot) e NOD-125 (limite de gasto), vizinhas de E4, D6, B8 e D4.
- **Achados do dia 15/10 sem issue** (lista de conhecidos do prompt) **não foram re-reportados**: cota por IA e não por conta; pendente com o harness antigo; pedido de colega sem fechamento; janela pulada sem motivo; rotina sem frente interrompida; frentes "rodando" sem turno; EventSource sem watchdog; painel "Esperando <bot>". Vários achados aqui são generalizações deles e estão marcados como "vizinho".
