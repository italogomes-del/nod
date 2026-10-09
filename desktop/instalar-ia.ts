import { stripVTControlCharacters } from "node:util";
import type { IaDesktop } from "../src/contracts/desktop.ts";
import type { CausaFalhaInstalacao, InstalacaoDaIa } from "../src/contracts/estado-ia.ts";
import { conferirPisoCli, extrairVersao } from "../src/adapters/executor/flag-floors.ts";
import { faltaNode } from "../src/domain/saida-do-cli.ts";

/**
 * Instalar a IA com um clique (definido em 2026-10-09, plano "IAs", PR 1): `npm install --global --prefix
 * <userData>/ferramentas <pacote oficial>`, sem sudo, sem shell e sem depender do Node do Mac.
 *
 * Decisão (medida em 2026-10-09): o app leva o próprio npm (devDependency `npm`, versão exata, copiada para
 * Contents/Resources/npm pelo electron-builder) e o roda com o Node do Electron (`ELECTRON_RUN_AS_NODE=1` — o mesmo
 * caminho do proxy MCP). Os scripts de instalação dos pacotes (o `node install.cjs` do Claude Code) acham `node` pelo
 * "node do nod": um script de 2 linhas em <ferramentas>/node-do-nod/node que chama o Electron como node. Medido com o
 * Electron 43.7.1 (Node 24.21.0) e o npm 11.17.0, num PATH sem node: o @openai/codex 0.162.1 e o
 * @anthropic-ai/claude-code 2.1.296 instalaram e responderam ao `--version`.
 *
 * Partes puras aqui (testadas em tests/unit/desktop/instalar-ia.test.ts); quem roda o processo e grava o registro é
 * o desktop/main.ts.
 */

/** Os pacotes oficiais no npm (conferidos em 2026-10-09: `npm view`), e o binário que cada um põe em <prefixo>/bin. */
export const PACOTE_DA_IA: Record<IaDesktop, { pacote: string; binario: "claude" | "codex"; nome: string }> = {
  "codex-cli": { pacote: "@openai/codex", binario: "codex", nome: "Codex" },
  "claude-cli": { pacote: "@anthropic-ai/claude-code", binario: "claude", nome: "Claude Code" },
};

/** definido em 2026-10-09: 3 tentativas no total, só para falha passageira de rede; espera 2 s e depois 5 s. */
export const TENTATIVAS_INSTALACAO = 3;
export const ESPERAS_ENTRE_TENTATIVAS_MS = [2_000, 5_000] as const;
/** Tamanho máximo da linha de progresso que vai à tela. */
const LINHA_MAX = 160;

/**
 * Os argumentos do npm. `@latest`: sem teto de versão (ADR-014/NOD-171: o piso é o testado; a verificação no fim
 * confere o piso). `--cache` numa pasta do nod: um ~/.npm com dono root (de um `sudo npm` antigo) não derruba a
 * instalação. `--allow-scripts` só no Claude Code, cujo `install.cjs` põe o binário nativo no lugar (o npm 11 avisa
 * que ia rodar sem permissão explícita).
 */
export function argsNpm(ia: IaDesktop, prefixo: string, cache: string): string[] {
  const { pacote } = PACOTE_DA_IA[ia];
  return [
    "install", "--global", "--prefix", prefixo, "--cache", cache,
    "--no-fund", "--no-audit", "--no-update-notifier", "--loglevel=http",
    ...(ia === "claude-cli" ? [`--allow-scripts=${pacote}`] : []),
    `${pacote}@latest`,
  ];
}

/**
 * O ambiente do npm: o mesmo limpo dos drivers, sem `npm_config_*` herdado (o app aberto de um `npm run` levaria o
 * prefixo de outro projeto), sem NODE_OPTIONS, e com o Electron como node.
 */
export function ambienteDoNpm(env: Readonly<Record<string, string>>, path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (/^npm_/i.test(k) || k === "NODE_OPTIONS" || k === "ELECTRON_RUN_AS_NODE") continue;
    out[k] = v;
  }
  return { ...out, PATH: path, ELECTRON_RUN_AS_NODE: "1", npm_config_update_notifier: "false" };
}

/** O "node do nod": o Electron como node, para o `#!/usr/bin/env node` e os scripts do npm num Mac sem Node. */
export function scriptNodeDoNod(execPath: string): string {
  const aspas = `'${execPath.replace(/'/g, "'\\''")}'`;
  return `#!/bin/sh\n# Gerado pelo app do nod: o Electron do app como node (ELECTRON_RUN_AS_NODE).\nELECTRON_RUN_AS_NODE=1 exec ${aspas} "$@"\n`;
}

/** A linha que vai à tela: sem cor, sem espaço sobrando, cortada. Vazia = não muda a linha anterior. */
export function linhaDoProgresso(texto: string): string | null {
  const linhas = stripVTControlCharacters(texto).split(/\r?\n|\r/).map((l) => l.trim()).filter((l) => l !== "");
  const ultima = linhas.at(-1);
  if (!ultima) return null;
  return ultima.length > LINHA_MAX ? `${ultima.slice(0, LINHA_MAX - 1)}…` : ultima;
}

