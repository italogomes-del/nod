import { detectarConectores } from "./catalogo-conectores.ts";
import { textoTemRecorrencia } from "./rotina-texto.ts";

export type Intencao =
  | { tipo: "confirmar" }
  | { tipo: "recusar" }
  | { tipo: "definir-papel"; texto: string }
  | { tipo: "propor-rotina"; texto: string }
  | { tipo: "propor-concessao"; conectorId: string; texto: string }
  | { tipo: "conversa"; texto: string };

const CONFIRMA = /^(sim|ok|pode|confirma(?:r)?|isso|fechou|bora|beleza|yes|confirmo)[\s!.]*$/i;
const RECUSA = /^(n[aã]o|agora n[aã]o|cancela(?:r)?|esquece|deixa)[\s!.]*$/i;

export function interpretarIntencao(entrada: {
  texto: string;
  temInstrucoes: boolean;
  temPropostaPendente: boolean;
}): Intencao {
  const texto = entrada.texto.trim();
  if (entrada.temPropostaPendente && CONFIRMA.test(texto)) return { tipo: "confirmar" };
  if (entrada.temPropostaPendente && RECUSA.test(texto)) return { tipo: "recusar" };

  const conectores = detectarConectores(texto);
  const pedeConexao = /conect[aeo]|autoriz[ae]|liga(?:r)? o|plugin|oauth/i.test(texto);
  if (conectores.length > 0 && (pedeConexao || entrada.temInstrucoes)) {
    if (pedeConexao || /slack|notion|gmail|clickup|github|agenda/i.test(texto)) {
      if (pedeConexao) {
        return { tipo: "propor-concessao", conectorId: conectores[0]!.id, texto };
      }
    }
  }

  if (entrada.temInstrucoes && textoTemRecorrencia(texto)) {
    return { tipo: "propor-rotina", texto };
  }

  if (!entrada.temInstrucoes) {
    return { tipo: "definir-papel", texto };
  }

  if (pedeConexao && conectores[0]) {
    return { tipo: "propor-concessao", conectorId: conectores[0].id, texto };
  }

  if (textoTemRecorrencia(texto)) {
    return { tipo: "propor-rotina", texto };
  }

  return { tipo: "conversa", texto };
}
