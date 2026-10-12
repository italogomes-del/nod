import type { AnuncioMaquina, PastaParaLimpar, PonteInterna, TrechoVivo, VigiaVivo } from "../../contracts/ponte.ts";
import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import type { TarefaDoBot } from "../../contracts/turno.ts";
import { versaoAceita } from "../../domain/versao-app.ts";

export class FalhaPonte extends Error {
  /** `rota_ausente` (NOD-199): o servidor não conhece a rota (404) — só a chamada que pede `rota404` vê este código. */
  readonly codigo: "servidor_fora" | "chave_invalida" | "atualize_app" | "reconectar" | "resposta_invalida" | "rota_ausente";
  constructor(codigo: FalhaPonte["codigo"]) { super(codigo); this.codigo = codigo; }
}

/** definido em 2026-09-17: somente HTTPS; loopback HTTP só quando explicitamente habilitado em desenvolvimento. */
export function urlServidor(valor: unknown, desenvolvimento = false): string {
  if (typeof valor !== "string") throw new FalhaPonte("resposta_invalida");
  const u = new URL(valor);
  if (u.username || u.password || u.search || u.hash || u.pathname !== "/" || (u.protocol !== "https:" && !(desenvolvimento && u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)))) throw new FalhaPonte("resposta_invalida");
  return u.origin;
}

/**
 * ADR-088: o que veio do servidor tem a forma de `PastaParaLimpar` (o Mac ainda confere o caminho antes de apagar). Valor
 * de `quando` desconhecido (de um servidor mais novo) descarta o item, sem erro. ADR-099 (I5): `sem_trabalho` entra.
 */
function pastaParaLimparValida(v: unknown): v is PastaParaLimpar {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return typeof p.trabalhoId === "string" && typeof p.pasta === "string" && (p.quando === "encerrada" || p.quando === "so_com_pr_mergeado" || p.quando === "sem_trabalho");
}

/**
 * `aoLimparAgora` (ADR-099 item 9, definido em 2026-10-12, I5): a resposta do `entregar` trouxe a pasta da frente que
 * terminou com o turno (`limparAgora`, só `sem_trabalho`). Chamado fora da entrega (`setTimeout`), depois de o laço já ter
 * esquecido o turno: senão a limpeza veria a pasta ainda em uso.
 */
