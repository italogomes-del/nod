import type { DefinicaoAcao } from "../../contracts/acoes.ts";

/**
 * A conta da pessoa (NOD-391, ADR-135; Onda 3, NOD-395). Mora em /api/conta (rota pública com a sessão conferida dentro,
 * ADR-124), fora da catraca A; o registro a lista para o docs/paridade.md mostrar as exceções. Senha, entrar e parear
 * nunca passam pelo chat.
 */

const ROTA = "rota pública de conta (/api/conta, ADR-124)";
const falta = { estado: "falta", onda: "NOD-395" } as const;

export const ACOES_CONTA = [
  { id: "conta.trocar_senha", titulo: "Trocar a senha", risco: "pessoa_confirma", cartaoNoChat: false, chat: { estado: "nunca", motivo: "senha nunca passa pela conversa" }, semRotaDePessoa: ROTA },
  { id: "conta.entrar", titulo: "Entrar, cadastrar ou recuperar a conta", risco: "pessoa_confirma", cartaoNoChat: false, chat: { estado: "nunca", motivo: "sessão: sem sessão não há chat" }, semRotaDePessoa: ROTA },
  { id: "conta.parear_aparelho", titulo: "Parear um aparelho com a conta", risco: "pessoa_confirma", cartaoNoChat: false, chat: { estado: "nunca", motivo: "pareamento: a pessoa confere o código no aparelho" }, semRotaDePessoa: ROTA },
  { id: "conta.sair_das_outras", titulo: "Sair dos outros aparelhos", risco: "arriscada", cartaoNoChat: true, chat: falta, semRotaDePessoa: ROTA },
  { id: "conta.editar_perfil", titulo: "Editar o nome, o sobre mim e a foto", risco: "muda", cartaoNoChat: false, chat: falta, semRotaDePessoa: ROTA },
  { id: "conta.trocar_email", titulo: "Trocar o e-mail da conta", risco: "pessoa_confirma", cartaoNoChat: true, chat: falta, semRotaDePessoa: ROTA },
  { id: "conta.remover_google", titulo: "Tirar o login Google da conta", risco: "pessoa_confirma", cartaoNoChat: true, chat: falta, semRotaDePessoa: ROTA },
  { id: "conta.exportar", titulo: "Exportar os dados da conta", risco: "muda", cartaoNoChat: true, chat: falta, semRotaDePessoa: ROTA },
  { id: "conta.excluir", titulo: "Excluir a conta (ou desfazer a exclusão)", risco: "pessoa_confirma", cartaoNoChat: true, chat: falta, semRotaDePessoa: ROTA },
] as const satisfies readonly DefinicaoAcao[];
