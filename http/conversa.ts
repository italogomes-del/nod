import type { Agente, Mensagem } from "../contracts/agente.ts";
import type { Concessao, SensibilidadeDeclarada } from "../contracts/conector.ts";
import type { Rotina } from "../contracts/rotina.ts";
import type { Snapshot } from "../db/store.ts";
import { novoId, PESSOA_LOCAL } from "../db/store.ts";
import { CATALOGO_CONECTORES, complementoCapacidades, conectorPorId } from "../core/catalogo-conectores.ts";
import { interpretarIntencao } from "../core/conversa-intencao.ts";
import { proporPapel } from "../core/proposta-agente.ts";
import { interpretarRotinaTexto } from "../core/rotina-texto.ts";
import { redigir } from "../core/redacao.ts";
import { cifrar } from "../db/cifra.ts";

const FUSO = process.env.NOD_FUSO_PADRAO ?? "America/Sao_Paulo";

function msg(
  s: Snapshot,
  agenteId: string,
  kind: Mensagem["kind"],
  texto: string,
  autoria: Mensagem["autoria"],
  payload: Record<string, unknown> | null = null,
  agora: number,
): Mensagem {
  return {
    tenantId: s.tenantId,
    id: novoId(),
    agenteId,
    autoria,
    kind,
    texto,
    payload,
    createdAt: agora,
  };
}

function pendente(s: Snapshot, agenteId: string): Mensagem | undefined {
  return [...s.mensagens].reverse().find(
    (m) =>
      m.agenteId === agenteId &&
      (m.kind === "proposta-papel" || m.kind === "proposta-rotina" || m.kind === "proposta-concessao") &&
      m.payload &&
      m.payload["estado"] === "pendente",
  );
}

export function starterDoAgente(s: Snapshot, agente: Agente, agora: number): Mensagem {
  return msg(
    s,
    agente.id,
    "starter",
    "Oi, Marlon. Aqui é o Novo Bot — acabamos de nos conhecer. Pronto pra te ajudar no que for mais útil pra você.",
    { tipo: "agente", agenteId: agente.id, porPessoaId: PESSOA_LOCAL },
    {
      title: "Pra que você quer me usar?",
      subtitle: "Pode escolher ou escrever do seu jeito.",
      options: [
        ["A", "Tarefas do dia a dia", "Lembretes, organização, follow-ups"],
        ["B", "Trabalho na Leapy", "Produto, ClickUp, Slack, código..."],
        ["C", "Pesquisa e respostas", "Pesquisas, comparações e drafts"],
        ["D", "Ainda não sei", "Me ajuda a descobrir no caminho"],
      ],
    },
    agora,
  );
}

export function criarAgenteNovo(s: Snapshot, agora: number): Agente {
  const usadasF = s.agentes.map((a) => a.forma);
  const usadasC = s.agentes.map((a) => a.cor);
  const p = proporPapel({
    texto: "Novo Bot",
    formasUsadas: usadasF,
    coresUsadas: usadasC,
    catalogo: CATALOGO_CONECTORES,
    fusoIana: FUSO,
    agora,
  });
  const agente: Agente = {
    tenantId: s.tenantId,
    id: novoId(),
    nome: "Novo Bot",
    instrucoes: "",
    dono: { tipo: "pessoa", pessoaId: PESSOA_LOCAL },
    forma: p.forma,
    cor: p.cor,
    secao: "sem-secao",
    favorito: false,
    confirmado: false,
    criadoEm: agora,
  };
  s.agentes.unshift(agente);
  s.mensagens.push(starterDoAgente(s, agente, agora));
  return agente;
}

