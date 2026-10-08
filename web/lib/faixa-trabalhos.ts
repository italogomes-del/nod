/**
 * A faixa de Trabalhos recolhida numa pílula (definido em 2026-10-07, #195): a escolha é da pessoa e mora no servidor
 * (`faixaTrabalhosRecolhida` em `PUT preferencias`), porque o app do Mac limpa o localStorage a cada conexão — o mesmo
 * padrão dos avisos de modo (web/lib/menu-modo.ts). O localStorage fica só de cache, para a faixa não piscar aberta antes
 * de as preferências chegarem.
 */
const CHAVE = "nod.faixaTrabalhosRecolhida";

export function lerFaixaRecolhida(): boolean {
  try {
    return localStorage.getItem(CHAVE) === "1";
  } catch {
    return false;
  }
}

export function guardarFaixaRecolhida(recolhida: boolean): void {
  try {
    localStorage.setItem(CHAVE, recolhida ? "1" : "0");
  } catch {
    // Sem storage, vale o servidor.
  }
}
