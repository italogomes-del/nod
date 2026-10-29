/**
 * O assunto de cada item da conversa e para onde ele vai (definido em 2026-10-18, plano do chat limpo, PR 1; ADR-114).
 *
 * `mensagens.assunto` (0091) guarda o que a mensagem é. A tabela `DESTINO` (src/domain/destino-no-chat.ts, só no
 * servidor) diz para onde cada assunto vai; a web recebe o destino pronto no DTO (`Mensagem.destino`) e nunca importa a
 * tabela (ADR-018). Mudar uma regra é mudar a tabela, sem regravar o banco. `null` em `assunto` é fala ou linha antiga
 * sem backfill: fica no chat.
 *
 * Os grupos abaixo são só leitura: o destino de cada um está na tabela, não no nome.
 */
export const ASSUNTOS = [
  // Falas entre bots e o que a pessoa entregou ou decidiu (chat).
  "colega.handoff",
  "colega.pedido",
  "colega.resposta",
  "acesso.concedido",
  "acesso.revogado",
  "acesso.pasta",
  "aprovacao.recibo",
  "aprovacao.automatica_falhou",
  // O aviso do deploy do PR 6 dos modos de aprovação: o "Ignorar todas" passou a usar as credenciais (uma vez por bot).
  "aprovacao.total_credenciais",
  "proposta.obsoleta",
  "proposta.resultado",
  "artefato",
  "ligacao",
  "sessao.nova",
  "sala.evento",
  // Rotinas: criar, mudar, pausar, apagar e a falha (chat); a execução sem nada para a pessoa (Atividade).
  "rotina.evento",
  "rotina.falhou",
  "rotina.adiada",
  "rotina.execucao",
  // O bot e o turno.
  "agente.criado",
  "bot.criado",
  "turno.orfao",
  "turno.falhou",
  "turno.interrompido",
  "turno.queda_da_maquina",
  "turno.retomado",
  "lote.retorno_caiu",
  "passe",
  "parada",
  // Negações.
  "negacao.ferramenta",
  "negacao.conector",
  "negacao.terminal",
  "negacao.plano_ausente",
  // IA, contas e cota.
  "ia.trocada",
  "ia.troca",
  "ia.limite_do_plano",
  "ia.fala_espera",
  "conta.trocada",
  "conta.seguiu",
  "conta.escolhida",
  "conta.nota",
  "conta.recusada",
  "cota.pedido_na_fila",
  "cota.espera",
  // NOD-309: o fundo que espera por outra queda (erro do provedor, máquina, reinício) e volta sozinho.
  "fundo.espera",
  "computador.fora_do_ar",
  "computador.em_operacao",
  // NOD-97: a pessoa fechou a tela no controle e o bot voltou a usar o computador.
  "computador.tela_fechada",
  // NOD-97 PR 5: o Chrome preencheu uma senha salva; o bot não vê o que está escrito.
  "computador.senha_preenchida",
  // Frentes e tasks: a web precisa delas na janela para desenhar outra coisa (anexo).
  "trabalho.aberto",
  "frentes.abertas",
  "frentes.terminadas",
  "frentes.recado",
  "pedido.respondido",
  // NOD-114: o bot avisou a pessoa por conta própria (avisar_pessoa); o desktop e o navegador mostram o aviso.
  "aviso.pessoa",
  // NOD-119: o card que pergunta se muda a barra lateral (ajustar_barra_lateral); a pessoa confirma nele.
  "barra.ajuste",
  // O resto do que o sistema escreve (Atividade).
  "memoria.anotada",
  "memoria.task_fechada",
  "compactacao",
  // NOD-54 (ADR-134): a linha que o bot lê no próximo turno ("Desfeito: N arquivos voltaram"); a pessoa vê o resultado na própria fala.
  "arquivos.desfeitos",
  "proposta.decidida",
  "inteligencia",
  "aprovacao.modo",
  "aprovacao.automatica",
  "acesso.automatico",
  "decisao.vencida",
  "sistema.generico",
] as const;

export type Assunto = (typeof ASSUNTOS)[number];

/**
 * `chat`: vira linha no chat. `anexo` (revisão de 18/10): não vira linha, mas a web precisa dele na janela para desenhar
 * outra coisa (o título e a origem das tasks, a âncora das frentes, a troca entre bots). `atividade`: sai do chat e
 * mora na Atividade do bot.
 */
export type Destino = "chat" | "anexo" | "atividade";

/**
 * O filtro da Atividade. Item sem categoria só aparece em "Tudo". `sem_aprovacao` (PR 6 dos modos de aprovação): o que o
 * modo rodou sem a pessoa — o terminal e os arquivos (`acoes_pelo_modo`) e os apps e acessos aprovados pelo modo.
 */
export type CategoriaDaAtividade = "sem_aprovacao" | "frentes" | "bloqueios" | "maquina_ia";

export type RegraDeDestino = {
  destino: Destino;
  categoria: CategoriaDaAtividade | null;
  /**
   * Destino que muda com o tempo (limite do plano, troca de IA, computador fora do ar, IA ausente): a tabela os marca
   * `chat`, a web os esconde quando deixam de valer, e a Atividade os lista sempre.
   */
  temporal?: true;
};