export function criarPonteHttp(o: { url: string; chave: string; versao: string; fetchImpl?: typeof fetch; aoFalhar?: (codigo: FalhaPonte["codigo"]) => void; aoLimparAgora?: (pastas: PastaParaLimpar[]) => void }) {
  const f = o.fetchImpl ?? fetch;
  let anuncio: AnuncioMaquina | null = null;
  /** Um buffer por turno: com o pool de laços, dois turnos renovam em paralelo e não podem trocar texto. */
  const trechos = new Map<string, TrechoVivo[]>();
  const ativos = new Set<AbortController>();
  /**
   * NOD-199: os turnos puxados e ainda não entregues (entregue ou abandonado). Com algum aqui, o anúncio de inventário
   * num servidor antigo NÃO cai no `conectar`, que recusaria ou limparia os planos do servidor.
   */
  const emAndamento = new Set<string>();
  /**
   * NOD-199: já houve um `conectar` aceito — daí em diante o anúncio vai sempre pela rota de inventário. Um 409 de outra
   * rota (o `conectar` recusado com turno rodando, um `puxar` concorrente) NÃO volta a mandar o anúncio pelo `conectar`:
   * se o servidor de fato esqueceu a máquina, a própria rota de inventário responde 409 e só então cai no `conectar`.
   */
  let conectado = false;
  async function chamar<T>(nome: string, corpo: unknown, opcoes: { rota404?: true } = {}): Promise<T> {
    const ctrl = new AbortController(); ativos.add(ctrl);
    const timer = setTimeout(() => ctrl.abort(), 35_000);
    try {
      const r = await f(`${o.url}/api/maquina/${nome}`, { method: "POST", headers: { authorization: `Bearer ${o.chave}`, "content-type": "application/json", "x-nod-versao": o.versao }, body: JSON.stringify(corpo), signal: ctrl.signal, redirect: "error" });
      const minima = r.headers.get("x-nod-versao-minima");
      if (r.status === 426 || (minima && !versaoAceita(o.versao, minima))) throw new FalhaPonte("atualize_app");
      if (r.status === 401 || r.status === 403) throw new FalhaPonte("chave_invalida");
      if (r.status === 409) throw new FalhaPonte("reconectar");
      if (r.status === 404 && opcoes.rota404) throw new FalhaPonte("rota_ausente");
      if (!r.ok) throw new FalhaPonte("servidor_fora");
      return await r.json() as T;
    } catch (e) {
      const erro = e instanceof FalhaPonte ? e : new FalhaPonte("servidor_fora");
      // O 404 da rota nova num servidor antigo não é falha de conexão: quem pediu decide (nada de aviso na tela).
      if (erro.codigo !== "rota_ausente") o.aoFalhar?.(erro.codigo);
      throw erro;
    } finally { clearTimeout(timer); ativos.delete(ctrl); }
  }
  const ponte: PonteInterna & Required<Pick<PonteInterna, "anunciarInventario">> = {
    async conectar(m) { anuncio = m; await chamar("conectar", m); conectado = true; },
    /**
     * NOD-199: o anúncio da vigia. Antes do primeiro `conectar` aceito vai pelo `conectar`; o 409 da rota de inventário
     * (servidor sem esta conexão) também cai nele, que é a recuperação. Conectado, vai pela rota só de inventário e guarda o anúncio, para um `reconectar` depois não
     * reanunciar o inventário velho. Servidor antigo (404): cai no `conectar` só sem turno em andamento; com turno, lança
     * e a vigia tenta de novo na próxima passada.
     */
    async anunciarInventario(m) {
      if (!conectado) { await ponte.conectar(m); return; }
      anuncio = m;
      try { await chamar("inventario", m, { rota404: true }); }
      catch (e) {
        if (!(e instanceof FalhaPonte)) throw e;
        if (e.codigo === "reconectar") { await ponte.conectar(m); return; }
        if (e.codigo === "rota_ausente" && emAndamento.size === 0) { await ponte.conectar(m); return; }
        throw e;
      }
    },
    async puxar(_pessoaId, maquina) {
      try {
        const plano = (await chamar<{ plano: PlanoTurno | null }>("puxar", maquina ? { memoria: maquina } : {})).plano;
        if (plano) emAndamento.add(plano.turnoId);
        return plano;
      }
      catch (e) {
        if (e instanceof FalhaPonte && e.codigo === "reconectar" && anuncio) await ponte.conectar(anuncio);
        throw e;
      }
    },
    async renovar(p) {
      const enviar = trechos.get(p.turnoId) ?? []; trechos.delete(p.turnoId);
      try { return await chamar("renovar", { ...p, trechos: enviar }); }
      catch { return { ativo: false, versaoMinimaApp: o.versao }; }
    },
    async entregar(e) {
      trechos.delete(e.turnoId);
      try {
        for (let tentativa = 0; ; tentativa++) {
          try {
            const r = await chamar<{ limparAgora?: unknown } | null>("entregar", e);
            const limpar = Array.isArray(r?.limparAgora) ? r.limparAgora.filter(pastaParaLimparValida).filter((p) => p.quando === "sem_trabalho") : [];
            if (limpar.length > 0 && o.aoLimparAgora) { const aviso = o.aoLimparAgora; setTimeout(() => { try { aviso(limpar); } catch { /* a passada de 6 h pega a pasta */ } }, 0); }
            return;
          }
          catch (erro) {
            if (!(erro instanceof FalhaPonte) || erro.codigo !== "servidor_fora" || tentativa >= 2) throw erro;
            await new Promise((r) => setTimeout(r, 1_000));
          }
        }
      } finally { emAndamento.delete(e.turnoId); } // entregue ou abandonado: o turno deixou de rodar neste Mac.
    },
    async desconectar() { await chamar("desconectar", {}); },
    /** ADR-088: servidor antigo (404) ou fora do ar devolve lista vazia — a próxima passada tenta de novo. */
    async pastasParaLimpar(_pessoaId, op) {
      try {
        const r = await chamar<{ pastas?: unknown }>("limpeza", op?.apertado === true ? { apertado: true } : {});
        return Array.isArray(r.pastas) ? r.pastas.filter(pastaParaLimparValida) : [];
      } catch {
        return [];
      }
    },
    async relatarLimpeza(_pessoaId, relato) { await chamar("limpeza/resultado", { relato }).catch(() => undefined); },
  };
  /** Teto de 16k de texto por renovação (o mesmo da rota): descarta os trechos mais antigos do turno. */
  function aparar(turnoId: string) {
    let fila = trechos.get(turnoId) ?? [];
    let total = fila.reduce((n, t) => n + ("texto" in t ? t.texto.length : 0), 0);
    while (total > 16_000 && fila.length > 0) {
      const t = fila[0]!;
      if ("texto" in t && total - t.texto.length < 16_000) { fila[0] = { texto: t.texto.slice(total - 16_000) }; break; }
      total -= "texto" in t ? t.texto.length : 0;
      fila.shift();
    }
    if (fila.length > 2_000) fila = fila.slice(-2_000);
    trechos.set(turnoId, fila);
  }
  return {
    ponte,
    /**
     * ADR-048: os itens aprovados que rodam no gh DESTE Mac. A máquina puxa (o servidor nunca disca,
     * ADR-021), executa e relata; falha de rede devolve lista vazia e a próxima volta tenta de novo.
     */
    async itensLocais(): Promise<{ itemId: string; capacidade: string; argumentos: Record<string, unknown> }[]> {
      try {
        const r = await chamar<{ itens?: unknown }>("itens-locais", {});
        return Array.isArray(r.itens) ? (r.itens as { itemId: string; capacidade: string; argumentos: Record<string, unknown> }[]) : [];
      } catch {
        return [];
      }
    },
    async resultadoItemLocal(itemId: string, desfecho: "executado" | "falhou_na_execucao"): Promise<void> {
      await chamar("itens-locais/resultado", { itemId, desfecho });
    },
    delta(turnoId: string, texto: string) {
      const fila = trechos.get(turnoId) ?? [];
      const ultimo = fila[fila.length - 1];
      if (ultimo && "texto" in ultimo) fila[fila.length - 1] = { texto: ultimo.texto + texto };
      else fila.push({ texto });
      trechos.set(turnoId, fila);
      aparar(turnoId);
    },
    ferramenta(turnoId: string, nome: string) { trechos.set(turnoId, [...(trechos.get(turnoId) ?? []), { ferramenta: nome }]); aparar(turnoId); },
    /** A lista inteira substitui a que ainda não saiu: só a mais nova importa. */
    tarefas(turnoId: string, lista: TarefaDoBot[]) { trechos.set(turnoId, [...(trechos.get(turnoId) ?? []).filter((t) => !("tarefas" in t)), { tarefas: lista }]); aparar(turnoId); },
    /** O vigia do turno (NOD-73): como as tarefas, o aviso mais novo substitui o que ainda não saiu — só ele importa. */
    vigia(turnoId: string, aviso: VigiaVivo) { trechos.set(turnoId, [...(trechos.get(turnoId) ?? []).filter((t) => !("vigia" in t)), { vigia: aviso }]); aparar(turnoId); },
    cancelar() { for (const c of ativos) c.abort(); },
  };
}
