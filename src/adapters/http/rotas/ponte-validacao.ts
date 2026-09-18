import type { Inventario } from "../../../contracts/inventario.ts";
import { MOTIVOS_FALHA, MOTIVOS_INTERRUPCAO, MOTIVOS_PASSE } from "../../../contracts/motivos.ts";
import type { Entrega } from "../../../contracts/ponte.ts";
import type { SinaisTurno } from "../../../contracts/turno.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { UUID } from "../roteador.ts";

export function exigir(condicao: unknown): asserts condicao {
  if (!condicao) throw new ErroDeDominio("entrada_invalida");
}
export function objeto(v: unknown): Record<string, unknown> {
  exigir(v && typeof v === "object" && !Array.isArray(v));
  return v as Record<string, unknown>;
}
export function texto(v: unknown, max = 100_000): v is string { return typeof v === "string" && v.length <= max; }
export function uuid(v: unknown): string { exigir(typeof v === "string" && UUID.test(v)); return v; }
export function sinais(v: unknown): SinaisTurno {
  const s = objeto(v);
  exigir(["attempted", "rejected", "promptSubmitted", "producedOutput"].every((k) => typeof s[k] === "boolean"));
  return { attempted: s.attempted as boolean, rejected: s.rejected as boolean, promptSubmitted: s.promptSubmitted as boolean, producedOutput: s.producedOutput as boolean };
}
export function inventario(v: unknown, agora: number): Inventario {
  const i = objeto(v);
  if (i.estado === "pronto") { exigir(texto(i.versao, 100)); return { estado: "pronto", versao: i.versao, em: agora }; }
  exigir(i.estado === "ausente" || i.estado === "nao_autenticado");
  return { estado: i.estado, motivo: i.estado === "ausente" ? "Harness não encontrado neste computador" : "Entre na conta do harness neste computador", em: agora };
}
export function entrega(v: unknown, machineId: string): Entrega {
  const e = objeto(v), r = objeto(e.resultado), f = objeto(e.fala), t = objeto(r.tokens);
  exigir(Number.isSafeInteger(e.seqLocal) && Number(e.seqLocal) > 0);
  exigir(f.tipo === "texto" ? texto(f.texto) : f.tipo === "passe" && MOTIVOS_PASSE.some((m) => m === f.motivo));
  exigir(["sucesso", "falha", "interrompido"].includes(String(r.desfecho)) && texto(r.texto));
  exigir(r.sessaoCli === null || (typeof r.sessaoCli === "string" && UUID.test(r.sessaoCli)));
  exigir(r.custoUsd === null || (typeof r.custoUsd === "number" && Number.isFinite(r.custoUsd) && r.custoUsd >= 0));
  exigir(["entrada", "saida", "cacheLeitura", "cacheCriacao"].every((k) => Number.isSafeInteger(t[k]) && Number(t[k]) >= 0));
  exigir([r.ferramentasChamadas, r.negacoesPermissao].every((a) => Array.isArray(a) && a.length <= 1000 && a.every((x) => texto(x, 200))));
  exigir(r.motivoFalha === undefined || MOTIVOS_FALHA.some((m) => m === r.motivoFalha));
  exigir(r.motivoInterrupcao === undefined || MOTIVOS_INTERRUPCAO.some((m) => m === r.motivoInterrupcao));
  const validados = sinais(r.sinais);
  // definido em 2026-09-17: erroCru remoto não entra no log; só os campos do contrato validado atravessam HTTP.
  return { turnoId: uuid(e.turnoId), machineId, seqLocal: Number(e.seqLocal), fala: f as Entrega["fala"], resultado: {
    desfecho: r.desfecho as Entrega["resultado"]["desfecho"], texto: r.texto, sessaoCli: r.sessaoCli as string | null,
    custoUsd: r.custoUsd as number | null, sinais: validados, tokens: t as Entrega["resultado"]["tokens"],
    ferramentasChamadas: r.ferramentasChamadas as string[], negacoesPermissao: r.negacoesPermissao as string[],
    motivoFalha: r.motivoFalha as Entrega["resultado"]["motivoFalha"], motivoInterrupcao: r.motivoInterrupcao as Entrega["resultado"]["motivoInterrupcao"],
  } };
}
