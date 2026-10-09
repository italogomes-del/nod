import type { IdHarness } from "./harness.ts";
import type { EpochMs } from "./ids.ts";
import type { Inventario } from "./inventario.ts";
import type { PlataformaMaquina } from "./ponte.ts";

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
};
/**
 * `servidorNoMac` (ADR-092): o Nod roda no modo local, com o servidor no Mac da pessoa. O bot sem máquina escolhida roda
 * neste Mac, e as máquinas da lista só pegam os bots escolhidos para elas. `api` é o endereço da API neste Mac (o que a VM
 * alcança pelo túnel SSH). Ausente = modo compartilhado ("qualquer uma").
 */
export type MaquinasDto = { maquinas: MaquinaDto[]; padraoId: string | null; servidorNoMac?: { api: string } };
