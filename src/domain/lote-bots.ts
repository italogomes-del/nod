import type { Agente, ModoAprovacao } from "../contracts/agente.ts";
import type { MotivoCardDoLote } from "../contracts/conversa.ts";
import type { AcaoLote, AppConectado, TipoAcaoLote } from "../contracts/ferramentas-do-nod.ts";
import { MAX_ACOES_LOTE } from "../contracts/ferramentas-do-nod.ts";
import { decidirPeloModo } from "./modo-aprovacao.ts";
import { ehNod, nomeReservadoAoNod } from "./nod.ts";

/**
 * O lote do Nod, puro (definido em 2026-10-07, ADR-082): validar TUDO antes de fazer qualquer coisa, resolver os bots
 * alvo (id, nome exato ou "@ref" de uma ação anterior), classificar o risco de cada ação e deixar o modo decidir o que
 * roda agora e o que espera a pessoa. Quem executa é o caso de uso (gerir-bots.ts).
 *
 * Arriscado, no lote: excluir e mudar o modo de outro bot sempre; dar acesso a um app, e duplicar um bot que tem acessos
 * (a cópia os leva), depois de conteúdo de fora no turno — a cerca 3. O Nod NÃO usa o alívio de `conversaComAPessoa`:
 * pedir na conversa não tira o risco de excluir (decisão do Marlon no /spec de 2026-10-07).
 */

/** O que o lote enxerga de um bot da pessoa. */
export type BotDoLote = Pick<Agente, "id" | "nome" | "ownerId" | "dono" | "papel" | "excluidoEm">;

/** Uma ação já validada: o alvo resolvido (um bot existente, ou o índice da ação que cria o bot). */
export type AcaoResolvida = AcaoLote & {
  i: number;
  /** O bot existente em que a ação roda; null em criar e quando o alvo é "@ref". */
  alvoId: string | null;
  /** O índice da ação (criar/duplicar) que produz o alvo, quando o alvo é "@ref". */
  alvoDaAcao: number | null;
  /** O nome que o card mostra: o do bot alvo, ou o do bot que vai nascer. */
  alvoNome: string;
};

export type Problema = { i: number; motivo: string };

const PRECISA_DE_BOT: ReadonlySet<TipoAcaoLote> = new Set(["duplicar", "editar", "mover", "excluir", "criar_rotina", "dar_acesso", "mudar_modo"]);
const CRIA_BOT: ReadonlySet<TipoAcaoLote> = new Set(["criar", "duplicar"]);

function vazio(v: string | undefined): boolean {
  return v === undefined || v.trim() === "";
}

/**
 * Valida o lote inteiro e resolve os alvos. Qualquer problema devolve TODOS os problemas e nada roda (o Nod corrige e
 * chama de novo). `bots` são os bots da pessoa que o lote pode tocar (já filtrados por dona; excluídos e o Nod entram
 * para a mensagem de erro dizer por quê); `apps`, os que ela conectou.
 */
