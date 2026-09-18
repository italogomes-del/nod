import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import type { ModoWorkspace } from "../../contracts/workspace.ts";
import { FERRAMENTAS_WORKSPACE } from "../../contracts/ferramentas-workspace.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import type { Escopo } from "../../shared/types.ts";
import type { Deps } from "../../use-cases/tipos.ts";
import { errosDoSchema, type ResultadoChamada } from "../../use-cases/chamar-ferramenta.ts";
import { criarPastas } from "../workspace/pastas.ts";
import { log } from "../../obs/log.ts";

type Dentro = <T>(e: Escopo, fn: (d: Deps) => Promise<T>) => Promise<T>;
/** definido em 2026-09-18: concessão local por conversa/pessoa; indisponível em servidor compartilhado. */
export function criarWorkspaces(o: { raiz: string; dentro: Dentro; machineId: string; imagem?: string }) {
  const pastas = criarPastas(o.raiz, o.imagem);
  const ocupados = new Set<string>();
  const revogando = new Set<string>();
  const cancelamentos = new Map<string, AbortController>();
  async function dono(e: Escopo, conversaId: string) {
    await o.dentro(e, async d => {
      const c = await d.repos.conversas.buscar(conversaId);
      if (!c || c.ownerId !== e.pessoaId || c.tipo !== "propria" || !c.agenteId) throw new ErroDeDominio("nao_encontrado");
      const a = await d.repos.agentes.buscar(c.agenteId);
      if (!a || a.ownerId !== e.pessoaId || a.excluidoEm) throw new ErroDeDominio("nao_encontrado");
    });
  }
  async function exclusivo<T>(e: Escopo, conversaId: string, fn: () => Promise<T>): Promise<T> {
    const k = `${e.tenantId}:${e.pessoaId}:${conversaId}`;
    if (ocupados.has(k) || revogando.has(k)) throw new ErroDeDominio("estado_invalido");
    ocupados.add(k);
    try { await dono(e, conversaId); return await fn(); } finally { ocupados.delete(k); }
  }
  return {
    async id(i: Escopo & { conversaId: string }) { return (await pastas.consultar(i))?.id ?? null; },
    async consultar(e: Escopo, conversaId: string) { await dono(e, conversaId); return pastas.consultar({ ...e, conversaId }); },
    async listar(e: Escopo, conversaId: string, caminho?: string) { await dono(e, conversaId); return pastas.listarPastas(caminho); },
    async escolher(e: Escopo, conversaId: string, pasta: string) {
      return exclusivo(e, conversaId, async () => {
        const v = await pastas.escolher({ ...e, conversaId }, pasta);
        log("info", "workspace_concedido", { tenant_id: e.tenantId, pessoa_id: e.pessoaId, conversa_id: conversaId, workspace_id: v.id });
        return v;
      });
    },
    async revogar(e: Escopo, conversaId: string) {
      await dono(e, conversaId);
      const k = `${e.tenantId}:${e.pessoaId}:${conversaId}`;
      if (revogando.has(k)) throw new ErroDeDominio("estado_invalido");
      revogando.add(k);
      try {
        cancelamentos.get(k)?.abort();
        while (ocupados.has(k)) await new Promise<void>(r => setTimeout(r, 25));
        await pastas.revogar({ ...e, conversaId });
        log("info", "workspace_revogado", { tenant_id: e.tenantId, pessoa_id: e.pessoaId, conversa_id: conversaId });
      } finally { revogando.delete(k); }
    },
    async chamar(e: Escopo, plano: PlanoTurno, nome: string, args: unknown): Promise<ResultadoChamada> {
      try {
        return await exclusivo(e, plano.conversaId, async () => {
          const schema = FERRAMENTAS_WORKSPACE[nome as keyof typeof FERRAMENTAS_WORKSPACE];
          if (!schema || errosDoSchema(schema, args).length || plano.tenantId !== e.tenantId || plano.autoria.conta_de_execucao !== e.pessoaId || plano.machineId !== o.machineId || !plano.catalogo.ferramentas.some(f => f.nome === nome && f.origem === "workspace")) throw new ErroDeDominio("nao_permitido");
          if (plano.politicaExecucao.efeitoExternoSoPorAprovacao && !["workspace_consultar", "workspace_arquivos", "workspace_ler_texto"].includes(nome)) throw new ErroDeDominio("nao_permitido");
          const conferir = () => o.dentro(e, async d => {
            const t = await d.repos.turnos.buscar(plano.turnoId);
            if (!t || t.agenteId !== plano.agenteId || t.conversaId !== plano.conversaId || t.ownerId !== e.pessoaId || t.pararSolicitadoEm || ["concluido", "interrompido"].includes(t.estado) || t.prazoEm <= d.agora() || plano.expiraEm <= d.agora() || await d.repos.agentes.execucaoBloqueada(t.id) || await d.repos.paradas.ativa(e.pessoaId, t.conversaId)) throw new ErroDeDominio("nao_permitido");
          });
          await conferir();
          const i = { ...e, conversaId: plano.conversaId };
          const v = await pastas.consultar(i);
          if (!v || v.id !== plano.workspaceId) return { ok: true, conteudo: JSON.stringify({ estado: "precisa_pasta", instrucao: "Use Pasta de trabalho na conversa para escolher a pasta; depois envie uma mensagem para continuar com o acesso atualizado." }), confianca: "confiavel" };
          const a = args as Record<string, unknown>;
          const controle = new AbortController();
          const k = `${e.tenantId}:${e.pessoaId}:${plano.conversaId}`;
          cancelamentos.set(k, controle);
          if (revogando.has(k)) controle.abort();
          let consultando = false;
          const timer = setInterval(() => {
            if (consultando) return;
            consultando = true;
            void conferir().catch(() => controle.abort()).finally(() => { consultando = false; });
          }, 500);
          let r: unknown;
          try {
            r = nome === "workspace_consultar" ? { pasta: v.pasta, ambiente: v.preparado, comandos: "Container isolado, sem rede; não usa serviços do Mac." } : nome === "workspace_preparar" ? await pastas.preparar(i, { modo: a.modo as ModoWorkspace, ...(typeof a.referencia === "string" ? { referencia: a.referencia } : {}) }) : await pastas.executar(i, nome, a, controle.signal);
          } finally { clearInterval(timer); cancelamentos.delete(k); }
          log("info", "workspace_acao", { tenant_id: e.tenantId, pessoa_id: e.pessoaId, turno_id: plano.turnoId, workspace_id: v.id, ferramenta: nome });
          return { ok: true, isError: typeof r === "object" && r !== null && "codigoSaida" in r && r.codigoSaida !== 0, conteudo: JSON.stringify(r), confianca: "nao_confiavel" };
        });
      } catch { return { ok: true, isError: true, conteudo: JSON.stringify({ erro: "workspace_indisponivel", instrucao: "A operação não foi confirmada. Confira acesso, caminho e revisão; não afirme que executou. Não procure configurações de ferramentas." }), confianca: "confiavel" }; }
    },
  };
}
export type Workspaces = ReturnType<typeof criarWorkspaces>;
