import type { PreferenciaHarness } from "../contracts/harness.ts";
import { validarInteligencia } from "../domain/harness.ts";
import { CORES_AGENTE, ESFORCOS_AGENTE, FORMAS_AGENTE, type Agente, type EsforcoAgente, type FormaAgente, type CorAgente } from "../contracts/agente.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso } from "./tipos.ts";

export type EntradaEditarPerfil = {
  agenteId: string;
  nome?: string;
  forma?: FormaAgente;
  cor?: CorAgente;
  titulo?: string;
  descricao?: string;
  modelo?: string;
  harness?: PreferenciaHarness;
  /** "" ou null = o padrão do modelo; ausente = não muda. */
  esforco?: string | null;
  /** Qualquer valor aqui é recusado: o dono é imutável (E1.2; trigger nod_agente_dono_imutavel no banco). */
  dono?: unknown;
};

function campo(v: unknown, nome: string, permiteVazio: boolean): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new ErroDeDominio("entrada_invalida", { cause: nome });
  const t = v.trim();
  if (!permiteVazio && t === "") throw new ErroDeDominio("entrada_invalida", { cause: nome });
  return t;
}

function esforcoValido(v: string): EsforcoAgente {
  const e = ESFORCOS_AGENTE.find((x) => x === v);
  if (!e) throw new ErroDeDominio("entrada_invalida", { cause: "esforco" });
  return e;
}

/** PATCH direto pela pessoa (sem proposta): nome/título/descrição/modelo. Quem tenta mudar o dono recebe dono_imutavel. */
export const editarPerfil: CasoDeUso<EntradaEditarPerfil, { agente: Agente }> = async (deps, input) => {
  if (input.dono !== undefined) throw new ErroDeDominio("dono_imutavel");
  if (input.forma !== undefined && !FORMAS_AGENTE.some((forma) => forma === input.forma)) throw new ErroDeDominio("entrada_invalida");
  if (input.cor !== undefined && !CORES_AGENTE.some((cor) => cor === input.cor)) throw new ErroDeDominio("entrada_invalida");
  const perfil = {
    forma: input.forma,
    cor: input.cor,
    nome: campo(input.nome, "nome", false),
    titulo: campo(input.titulo, "titulo", true),
    descricao: campo(input.descricao, "descricao", true),
    harness: input.harness,
    modelo: campo(input.modelo, "modelo", false),
    esforco: input.esforco === undefined ? undefined : input.esforco === null || input.esforco === "" ? null : esforcoValido(input.esforco),
  };
  if ((perfil.nome?.length ?? 0) > 60 || (perfil.titulo?.length ?? 0) > 120 || (perfil.descricao?.length ?? 0) > 8000) throw new ErroDeDominio("entrada_invalida");
  if (Object.values(perfil).every((v) => v === undefined)) throw new ErroDeDominio("entrada_invalida", { cause: "nada a editar" });

  const existente = await deps.repos.agentes.buscar(input.agenteId);
  if (!existente) throw new ErroDeDominio("nao_encontrado");
  if (perfil.harness !== undefined || perfil.modelo !== undefined) validarInteligencia(perfil.harness ?? existente.harness ?? "auto", perfil.modelo ?? existente.modelo);
  const modeloMudou = perfil.harness !== undefined && perfil.harness !== existente.harness || perfil.modelo !== undefined && perfil.modelo !== existente.modelo;
  const agente = await deps.repos.agentes.atualizarPerfil(input.agenteId, { ...perfil, ...(perfil.descricao !== undefined || perfil.titulo !== undefined ? { confirmado: true } : {}) });
  // Visível (equipe) mas de outra pessoa: o repositório devolve null em vez de 42501.
  if (!agente) throw new ErroDeDominio("nao_permitido");

  if (modeloMudou) {
    const conversa = await deps.repos.conversas.buscarPropriaDoAgente(agente.id);
    if (conversa) await deps.repos.conversas.atualizarSessaoCli(conversa.id, null);
  }

  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  return {
    data: { agente },
    events: [evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, dados: { agente_id: agente.id, acao: "perfil_editado", nome: agente.nome } })],
  };
};