function aplicarConfirmacao(s: Snapshot, agente: Agente, p: Mensagem, chave: Buffer, agora: number): Mensagem[] {
  const out: Mensagem[] = [];
  if (!p.payload) return out;
  p.payload["estado"] = "confirmada";

  if (p.kind === "proposta-papel") {
    agente.nome = String(p.payload["nome"] ?? agente.nome);
    agente.instrucoes = String(p.payload["instrucoes"] ?? "");
    agente.confirmado = true;
    out.push(
      msg(
        s,
        agente.id,
        "sistema",
        `Agora eu sou ${agente.nome}. Nasci sem nenhum acesso. Conecte um app quando quiser — Slack, Notion, ClickUp — e ligue cada capacidade. Nada foi concedido ainda.`,
        { tipo: "agente", agenteId: agente.id, porPessoaId: PESSOA_LOCAL },
        null,
        agora,
      ),
    );
    const acessos = (p.payload["acessosPedidos"] as { conectorId: string; nome: string }[] | undefined) ?? [];
    for (const a of acessos) {
      out.push(...proporConcessao(s, agente, a.conectorId, agora));
    }
    const rotina = p.payload["rotina"] as Rotina | undefined;
    if (rotina) {
      rotina.estado = "proposta";
      s.rotinas.push(rotina);
      out.push(msgRotina(s, agente, rotina, agora));
    }
    return out;
  }

  if (p.kind === "proposta-rotina") {
    const rotina = s.rotinas.find((r) => r.id === p.payload?.["rotinaId"]);
    if (rotina) {
      rotina.estado = "ativa";
      const quando = rotina.proximoDisparo
        ? new Date(rotina.proximoDisparo).toLocaleString("pt-BR", { timeZone: rotina.fusoIana })
        : "";
      out.push(
        msg(
          s,
          agente.id,
          "sistema",
          `Rotina ativa. Próximo disparo: ${quando} (${rotina.fusoIana}). O gate de aprovação já vem ligado — nada sai sem você.`,
          { tipo: "agente", agenteId: agente.id, porPessoaId: PESSOA_LOCAL },
          { rotinaId: rotina.id },
          agora,
        ),
      );
    }
    return out;
  }

  if (p.kind === "proposta-concessao") {
    const concessao = s.concessoes.find((c) => c.id === p.payload?.["concessaoId"]);
    if (concessao) {
      const declaracao = (p.payload["declaracao"] as SensibilidadeDeclarada | undefined) ?? "nao-declarou";
      concessao.declaracao = declaracao;
      concessao.estado = "conectada";
      const ligadas = (p.payload["capacidadesLigadas"] as string[] | undefined) ?? [];
      concessao.capacidadesLigadas = ligadas;
      const conector = conectorPorId(concessao.conectorId);
      const naoPode = conector ? complementoCapacidades(conector, ligadas) : [];
      s.credenciaisCifradas[concessao.id] = cifrar(
        JSON.stringify({
          provider: concessao.conectorId,
          grant: "local-dev",
          em: agora,
        }),
        chave,
      );
      out.push(
        msg(
          s,
          agente.id,
          "sistema",
          `${conector?.nome ?? concessao.conectorId} conectado. Capacidade ligada: ${ligadas.length === 0 ? "nenhuma" : ligadas.join(", ")}. Exatamente o que eu não poderei fazer: ${naoPode.join("; ") || "—"}.`,
          { tipo: "agente", agenteId: agente.id, porPessoaId: PESSOA_LOCAL },
          { concessaoId: concessao.id },
          agora,
        ),
      );
    }
  }
  return out;
}

function msgRotina(s: Snapshot, agente: Agente, rotina: Rotina, agora: number): Mensagem {
  const quando = rotina.proximoDisparo
    ? new Date(rotina.proximoDisparo).toLocaleString("pt-BR", { timeZone: rotina.fusoIana })
    : "";
  return msg(
    s,
    agente.id,
    "proposta-rotina",
    `Entendi a recorrência. Nada foi agendado ainda.`,
    { tipo: "agente", agenteId: agente.id, porPessoaId: PESSOA_LOCAL },
    {
      estado: "pendente",
      rotinaId: rotina.id,
      resumo: `${rotina.instrucao}`,
      cron: rotina.cron,
      fusoIana: rotina.fusoIana,
      proximo: quando,
      exigeAprovacao: rotina.exigeAprovacao,
    },
    agora,
  );
}

function proporConcessao(s: Snapshot, agente: Agente, conectorId: string, agora: number): Mensagem[] {
  const conector = conectorPorId(conectorId);
  if (!conector) return [];
  const existente = s.concessoes.find(
    (c) => c.agenteId === agente.id && c.conectorId === conectorId && c.estado !== "revogada",
  );
  if (existente?.estado === "conectada") {
    return [
      msg(
        s,
        agente.id,
        "texto",
        `${conector.nome} já está conectado. Capacidades ligadas: ${existente.capacidadesLigadas.length === 0 ? "nenhuma" : existente.capacidadesLigadas.join(", ")}.`,
        { tipo: "agente", agenteId: agente.id, porPessoaId: PESSOA_LOCAL },
        null,
        agora,
      ),
    ];
  }
  const concessao: Concessao = existente ?? {
    tenantId: s.tenantId,
    id: novoId(),
    agenteId: agente.id,
    conectorId,
    estado: "proposta",
    declaracao: "nao-declarou",
    capacidadesLigadas: [],
    criadoEm: agora,
  };
  if (!existente) s.concessoes.push(concessao);
  const naoPode = complementoCapacidades(conector, []);
  return [
    msg(
      s,
      agente.id,
      "proposta-concessao",
      `Para usar ${conector.nome} preciso da sua concessão. Todas as capacidades começam desligadas.`,
      { tipo: "agente", agenteId: agente.id, porPessoaId: PESSOA_LOCAL },
      {
        estado: "pendente",
        concessaoId: concessao.id,
        conectorId: conector.id,
        nome: conector.nome,
        resumo: conector.resumo,
        sugestaoToca: conector.sugestaoToca,
        declaracao: "nao-declarou",
        capacidades: conector.capacidades,
        capacidadesLigadas: [],
        naoPode,
      },
      agora,
    ),
  ];
}

