import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import type { ContaAnunciada, EstadoContaNaMaquina } from "../src/contracts/contas-ia.ts";
import { IAS_DESKTOP, type IaDesktop } from "../src/contracts/desktop.ts";
import { CONTAS_POR_IA_MAX, ID_CONTA_PADRAO, contaCorporativa, apelidoValido } from "../src/domain/contas-da-ia.ts";
import { textoDaImpressaoDaConta } from "../src/domain/contas-da-pessoa.ts";
import { ambienteDaConta, novoIdDeConta, pastaDaConta, prepararPastaDaConta, removerPastaDaConta, VARIAVEL_DA_CONTA } from "./contas-mac.ts";

/**
 * As contas de IA logadas NESTA máquina (definido em 2026-10-13, ADR-102), sem Electron: o motor da VM usa, e o app do
 * Mac pode usar. Uma pasta por conta (CLAUDE_CONFIG_DIR/CODEX_HOME, ADR-101, contas-mac.ts); a conta de sempre ("padrao")
 * é a pasta padrão (~/.claude, ~/.codex). Quem diz qual conta está em cada pasta é o CLI (`claude auth status`, o
 * `account/read` do Codex): o e-mail e a organização viram a impressão (sha256 com a pessoa) e nunca saem da máquina
 * (ADR-019). O que vai ao servidor é `anuncio()`.
 *
 * R11 da revisão: a identidade é lida depois de um login ou logout e, fora isso, no máximo a cada 10 min por conta.
 */
export type ContaLocal = {
  id: string;
  ia: IaDesktop;
  /** O apelido que a pessoa deu ao pedir a conta (vai como sugestão no anúncio da conta nova). */
  apelido: string | null;
  /** Quando a pasta ganhou o login atual (R4: conta removida só volta com login mais novo que a remoção). */
  logadaEm: number;
  /** A impressão da última conta lida nesta pasta; null = nunca logou. */
  impressao: string | null;
  plano: string | null;
  estado: EstadoContaNaMaquina;
  lidaEm: number;
};

export type IdentidadeDaConta = { logado: boolean; email: string | null; orgId: string | null; plano: string | null };

export type DepsContasLocais = {
  /** A pasta onde ficam as pastas das contas (`<base>/contas/<ia>/<id>`). */
  base: string;
  arquivo: string;
  pessoaId: string;
  /** O diretório padrão da IA (~/.claude, ~/.codex): a conta "padrao" e o alvo dos symlinks do Claude. */
  padrao(ia: IaDesktop): string;
  /** O CLI diz quem está logado com este ambiente; undefined = não respondeu (prazo, erro). */
  lerIdentidade(ia: IaDesktop, env: Record<string, string>): Promise<IdentidadeDaConta | undefined>;
  /** `claude auth logout` / `codex logout` com o ambiente da conta. */
  logout(ia: IaDesktop, env: Record<string, string>): Promise<boolean>;
  agora(): number;
};

/** definido em 2026-10-13 (R11): sem login/logout, a identidade de cada conta é relida no máximo a cada 10 min. */
export const RELEITURA_DA_CONTA_MS = 10 * 60_000;

export type ContasLocais = ReturnType<typeof criarContasLocais>;

