import type { EsperaParaRodar, RelatoEspera, RespostaRelatoEspera } from "./espera.ts";
import type { CapacidadesHarness, IdHarness } from "./harness.ts";
import type { RuntimeEvent } from "./evento.ts";
import type { Inventario } from "./inventario.ts";
import type { MotivoPasse } from "./motivos.ts";
import type { PlanoTurno } from "./plano-turno.ts";
import type { LeituraMemoria } from "./trabalho.ts";
import type { ResultadoTurno, SinaisTurno, TarefaDoBot } from "./turno.ts";

/** A máquina se anuncia (ADR-021 conectar). */
export type AnuncioMaquina = {
  machineId: string;
  nome: string;
  inventario: Inventario;
  versaoContrato: number;
  harnesses?: Partial<Record<IdHarness, Inventario>>;
  /**
   * definido em 2026-09-24 (ADR-048): `gh auth status` NESTA máquina. O servidor só usa o gh para a
   * pessoa dona da chave desta máquina — o login do gh serve a quem o fez, nunca a um colega.
   */
  github?: { gh: boolean };
  /**
   * definido em 2026-10-04 (ADR-072): este app roda o laço de voz (abre o canal do cérebro da ligação). Ausente = app
   * antigo: o turno da ligação nunca vai para ele.
   */
  ligacao?: boolean;
  /**
   * NOD-167: IAs prontas neste Mac que NÃO rodam o laço de voz (o Codex sem `app-server`). O servidor recusa o Ligar
   * de um bot com essa IA com o motivo `codex_sem_app_server`. Ausente = app antigo, ou todas rodam.
   */
  semLacoDeVoz?: IdHarness[];
  /**
   * definido em 2026-10-08 (ADR-083, revisão do épico): as capacidades que os drivers DESTA máquina declaram, já com os
   * pisos do CLI instalado (ex.: `bifurcaSessao` só com `--fork-session` no help). Na rede de 2 min, a máquina do turno
   * que anunciou `bifurcaSessao` faz o dono seguir numa cópia da sessão; sem o anúncio (app antigo), a sessão vai com a
   * frente e o dono segue com o histórico (revisto em 2026-10-12, ADR-099, I8).
   */
  capacidades?: Partial<Record<IdHarness, CapacidadesHarness>>;
  /**
   * definido em 2026-10-09 (ADR-090): o sistema da máquina. O prompt e as telas nomeiam a máquina do turno e não afirmam
   * "Mac" quando ela é Linux. Ausente = app do Mac anterior a este campo: vale `darwin`.
   */
  plataforma?: PlataformaMaquina;
};

/** ADR-090: as plataformas em que o motor roda — o app do Mac e o motor sem janela numa máquina Linux. */
export const PLATAFORMAS_MAQUINA = ["darwin", "linux"] as const;
export type PlataformaMaquina = (typeof PLATAFORMAS_MAQUINA)[number];

/** Passe é CAMPO tipado, nunca regex sobre o texto do modelo (GRUPO.passe-tipado). */
export type FalaEntrega = { tipo: "texto"; texto: string } | { tipo: "passe"; motivo: MotivoPasse };

export type Entrega = {
  turnoId: string;
  machineId: string;
  /** Idempotência: UNIQUE (tenant_id, turno_id, seq_local) na 0002. */
  seqLocal: number;
  fala: FalaEntrega;
  resultado: ResultadoTurno;
  /** #189: mensagens escritas na sessão cuja confirmação não chegou numa renovação (a última falhou); a entrega confirma. */
  mensagensEntregues?: string[];
};

/**
 * Uma volta do modelo numa sessão viva que não encerrou o turno (definido em 2026-10-01, ADR-067). `seq` sobe de 1 em
 * 1 por turno: o servidor grava cada uma uma vez só, mesmo que a renovação seja repetida.
 */
