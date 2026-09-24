export type ChaveRedacao =
  | "capacidade-desligada"
  | "rotina-sem-resposta"
  | "agente-vazio"
  | "offset-numerico"
  | "proposta-recusada"
  | "agente-nasceu"
  | "sem-acessos-nunca-executou"
  | "turno-interrompido"
  | "parada-nada-rodando"
  | "memoria-nao-e-fonte"
  | "proposta-confirmada"
  | "rotina-proxima-execucao"
  | "rotina-passou-em-branco"
  | "rotina-falhou"
  | "handoff"
  | "passe"
  | "consentimento"
  | "executor-indisponivel"
  | "negacao-terminal"
  | "decisao-vencida"
  | "retomada"
  | "parei-falta-dado"
  | "anotei"
  | "permissao-permanente"
  | "computador-fora-do-ar";

/** Textos de sistema FIXOS em português; nunca vêm do modelo. `{chave}` é preenchido com params. */
const CATALOGO: Record<ChaveRedacao, string> = {
  "capacidade-desligada": "Não posso fazer isso: essa capacidade está desligada. Nada mais será tentado neste turno.",
  "rotina-sem-resposta": "A rotina não executou: ninguém respondeu o gate. Nada foi enviado.",
  "agente-vazio": "Este agente nasce sem nenhum acesso. O alcance será concedido por você, capacidade a capacidade.",
  "offset-numerico": "Não gravo fuso como offset. Use um nome IANA, por exemplo America/Sao_Paulo.",
  "proposta-recusada": "Deixei isso de lado. Nada foi agendado nem concedido.",
  "agente-nasceu": "Este agente nasce com identidade de execução vazia: sem nome definitivo, sem acessos, sem rotina. Diga o que ele faz.",
  "sem-acessos-nunca-executou": "sem acessos · nunca executou",
  "turno-interrompido": "Turno interrompido: {motivo}. O que já saiu fica marcado como parcial; nada foi reenviado.",
  "parada-nada-rodando": "Nada estava rodando. Nenhum turno foi interrompido.",
  "permissao-permanente": "{pessoa} permitiu para sempre: {ferramentas}. Vale para qualquer destino destas ferramentas, a partir do próximo turno; você pode revogar quando quiser.",
  "memoria-nao-e-fonte": "Memória do agente: não substitui fonte autoritativa. Se um dado importa, confira na origem.",
  "proposta-confirmada": "Confirmado por {pessoa}. A partir de agora vale: {resumo}.",
  "rotina-proxima-execucao": "Rotina ativa: {resumo} · próxima execução: {proxima} ({fuso}).",
  "rotina-passou-em-branco": "A rotina passou em branco: {motivo}. Nada foi enviado.",
  "rotina-falhou": "A rotina falhou por erro técnico: {motivo}. Nada foi enviado; a próxima execução segue agendada.",
  handoff: "{de} passou para {para}: {motivo}.",
  passe: "{agente} passou a vez ({motivo}).",
  // definido em 2026-09-24 (ADR-044): {escopo} é a lista `slug.capacidade` do lote; com uma só, o texto é o de antes.
  consentimento: "Concedido por {pessoa} em {quando}: {escopo}; não inclui: {naoInclui}.",
  "executor-indisponivel": "Nenhum trabalho começa: executor indisponível ({motivo}) desde {desde}.",
  "negacao-terminal": "Negado (terminal): {nome} — {motivo}. Não tente outro caminho neste turno.",
  "decisao-vencida": "Esta decisão venceu em {quando} sem resposta ({desfecho}). Você pode reabrir.",
  retomada: "Retomando o turno interrompido ({motivo}) a partir de onde parou; nada foi reenviado.",
  "parei-falta-dado": "parei: falta {dado}; quem destrava: {quem}; não vou tentar de novo.",
  anotei: "Anotei como {tipo}: {texto}",
  // definido em 2026-09-24 (emenda da ADR-037): o aviso ÚNICO da transição; a hora sai no cartão da web.
  "computador-fora-do-ar": "O computador de {agente} não responde: {motivo}. Tirei o computador das próximas execuções até você religá-lo.",
};

/**
 * definido em 2026-09-18: a frase interpolava o código cru e a pessoa lia "erro_max_turns". Motivo
 * sem tradução continua saindo como está — é dado técnico visível, não um buraco silencioso.
 */
const MOTIVO_EM_PORTUGUES: Readonly<Record<string, string>> = {
  turno_travado: "o agente ficou sem responder",
  trabalho_incompleto: "o agente não chegou ao fim da tarefa",
  sem_progresso: "o agente não chegou a produzir nada",
  parado_pela_pessoa: "você pediu para parar",
  // definido em 2026-09-24 (ADR-045): "o computador" era lido como o computador DO BOT (ADR-037); quem
  // parou foi o Mac da pessoa, e as três causas comuns cabem na frase.
  maquina_sem_contato: "seu Mac parou de responder (repouso, sem rede ou nod fechado)",
  reinicio_servidor: "o servidor reiniciou",
  executor_indisponivel: "a inteligência não estava disponível",
};

export function motivoEmPortugues(motivo: string): string {
  return MOTIVO_EM_PORTUGUES[motivo] ?? motivo;
}

export function redigir(chave: ChaveRedacao, _agora: number, params: Readonly<Record<string, string>> = {}): string {
  let texto = CATALOGO[chave];
  for (const [k, v] of Object.entries(params)) texto = texto.split(`{${k}}`).join(v);
  return texto;
}