export function criarContasLocais(d: DepsContasLocais) {
  let contas: ContaLocal[] = [];

  const padraoDe = (ia: IaDesktop): ContaLocal => ({ id: ID_CONTA_PADRAO, ia, apelido: null, logadaEm: 0, impressao: null, plano: null, estado: "sem_login", lidaEm: 0 });

  async function gravar(): Promise<void> {
    const tmp = `${d.arquivo}.tmp`;
    await writeFile(tmp, `${JSON.stringify({ versao: 1, contas })}\n`, { mode: 0o600 });
    await rename(tmp, d.arquivo);
  }

  function ambiente(c: Pick<ContaLocal, "ia" | "id">): Record<string, string> {
    return ambienteDaConta(d.base, c.ia, c.id);
  }

  async function lerUma(c: ContaLocal): Promise<boolean> {
    const id = await d.lerIdentidade(c.ia, ambiente(c)).catch(() => undefined);
    c.lidaEm = d.agora();
    if (id === undefined) return false;
    const antes = `${c.impressao}|${c.estado}|${c.plano}`;
    if (id.logado && id.email) {
      const impressao = createHash("sha256").update(textoDaImpressaoDaConta({ pessoaId: d.pessoaId, ia: c.ia, email: id.email, orgId: id.orgId })).digest("hex");
      if (impressao !== c.impressao) c.logadaEm = d.agora();
      c.impressao = impressao;
      c.plano = id.plano;
      c.estado = "pronta";
    } else {
      c.estado = "sem_login";
    }
    return antes !== `${c.impressao}|${c.estado}|${c.plano}`;
  }

  return {
    async carregar(): Promise<void> {
      const texto = await readFile(d.arquivo, "utf8").catch(() => null);
      const lidas: ContaLocal[] = [];
      try {
        const bruto = texto ? (JSON.parse(texto) as { contas?: unknown }).contas : [];
        for (const x of Array.isArray(bruto) ? bruto : []) {
          const o = x as Partial<ContaLocal>;
          if (typeof o.id !== "string" || !IAS_DESKTOP.includes(o.ia as IaDesktop)) continue;
          if (o.id !== ID_CONTA_PADRAO && !pastaDaConta(d.base, o.ia as IaDesktop, o.id)) continue;
          lidas.push({ id: o.id, ia: o.ia as IaDesktop, apelido: apelidoValido(o.apelido) ?? null, logadaEm: Number(o.logadaEm) || 0, impressao: typeof o.impressao === "string" ? o.impressao : null, plano: typeof o.plano === "string" ? o.plano : null, estado: o.estado === "pronta" ? "pronta" : "sem_login", lidaEm: 0 });
        }
      } catch { /* arquivo quebrado: recomeça com as contas de sempre */ }
      contas = lidas;
      for (const ia of IAS_DESKTOP) if (!contas.some((c) => c.ia === ia && c.id === ID_CONTA_PADRAO)) contas.unshift(padraoDe(ia));
    },

    listar: (): readonly ContaLocal[] => contas,
    ambiente,
    porImpressao: (impressao: string): ContaLocal | null => contas.find((c) => c.impressao === impressao) ?? null,
    porId: (id: string, ia: IaDesktop): ContaLocal | null => contas.find((c) => c.id === id && c.ia === ia) ?? null,

    /**
     * A pasta para um login novo: a conta de sempre se ela ainda não tem login nesta máquina; senão uma pasta nova (até
     * CONTAS_POR_IA_MAX por IA). null = cheio.
     */
    async pastaParaLogin(ia: IaDesktop, apelido: string | null): Promise<ContaLocal | null> {
      const padrao = contas.find((c) => c.ia === ia && c.id === ID_CONTA_PADRAO);
      if (padrao && padrao.impressao === null && padrao.estado !== "pronta") {
        padrao.apelido = apelido;
        return padrao;
      }
      if (contas.filter((c) => c.ia === ia).length >= CONTAS_POR_IA_MAX) return null;
      const nova: ContaLocal = { id: novoIdDeConta(), ia, apelido, logadaEm: 0, impressao: null, plano: null, estado: "sem_login", lidaEm: 0 };
      await prepararPastaDaConta({ base: d.base, ia, id: nova.id, padrao: d.padrao(ia) });
      contas.push(nova);
      await gravar();
      return nova;
    },

    /** Relê a identidade (todas, ou só as vencidas). true = algo mudou (o motor reanuncia). */
    async ler(o: { forcar?: boolean; id?: string } = {}): Promise<boolean> {
      let mudou = false;
      for (const c of contas) {
        if (o.id !== undefined && c.id !== o.id) continue;
        if (!o.forcar && d.agora() - c.lidaEm < RELEITURA_DA_CONTA_MS) continue;
        if (await lerUma(c)) mudou = true;
      }
      if (mudou) await gravar();
      return mudou;
    },

    /** O login novo numa pasta falhou ou foi cancelado: a pasta vazia sai (a conta de sempre fica). */
    async descartar(c: ContaLocal): Promise<void> {
      if (c.impressao !== null || c.id === ID_CONTA_PADRAO) return;
      await removerPastaDaConta({ base: d.base, ia: c.ia, id: c.id, logout: async () => true }).catch(() => undefined);
      contas = contas.filter((x) => x !== c);
      await gravar();
    },

    /**
     * A pessoa entrou de novo numa conta que já estava noutra pasta desta máquina: a pasta repetida sai SEM logout (o
     * logout poderia derrubar a sessão da mesma conta na outra pasta). A conta de sempre nunca sai.
     */
    async descartarRepetidas(): Promise<number> {
      const vistas = new Set<string>();
      const repetidas: ContaLocal[] = [];
      for (const c of [...contas].sort((a, b) => (a.id === ID_CONTA_PADRAO ? -1 : b.id === ID_CONTA_PADRAO ? 1 : a.logadaEm - b.logadaEm))) {
        if (!c.impressao) continue;
        const chave = `${c.ia}:${c.impressao}`;
        if (vistas.has(chave) && c.id !== ID_CONTA_PADRAO) repetidas.push(c);
        vistas.add(chave);
      }
      for (const c of repetidas) await removerPastaDaConta({ base: d.base, ia: c.ia, id: c.id, logout: async () => true }).catch(() => undefined);
      if (repetidas.length > 0) {
        contas = contas.filter((c) => !repetidas.includes(c));
        await gravar();
      }
      return repetidas.length;
    },

    /**
     * Sair de uma conta nesta máquina (pedido da tela): logout com a variável dela e, fora a conta de sempre, a pasta sai.
     * false = a máquina não tem essa conta (nada a fazer: o servidor apaga o vínculo do mesmo jeito).
     */
    async sair(impressao: string): Promise<boolean> {
      const c = contas.find((x) => x.impressao === impressao);
      if (!c) return false;
      if (c.id === ID_CONTA_PADRAO) {
        await d.logout(c.ia, {}).catch(() => false);
        Object.assign(c, { impressao: null, plano: null, estado: "sem_login", logadaEm: 0, apelido: null });
      } else {
        await removerPastaDaConta({ base: d.base, ia: c.ia, id: c.id, logout: (env) => d.logout(c.ia, env) });
        contas = contas.filter((x) => x !== c);
      }
      await gravar();
      return true;
    },

    /** O que vai ao servidor: as contas com impressão (a que perdeu o login vai como `sem_login`). */
    anuncio(): ContaAnunciada[] {
      return contas.filter((c) => c.impressao !== null).map((c) => ({
        impressao: c.impressao!,
        ia: c.ia,
        estado: c.estado,
        plano: c.plano,
        corporativa: contaCorporativa({ id: c.id, plano: c.plano?.toLowerCase() ?? null }),
        logadaEm: c.logadaEm,
        ...(c.apelido ? { apelidoSugerido: c.apelido } : {}),
      }));
    },

    variavel: (ia: IaDesktop) => VARIAVEL_DA_CONTA[ia],
  };
}