/** Por que o npm falhou, pelos códigos de erro dele; `passageira` = vale tentar de novo. */
export function classificarFalhaNpm(saida: string): { causa: CausaFalhaInstalacao; passageira: boolean } {
  const t = stripVTControlCharacters(saida);
  if (/\bENOSPC\b|no space left/i.test(t)) return { causa: "sem_espaco", passageira: false };
  if (/\bEACCES\b|\bEPERM\b|permission denied/i.test(t)) return { causa: "sem_permissao", passageira: false };
  if (/\bE404\b|\bETARGET\b|404 Not Found|No matching version/i.test(t)) return { causa: "pacote_indisponivel", passageira: false };
  if (faltaNode(t)) return { causa: "sem_npm", passageira: false };
  if (/\bENOTFOUND\b|\bEAI_AGAIN\b|\bENETUNREACH\b|\bECONNREFUSED\b|\bECONNRESET\b|\bETIMEDOUT\b|\bESOCKETTIMEDOUT\b|socket hang up|network (request|error)|getaddrinfo/i.test(t)) return { causa: "sem_internet", passageira: true };
  if (/\bE5\d\d\b|50[0-9] (Internal Server Error|Bad Gateway|Service Unavailable|Gateway Time-?out)/i.test(t)) return { causa: "falhou", passageira: true };
  return { causa: "falhou", passageira: false };
}

export function mensagemDaInstalacao(ia: IaDesktop, causa: CausaFalhaInstalacao): string {
  const { nome } = PACOTE_DA_IA[ia];
  switch (causa) {
    case "sem_internet": return `Não foi possível baixar o ${nome}. Confira a internet e tente de novo.`;
    case "sem_espaco": return `Falta espaço no disco para instalar o ${nome}. Libere espaço e tente de novo.`;
    case "sem_permissao": return `O Mac não deixou o nod gravar a pasta do ${nome}. Tente de novo; se continuar, exporte o diagnóstico pelo menu Ajuda.`;
    case "pacote_indisponivel": return `O ${nome} não está disponível para download agora. Tente de novo mais tarde.`;
    case "sem_npm": return `O nod não conseguiu rodar o instalador do ${nome}. Reinstale o app do nod.`;
    case "verificacao_falhou": return `O ${nome} foi instalado, mas não respondeu. Tente de novo.`;
    case "falhou": return `A instalação do ${nome} não terminou. Tente de novo.`;
  }
}

/** O npm rodando (desktop/main.ts monta com iniciarProcesso): `aoSair` recebe o stdout E o stderr, na ordem em que chegam. */
export type ProcessoNpm = { aoSair(fn: (texto: string) => void): void; fim: Promise<{ codigo: number | null }>; matar(): Promise<void> };
export type RegistroDeInstalacao = { nome: string; escrever(texto: string): void; fechar(): Promise<void> };

export type DepsInstalador = {
  /** Roda o npm com os argumentos dados; null = o app não achou o npm (nem o próprio nem um do Mac). */
  rodarNpm(args: string[]): Promise<ProcessoNpm | null>;
  /** Roda `<binario> --version` com o PATH aumentado. */
  versao(binario: string): Promise<{ codigo: number | null; saida: string }>;
  prefixo: string;
  cache: string;
  abrirRegistro(ia: IaDesktop): Promise<RegistroDeInstalacao>;
  aoMudar(ia: IaDesktop, instalacao: InstalacaoDaIa): void;
  /** Instalou e respondeu: o app sonda de novo (a vigia) para a IA aparecer. */
  aoInstalar(ia: IaDesktop): void;
  esperar(ms: number): Promise<void>;
  agora(): number;
  registrar(evento: string, campos: Record<string, string | number | boolean | null>): void;
};

export type InstaladorDeIas = {
  /** Instala; chamadas durante uma instalação em curso da mesma IA recebem a mesma promessa (sem instalação dupla). */
  instalar(ia: IaDesktop): Promise<InstalacaoDaIa>;
  cancelar(ia: IaDesktop): Promise<boolean>;
  estado(ia: IaDesktop): InstalacaoDaIa | null;
};