export type FalaIntermediaria = { seq: number; texto: string };
export type PedidoRenovar = {
  turnoId: string;
  machineId: string;
  sinais: SinaisTurno;
  eventos: RuntimeEvent[];
  /** ADR-067: falas da sessão viva ainda não confirmadas pelo servidor. */
  falas?: FalaIntermediaria[];
  /**
   * ADR-067: a sessão viva está com a entrada aberta. Só então o servidor absorve as mensagens novas da pessoa nesta
   * conversa e as devolve; sem isto elas esperam na fila, como antes.
   */
  aceitaMensagens?: boolean;
  /**
   * definido em 2026-10-07 (ADR-083, #189): os ids (`mensagensIds`) que o CLI recebeu desde a última renovação. Só estes
   * saem da fila como absorvidos; os que nunca chegam aqui continuam `pendente` e viram turno próprio. A presença do
   * campo (mesmo vazio) diz que o app confirma: app antigo, sem ele, tem a mensagem absorvida na hora, como antes.
   */
  mensagensEntregues?: string[];
  /** #189: ids que o adapter não conseguiu escrever (a sessão fechou entre o pedido e a resposta): ficam na fila. */
  mensagensDevolvidas?: string[];
  /** definido em 2026-10-07 (ADR-083, #194): a memória do Mac, amostrada uma vez por máquina a cada 30 s. */
  memoria?: LeituraMemoria;
};
/**
 * O que a renovação devolve. `mensagens`: as falas da pessoa que entraram neste turno vivo, na ordem (ADR-067).
 * `mensagensIds` (#189): o id do turno de cada uma, na mesma ordem, para o app confirmar em `mensagensEntregues`.
 */
/** `mensagensSemMoldura`: ids (de `mensagensIds`) que são recado para a task, não fala da pessoa — entram sem a moldura. */
export type RespostaRenovar = { ativo: boolean; versaoMinimaApp: string; mensagens?: string[]; mensagensIds?: string[]; mensagensSemMoldura?: string[]; ligacaoEncerrada?: boolean };

/**
 * O que o app desktop viu do turno vivo desde a última renovação, NA ORDEM: texto do modelo e nomes
 * de ferramenta (nunca input/resultado). O servidor republica como turno.delta / turno.atividade.
 */
export type TrechoVivo = { texto: string } | { ferramenta: string } | { tarefas: TarefaDoBot[] } | { vigia: VigiaVivo };

/**
 * O vigia do turno (definido em 2026-10-05, NOD-73; src/domain/vigia-turno.ts): só AVISA, nunca corta. `mudoMs` > 0
 * é o silêncio desde o último evento do CLI (0 = houve novidade); `aberta` é o NOME da ferramenta sem resultado;
 * `emFundo` conta os comandos em segundo plano; `repeticao` é o maior limiar (5, 10, 20) já atingido no turno. Só
 * nome e números: os argumentos nunca saem do Mac. Um trecho novo substitui o anterior no buffer da ponte.
 */
export type VigiaVivo = { mudoMs: number; aberta?: string; emFundo: number; repeticao?: { nome: string; vezes: number } };

/**
 * Uma pasta de task encerrada que o Mac pode limpar (definido em 2026-10-09, ADR-088). `pasta` é relativa a `~/nod`
 * (`<bot>/<slug>`, a forma de `trabalhos.pasta` sem o `~/nod/`). `quando`: `encerrada` = acabou há mais de 3 dias e as
 * worktrees limpas saem; `so_com_pr_mergeado` = acabou há menos, e só sai a worktree cujo PR já foi mergeado.
 */
export type PastaParaLimpar = { trabalhoId: string; pasta: string; quando: "encerrada" | "so_com_pr_mergeado" };

/**
 * O que o Mac relata de uma passada da limpeza (ADR-088): só números e motivos, nunca caminho (o slug da pasta vem do
 * título da task). `liberadoBytes` é a diferença do espaço livre do volume antes e depois de cada remoção (o `du`
 * mente com os clones APFS do pnpm). `orfas`: worktrees na raiz das pastas dos bots, fora de qualquer task — contadas,
 * nunca apagadas; `orfasParadas` as sem mexer há 2 dias ou mais.
 */
