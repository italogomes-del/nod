# ADR-105 — A limpeza pergunta pelas pastas que a máquina tem no disco

Status: aceito (pedido do Marlon, 2026-10-15) · Data: 2026-10-15 · Revisa a
[ADR-088](adr-088-limpeza-das-pastas-de-task.md) (quem pode ser limpo) e a
[ADR-096](adr-096-o-disco-que-se-cuida.md) (o disco que se cuida)

## Contexto

Em 15/10 a VM dos bots (`nod-motor-teste`) encheu de novo: 409 MB livres de 99 GB. O disco foi para 200 GB e a
limpeza foi investigada. Ela rodava a cada 30 min com o disco apertado, mas não apagava nada. Medido em 15/10:

- **O servidor só oferecia pastas já limpas.** `candidatosALimpeza` devolve até 500 tasks encerradas nos últimos 30
  dias, das mais antigas para as mais novas. O Marlon tinha 1.151 nessa janela, e a 500ª tinha terminado em 09/10
  20:32. Nada que terminou depois aparecia. Quase todas as 500 já tinham saído do disco, então cada passada da VM
  achava "1 pasta". Das 124 tasks encerradas do Ze 1, só 10 entravam no corte, todas elegíveis (sem turno vivo, sem
  decisão pendente, sem pasta dividida). A VM liberou 0 MB por dia de 12 a 14/10. Sem mudança, o corte só andaria
  quando as tasks de 09/10 saíssem da janela, perto de 08/11.
- **A reconfirmação caía no mesmo corte.** Antes de apagar, a máquina pede a lista inteira de novo e procura a pasta
  nela. A pasta fora das 500 não se reconfirmava (`nao_reconfirmada`).
- **A worktree sem clone travava a pasta para sempre.** Uma task apagou o clone `nod` de outra. A worktree que sobrou
  (`Ada/…-169c93/nod`, e mais cinco da Tarsila) aponta para um `gitdir` que não existe. O `git rev-parse` falha, a
  limpeza marca `erro`, e `erro` segura a pasta. Era essa a pasta oferecida e recusada a cada 30 min desde 04:47 UTC.
- **O log misturava as máquinas.** `limpeza_feita` é por pessoa. Os 24,7 GB liberados às 14:29 UTC foram no Mac do
  Marlon, mas pareciam da VM, cujo espaço livre ficou em ~5,9 GB o dia inteiro.

## Decisão

1. **A máquina manda as pastas que tem.** Cada passada lê os nomes em `~/nod/<bot>/<slug>` (dois `readdir`, sem medir
   nada) e os manda em `pastas` no pedido `limpeza` (`pastasNoDisco`, em `adapters/executor/limpeza-das-tasks.ts`). O
   servidor só considera as tasks dessas pastas. Lista vazia = nada a limpar, sem consultar o banco. A rota valida a
   lista (`pastasDaMaquina`, no domínio): só a forma de `pastaDeTask`, em NFC, sem repetir, até 5.000 itens. A
   consulta compara `normalize(pasta, NFC)`, porque o APFS do Mac pode devolver o nome com o acento decomposto.
2. **Sem lista, as mais recentes primeiro.** A máquina que ainda não atualizou não manda `pastas`. Para ela, a consulta
   passa a ordenar por `terminado_em desc`: as tasks que acabaram há pouco são as que ainda têm pasta no disco. O teto
   de 500 fica.
3. **A reconfirmação pergunta só pela pasta que vai sair** (`pastas: [p.pasta]`). Responde certo fora de qualquer corte
   e é mais barata.
4. **`clone_sumiu`, um motivo novo.** A worktree cujo `gitdir:` aponta para dentro de `~/nod` e não existe mais
   (`cloneSumiu`, em `guardar-antes-de-apagar.ts`) entra em `SAI_GUARDANDO`. Na task encerrada, a pasta é guardada
   (`.tar.gz` em `~/nod/.guardado`, ADR-096 §4) e apagada. Na task recente, fica. Sem o clone, não há commit a
   referenciar nem worktree a desligar, e os arquivos vão no guardado. O mesmo vale para a órfã da raiz do bot. Clone
   **fora** de `~/nod` que sumiu (um disco desmontado, por exemplo) segue `erro`, porque pode voltar.
5. **O log diz qual máquina limpou.** `limpeza_feita`, `limpeza_simulada` e `limpeza_adiada` levam `machine_id` quando
   o relato chega pela ponte.

O que vai ao servidor são nomes de pasta que ele já guarda em `trabalhos.pasta`. Nada novo é gravado: a lista só
filtra a consulta.

## Alternativas descartadas

- **Só inverter a ordem (item 2 sozinho).** Resolve o 15/10, mas volta a falhar quando uma pasta antiga ficar presa e
  houver mais de 500 tasks mais novas. A lista da máquina não tem corte que esconda pasta existente.
- **Tirar o teto e paginar.** A consulta tem três subconsultas por task, e o número de tasks só cresce. A cada passada,
  o banco pagaria por pastas que não existem em disco nenhum.
- **O servidor lembrar o que cada máquina já limpou.** Exige tabela nova e relato por pasta, que é caminho, e o relato
  hoje é só números (ADR-088). A máquina já sabe o que tem no disco.

## Gatilho de reversão

- Voltar a mandar só `apertado` (sem a lista) se a consulta `candidatosALimpeza` com `pastas` passar de 1 s (medir com
  `explain analyze` no banco de produção) ou se uma máquina tiver mais de 5.000 pastas de task.
- Tirar `clone_sumiu` de `SAI_GUARDANDO` se aparecer pasta guardada com esse motivo cujo clone existia, por exemplo
  num caminho com link.