export function validarLote(acoes: readonly AcaoLote[], bots: readonly BotDoLote[], apps: readonly AppConectado[], pessoaId: string): { ok: true; acoes: AcaoResolvida[] } | { ok: false; problemas: Problema[] } {
  const problemas: Problema[] = [];
  if (acoes.length === 0) problemas.push({ i: -1, motivo: "nenhuma ação" });
  if (acoes.length > MAX_ACOES_LOTE) problemas.push({ i: -1, motivo: `no máximo ${MAX_ACOES_LOTE} ações por pedido; divida em partes` });
  const refs = new Map<string, number>();
  const resolvidas: AcaoResolvida[] = [];

  acoes.forEach((a, i) => {
    const erro = (motivo: string) => problemas.push({ i, motivo });
    let alvoId: string | null = null;
    let alvoDaAcao: number | null = null;
    let alvoNome = "";

    if (a.ref !== undefined) {
      if (!CRIA_BOT.has(a.tipo)) erro("ref só vale em criar e duplicar");
      else if (refs.has(a.ref)) erro(`ref "${a.ref}" repetido`);
      else refs.set(a.ref, i);
    }

    if (PRECISA_DE_BOT.has(a.tipo)) {
      const alvo = (a.bot ?? "").trim();
      if (alvo === "") erro(`${a.tipo} precisa do bot alvo`);
      else if (alvo.startsWith("@")) {
        const origem = refs.get(alvo.slice(1));
        // A própria ação registrou o ref acima: um "@ref" que aponta para si mesmo não é anterior.
        if (origem === undefined || origem === i) erro(`"${alvo}" não é o ref de uma ação anterior`);
        else {
          alvoDaAcao = origem;
          alvoNome = resolvidas[origem]?.tipo === "criar" ? acoes[origem]?.nome ?? alvo : `${resolvidas[origem]?.alvoNome ?? alvo} (cópia)`;
        }
      } else {
        const r = resolverBot(alvo, bots, pessoaId);
        if ("motivo" in r) erro(r.motivo);
        else { alvoId = r.bot.id; alvoNome = r.bot.nome; }
      }
      if (alvoDaAcao !== null && a.tipo === "duplicar") erro("duplicar precisa de um bot que já existe");
    } else if (a.bot !== undefined) erro(`${a.tipo} não leva bot`);

    switch (a.tipo) {
      case "criar":
        if (vazio(a.nome)) erro("criar precisa do nome");
        else if (nomeReservadoAoNod(a.nome ?? "")) erro("o nome Nod é do bot fixo");
        if (vazio(a.descricao)) erro("criar precisa da descrição do que o bot faz");
        alvoNome = (a.nome ?? "").trim();
        break;
      case "editar":
        if ([a.nome, a.titulo, a.descricao, a.modelo, a.esforco].every((v) => v === undefined)) erro("editar sem nada para mudar");
        if (a.nome !== undefined && (vazio(a.nome) || nomeReservadoAoNod(a.nome))) erro(vazio(a.nome) ? "nome vazio" : "o nome Nod é do bot fixo");
        break;
      case "mover":
        if (a.secao === undefined) erro("mover precisa da seção (\"\" tira da seção)");
        break;
      case "criar_rotina":
        if (vazio(a.cron) || vazio(a.fuso_iana) || vazio(a.instrucao)) erro("criar_rotina precisa de cron, fuso_iana e instrucao");
        break;
      case "dar_acesso": {
        const app = apps.find((x) => x.slug === a.app);
        if (vazio(a.app) || !a.nivel) erro("dar_acesso precisa do app e do nível");
        else if (!app) erro(`o app "${a.app}" não está conectado: a pessoa conecta no Marketplace`);
        else if (!app.niveis.includes(a.nivel)) erro(`o app "${a.app}" não tem ferramentas de ${a.nivel}`);
        break;
      }
      case "mudar_modo":
        if (!a.modo) erro("mudar_modo precisa do modo");
        break;
      default:
        break;
    }
    resolvidas.push({ ...a, i, alvoId, alvoDaAcao, alvoNome });
  });

  return problemas.length ? { ok: false, problemas } : { ok: true, acoes: resolvidas };
}

/** Um bot da pessoa por id ou nome exato (sem diferenciar maiúsculas); o motivo diz por que não serve. */
export function resolverBot(alvo: string, bots: readonly BotDoLote[], pessoaId: string): { bot: BotDoLote } | { motivo: string } {
  const porId = bots.find((b) => b.id === alvo);
  const candidatos = porId ? [porId] : bots.filter((b) => b.nome.trim().toLowerCase() === alvo.trim().toLowerCase() && b.excluidoEm === null);
  if (candidatos.length === 0) return { motivo: `não achei o bot "${alvo}" entre os seus` };
  if (candidatos.length > 1) return { motivo: `há mais de um bot chamado "${alvo}": use o id (ver_colegas)` };
  const bot = candidatos[0]!;
  if (ehNod(bot)) return { motivo: "o Nod não mexe em si mesmo" };
  if (bot.ownerId !== pessoaId || bot.dono !== "pessoa") return { motivo: `"${bot.nome}" não é um bot seu` };
  if (bot.excluidoEm !== null) return { motivo: `"${bot.nome}" foi excluído` };
  return { bot };
}

/** O risco de uma ação no lote; null = não é arriscada. */
export function riscoDaAcao(a: Pick<AcaoLote, "tipo">, s: { contaminado: boolean; alvoTemAcessos: boolean }): MotivoCardDoLote | null {
  if (a.tipo === "excluir" || a.tipo === "mudar_modo") return "arriscada";
  if (s.contaminado && (a.tipo === "dar_acesso" || (a.tipo === "duplicar" && s.alvoTemAcessos))) return "conteudo_de_fora";
  return null;
}

/**
 * O que roda agora e o que espera a pessoa, pelo modo do Nod. Uma ação cujo alvo é o bot que outra ação (que espera)
 * vai criar também espera: ela só pode rodar depois. Devolve, por ação, `null` (roda agora) ou o motivo do card.
 */
export function decidirLote(acoes: readonly AcaoResolvida[], modo: ModoAprovacao | undefined, riscos: readonly (MotivoCardDoLote | null)[]): (MotivoCardDoLote | null)[] {
  const espera: (MotivoCardDoLote | null)[] = [];
  for (const a of acoes) {
    const risco = riscos[a.i] ?? null;
    const d = decidirPeloModo(modo, { arriscada: risco !== null, credencial: false });
    let motivo: MotivoCardDoLote | null = d?.automatico ? null : (risco ?? "manual");
    if (motivo === null && a.alvoDaAcao !== null && espera[a.alvoDaAcao] !== null) motivo = espera[a.alvoDaAcao] ?? "manual";
    espera.push(motivo);
  }
  return espera;
}
