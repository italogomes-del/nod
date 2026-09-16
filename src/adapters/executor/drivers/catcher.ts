import { randomUUID } from "node:crypto";
import type { Inventario } from "../../../contracts/inventario.ts";
import type { PlanoTurno } from "../../../contracts/plano-turno.ts";
import type { EventoStream, ResultadoTurno, TokensTurno } from "../../../contracts/turno.ts";
import { classificarResultado } from "../../../domain/stream-json.ts";
// Importado por caminho, como o plano autoriza (L3 registrou): o roteiro é módulo puro sem vitest e a
// gramática dos marcadores tem que ser UMA — copiar aqui faria as duas divergirem.
import { roteiroPadrao, type Roteiro } from "../../../../tests/helpers/catcher-roteiro.ts";
import { criarClienteNod, type ClienteNod } from "../cliente-nod.ts";
import type { Adapter, ConfigDriver, Driver, Instance } from "../spi.ts";

/**
 * Driver catcher (Leapy §11, EMENDA 25): mesmo SPI do claude-cli, locality 'ambos', sem CLI e sem
 * custo. É o default de dev/CI (NOD_EXECUTOR=catcher). Marcadores no prompt disparam tool_use pelo
 * MESMO cliente-nod do proxy (in-process, sem processo filho) — o que o executor teria chamado passa
 * pela mesma rota interna que o CLI real usaria. Cada passo vira um registro (`aoRegistrar`, tipo
 * snake_case) que o servidor persiste em catcher_registros (Services.catcher.registrar, L9).
 */
export type RegistroCatcher = { turnoId: string; tipo: string; dados: Record<string, unknown> };

export type OpcoesCatcher = {
  /** URL do nod para as chamadas de ferramenta; ausente = tool_use responde "não executada". */
  urlNod?: string;
  aoRegistrar?: (r: RegistroCatcher) => void;
  /** Atraso entre eventos (testes de interrupção no meio do streaming). */
  atrasoMs?: number;
  clienteNod?: (lig: { url: string; token: string }) => ClienteNod;
};

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function ehRoteiro(v: unknown): v is Roteiro {
  return typeof v === "object" && v !== null && Array.isArray((v as { passos?: unknown }).passos);
}

const TOKENS_ZERADOS: TokensTurno = { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 };

export function criarCatcherDriver(o: OpcoesCatcher = {}): Driver {
  return {
    meta: { id: "catcher", locality: "ambos" },
    async create(cfg: ConfigDriver): Promise<Instance> {
      const roteiroFixo = ehRoteiro(cfg.roteiro) ? cfg.roteiro : null;
      return {
        async sondar(): Promise<Inventario> {
          return { estado: "pronto", versao: "catcher", em: Date.now() };
        },

        adapter(plano: PlanoTurno): Adapter {
          let interrompido = false;
          const registrar = (tipo: string, dados: Record<string, unknown>) => o.aoRegistrar?.({ turnoId: plano.turnoId, tipo, dados });
          const ferramentas = plano.catalogo.ferramentas.map((f) => f.nomeMcp);
          const cliente = o.urlNod ? (o.clienteNod ?? criarClienteNod)({ url: o.urlNod, token: plano.tokenDeTurno }) : null;

          return {
            async rodarTurno(sinks): Promise<ResultadoTurno> {
              await sinks.sinal("attempted");
              const roteiro = roteiroFixo ?? roteiroPadrao({ prompt: plano.entrada.texto, ferramentas });
              const sessaoCli = plano.entrada.sessaoCli ?? randomUUID();
              registrar("plano_recebido", { ferramentas, modelo: plano.entrada.modelo, sessaoCli, passos: roteiro.passos.length, executor: plano.executor });

              const emitidos: EventoStream[] = [];
              const emitir = async (ev: EventoStream) => {
                if (o.atrasoMs) await dormir(o.atrasoMs);
                if (interrompido) return false;
                emitidos.push(ev);
                sinks.evento(ev);
                if (ev.tipo === "delta") sinks.delta(ev.texto);
                if (ev.tipo === "delta" || ev.tipo === "tool_use" || ev.tipo === "result") await sinks.sinal("producedOutput");
                return true;
              };

              await sinks.sinal("promptSubmitted");
              await emitir({ tipo: "init", sessaoCli, ferramentas, modelo: plano.entrada.modelo, versaoCli: "catcher", apiKeySource: "none" });

              let texto = "";
              let custoUsd = 0;
              let falha: string | null = null;
              let numTurnos = 1;
              for (const p of roteiro.passos) {
                if (interrompido) break;
                if (p.tipo === "delta") {
                  if (!(await emitir({ tipo: "delta", texto: p.texto }))) break;
                } else if (p.tipo === "texto") texto = p.texto;
                else if (p.tipo === "custo") custoUsd = p.custoUsd;
                else if (p.tipo === "falha") falha = p.subtype;
                else if (p.tipo === "tool_use") {
                  const id = `toolu_catcher_${emitidos.length}`;
                  const nome = p.nome.startsWith("mcp__nod__") ? p.nome.slice("mcp__nod__".length) : p.nome;
                  const nomeMcp: `mcp__nod__${string}` = `mcp__nod__${nome}`;
                  registrar("tool_use", { id, nome, nomeMcp, noCatalogo: ferramentas.includes(nomeMcp), input: p.input });
                  if (!(await emitir({ tipo: "tool_use", id, nome: nomeMcp, input: p.input }))) break;
                  let resposta: { conteudo: string; isError: boolean };
                  if (!cliente) resposta = { conteudo: `catcher: ${nome} não executada (sem servidor)`, isError: false };
                  else {
                    try {
                      resposta = await cliente.chamarFerramenta(nome, p.input);
                    } catch {
                      // ADR-029: falha técnica é dita, nunca engolida como {} silencioso
                      resposta = { conteudo: "falha_tecnica", isError: true };
                    }
                  }
                  registrar("tool_result", { id, nome, isError: resposta.isError, chars: resposta.conteudo.length });
                  if (!(await emitir({ tipo: "tool_result", toolUseId: id, isError: resposta.isError, texto: resposta.conteudo }))) break;
                  numTurnos += 1;
                }
              }

              if (!interrompido) {
                await emitir({
                  tipo: "result",
                  sucesso: falha === null,
                  subtype: falha ?? "success",
                  sessaoCli,
                  texto,
                  custoUsd,
                  tokens: TOKENS_ZERADOS,
                  numTurnos,
                  negacoesPermissao: [],
                });
              }
              const resultado = classificarResultado({ eventos: emitidos, exitCode: interrompido ? 143 : 0, signal: null, stderr: "", interrompidoPeloDriver: interrompido });
              registrar("resultado", { desfecho: resultado.desfecho, custoUsd: resultado.custoUsd, ferramentasChamadas: resultado.ferramentasChamadas, interrompido });
              return resultado;
            },

            async interromper(): Promise<void> {
              interrompido = true;
            },
          };
        },

        async dispose(): Promise<void> {
          // sem processo filho
        },
      };
    },
  };
}

/** Instância sem ligação: roteiro/prompt viram eventos, tool_use responde "não executada". */
export const catcherDriver: Driver = criarCatcherDriver();
