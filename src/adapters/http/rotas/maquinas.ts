import { ErroDeDominio } from "../../../domain/erro.ts";
import type { PareamentoMaquina } from "../../../services/pareamento-maquina.ts";
import { lerPlataforma, type PareamentoDispositivo } from "../../../services/pareamento-dispositivo.ts";
import type { MaquinaDto } from "../../../contracts/maquina.ts";
import type { Deps } from "../../../use-cases/tipos.ts";
import type { Escopo } from "../../../shared/types.ts";
import { log } from "../../../obs/log.ts";
import type { MaquinaConectada } from "./ponte.ts";
import { emitirChaveMaquina, revogarChaveMaquina } from "../../../use-cases/chaves-maquina.ts";
import type { Rota } from "../roteador.ts";
import { executar, type DentroDeTx } from "./dentro-de-tx.ts";

/**
 * "Minhas chaves" (E1.3, ADR-031): a pessoa da sessão emite, lista e revoga as chaves dos próprios
 * computadores. Rota de PESSOA (cookie), nunca interna: agente não emite chave. A chave crua aparece
 * só na resposta do POST; a listagem nunca a traz (nem o hash).
 *
 * Pareamento pelo navegador (ADR-069): a pessoa, com sessão, abre um pedido para o Mac que pediu
 * (`pareamentos`); o app troca o código de uso único pela chave em `pareamento/trocar`, rota pública
 * que recusa navegador (Origin → 403) como as de máquina. A chave nasce na troca, dentro do escopo
 * da pessoa que confirmou.
 */
/** ADR-088: o nome que a máquina manda no pareamento (o hostname, editável depois como o de qualquer chave). */
function nomeDaMaquina(v: unknown): string {
  const nome = typeof v === "string" ? v.trim() : "";
  if (nome.length === 0 || nome.length > 60) throw new ErroDeDominio("entrada_invalida", { cause: "nome da máquina" });
  return nome;
}

/** ADR-088: a chave existe, é da pessoa do escopo e não foi revogada — só assim um bot pode ser preso a ela. */
async function exigirChaveViva(d: Deps, id: unknown): Promise<string> {
  if (typeof id !== "string") throw new ErroDeDominio("entrada_invalida", { cause: "máquina" });
  const viva = (await d.repos.maquinaTokens.listar()).find((c) => c.id === id && c.revogadaEm === null);
  if (!viva) throw new ErroDeDominio("nao_encontrado", { cause: "máquina" });
  return viva.id;
}

