import type { CorAgente, FormaAgente } from "../contracts/agente.ts";
import type { ConectorCatalogo } from "../contracts/conector.ts";
import { detectarConectores } from "./catalogo-conectores.ts";
import { interpretarRotinaTexto, textoTemRecorrencia, type RotinaNormalizada } from "./rotina-texto.ts";

export const FORMAS: readonly FormaAgente[] = ["shape-square", "shape-hex", "shape-circle"];
export const CORES: readonly CorAgente[] = [
  "c-red",
  "c-pink",
  "c-purple",
  "c-blue",
  "c-teal",
  "c-green",
  "c-orange",
  "c-black",
];

export type PropostaPapel = {
  nome: string;
  instrucoes: string;
  forma: FormaAgente;
  cor: CorAgente;
  acessosPedidos: { conectorId: string; nome: string }[];
  naoDeveFazer: string[];
  rotina: RotinaNormalizada | null;
};

function tituloDe(texto: string): string {
  const nomeado = texto.match(/te chamo\s+([^.,\n]+)|nome(?:\s+dele)?\s+([A-ZÁÉÍÓÚÂÊÔÃÕ][\wÀ-ÿ-]+)/i);
  const n = (nomeado?.[1] ?? nomeado?.[2] ?? "").trim();
  if (n) return n.slice(0, 24);
  if (/lgpd/i.test(texto)) return "LGPD";
  if (/caixa de entrada|gmail|e-?mail/i.test(texto)) return "Triagem";
  if (/clickup/i.test(texto)) return "ClickUp";
  if (/bug|triagem de bug/i.test(texto)) return "BugZero";
  const palavra = texto.match(/\b([A-ZÁÉÍÓÚ][\wÀ-ÿ]{2,})\b/);
  if (palavra?.[1] && !/^(Quero|Olá|Ola|Preciso|Faz|Para)\b/i.test(palavra[1])) return palavra[1].slice(0, 18);
  return "Novo Bot";
}

export function proximaForma(usadas: readonly FormaAgente[]): FormaAgente {
  return FORMAS.find((f) => !usadas.includes(f)) ?? "shape-square";
}

export function proximaCor(usadas: readonly CorAgente[]): CorAgente {
  return CORES.find((c) => !usadas.includes(c)) ?? "c-red";
}

/**
 * Do texto livre nasce a proposta. Nada é concedido nem agendado aqui (E1.1).
 */
export function proporPapel(entrada: {
  texto: string;
  formasUsadas: readonly FormaAgente[];
  coresUsadas: readonly CorAgente[];
  catalogo: readonly ConectorCatalogo[];
  fusoIana: string;
  agora: number;
}): PropostaPapel {
  const conectores = detectarConectores(entrada.texto);
  const naoDeveFazer = [
    "Nada sai para fora sem a sua confirmação.",
    "Não herda nenhuma credencial sua — nasce vazio.",
  ];
  if (conectores.length === 0) {
    naoDeveFazer.push("Não fala com nenhum app até você conectar e ligar cada capacidade.");
  } else {
    for (const c of conectores) {
      naoDeveFazer.push(
        `${c.nome}: nenhuma capacidade ligada ainda — exatamente o que ele não poderá fazer até você ligar uma a uma.`,
      );
    }
  }

  let rotina: RotinaNormalizada | null = null;
  if (textoTemRecorrencia(entrada.texto)) {
    try {
      rotina = interpretarRotinaTexto({
        texto: entrada.texto,
        fusoIana: entrada.fusoIana,
        agora: entrada.agora,
      });
    } catch {
      rotina = null;
    }
  }

  return {
    nome: tituloDe(entrada.texto),
    instrucoes: entrada.texto.trim(),
    forma: proximaForma(entrada.formasUsadas),
    cor: proximaCor(entrada.coresUsadas),
    acessosPedidos: conectores.map((c) => ({ conectorId: c.id, nome: c.nome })),
    naoDeveFazer,
    rotina,
  };
}
