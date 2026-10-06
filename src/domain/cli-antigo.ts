/**
 * A frase que a pessoa lê quando o CLI está instalado, mas abaixo do piso testado (NOD-171): nunca "Instale". Diz a
 * versão que está no Mac e a mínima, para a pessoa saber o que atualizar sem abrir terminal.
 */
export function motivoCliAntigo(nome: string, versao: string, minima: string): string {
  return `O ${nome} deste Mac (${versao}) é mais antigo que o testado pelo nod. Atualize para a versão ${minima} ou mais nova.`;
}
