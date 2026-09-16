export type ChaveRedacao =
  | "capacidade-desligada"
  | "rotina-sem-resposta"
  | "agente-vazio"
  | "offset-numerico"
  | "proposta-recusada";

const CATALOGO: Record<ChaveRedacao, string> = {
  "capacidade-desligada":
    "Não posso fazer isso: essa capacidade está desligada. Nada mais será tentado neste turno.",
  "rotina-sem-resposta":
    "A rotina não executou: ninguém respondeu o gate. Nada foi enviado.",
  "agente-vazio":
    "Este agente nasce sem nenhum acesso. O alcance será concedido por você, capacidade a capacidade.",
  "offset-numerico":
    "Não gravo fuso como offset. Use um nome IANA, por exemplo America/Sao_Paulo.",
  "proposta-recusada": "Deixei isso de lado. Nada foi agendado nem concedido.",
};

export function redigir(chave: ChaveRedacao, _agora: number): string {
  return CATALOGO[chave];
}