export function tratarMensagem(
  s: Snapshot,
  agente: Agente,
  texto: string,
  chave: Buffer,
  agora: number,
): Mensagem[] {
  const humanas = msg(
    s,
    agente.id,
    "texto",
    texto,
    { tipo: "pessoa", pessoaId: PESSOA_LOCAL },
    null,
    agora,
  );
  s.mensagens.push(humanas);
  const pend = pendente(s, agente.id);
  const intencao = interpretarIntencao({
    texto,
    temInstrucoes: agente.instrucoes.length > 0,
    temPropostaPendente: Boolean(pend),
  });

  const respostas: Mensagem[] = [];

  if (intencao.tipo === "confirmar" && pend) {
    respostas.push(...aplicarConfirmacao(s, agente, pend, chave, agora));
  } else if (intencao.tipo === "recusar" && pend) {
    pend.payload = { ...pend.payload, estado: "recusada" };
    if (pend.kind === "proposta-rotina") {
      const r = s.rotinas.find((x) => x.id === pend.payload?.["rotinaId"]);
      if (r && r.estado === "proposta") r.estado = "pausada";
    }
    respostas.push(
      msg(
        s,
        agente.id,
        "texto",
        redigir("proposta-recusada", agora),
        { tipo: "agente", agenteId: agente.id, porPessoaId: PESSOA_LOCAL },
        null,
        agora,
      ),
    );
  } else if (intencao.tipo === "definir-papel") {
    const p = proporPapel({
      texto: intencao.texto,
      formasUsadas: s.agentes.filter((a) => a.id !== agente.id).map((a) => a.forma),
      coresUsadas: s.agentes.filter((a) => a.id !== agente.id).map((a) => a.cor),
      catalogo: CATALOGO_CONECTORES,
      fusoIana: FUSO,
      agora,
    });
    let rotina: Rotina | null = null;
    if (p.rotina) {
      rotina = {
        tenantId: s.tenantId,
        id: novoId(),
        agenteId: agente.id,
        cron: p.rotina.cron,
        fusoIana: p.rotina.fusoIana,
        instrucao: p.rotina.instrucao,
        exigeAprovacao: true,
        estado: "proposta",
        proximoDisparo: p.rotina.proximoDisparo,
        criadoEm: agora,
      };
    }
    respostas.push(
      msg(
        s,
        agente.id,
        "proposta-papel",
        "Entendi o trabalho. Nada foi concedido nem agendado. Confirma?",
        { tipo: "agente", agenteId: agente.id, porPessoaId: PESSOA_LOCAL },
        {
          estado: "pendente",
          nome: p.nome,
          instrucoes: p.instrucoes,
          acessosPedidos: p.acessosPedidos,
          naoDeveFazer: p.naoDeveFazer,
          rotinaResumo: p.rotina?.resumo ?? null,
          rotina,
        },
        agora,
      ),
    );
  } else if (intencao.tipo === "propor-rotina") {
    const n = interpretarRotinaTexto({ texto: intencao.texto, fusoIana: FUSO, agora });
    const rotina: Rotina = {
      tenantId: s.tenantId,
      id: novoId(),
      agenteId: agente.id,
      cron: n.cron,
      fusoIana: n.fusoIana,
      instrucao: n.instrucao,
      exigeAprovacao: true,
      estado: "proposta",
      proximoDisparo: n.proximoDisparo,
      criadoEm: agora,
    };
    s.rotinas.push(rotina);
    respostas.push(msgRotina(s, agente, rotina, agora));
  } else if (intencao.tipo === "propor-concessao") {
    respostas.push(...proporConcessao(s, agente, intencao.conectorId, agora));
  } else {
    respostas.push(
      msg(
        s,
        agente.id,
        "texto",
        agente.instrucoes
          ? "Certo. Posso criar uma rotina se você disser quando («toda segunda às 7h»), ou conectar um app («conecta com o Slack» / Notion / ClickUp)."
          : "Me diz em uma ou duas frases o que eu faço. Sem formulário — é só escrever.",
        { tipo: "agente", agenteId: agente.id, porPessoaId: PESSOA_LOCAL },
        null,
        agora,
      ),
    );
  }

  s.mensagens.push(...respostas);
  return [humanas, ...respostas];
}

export function confirmarProposta(
  s: Snapshot,
  agente: Agente,
  propostaId: string,
  chave: Buffer,
  agora: number,
  extra?: { declaracao?: SensibilidadeDeclarada; capacidadesLigadas?: string[] },
): Mensagem[] {
  const p = s.mensagens.find((m) => m.id === propostaId);
  if (!p || !p.payload) return [];
  if (extra?.declaracao && p.payload) p.payload["declaracao"] = extra.declaracao;
  if (extra?.capacidadesLigadas && p.payload) p.payload["capacidadesLigadas"] = extra.capacidadesLigadas;
  const out = aplicarConfirmacao(s, agente, p, chave, agora);
  s.mensagens.push(...out);
  return out;
}