export type RelatoLimpeza = {
  pastas: number;
  removidas: number;
  pastasApagadas: number;
  liberadoBytes: number;
  puladas: Partial<Record<MotivoPuladaLimpeza, number>>;
  orfas: number;
  orfasParadas: number;
  duracaoMs: number;
  /**
   * Revisão do #225 (`NOD_LIMPEZA_TASKS=simular`): a passada fez todas as checagens e não apagou nada. `removidas` e
   * `pastasApagadas` contam o que sairia; `estimadoBytes` é o `du` das worktrees que sairiam.
   */
  simulada?: boolean;
  estimadoBytes?: number;
  /** Segunda revisão do #225: o Docker está instalado e não respondeu — a passada não mexeu em nada. */
  adiada?: boolean;
  /** ADR-096: a passada foi disparada pelo disco apertado (fora das 6 h). */
  apertada?: boolean;
  /** ADR-096: o que os caches de pacote (npm, pnpm) liberaram na passada apertada, pelo `statfs`. */
  cachesBytes?: number;
  /**
   * ADR-096 §4: pastas (de task ou órfãs) guardadas compactadas em `~/nod/.guardado` e apagadas, o tamanho dos guardados,
   * os guardados vencidos apagados e as órfãs da raiz que saíram (limpas, sem guardar).
   */
  guardadas?: number;
  guardadoBytes?: number;
  guardadosVencidos?: number;
  orfasRemovidas?: number;
};
/**
 * Revisão do #225: `aninhado` (outra worktree ou repositório dentro dela), `ignorado_valioso` (arquivo ignorado que não
 * se refaz), `head_solto` (commit fora de qualquer branch, remoto ou tag), `em_uso` (um turno deste Mac roda na pasta) e
 * `nao_reconfirmada` (o servidor não confirmou de novo logo antes de apagar). ADR-096 §4: `processo_vivo` (um `*.pid`
 * da pasta aponta para um processo vivo, como um Postgres de teste) e `grande_demais` (o guardado passaria de 2 GB).
 */
export type MotivoPuladaLimpeza = "suja" | "travada" | "montagem" | "pr_nao_mergeado" | "clone" | "fora_da_pasta" | "aninhado" | "ignorado_valioso" | "head_solto" | "em_uso" | "nao_reconfirmada" | "erro" | "processo_vivo" | "grande_demais";

/**
 * Os cinco verbos da ponte (ADR-021), faladas in-process nesta rodada. A ponte HTTP entra depois
 * sem trocar o driver. {ativo:false} em renovar manda o executor abortar.
 */
export interface PonteInterna {
  conectar(m: AnuncioMaquina): Promise<void>;
  /**
   * NOD-199 (emenda à ADR-021): reanuncia só as IAs da máquina já conectada, sem mexer nos turnos em andamento. Opcional:
   * só o cliente HTTP do app tem; a ponte interna do servidor não precisa (o `conectar` dela já é idempotente).
   */
  anunciarInventario?(m: AnuncioMaquina): Promise<void>;
  /** ADR-085 (2026-10-08): `maquina` é a leitura do Mac que pede (memória e processador); ausente = app antigo ou sem leitura. */
  puxar(pessoaId: string, maquina?: LeituraMemoria): Promise<PlanoTurno | null>;
  renovar(p: PedidoRenovar): Promise<RespostaRenovar>;
  entregar(e: Entrega): Promise<void>;
  desconectar(machineId: string): Promise<void>;
  /**
   * ADR-088 (2026-10-09): as pastas de task encerradas que este Mac pode limpar. A regra (quem pode) é do servidor, que
   * tem o banco; o disco é do Mac, que apaga. Ausente = ponte antiga: a limpeza não roda. ADR-096: `apertado` = o
   * disco da máquina está amarelo ou vermelho, e a task encerrada há mais de 2 h já vale como `encerrada`.
   */
  pastasParaLimpar?(pessoaId: string, o?: { apertado?: boolean }): Promise<PastaParaLimpar[]>;
  /** ADR-088: o resumo da passada, para o log `limpeza_feita` do servidor. */
  relatarLimpeza?(pessoaId: string, relato: RelatoLimpeza): Promise<void>;
  /**
   * definido em 2026-10-12 (ADR-099, parte 2): as esperas de comando que esta máquina deve estar rodando agora (o puxar, a
   * cada 5 s, também é a notícia que o varredor confere). `machineId` só vale na ponte in-process: na HTTP a máquina é a
   * da chave. null = sem resposta (servidor fora, ou antigo): a máquina não mata nem começa nada por isso.
   */
  esperas?(pessoaId: string, machineId: string): Promise<EsperaParaRodar[] | null>;
  /** ADR-099: o relato de uma espera (começou, terminou, não deu). null = sem resposta: a máquina guarda e manda de novo. */
  relatarEspera?(pessoaId: string, machineId: string, relato: RelatoEspera): Promise<RespostaRelatoEspera | null>;
}
