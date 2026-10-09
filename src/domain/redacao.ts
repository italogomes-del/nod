import type { MotivoFalha, MotivoInterrupcao } from "../contracts/motivos.ts";
import type { PlataformaMaquina } from "../contracts/ponte.ts";

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
  | "ia-trocada"
  | "negacao-terminal"
  | "decisao-vencida"
  | "retomada"
  | "retomada-automatica"
  | "parei-falta-dado"
  | "anotei"
  | "permissao-permanente"
  | "computador-fora-do-ar"
  | "rotina-pausada-sem-acesso"
  | "pendencia-feita"
  | "pendencia-descartada"
  | "pendencia-descartada-pela-pessoa";

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
  "permissao-permanente": "{pessoa} permitiu para sempre: {ferramentas}. Vale já, para qualquer destino destas ferramentas, enquanto o bot não tiver lido conteúdo de fora na tarefa.",
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
  // definido em 2026-10-05: o bot em automático repetiu o pedido na outra IA (assentar-turno.ts, aposContaSemAcesso).
  "ia-trocada": "Respondendo pelo {para}: a conta do {de} neste computador está sem acesso.",
  "negacao-terminal": "Negado (terminal): {nome} — {motivo}. Não tente outro caminho neste turno.",
  // definido em 2026-09-24: {desfecho} em palavras (varredor-expiracao.ts), nunca o enum com espaços no lugar de "_".
  "decisao-vencida": "Este pedido venceu em {quando} sem resposta — {desfecho}. Você pode reabrir.",
  retomada: "Retomando o turno interrompido ({motivo}) a partir de onde parou; nada foi reenviado.",
  // definido em 2026-10-08 (pedidos-parados.ts): o pedido de um colega caiu por infraestrutura e o servidor o retomou.
  "retomada-automatica": "Este pedido caiu ({motivo}) e foi retomado sozinho quando as máquinas voltaram: tentativa {tentativa} de {maximo}.",
  // definido em 2026-09-24 (emenda da ADR-045): só a frase curta da fila ("Sua vez", decisoes.frase); na
  // conversa a pergunta é a fala do próprio agente (pedir-a-pessoa.ts).
  "parei-falta-dado": "parei: falta {dado}; quem destrava: {quem}; não vou tentar de novo.",
  // definido em 2026-10-03: {tipo} já com artigo e acento ("uma preferência"), nunca o enum cru (lembrar.ts).
  anotei: "Anotei {tipo}: {texto}",
  // definido em 2026-09-24 (emenda da ADR-037): o aviso ÚNICO da transição; a hora sai no cartão da web.
  "computador-fora-do-ar": "O computador de {agente} não responde: {motivo}. Tirei o computador das próximas execuções até você religá-lo.",
  // definido em 2026-09-24 (emenda da ADR-044): a linha ÚNICA quando o pedido de acesso da rotina vence —
  // no lugar do "este pedido venceu"; {prazo} é o da decisão ("24h"), {app} o nome que a pessoa lê.
  "rotina-pausada-sem-acesso": "Rotina pausada: ninguém liberou o acesso ao {app} em {prazo}. Reative quando quiser.",
  // definido em 2026-09-30 (ADR-064): a pendência resolvida deixa rastro na conversa — a pessoa vê que o bot cumpriu
  // o que deixou para depois, mesmo quando a rotina que cumpriu não teria outra novidade a contar.
  "pendencia-feita": "Feito: {texto}. {como}",
  "pendencia-descartada": "Descartei: {texto}. {motivo}",
  "pendencia-descartada-pela-pessoa": "Você descartou: {texto}",
};

/**
 * definido em 2026-09-18: a frase interpolava o código cru e a pessoa lia "erro_max_turns".
 * definido em 2026-10-05 (NOD-174): o mapa é TOTAL sobre os enums de contracts/motivos.ts — um motivo novo sem
 * tradução quebra o typecheck, em vez de aparecer cru na conversa ("Turno interrompido: erro_execucao.").
 */
const MOTIVO_EM_PORTUGUES: Readonly<Record<MotivoFalha | MotivoInterrupcao, string>> = {
  turno_travado: "o agente ficou sem responder",
  trabalho_incompleto: "o agente não chegou ao fim da tarefa",
  sem_progresso: "o agente não chegou a produzir nada",
  parado_pela_pessoa: "você pediu para parar",
  // definido em 2026-09-24 (ADR-045): "o computador" era lido como o computador DO BOT (ADR-037); quem
  // parou foi o Mac da pessoa, e as três causas comuns cabem na frase.
  maquina_sem_contato: "seu Mac parou de responder (repouso, sem rede ou nod fechado)",
  reinicio_servidor: "o servidor reiniciou",
  executor_indisponivel: "a inteligência não estava disponível",
  lancamento_falhou: "a IA não conseguiu abrir neste Mac",
  sessao_rejeitada: "a IA recusou a conversa antes de começar",
  absorvido: "a mensagem foi lida junto com a seguinte",
  erro_max_turns: "o agente chegou ao limite de passos deste turno",
  erro_execucao: "a IA parou por um erro; tente de novo e, se repetir, relate o problema nesta mensagem",
  motor_ausente: "a IA não está instalada neste Mac",
  nao_autenticado: "a conta da IA não está conectada neste Mac",
  // NOD-171: sem a hora. O aviso do turno usa fraseDoLimiteDoPlano (erro-fornecedor.ts), que diz quando volta.
  limite_do_plano: "o plano da IA atingiu o limite de uso; espere o uso renovar e tente de novo",
};

/** Aceita string: o banco guarda motivos que saíram do enum. Motivo legado sem tradução sai como está, sem quebrar. */
export function motivoEmPortugues(motivo: string): string {
  return Object.hasOwn(MOTIVO_EM_PORTUGUES, motivo) ? MOTIVO_EM_PORTUGUES[motivo as keyof typeof MOTIVO_EM_PORTUGUES] : motivo;
}

/** A máquina de um turno caído, como a chave dela diz (maquina_tokens, 0067); null = sem chave (o Mac do modo local). */
export type MaquinaDaQueda = { nome: string; plataforma: PlataformaMaquina | null };

/**
 * definido em 2026-10-09: o `maquina_sem_contato` de quem rodava na VM dizia "seu Mac parou de responder" (o Ze 1 no
 * motor Linux, com o Mac aberto na mesa). A máquina Linux é nomeada, com as causas dela; o Mac, a chave que ainda não
 * disse o sistema e o Mac sem chave do modo local ficam com a frase de sempre.
 */
export function motivoDaQuedaEmPortugues(maquina: MaquinaDaQueda | null): string {
  return maquina?.plataforma === "linux" ? `a máquina ${maquina.nome} parou de responder (desligada, sem rede ou motor parado)` : MOTIVO_EM_PORTUGUES.maquina_sem_contato;
}

export function redigir(chave: ChaveRedacao, _agora: number, params: Readonly<Record<string, string>> = {}): string {
  let texto = CATALOGO[chave];
  for (const [k, v] of Object.entries(params)) texto = texto.split(`{${k}}`).join(v);
  return texto;
}