export function rotasMaquinas(deps: { dentro: DentroDeTx; pareamento: PareamentoMaquina; dispositivo: PareamentoDispositivo; maquinasVivas?: (escopo: Escopo) => MaquinaConectada[] }): Rota[] {
  return [
    {
      metodo: "POST",
      padrao: /^\/maquinas\/chaves$/,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { nome?: unknown };
        const r = await deps.dentro(ctx.escopo, (d) => executar(d, emitirChaveMaquina, { nome: corpo.nome }));
        ctx.json(201, r);
      },
    },
    {
      metodo: "GET",
      padrao: /^\/maquinas\/chaves$/,
      async handler(ctx) {
        ctx.json(200, { chaves: await deps.dentro(ctx.escopo, (d) => d.repos.maquinaTokens.listar()) });
      },
    },
    {
      metodo: "DELETE",
      padrao: /^\/maquinas\/chaves\/(?<id>[^/]+)$/,
      async handler(ctx) {
        ctx.json(200, await deps.dentro(ctx.escopo, (d) => executar(d, revogarChaveMaquina, { id: ctx.params.id ?? "" })));
      },
    },
    {
      metodo: "POST",
      padrao: /^\/maquinas\/pareamentos$/,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { nome?: unknown; desafio?: unknown };
        const nome = typeof corpo.nome === "string" ? corpo.nome.trim() : "";
        if (nome.length === 0 || nome.length > 60 || typeof corpo.desafio !== "string") throw new ErroDeDominio("entrada_invalida", { cause: "pareamento" });
        let codigo: string;
        try { codigo = deps.pareamento.abrir({ escopo: ctx.escopo, nome, desafio: corpo.desafio }); }
        catch { throw new ErroDeDominio("entrada_invalida", { cause: "desafio do pareamento" }); }
        ctx.json(201, { codigo });
      },
    },
    {
      metodo: "POST",
      padrao: /^\/pareamento\/trocar$/,
      publica: true,
      async handler(ctx) {
        // Quem troca é o app, nunca uma página: sem isto, um site qualquer poderia tentar a troca no navegador da pessoa.
        if (ctx.req.headers.origin !== undefined) { ctx.json(403, { codigo: "nao_permitido" }); return; }
        const corpo = (await ctx.corpo()) as { codigo?: unknown; verificador?: unknown };
        const pedido = typeof corpo.codigo === "string" && typeof corpo.verificador === "string" ? deps.pareamento.trocar({ codigo: corpo.codigo, verificador: corpo.verificador }) : null;
        if (!pedido) { ctx.json(400, { codigo: "pareamento_invalido" }); return; }
        const r = await deps.dentro(pedido.escopo, (d) => executar(d, emitirChaveMaquina, { nome: pedido.nome }));
        ctx.json(201, { chave: r.chave });
      },
    },
    // ── ADR-088: pareamento por código (máquina sem navegador) ──────────────────────────────────────────────────────
    {
      metodo: "POST",
      padrao: /^\/pareamento\/dispositivo$/,
      publica: true,
      async handler(ctx) {
        // Quem pede é o motor, nunca uma página (como pareamento/trocar).
        if (ctx.req.headers.origin !== undefined) { ctx.json(403, { codigo: "nao_permitido" }); return; }
        const corpo = (await ctx.corpo()) as { nome?: unknown; plataforma?: unknown };
        const plataforma = lerPlataforma(corpo.plataforma);
        if (!plataforma) throw new ErroDeDominio("entrada_invalida", { cause: "plataforma" });
        ctx.json(201, deps.dispositivo.pedir({ nome: nomeDaMaquina(corpo.nome), plataforma }));
      },
    },
    {
      metodo: "POST",
      padrao: /^\/pareamento\/dispositivo\/trocar$/,
      publica: true,
      async handler(ctx) {
        if (ctx.req.headers.origin !== undefined) { ctx.json(403, { codigo: "nao_permitido" }); return; }
        const corpo = (await ctx.corpo()) as { codigoDispositivo?: unknown };
        const r = typeof corpo.codigoDispositivo === "string" ? deps.dispositivo.trocar({ codigoDispositivo: corpo.codigoDispositivo }) : { estado: "invalido" as const };
        if (r.estado === "pendente") { ctx.json(202, { estado: "pendente" }); return; }
        if (r.estado === "invalido") { ctx.json(400, { codigo: "pareamento_invalido" }); return; }
        const emitida = await deps.dentro(r.escopo, (d) => executar(d, emitirChaveMaquina, { nome: r.nome }));
        log("info", "maquina_pareada_por_codigo", { pessoa_id: r.escopo.pessoaId, chave_id: emitida.dados.id });
        ctx.json(201, { chave: emitida.chave, machineId: emitida.dados.id });
      },
    },
    {
      metodo: "GET",
      padrao: /^\/maquinas\/dispositivos\/(?<codigo>[^/]+)$/,
      async handler(ctx) {
        const pedido = deps.dispositivo.ver({ codigoPessoa: decodeURIComponent(ctx.params.codigo ?? ""), escopo: ctx.escopo });
        if (!pedido) { ctx.json(404, { codigo: "pareamento_invalido" }); return; }
        ctx.json(200, pedido);
      },
    },
    {
      metodo: "POST",
      padrao: /^\/maquinas\/dispositivos\/(?<codigo>[^/]+)\/aprovar$/,
      async handler(ctx) {
        const ok = deps.dispositivo.aprovar({ codigoPessoa: decodeURIComponent(ctx.params.codigo ?? ""), escopo: ctx.escopo });
        if (!ok) { ctx.json(404, { codigo: "pareamento_invalido" }); return; }
        ctx.json(200, { ok: true });
      },
    },
    // ── ADR-088: as máquinas da pessoa e onde cada bot trabalha ──────────────────────────────────────────────────────
    {
      metodo: "GET",
      padrao: /^\/maquinas$/,
      async handler(ctx) {
        const { chaves, padraoId } = await deps.dentro(ctx.escopo, async (d) => ({ chaves: await d.repos.maquinaTokens.listar(), padraoId: (await d.repos.preferencias.buscar()).maquinaPadraoId ?? null }));
        const vivas = new Map((deps.maquinasVivas?.(ctx.escopo) ?? []).map((m) => [m.machineId, m]));
        const maquinas: MaquinaDto[] = chaves.filter((c) => c.revogadaEm === null).map((c) => {
          const viva = vivas.get(c.id);
          return { id: c.id, nome: viva?.nome ?? c.nome, prefixo: c.prefixo, criadaEm: c.criadaEm, ultimoUsoEm: c.ultimoUsoEm, conectada: !!viva, plataforma: viva?.plataforma ?? null, ias: viva?.ias ?? {}, gh: viva?.gh ?? false };
        });
        ctx.json(200, { maquinas, padraoId: maquinas.some((m) => m.id === padraoId) ? padraoId : null });
      },
    },
    {
      metodo: "PUT",
      padrao: /^\/maquinas\/padrao$/,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { maquinaId?: unknown };
        const r = await deps.dentro(ctx.escopo, async (d) => d.repos.preferencias.definirMaquinaPadrao(corpo.maquinaId === null ? null : await exigirChaveViva(d, corpo.maquinaId)));
        ctx.json(200, { padraoId: r.maquinaPadraoId ?? null });
      },
    },
    {
      metodo: "PUT",
      padrao: /^\/agentes\/(?<id>[^/]+)\/maquina$/,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { maquinaId?: unknown };
        const alterados = await deps.dentro(ctx.escopo, async (d) => d.repos.agentes.definirMaquina([ctx.params.id ?? ""], corpo.maquinaId === null ? null : await exigirChaveViva(d, corpo.maquinaId)));
        if (alterados.length === 0) throw new ErroDeDominio("nao_encontrado", { cause: "agente" });
        ctx.json(200, { agente: alterados[0] });
      },
    },
    {
      metodo: "PUT",
      padrao: /^\/maquinas\/(?<id>[^/]+)\/bots$/,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { agentes?: unknown };
        if (!Array.isArray(corpo.agentes) || corpo.agentes.length > 200 || !corpo.agentes.every((a) => typeof a === "string")) throw new ErroDeDominio("entrada_invalida", { cause: "agentes" });
        const ids = corpo.agentes as string[];
        const alterados = await deps.dentro(ctx.escopo, async (d) => d.repos.agentes.definirMaquina(ids, await exigirChaveViva(d, ctx.params.id)));
        ctx.json(200, { movidos: alterados.length });
      },
    },
    {
      metodo: "POST",
      padrao: /^\/conversas\/(?<id>[^/]+)\/rodar-desta-vez$/,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { maquinaId?: unknown };
        const n = await deps.dentro(ctx.escopo, async (d) => d.repos.turnos.rodarDestaVez(ctx.params.id ?? "", await exigirChaveViva(d, corpo.maquinaId)));
        log("info", "turno_rodar_desta_vez", { pessoa_id: ctx.escopo.pessoaId, conversa_id: ctx.params.id, turnos: n });
        ctx.json(200, { turnos: n });
      },
    },
  ];
}
