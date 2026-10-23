import type { IdHarness } from "./harness.ts";
import type { EpochMs } from "./ids.ts";
import type { Inventario } from "./inventario.ts";
import type { PapelMaquina, PlataformaMaquina } from "./ponte.ts";
import type { MaquinaNuvemDto } from "./provedor-nuvem.ts";
import type { DiscoDoMac, LeituraDisco, MotivoEsperaMac, NivelPressao } from "./trabalho.ts";
// ADR-099 §7 (2026-10-12): a cota da IA segura trabalho como a máquina; trabalho.ts lê os campos daqui (teto de 200 linhas).
export type { CotaNosTrabalhos, CotaNoTrabalho } from "./cota.ts";

/**
 * ADR-090: uma máquina da pessoa na tela "Máquinas" — a chave viva, com o que a máquina anunciou se está conectada agora
 * (nome, plataforma, IAs e gh). `plataforma` null = não está conectada (o servidor só sabe pelo anúncio).
 */
export type MaquinaDto = {
  id: string;
  nome: string;
  prefixo: string;
  criadaEm: EpochMs;
  ultimoUsoEm: EpochMs | null;
  conectada: boolean;
  plataforma: PlataformaMaquina | null;
  ias: Partial<Record<IdHarness, Inventario["estado"]>>;
  gh: boolean;
  /** NOD-94: `computador` = "· só computador" na tela; fica fora dos seletores de onde o bot trabalha. Ausente = `motor`. */
  papel?: PapelMaquina;
  /** ADR-121 (NOD-92): a máquina que dorme e acorda pelo Google. Ausente sem `NOD_MAQUINA_NUVEM=gcp` ou fora da nuvem. */
  nuvem?: MaquinaNuvemDto;
};
/**
 * `servidorNoMac` (ADR-092): o Nod roda no modo local, com o servidor no Mac da pessoa. O bot sem máquina escolhida roda
 * neste Mac, e as máquinas da lista só pegam os bots escolhidos para elas. `api` é o endereço da API neste Mac (o que a VM
 * alcança pelo túnel SSH). Ausente = modo compartilhado ("qualquer uma").
 */
export type MaquinasDto = { maquinas: MaquinaDto[]; padraoId: string | null; servidorNoMac?: { api: string } };

/** Uma máquina da pessoa como a tela a nomeia: o Mac ("seu Mac") ou outra, pelo nome que ela anunciou ("nod-motor-teste"). */
export type MaquinaDoTrabalho = {
  id: string;
  nome: string;
  ehMac: boolean;
  /**
   * NOD-260 (definido em 2026-10-15, G8): desde quando a máquina não fala com o servidor — a regra do chip da conversa
   * (conectada = contato há menos de 60 s; senão o último uso da chave). null = em contato (ou não se sabe). Opcional: o
   * servidor de antes não manda.
   */
  semContatoDesde?: number | null;
  /** ADR-121 (NOD-92): a máquina na nuvem está acordando para este trabalho ("Acordando <máquina>…"). Opcional. */
  acordando?: boolean;
};

/**
 * A leitura de UMA máquina (2026-10-09): os mesmos níveis de `TrabalhosDto`, só dela, e o que o portão dela segura agora
 * (`motivoEspera`, `seguraTudoNovo`) pelo "uso do Mac" da pessoa, que vale para todas. `memoriaBotsMb`: a memória dos
 * processos dos bots nela.
 */
export type LeituraDeMaquinaDto = MaquinaDoTrabalho & {
  pressao: NivelPressao;
  memoriaBotsMb: number;
  processador: NivelPressao | null;
  usoProcessador: number | null;
  cargaProcessador: number | null;
  fila: NivelPressao | null;
  disco: DiscoDoMac | null;
  discoSuportado: boolean;
  motivoEspera: MotivoEsperaMac | null;
  seguraTudoNovo: boolean;
};

/**
 * A leitura viva de UMA máquina, como o processo a guarda (2026-10-09, trabalhos-vivos.ts): `portao` é o nível do
 * processador que o portão usa (o pior entre a CPU e a fila, ADR-091); `totalMb`, a memória dos processos dos bots nela.
 */
export type LeituraDaMaquinaViva = { machineId: string; nivel: NivelPressao; totalMb: number; processador: NivelPressao | null; fila: NivelPressao | null; portao: NivelPressao | null; uso: number | null; carga: number | null; disco: LeituraDisco | null; discoNivel: NivelPressao | null; discoMedido: boolean; discoAcabaEmMs?: number | null };