export function criarInstaladorDeIas(d: DepsInstalador): InstaladorDeIas {
  const emCurso = new Map<IaDesktop, Promise<InstalacaoDaIa>>();
  const ultimo = new Map<IaDesktop, InstalacaoDaIa>();
  const processos = new Map<IaDesktop, ProcessoNpm>();
  const cancelados = new Set<IaDesktop>();

  const mudar = (ia: IaDesktop, i: InstalacaoDaIa) => { ultimo.set(ia, i); d.aoMudar(ia, { ...i }); };

  async function verificar(ia: IaDesktop): Promise<{ ok: true; versao: string } | { ok: false; saida: string }> {
    const binario = `${d.prefixo}/bin/${PACOTE_DA_IA[ia].binario}`;
    const r = await d.versao(binario).catch((e: unknown) => ({ codigo: null, saida: e instanceof Error ? e.message : String(e) }));
    const versao = r.codigo === 0 ? extrairVersao(r.saida) : null;
    if (!versao || !conferirPisoCli(ia, versao).ok) return { ok: false, saida: r.saida };
    return { ok: true, versao };
  }

  async function rodar(ia: IaDesktop): Promise<InstalacaoDaIa> {
    cancelados.delete(ia);
    const registro = await d.abrirRegistro(ia);
    const base = { registro: registro.nome };
    const args = argsNpm(ia, d.prefixo, d.cache);
    registro.escrever(`# nod: instalar ${PACOTE_DA_IA[ia].pacote} em ${new Date(d.agora()).toISOString()}\n# npm ${args.join(" ")}\n`);
    d.registrar("ia_instalacao_iniciada", { ia, registro: registro.nome });
    let fim: InstalacaoDaIa | null = null;
    try {
      for (let tentativa = 1; tentativa <= TENTATIVAS_INSTALACAO; tentativa++) {
        mudar(ia, { fase: "instalando", linha: null, tentativa, mensagem: `Instalando o ${PACOTE_DA_IA[ia].nome}…`, ...base });
        const npm = await d.rodarNpm(args).catch(() => null);
        if (!npm) { fim = { fase: "falhou", linha: null, tentativa, causa: "sem_npm", mensagem: mensagemDaInstalacao(ia, "sem_npm"), ...base }; break; }
        processos.set(ia, npm);
        let saida = "";
        npm.aoSair((t) => {
          registro.escrever(t);
          // O fim é o que importa (o npm escreve o erro por último): guarda os últimos 64 KiB.
          saida = (saida + t).slice(-65_536);
          const linha = linhaDoProgresso(t);
          const atual = ultimo.get(ia);
          if (linha && atual?.fase === "instalando" && atual.linha !== linha) mudar(ia, { ...atual, linha });
        });
        const r = await npm.fim;
        processos.delete(ia);
        registro.escrever(`\n# npm saiu com ${r.codigo ?? "sinal"}\n`);
        if (cancelados.has(ia)) { fim = { fase: "cancelado", linha: null, tentativa, mensagem: "Instalação cancelada.", ...base }; break; }
        if (r.codigo === 0) {
          const v = await verificar(ia);
          registro.escrever(`# --version: ${v.ok ? v.versao : `falhou: ${v.saida.slice(0, 500)}`}\n`);
          fim = v.ok
            ? { fase: "sucesso", linha: null, tentativa, versao: v.versao, mensagem: `${PACOTE_DA_IA[ia].nome} ${v.versao} instalado.`, ...base }
            : { fase: "falhou", linha: null, tentativa, causa: "verificacao_falhou", mensagem: mensagemDaInstalacao(ia, "verificacao_falhou"), ...base };
          break;
        }
        const falha = classificarFalhaNpm(saida);
        if (falha.passageira && tentativa < TENTATIVAS_INSTALACAO) {
          registro.escrever(`# falha passageira (${falha.causa}); tentando de novo\n`);
          await d.esperar(ESPERAS_ENTRE_TENTATIVAS_MS[tentativa - 1] ?? 5_000);
          if (cancelados.has(ia)) { fim = { fase: "cancelado", linha: null, tentativa, mensagem: "Instalação cancelada.", ...base }; break; }
          continue;
        }
        fim = { fase: "falhou", linha: null, tentativa, causa: falha.causa, mensagem: mensagemDaInstalacao(ia, falha.causa), ...base };
        break;
      }
    } catch (erro) {
      registro.escrever(`# erro: ${erro instanceof Error ? erro.message : String(erro)}\n`); // idioma-fixo: o registro de suporte, nunca vai à tela
      fim = { fase: "falhou", linha: null, tentativa: 1, causa: "falhou", mensagem: mensagemDaInstalacao(ia, "falhou"), ...base };
    } finally {
      processos.delete(ia);
      await registro.fechar().catch(() => undefined);
    }
    const resultado = fim ?? { fase: "falhou" as const, linha: null, tentativa: TENTATIVAS_INSTALACAO, causa: "falhou" as const, mensagem: mensagemDaInstalacao(ia, "falhou"), ...base };
    mudar(ia, resultado);
    d.registrar("ia_instalacao_fim", { ia, fase: resultado.fase, causa: resultado.causa ?? null, versao: resultado.versao ?? null, tentativas: resultado.tentativa, registro: registro.nome });
    if (resultado.fase === "sucesso") d.aoInstalar(ia);
    return resultado;
  }

  return {
    instalar(ia) {
      const atual = emCurso.get(ia);
      if (atual) return atual;
      const p = rodar(ia).finally(() => { emCurso.delete(ia); });
      emCurso.set(ia, p);
      return p;
    },
    async cancelar(ia) {
      if (!emCurso.has(ia)) return false;
      cancelados.add(ia);
      await processos.get(ia)?.matar().catch(() => undefined);
      return true;
    },
    estado(ia) {
      const i = ultimo.get(ia);
      return i ? { ...i } : null;
    },
  };
}
