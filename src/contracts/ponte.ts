import type { ContaAnunciada } from "./contas-ia.ts";
import type { EsperaParaRodar, RelatoEspera, RespostaRelatoEspera } from "./espera.ts";
import type { CapacidadesHarness, IdHarness } from "./harness.ts";
import type { RuntimeEvent } from "./evento.ts";
import type { Inventario } from "./inventario.ts";
import type { PastaParaLimpar, RelatoLimpeza } from "./limpeza.ts";
import type { MotivoPasse } from "./motivos.ts";
import type { PlanoTurno } from "./plano-turno.ts";
import type { PedidoRevisao, RelatoRevisao, RespostaRelatoRevisao } from "./revisao.ts";
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
  /**
   * definido em 2026-10-12 (NOD-214): o cliente desta máquina atravessa o reinício do servidor — a renovação sem resposta
   * vira `indefinido` (o CLI segue) por até `TOLERANCIA_REINICIO_MS`, a entrega insiste por até 120 s e a mensagem com id
   * repetido não é escrita duas vezes. Só com isto o servidor pode deixar de esperar o turno na drenagem do deploy.
   * Ausente = app antigo: a drenagem espera o turno como antes (NOD-175/176). Quem anuncia é a ponte HTTP do cliente.
   */
  sobreviveReinicio?: boolean;
  /** ADR-102 (2026-10-13): as contas de IA logadas nesta máquina (impressão e, ADR-105, e-mail). Ausente = app antigo. */
  contas?: ContaAnunciada[];
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
  /**
   * definido em 2026-10-12 (NOD-214): a sessão do CLI deste turno (do evento `init` do harness), em toda renovação. O
   * servidor a grava cedo: se a entrega se perder num reinício, a volta retoma a mesma sessão em vez de abrir outra.
   */
  sessaoCli?: string;
  /**
   * ADR-115 (2026-10-18, revisao.ts): `revisa: true` só quando o driver do turno sabe revisar (flags conferidas no
   * `--help`); a renovação sem o campo tira o turno do revisor (cartão na fase 1). `segredoRevisao` vai em TODA
   * renovação, desde a do `promptSubmitted`: o servidor só o amarra enquanto o turno não tinha `prompt_submitted` no banco,
   * e dois segredos diferentes tiram o turno do revisor (caixa-revisoes.ts). `revisoesRecebidas` confirma os recebidos.
   */
  revisa?: true;
  segredoRevisao?: string;
  revisoesRecebidas?: string[];
};
/**
 * O que a renovação devolve. `mensagens`: as falas da pessoa que entraram neste turno vivo, na ordem (ADR-067).
 * `mensagensIds` (#189): o id do turno de cada uma, na mesma ordem, para o app confirmar em `mensagensEntregues`.
 */
/** `mensagensSemMoldura`: ids (de `mensagensIds`) que são recado para a task, não fala da pessoa — entram sem a moldura. */
/**
 * `ativo: "indefinido"` (NOD-214): só o cliente HTTP devolve — o servidor não respondeu (fora, 5xx, 409 sem reconexão) e
 * ainda está dentro de `TOLERANCIA_REINICIO_MS`. O laço segue o turno; só `false` interrompe. O servidor nunca o manda.
 */
/**
 * `motivo` (NOD-264, C20): com `ativo: false`, por que o servidor negou — `sem_plano` (o processo não conhece o turno),
 * `parado` (o turno não está mais despachando ou o Parar foi pedido), `agente_excluido` (o bot saiu ou trocou de
 * geração), `lease_vencido` (o lease venceu ou o turno é de outra máquina). Só código; vira a causa do `turno_interrompido`.
 */
export const MOTIVOS_RENOVACAO_NEGADA = ["sem_plano", "parado", "agente_excluido", "lease_vencido"] as const;
export type MotivoRenovacaoNegada = (typeof MOTIVOS_RENOVACAO_NEGADA)[number];
export type RespostaRenovar = { ativo: boolean | "indefinido"; versaoMinimaApp: string; motivo?: MotivoRenovacaoNegada; mensagens?: string[]; mensagensIds?: string[]; mensagensSemMoldura?: string[]; ligacaoEncerrada?: boolean; revisoes?: PedidoRevisao[] };

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

export type { MotivoPuladaLimpeza, PastaParaLimpar, RelatoLimpeza } from "./limpeza.ts";

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
   * disco da máquina está amarelo ou vermelho, e a task encerrada há mais de 2 h já vale como `encerrada`. ADR-106:
   * `codigos` = o sha256 (hexadecimal) de cada `<bot>/<slug>` em NFC que existe no disco da máquina — nunca o nome; o
   * servidor só responde sobre essas pastas. Ausente = máquina antiga: as mais recentes primeiro.
   */
  pastasParaLimpar?(pessoaId: string, o?: { apertado?: boolean; codigos?: readonly string[] }): Promise<PastaParaLimpar[]>;
  /** ADR-099 (I5): a pasta da frente que terminou com este turno, se já vale `sem_trabalho` (vai na resposta do entregar). */
  limparAgora?(pessoaId: string, turnoId: string): Promise<PastaParaLimpar | null>;
  /** ADR-088: o resumo da passada, para o log `limpeza_feita` do servidor. ADR-106: `machineId` = a máquina que limpou. */
  relatarLimpeza?(pessoaId: string, relato: RelatoLimpeza, machineId?: string): Promise<void>;
  /**
   * definido em 2026-10-12 (ADR-099, parte 2): as esperas de comando que esta máquina deve estar rodando agora (o puxar, a
   * cada 5 s, também é a notícia que o varredor confere). `machineId` só vale na ponte in-process: na HTTP a máquina é a
   * da chave. null = sem resposta (servidor fora, ou antigo): a máquina não mata nem começa nada por isso.
   */
  esperas?(pessoaId: string, machineId: string): Promise<EsperaParaRodar[] | null>;
  /** ADR-099: o relato de uma espera (começou, terminou, não deu). null = sem resposta: a máquina guarda e manda de novo. */
  relatarEspera?(pessoaId: string, machineId: string, relato: RelatoEspera): Promise<RespostaRelatoEspera | null>;
  /** ADR-115: o relato de uma revisão (revisao.ts). null = sem resposta (servidor antigo: 404); o pedido vira cartão. */
  relatarRevisao?(pessoaId: string, machineId: string, relato: RelatoRevisao): Promise<RespostaRelatoRevisao | null>;
}
