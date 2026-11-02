import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DefinicaoAcao } from "../../src/contracts/acoes.ts";
import type { Escopo } from "../../src/shared/types.ts";
import { ASSINATURA_PNG } from "../../src/adapters/tela/capturador-cdp.ts";
import { REGISTRO_DE_ACOES } from "../../src/domain/acoes/index.ts";
import { ACOES_CONHECIDAS_NOD398 } from "../helpers/acoes-conhecidas-nod398.ts";
import { CORPOS_QUEBRADOS, gerarEntradas, lerSemente, type CasoDeFuzz } from "../../src/domain/fuzz/gerador.ts";
import { ehErroDeDominio } from "../../src/domain/erro.ts";
import type { AcaoLote } from "../../src/contracts/ferramentas-do-nod.ts";
import type { ModoAprovacao } from "../../src/contracts/agente.ts";
import { gerirBots } from "../../src/use-cases/gerir-bots.ts";
import { gerirTimes } from "../../src/use-cases/gerir-times.ts";
import { garantirNod } from "../../src/use-cases/onboarding.ts";
import { CAMINHOS_DAS_ACOES_DE_CONTA, acoesNovasSemLeitura, acoesSemHandler, bloquearRedeExterna, rotasPublicasSemHandler, vereditoDeDecisao, sementeDoPr, chegouNoHandler, custoDoFuzz, enxugarCasos, executarFuzz, lerN, marcaDoBanco, processosBloqueados, quietude, planoDoServidor, relatarViolacoes, sqlDoRetrato, sqlDoRetratoDaConta, zerarCustoDoFuzz, type AlvoDoFuzz, type Retrato } from "../helpers/fuzz.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto, type SessaoDeTeste } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E, limparTenantE2E, varrerSobrasDaPessoa } from "./limpeza-e2e.ts";

/**
 * NOD-398: o fuzz das ações. Percorre TODAS as ações do registro (src/domain/acoes/) — a lista vem do registro, nunca
 * deste arquivo — e manda a cada rota que a declara N entradas absurdas geradas do JSON Schema dela. Invariantes depois
 * de cada chamada: nunca 5xx, /api/saude de pé, erro sem diff no banco da pessoa (o que o RLS dela enxerga) e o banco de
 * outras pessoas intacto (uma do mesmo tenant, uma de outro). Cobertura: toda ação tem de ter ao menos uma chamada que
 * CHEGOU ao handler (não 404 do roteador nem 401 de sessão).
 *
 * Reproduzir: `FUZZ_SEMENTE=<a do log> FUZZ_N=<n> npx vitest run --project concurrency tests/concurrency/fuzz-acoes.test.ts`.
 */

// No PR a semente vem do commit (GITHUB_SHA): o mesmo commit testa sempre as mesmas entradas e o gate não pisca. O noturno
// passa uma FUZZ_SEMENTE nova a cada noite.
function headLocal(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 }).trim();
  } catch {
    return null;
  }
}
const SEGREDO_DA_OUTRA = { nome: "Da outra zq7x", descricao: "Não pode mudar nem aparecer zq7x." };
// Fora do CI a semente sai do HEAD local (revisão 6): o `npm run check` de um bot não sorteia entradas novas a cada rodada
// e não tropeça num achado alheio à mudança dele; sorteio só no noturno ou com FUZZ_SEMENTE.
const SEMENTE = lerSemente(process.env.FUZZ_SEMENTE, () => sementeDoPr(process.env.GITHUB_SHA) ?? sementeDoPr(headLocal() ?? undefined) ?? randomInt(0, 2 ** 31));
// N=20 cabe no orçamento do job integration (≤ 90 s); a rodada noturna usa FUZZ_N=200.
const N = lerN(process.env.FUZZ_N, 20);
// O prazo cresce com N: medido em 2026-10-28, N=20 leva ~55 s no servidor padrão e ~22 s no compartilhado (saúde e retrato em paralelo);
// ~5 s por unidade de N com folga dobrada. N=200 (noturno) ganha ~33 min, dentro dos 45 do job.
// NOD-417 (o teto de 150 s caindo em lote na CI carregada, com a main a 126,8 s): o executor pula os retratos quando a
// marca do banco (marcaDoBanco) prova que nada foi gravado desde o último. Semente 1530664212 local: 106,5 s → 49,0 s.
const PRAZO_DO_FUZZ_MS = Math.max(600_000, N * 10_000);

/**
 * Duas configurações, porque nem toda rota existe em todo modo: o servidor padrão (local) leva quase tudo; o
 * compartilhado com contas, minha conta e nuvem leva o resto (SSH, nuvem, conta). O segundo fuzza só o que o primeiro
 * não tinha, e o fim exige 100% do registro coberto.
 */
const CONFIGURACOES: { nome: string; env: Record<string, string> }[] = [
  { nome: "padrão", env: { NOD_CAPTURA_TELA: "1" } },
  { nome: "compartilhado + contas + nuvem", env: { NOD_MODO: "compartilhado", NOD_CONTAS: "1", NOD_MINHA_CONTA: "1", NOD_MAQUINA_NUVEM: "gcp" } },
];
/**
 * NOD-445 (ADR-146): ação sem rota nenhuma (`semRotaDePessoa` fora das de conta, que moram nas rotas públicas de
 * /api/conta) não tem o que o fuzz HTTP mandar: a tela leva à conversa e o caminho é a ferramenta, provada no teste de
 * contrato da ação. Sai da cobertura por aqui, derivada do registro (nunca uma lista à mão).
 */
const SO_PELA_CONVERSA = new Set<string>((REGISTRO_DE_ACOES as readonly DefinicaoAcao[]).filter((a) => a.semRotaDePessoa && !Object.hasOwn(CAMINHOS_DAS_ACOES_DE_CONTA, a.id)).map((a) => a.id));
let faltando: readonly string[] = REGISTRO_DE_ACOES.map((a) => a.id).filter((id) => !SO_PELA_CONVERSA.has(id));
/**
 * Revisão 10: as ações que hoje só recebem 404 (o fuzz não semeia a entidade delas) ou 403 (guarda). É um TETO: ação
 * fora desta lista que só receba 404/403 reprova (a cobertura rasa não cresce em silêncio). Semear e tirar daqui: NOD-409.
 */
// Revisão 19: só os corpos que o `lerCorpo` recusa (JSON inválido, `null` no topo); corpo vazio e topo que não é objeto
// chegam à rota, que valida: esse 400 é leitura da entrada. O teste confere que os rótulos ainda existem no gerador.
const ROTULOS_QUEBRADOS = new Set(["json quebrado", "não json", "null no topo"]);
const SO_404_403_ACEITAS = new Set([
  "bots.cobrar_colega", "memoria.desfazer_diario", "apps.sondar", "apps.habilitar", "apps.desabilitar", "maquinas.aprovar_dispositivo",
  "cartoes.reabrir", "cartoes.dispensar", "cartoes.confirmar_proposta", "cartoes.recusar_proposta", "turnos.cancelar", "incidentes.dispensar",
  "modo.contestar", "salas.parar", "trabalhos.parar", "trabalhos.fazer_aqui", "voz.encerrar", "memoria.apagar", "contas_ia.remover",
  "maquinas.revogar_chave", "conversas.tirar_pasta", "voz.apagar_falas",
  "maquinas.confiar_ssh", "maquinas.cancelar_ssh", "nuvem.dormir", "nuvem.acordar", "nuvem.excluir_maquina",
  // Revisão 12: lê o corpo antes de buscar a decisão, mas o fuzz não semeia decisões; sem corpo quebrado, sempre 404.
  "cartoes.decidir",
  // Revisão 11: oscilam pela semente (algumas sementes só sorteiam entradas que passam da validação e caem no 404). Medido
  // com as sementes 1, 424242, 3979170113 e a do HEAD local.
  "contas_ia.tentar_de_novo", "conversas.desfazer_turno", "apps.credenciais", "apps.github_app", "turnos.retomar_decisao",
  // Revisão 13: com 401/429 fora da conta da leitura, oscila também (a semente 3509089577 só lhe deu 404/401/429).
  "maquinas.desconectar",
]);
/**
 * Revisão 16: ação NOVA (fora de ACOES_CONHECIDAS_NOD398) que não dá para semear sai do veredito só por aqui, com a issue
 * que vai semeá-la (o teste exige o id NOD-n). SO_404_403_ACEITAS só pode ter ações da foto: não serve de saída para nova.
 */
const ISENCOES_DE_ACOES_NOVAS: Readonly<Record<string, string>> = {
  // A main vermelha em 849a2d14 (semente 2224696596): o fuzz não semeia versão de perfil, e só a semente que sorteia um número
  // existente passa da busca. Semear a versão do perfil no fuzz é da NOD-20.
  "bots.restaurar_versao": "NOD-20",
};
/** As ações do quadro que a NOD-420 mudou (o prazo_min): no PR levam as N entradas; as outras do quadro, metade. */
const ACOES_DO_QUADRO_COM_N = new Set(["quadro.criar_coluna", "quadro.renomear_coluna"]);
const duracoes: number[] = [];
// Revisão 14: a leitura da entrada acumulada entre os servidores, para a regra das ações novas valer só no fim.
const fuzzadasTodas = new Set<string>();
const alemDaBuscaTodas = new Set<string>();

describe("listas do teto das ações só 404/403 (revisão 16 do #590)", () => {
  it("SO_404_403_ACEITAS só tem ações da foto e cada isenção de ação nova cita a issue", () => {
    expect([...SO_404_403_ACEITAS].filter((a) => !ACOES_CONHECIDAS_NOD398.has(a))).toEqual([]);
    expect([...ROTULOS_QUEBRADOS].filter((r) => !CORPOS_QUEBRADOS.some((e) => e.rotulo === r))).toEqual([]);
    const registro = new Set<string>(REGISTRO_DE_ACOES.map((a) => a.id));
    expect(Object.entries(ISENCOES_DE_ACOES_NOVAS).filter(([a, issue]) => ACOES_CONHECIDAS_NOD398.has(a) || !registro.has(a) || !/^NOD-\d+$/.test(issue))).toEqual([]);
  });
});

for (const [ordem, config] of CONFIGURACOES.entries()) {
  describeIntegracao(`fuzz das ações do registro (NOD-398), servidor ${config.nome}`, () => {
    let srv: ServidorCompleto;
    let outra: SessaoDeTeste;
    let deOutroTenant: SessaoDeTeste;
    let sessao: SessaoDeTeste;
    let sqlRetrato: string;
    let sqlConta: string;
    let desbloquear: () => void;
    let home = "";
    const outraEscopo: Escopo = { tenantId: "", pessoaId: randomUUID() };
    const outroTenant: Escopo = { tenantId: randomUUID(), pessoaId: randomUUID() };

    beforeAll(async () => {
      // Revisão 9: o servidor do fuzz não toca o ~/.nod de verdade (workspaces, pastas, arquivos da pessoa): NOD_HOME
      // temporário, apagado no fim, e só os sockets unix dele (e o do Postgres) liberados.
      home = mkdtempSync(join(tmpdir(), "nod-fuzz-home-"));
      desbloquear = bloquearRedeExterna({ unixPermitidos: [home] });
      // tela.capturar entra no fuzz com a flag ligada e um capturador falso: mede a validação da rota sem subir Chrome.
      srv = await servidorCompleto({ env: { ...config.env, NOD_HOME: home }, capturador: { capturar: async () => ASSINATURA_PNG }, intervalos: { orquestradorMs: 3_600_000, schedulerMs: 3_600_000, expiracaoMs: 3_600_000, outboxMs: 3_600_000, leaseMs: 3_600_000 } });
      sessao = srv.pessoa;
      outraEscopo.tenantId = srv.pessoa.tenantId;
      await srv.dbDono`insert into pessoas (tenant_id, id, nome, iniciais) values (${outraEscopo.tenantId}, ${outraEscopo.pessoaId}, 'Outra do fuzz', 'OF') on conflict do nothing`;
      outra = srv.sessaoDe(outraEscopo);
      await srv.dbDono`insert into tenants (id, nome) values (${outroTenant.tenantId}, 'Outro tenant do fuzz') on conflict do nothing`;
      await srv.dbDono`insert into pessoas (tenant_id, id, nome, iniciais) values (${outroTenant.tenantId}, ${outroTenant.pessoaId}, 'De outro tenant', 'OT') on conflict do nothing`;
      deOutroTenant = srv.sessaoDe(outroTenant);
      sqlRetrato = await sqlDoRetrato(srv.dbDono);
      sqlConta = await sqlDoRetratoDaConta(srv.dbDono);
    }, 60_000);

    afterAll(async () => {
      desbloquear?.();
      if (home) rmSync(home, { recursive: true, force: true });
      if (!srv) return;
      await srv.fechar();
      // Primeiro a varredura pelo catálogo (toda tabela com owner_id, apagada pela própria pessoa), depois a limpeza do e2e
      // (conta, sessões, pessoa). Ela apaga e só então conta: a falha aqui é linha que NÃO DÁ para apagar como a dona (FK
      // sem par, policy sem delete, tabela fora do grant), não "a limpeza esqueceu uma tabela" — o catálogo cobre isso.
      const sobras: string[] = [];
      for (const escopo of [{ tenantId: srv.pessoa.tenantId, pessoaId: srv.pessoa.pessoaId }, outraEscopo, outroTenant]) {
        sobras.push(...(await varrerSobrasDaPessoa(srv.db, srv.dbDono, escopo)).map((t) => `${escopo.pessoaId.slice(0, 8)}/${t}`));
        await limparPessoaE2E(srv.db, srv.dbDono, escopo, { agentes: [], conversas: [] });
      }
      await limparTenantE2E(srv.dbDono, outroTenant.tenantId);
      await srv.desligar();
      expect(sobras, "linhas do fuzz que a dona não consegue apagar").toEqual([]);
    }, 60_000);

    // O que o RLS da pessoa enxerga + as tabelas de conta dela (sem RLS, lidas pelo dono e filtradas pela pessoa). As de
    // conta só são escritas pelas rotas de conta, que só existem com NOD_CONTAS: no servidor sem contas o retrato delas
    // custaria uma consulta a mais por chamada (o orçamento de 90 s) sem poder pegar nada.
    const retratoDe = async (s: SessaoDeTeste): Promise<Retrato> => {
      const [doRls, daConta] = await Promise.all([
        srv.app.dentro({ tenantId: s.tenantId, pessoaId: s.pessoaId }, (d) =>
          d.tx(async (trx) => Object.fromEntries((await trx.unsafe<{ t: string; h: string }[]>(sqlRetrato)).map((l) => [l.t, l.h]))),
        ),
        srv.app.contas ? srv.dbDono.unsafe<{ t: string; h: string }[]>(sqlConta, [s.tenantId, s.pessoaId]) : Promise.resolve([]),
      ]);
      return { ...doRls, ...Object.fromEntries(daConta.map((l) => [l.t, l.h])) };
    };

    it("cada ação recebe N entradas absurdas e nenhum invariante cai", async () => {
      // eslint-disable-next-line no-console
      console.log(`fuzz-acoes[${config.nome}]: FUZZ_SEMENTE=${SEMENTE} FUZZ_N=${N}`);
      // Ids reais: um bot da pessoa e um da outra (o RLS tem de esconder o segundo), com a conversa e uma rotina de cada
      // (revisão 9): a rota `/rotinas/:id` recebe id de rotina e passa da busca, em vez de só exercitar o "não achei".
      type Criado = { agente: { id: string }; conversa: { id: string } };
      const meu = await srv.json<Criado>("POST", "agentes", { dono: "pessoa", nome: "Alvo do fuzz", descricao: "Recebe o fuzz." });
      const dela = await srv.json<Criado>("POST", "agentes", { dono: "pessoa", ...SEGREDO_DA_OUTRA }, outra);
      const rotinaDe = (s: SessaoDeTeste, b: Criado) =>
        srv.app.dentro({ tenantId: s.tenantId, pessoaId: s.pessoaId }, (d) =>
          d.tx(async (trx) => {
            // Próxima execução daqui a 30 dias: o agendador não a roda durante o fuzz.
            const [r] = await trx<{ id: string }[]>`insert into rotinas (tenant_id, owner_id, agente_id, conversa_id, cron, fuso_iana, instrucao, fonte, entregavel, limites_aprovacao, politica_sem_dado, proxima_execucao)
              values (${s.tenantId}, ${s.pessoaId}, ${b.agente.id}, ${b.conversa.id}, '0 8 * * *', 'UTC', 'Rotina do fuzz', 'f', 'e', 'l', 'p', now() + interval '30 days') returning id`;
            return r!.id;
          }),
        );
      const [minhaRotina, rotinaDela] = [await rotinaDe(sessao, meu), await rotinaDe(outra, dela)];
      // NOD-442: um quadro com um lote no bot da pessoa. Sem ele o `quadro.desfazer` só passava da busca na semente em que um
      // `quadro.criar` válido saía antes, com o experimento ligado por um `preferencias.salvar` sorteado (a main vermelha com
      // a semente 1644694243). O experimento Quadro fica ligado para o fuzz passar da guarda dele.
      await srv.json("PUT", "preferencias", { experimentos: { quadro: true } });
      await srv.json("POST", `agentes/${meu.agente.id}/quadro`, { meta: "Quadro do fuzz" });
      // Uma coluna removível (id `c-…`): o primeiro `quadro.remover_coluna` que a sortear remove de verdade.
      const comColuna = await srv.json<{ quadro: { colunas: { id: string; nome: string }[] } }>("POST", `agentes/${meu.agente.id}/quadro/colunas`, { nome: "Coluna do fuzz", grupo: "iniciado" });
      const colunaDoFuzz = comColuna.quadro.colunas.find((c) => c.nome === "Coluna do fuzz")!.id;
      // NOD-417: uma tarefa (em Backlog, sem acionar ninguém) para o `:tid` (`quadro.terminei` só passava da busca com ela).
      const comTarefa = await srv.json<{ quadro: { tarefas: { id: string; titulo: string }[] } }>("POST", `agentes/${meu.agente.id}/quadro/tarefas`, { titulo: "Tarefa do fuzz", status: "backlog" });
      const tarefaDoFuzz = comTarefa.quadro.tarefas.find((t) => t.titulo === "Tarefa do fuzz")!.id;
      // NOD-443: a outra pessoa do tenant no quadro, para o `:pid` (`quadro.tirar_pessoa` só passava da busca na semente em
      // que um `quadro.adicionar_pessoa` sorteado acertava o nome dela antes; a 443 ficou vermelha com a semente 1735492939).
      const comPessoa = await srv.json<{ ok: boolean; detalhe?: string }>("POST", `agentes/${meu.agente.id}/quadro/pessoas`, { pessoa: outraEscopo.pessoaId });
      if (!comPessoa.ok) throw new Error(`a pessoa do fuzz não entrou no quadro: ${comPessoa.detalhe}`);
      // NOD-445: um app ativo e um removido no bot da pessoa e um no da outra, para `paginas.remover_app` e
      // `paginas.restaurar_app` passarem da busca (o `:app` recebe estes ids pelo segmento `apps`).
      const appDe = (s: SessaoDeTeste, b: Criado, nome: string, removido: boolean) =>
        srv.app.dentro({ tenantId: s.tenantId, pessoaId: s.pessoaId }, (d) =>
          d.tx(async (trx) => {
            const [r] = await trx<{ id: string }[]>`insert into apps_do_bot (tenant_id, owner_id, agente_id, nome, nome_chave, fonte, forma, removido_em)
              values (${s.tenantId}, ${s.pessoaId}, ${b.agente.id}, ${nome}, ${nome.toLowerCase()}, 'bot', 'lista', ${removido ? new Date() : null}) returning id`;
            return r!.id;
          }),
        );
      const [meuApp, meuAppRemovido, appDela] = [await appDe(sessao, meu, "Vagas", false), await appDe(sessao, meu, "Leads", true), await appDe(outra, dela, "Vagas", false)];
      // NOD-437: um time de cada pessoa (e o Sem time da pessoa) para o `/times/:id`: renomear e excluir passam da busca.
      type ComTime = { time: { id: string } };
      const timeDoFuzz = (await srv.json<ComTime>("POST", "times", { nome: "Time do fuzz" })).time.id;
      const timeDela = (await srv.json<ComTime>("POST", "times", { nome: "Time dela" }, outra)).time.id;
      const semTimeDoFuzz = (await srv.json<{ times: { id: string; semTime: boolean }[] }>("POST", "times/sincronizar", {})).times.find((t) => t.semTime)!.id;
      const plano = planoDoServidor({
        registro: REGISTRO_DE_ACOES as readonly DefinicaoAcao[],
        pendentes: faltando,
        rotas: [...srv.app.rotas, ...(srv.app.contas?.rotas ?? [])],
        semente: SEMENTE + ordem,
        n: N,
        ids: {
          daPessoa: [meu.agente.id],
          deOutraPessoa: [dela.agente.id],
          porRecurso: {
            conversas: { daPessoa: [meu.conversa.id], deOutraPessoa: [dela.conversa.id] },
            rotinas: { daPessoa: [minhaRotina], deOutraPessoa: [rotinaDela] },
            // NOD-415: a main ficou vermelha com a semente 3044290320 porque `bots.excluir` e `quadro.remover` rodavam antes
            // de `quadro.remover_coluna` (o plano agora vai do DELETE mais fundo ao mais raso). O `:cid` recebe ainda ids
            // reais: a coluna semeada (a remoção de verdade) e as fixas (o id não muda ao renomear; remover dá 400).
            colunas: { daPessoa: [colunaDoFuzz, "voce", "cancelado"], deOutraPessoa: [] },
            tarefas: { daPessoa: [tarefaDoFuzz], deOutraPessoa: [] },
            pessoas: { daPessoa: [outraEscopo.pessoaId], deOutraPessoa: [] },
            apps: { daPessoa: [meuApp, meuAppRemovido], deOutraPessoa: [appDela] },
            times: { daPessoa: [timeDoFuzz, semTimeDoFuzz], deOutraPessoa: [timeDela] },
          },
        },
      });
      // NOD-445, custo no PR (N <= 20; a noturna fica inteira): as rotas de remover e restaurar app não leem o corpo, então
      // as N entradas viravam N sorteios do mesmo caminho (com a semente 1257342993: 2 de 20 e 1 de 20 passaram da busca).
      // Cada uma fica com um caso por id que importa (o app vivo, o removido, o da outra pessoa pelo bot dela e pelo meu,
      // um id quebrado), na posição do plano. A ordenar lê o corpo: fica com as 10 primeiras entradas (as fixas + 7).
      if (N <= 20) {
        const apps = [meuApp, meuAppRemovido, appDela, "nao-e-uuid"].map((app) => ({ bot: meu.agente.id, app }));
        apps.push({ bot: dela.agente.id, app: appDela });
        const enxuto: typeof plano.casos = [];
        const vistos = new Map<string, number>();
        for (const c of plano.casos) {
          const n = (vistos.get(c.acao) ?? 0) + 1;
          vistos.set(c.acao, n);
          if (c.acao === "paginas.ordenar" && n > 10) continue;
          if (c.acao === "paginas.remover_app" || c.acao === "paginas.restaurar_app") {
            if (n > 1) continue;
            const fim = c.acao === "paginas.restaurar_app" ? "/restaurar" : "";
            for (const a of apps) enxuto.push({ ...c, caminho: `/agentes/${a.bot}/apps/${encodeURIComponent(a.app)}${fim}` });
            continue;
          }
          enxuto.push(c);
        }
        plano.casos.splice(0, plano.casos.length, ...enxuto);
      }
      // NOD-420: no PR (N ≤ 20) as ações do quadro levam metade das entradas por rota (as fixas e um caso que passa da
      // busca sempre ficam), menos as que a NOD-420 mudou (criar_coluna e renomear_coluna, o prazo_min), que levam N.
      // O quadro é 17 rotas das ~150 do padrão; a noturna (N ≥ 100) fuzza tudo com N.
      if (N <= 20) {
        const antes = plano.casos.length;
        plano.casos = enxugarCasos(plano.casos, {
          acoes: (a) => a.startsWith("quadro.") && !ACOES_DO_QUADRO_COM_N.has(a),
          k: Math.ceil(N / 2),
          idsDaPessoa: new Set([meu.agente.id, colunaDoFuzz, "voce", "cancelado", tarefaDoFuzz, outraEscopo.pessoaId]),
        });
        // eslint-disable-next-line no-console
        console.log(`fuzz-acoes[${config.nome}]: ações do quadro com ${Math.ceil(N / 2)} entradas por rota: ${antes} → ${plano.casos.length} casos`);
      }
      // eslint-disable-next-line no-console
      console.log(`fuzz-acoes[${config.nome}]: ${plano.acoes} ações, ${plano.casos.length} casos; sem rota: ${plano.semRota.join(", ") || "nenhuma"}`);
      expect(plano.casos.length, "o plano do fuzz saiu vazio: nada seria testado").toBeGreaterThan(0);

      // O cliente do fuzz age como o navegador: adota o cookie novo que o servidor manda (as rotas de conta trocam o
      // cookie antigo, sem sid, por uma sessão registrada no primeiro pedido, por desenho). Sem isso cada pedido criava
      // uma sessão nova e o retrato da conta acusava erro mexendo no banco. Se o servidor apaga o cookie (sair), volta ao
      // cookie de partida e o troca de novo na hora, como quem entra de novo, antes do retrato.
      const cookieInicial = sessao.cookie;
      const adotarCookie = async (r: Response): Promise<void> => {
        const novo = r.headers.getSetCookie().map((c) => /^nod_sessao=([^;]*)/.exec(c)?.[1]).find((v) => v !== undefined);
        if (novo === undefined) return;
        if (novo) { sessao = { ...sessao, cookie: `nod_sessao=${novo}` }; return; }
        sessao = { ...sessao, cookie: cookieInicial };
        if (srv.app.contas) await adotarCookie(await fetch(`${srv.url}/api/conta`, { headers: { cookie: cookieInicial }, signal: AbortSignal.timeout(15_000) }));
      };
      // Entra antes do fuzz: a troca do cookie de partida acontece aqui, e não no meio de um caso que deu erro.
      if (srv.app.contas) await adotarCookie(await fetch(`${srv.url}/api/conta`, { headers: { cookie: cookieInicial }, signal: AbortSignal.timeout(15_000) }));
      const contagem = new Map<number, number>();
      const chegaram = new Set<string>();
      const alemDaBusca = new Set<string>();
      const rotasQueChegaram = new Set<string>();
      const vazamentos: string[] = [];
      const alvo: AlvoDoFuzz = {
        chamar: async (c: CasoDeFuzz) => {
          const base = c.publica ? `${srv.url}/api` : `${srv.url}/api/t/${sessao.tenantId}`;
          const r = await fetch(`${base}${c.caminho}`, {
            method: c.metodo,
            // A origem do próprio servidor: as rotas de conta recusam POST sem ela antes de olhar a entrada.
            headers: { cookie: sessao.cookie, "content-type": "application/json", origin: srv.url },
            body: c.metodo === "GET" || c.entrada.corpo === null ? undefined : c.entrada.corpo,
            signal: AbortSignal.timeout(15_000),
          });
          await adotarCookie(r);
          contagem.set(r.status, (contagem.get(r.status) ?? 0) + 1);
          const corpo = await r.text();
          // Vazamento por leitura: o nome e a descrição do bot da outra pessoa nunca entram numa entrada do fuzz (só o id,
          // que a rota pode ecoar num erro), então aparecer numa resposta é leitura através da RLS.
          if (corpo.includes(SEGREDO_DA_OUTRA.nome) || corpo.includes(SEGREDO_DA_OUTRA.descricao)) vazamentos.push(`${r.status} ${c.metodo} ${c.caminho}: ${corpo.slice(0, 160)}`);
          if (chegouNoHandler(c, r.status, corpo)) {
            chegaram.add(c.acao);
            rotasQueChegaram.add(c.rota);
          }
          // Revisão 9: chegar ao handler com 404 ("não achei") ou 403 (guarda) não lê a entrada. A ação que só teve esses
          // sai no log, para a cobertura rasa aparecer em vez de contar como 100%.
          // Revisão 11: o 400 de um corpo quebrado sai do `lerCorpo`, antes de a rota ler qualquer campo; não conta.
          // Revisão 12: 401 (sessão) e 429 (limite) também barram antes da entrada; não contam.
          // Revisões 17 a 19: o 400 do `lerCorpo` (JSON inválido, `null` no topo, ou byte nulo/surrogate solto num campo) sai quando a rota
          // pede o corpo, antes de ler qualquer campo; não conta. Só o 400: outro status desses casos é da própria rota. 5xx
          // já é violação e não conta (o log não sugere tirar da lista uma ação que só deu 500). 413 o fuzz não alcança.
          const barradoNoCorpo = r.status === 400 && (ROTULOS_QUEBRADOS.has(c.entrada.rotulo) || /: (byte nulo|surrogate solto)$/.test(c.entrada.rotulo));
          if (chegouNoHandler(c, r.status, corpo) && r.status < 500 && r.status !== 404 && r.status !== 403 && r.status !== 401 && r.status !== 429 && !barradoNoCorpo) alemDaBusca.add(c.acao);
          // eslint-disable-next-line no-console
          if (process.env.FUZZ_DEBUG) console.log(`FZ ${r.status} ${c.acao} ${c.metodo} ${c.caminho} ${corpo.slice(0, 80)}`);
          return { status: r.status, corpo };
        },
        saude: async () => (await fetch(`${srv.url}/api/saude`, { signal: AbortSignal.timeout(5_000) })).ok,
        retrato: () => retratoDe(srv.pessoa),
        // O custo no PR (o teto de 150 s): o caso que não gravou nada no banco não paga os retratos (ver marcaDoBanco).
        marca: () => marcaDoBanco(srv.dbDono),
        retratoDaOutra: async () => {
          const [a, b] = await Promise.all([retratoDe(outra), retratoDe(deOutroTenant)]);
          return { ...Object.fromEntries(Object.entries(a).map(([k, v]) => [`mesmo tenant/${k}`, v])), ...Object.fromEntries(Object.entries(b).map(([k, v]) => [`outro tenant/${k}`, v])) };
        },
      };
      const inicio = Date.now();
      const violacoes = await executarFuzz(alvo, plano.casos, {
        quieto: {
          prazoMs: 5_000,
          intervaloMs: 100,
          // Sem turno da pessoa na fila ou rodando: o trabalho que um sucesso disparou já escreveu o que tinha a escrever.
          ocioso: () =>
            srv.app.dentro({ tenantId: srv.pessoa.tenantId, pessoaId: srv.pessoa.pessoaId }, (d) =>
              d.tx(async (trx) => (await trx<{ n: number }[]>`select count(*)::int as n from turnos where owner_id = ${srv.pessoa.pessoaId} and estado in ('pendente', 'despachando')`)[0]!.n === 0),
            ),
        },
      });
      const segundos = (Date.now() - inicio) / 1000;
      // O custo deste servidor (contagens e ms por etapa), para medir corte de custo com a mesma FUZZ_SEMENTE.
      // eslint-disable-next-line no-console
      console.log(`fuzz-acoes[${config.nome}]: custo ${JSON.stringify({ ...custoDoFuzz, ms: Object.fromEntries(Object.entries(custoDoFuzz.ms).map(([k, v]) => [k, Math.round(v)])) })}`);
      zerarCustoDoFuzz();
      duracoes.push(segundos);
      const semHandler = acoesSemHandler(plano.casos, chegaram);
      const rotasSemHandler = rotasPublicasSemHandler(plano.casos, rotasQueChegaram);
      // Revisão 14: só quem chegou ao handler neste servidor; quem não chegou vai ao próximo (`faltando`).
      const so404 = [...chegaram].filter((a) => !alemDaBusca.has(a)).sort();
      for (const a of chegaram) fuzzadasTodas.add(a);
      for (const a of alemDaBusca) alemDaBuscaTodas.add(a);
      // eslint-disable-next-line no-console
      console.log(`fuzz-acoes[${config.nome}]: só 404/403/401/429 (não passaram da busca ou da guarda): ${so404.join(", ") || "nenhuma"}`);
      // eslint-disable-next-line no-console
      console.log(`fuzz-acoes[${config.nome}]: ${plano.casos.length} chamadas em ${segundos.toFixed(1)} s; status: ${JSON.stringify(Object.fromEntries([...contagem].sort((a, b) => a[0] - b[0])))}; sem chegar ao handler: ${semHandler.join(", ") || "nenhuma"}; rotas de conta sem chegar: ${rotasSemHandler.join(", ") || "nenhuma"}`);
      // A semente impressa é a BASE (a do log de cima): cada servidor soma a própria ordem por dentro, então rodar de novo
      // com ela refaz exatamente os mesmos casos neste servidor (revisão 2: imprimir SEMENTE + ordem reproduzia outra coisa).
      // Antes de qualquer expect (QA do #590): uma falha aqui não pode deixar `faltando` com o registro inteiro e fazer o
      // próximo servidor fuzzar tudo (e acusar em cascata o que só vale no padrão).
      faltando = [...plano.semRota.filter((a) => !SO_PELA_CONVERSA.has(a)), ...semHandler.filter((a) => (REGISTRO_DE_ACOES as readonly DefinicaoAcao[]).some((d) => d.id === a))];
      // Revisão 15: soft e antes dos outros expects, para aparecer junto de qualquer outra falha do último servidor. A
      // ação nova que não dá para semear sai por ISENCOES_DE_ACOES_NOVAS, com a issue de semear.
      if (ordem === CONFIGURACOES.length - 1) expect.soft(acoesNovasSemLeitura({ fuzzadas: fuzzadasTodas, alemDaBusca: alemDaBuscaTodas, conhecidas: new Set([...ACOES_CONHECIDAS_NOD398, ...Object.keys(ISENCOES_DE_ACOES_NOVAS)]) }), `semente ${SEMENTE}: ações novas do registro que em nenhum servidor passaram de 404/403/401/429 (semear a entidade no fuzz; se não der, pôr em ISENCOES_DE_ACOES_NOVAS com a issue)`).toEqual([]);
      expect(vazamentos, `servidor ${config.nome}: respostas com o bot da outra pessoa`).toEqual([]);
      expect(violacoes, `servidor ${config.nome}\n${relatarViolacoes(SEMENTE, N, violacoes)}`).toEqual([]);
      // Cada rota de conta montada neste servidor tem de ter lido a entrada pelo menos uma vez (não só 403/429).
      // Teto (revisões 10 a 14): ação fora da lista que só recebe 404/403/401/429. Com N pequeno (PR) a amostra muda a cada
      // push e o resultado das ações que já existiam oscila, então para elas só avisa e reprova com N >= 100 (noturno). As
      // ações NOVAS (fora de ACOES_CONHECIDAS_NOD398) reprovam já no PR, no fim, se em nenhum servidor passaram da busca.
      // Revisão 17: a isenção de ação nova vale também no noturno.
      const novas = so404.filter((a) => !SO_404_403_ACEITAS.has(a) && !Object.hasOwn(ISENCOES_DE_ACOES_NOVAS, a));
      const sairamDaLista = [...SO_404_403_ACEITAS].filter((a) => alemDaBusca.has(a));
      // eslint-disable-next-line no-console
      if (novas.length || sairamDaLista.length) console.log(`fuzz-acoes[${config.nome}]: semente ${SEMENTE}; só 404/403/401/429 fora da lista: ${novas.join(", ") || "nenhuma"}; da lista que já leram a entrada (tirar de SO_404_403_ACEITAS): ${sairamDaLista.join(", ") || "nenhuma"}`);
      if (N >= 100) expect(novas, `servidor ${config.nome}, semente ${SEMENTE}: ações fora de SO_404_403_ACEITAS que não passaram da busca (404/403/401/429 ou corpo barrado no lerCorpo; semear, ou pôr na lista com a NOD-409 se for da foto, ou em ISENCOES_DE_ACOES_NOVAS com a issue se for nova)`).toEqual([]);
      expect(rotasSemHandler, `servidor ${config.nome}: rotas de conta que só barraram antes do handler`).toEqual([]);
      // Quem não chegou ao handler aqui ficou pendente (acima) para o próximo servidor; no fim, tem de ter chegado em algum.
      // Depois da última configuração, nenhuma ação do registro pode ter ficado sem fuzz.
      if (ordem === CONFIGURACOES.length - 1) {
        expect(faltando, "ações do registro que nenhum servidor do fuzz fez chegar ao handler").toEqual([]);
        // Critério 7 (NOD-398): no PR (N=20) o fuzz cabe em 90 s somando os dois servidores; a noturna (N maior) não tem teto aqui.
        const total = duracoes.reduce((x, y) => x + y, 0);
        // eslint-disable-next-line no-console
        console.log(`fuzz-acoes: total ${total.toFixed(1)} s (orçamento do PR: 90 s com FUZZ_N=20)`);
        // eslint-disable-next-line no-console
        console.log(`fuzz-acoes: esperas pelo banco quieto que estouraram o prazo: ${quietude.esgotou}`);
        // eslint-disable-next-line no-console
        console.log(`fuzz-acoes: processos-filho barrados: ${[...new Set(processosBloqueados)].join(", ") || "nenhum"}`);
        // O teto só vale onde o ci.yml o define (FUZZ_TETO_S no job integration, revisão 6): no desktop-release o mesmo
        // `npm run check` roda num runner hospedado mais lento, e uma oscilação de tempo não pode derrubar um release.
        // No CI, o tempo vai ao resumo do job: é a medida do critério 7 (90 s), lida da rodada. O teto que reprova (FUZZ_TETO_S)
        // tem folga para a fila da VM compartilhada (revisão 7): pega a regressão grande, não a oscilação do runner.
        if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `fuzz-acoes (N=${N}): ${duracoes.map((d) => d.toFixed(1)).join(" s + ")} s = **${total.toFixed(1)} s** (meta do PR: < 90 s; só executarFuzz dos dois servidores, sem boot)\n\n`);
        const teto = Number(process.env.FUZZ_TETO_S ?? "");
        if (N <= 20 && teto > 0) expect(total, `o fuzz do PR passou de ${teto} s (critério 7 do NOD-398)`).toBeLessThan(teto);
      }
    }, PRAZO_DO_FUZZ_MS);

    // Critério 4 (NOD-398): ação arriscada ou pessoa_confirma nunca roda sem decisão. Lista e risco vêm do registro (lote +
    // riscoDe), os argumentos do gerador. Para cada item e cada modo em que ela tem de esperar, o gerir_bots do Nod (o
    // caminho do chat) tem de recusar a entrada ou deixá-la esperando num cartão; nunca "feita", e o bot alvo intacto.
    if (ordem === 0) it("ação arriscada ou pessoa_confirma nunca roda sem decisão, em nenhum modo em que deve esperar", async () => {
      const alvo = await srv.json<{ agente: { id: string } }>("POST", "agentes", { dono: "pessoa", nome: "Alvo do invariante", descricao: "Não pode mudar sem decisão." });
      const botId = alvo.agente.id;
      // Revisão 8: entra também a ação cujo risco depende da entrada (`riscoDe`); o risco efetivo de cada item decide abaixo.
      const arriscadas = (REGISTRO_DE_ACOES as readonly DefinicaoAcao[]).filter((d) => d.lote && (d.lote.riscoDe !== undefined || d.risco === "arriscada" || d.risco === "pessoa_confirma"));
      expect(arriscadas.map((d) => d.id).sort(), "o registro perdeu as ações arriscadas do lote").toEqual(expect.arrayContaining(["bots.excluir", "bots.mudar_modo"]));
      const linha = async () => (await srv.dbDono<{ l: string }[]>`select row_to_json(a)::text as l from (select nome, descricao, modo_aprovacao, excluido_em from agentes where id = ${botId}) a`)[0]?.l;
      // NOD-437: times.excluir (arriscada) tem a via do gerir_times: o time do invariante, com o bot alvo dentro, não pode sumir.
      const TIME_DO_INVARIANTE = "Time do invariante";
      await srv.json("POST", "times", { nome: TIME_DO_INVARIANTE, bots: [botId] });
      const linhaDoBot = linha;
      const linhaDoTime = async () => (await srv.dbDono<{ l: string }[]>`select coalesce((select row_to_json(t)::text from (select nome, nome_chave from times where nome_chave = 'time do invariante' and owner_id = ${srv.pessoa.pessoaId}) t), 'sumiu') as l`)[0]?.l;
      const ambas = async () => `${await linhaDoBot()} | ${await linhaDoTime()}`;
      const antes = await ambas();
      const violacoes: { acao: string; caso: string; motivo: string }[] = [];
      const esperas = new Map<string, number>();
      for (const def of arriscadas) {
        const fixos: Record<string, unknown>[] = def.lote!.tipo === "mudar_modo" ? [{ modo: "total" }, { modo: "manual" }, { modo: "automatico" }] : [{}];
        const doFuzz = gerarEntradas(def.schema, SEMENTE, N).flatMap((e) => {
          try { const v = e.corpo === null ? null : JSON.parse(e.corpo); return v && typeof v === "object" && !Array.isArray(v) ? [{ rotulo: e.rotulo, v: v as Record<string, unknown> }] : []; } catch { return []; }
        });
        const itens = [...fixos.map((v, i) => ({ rotulo: `fixo ${i}`, v })), ...doFuzz];
        for (const { rotulo, v } of itens) {
          const viaTimes = def.chat.estado === "vivo" && def.chat.via.ferramenta === "gerir_times";
          const item = { ...v, tipo: def.lote!.tipo, bot: botId } as unknown as AcaoLote;
          const risco = def.lote!.riscoDe?.(item) ?? def.risco;
          if (risco !== "arriscada" && risco !== "pessoa_confirma") continue;
          const modos: ModoAprovacao[] = risco === "pessoa_confirma" ? ["manual", "automatico", "total"] : ["manual", "automatico"];
          for (const modo of modos) {
            const caso = `${rotulo} (${JSON.stringify(v).slice(0, 60)}) no modo ${modo}`;
            try {
              const r = await srv.app.dentro(srv.pessoa, async (d) => {
                const r0 = await garantirNod(d, {});
                if (r0.events?.length) await d.repos.events.gravarComOutbox(r0.events);
                const nod = r0.data.nod;
                await d.repos.agentes.definirModoAprovacao(nod.id, modo);
                const t = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: nod.conversaId, agenteId: nod.id, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "fuzz do invariante", entradaConfianca: "confiavel", modelo: "auto" });
                const lote = viaTimes
                  ? await gerirTimes(d, { turnoId: t!.id, agenteId: nod.id, conversaId: nod.conversaId, resumo: "fuzz", acoes: [{ time: TIME_DO_INVARIANTE, ...v, tipo: "excluir" } as never] })
                  : await gerirBots(d, { turnoId: t!.id, agenteId: nod.id, conversaId: nod.conversaId, resumo: "fuzz", acoes: [item] });
                if (lote.events?.length) await d.repos.events.gravarComOutbox(lote.events);
                return lote.data;
              });
              // Ok: esperando num cartão (com decisão) ou recusada (falha). Nunca feita.
              const veredito = vereditoDeDecisao(r);
              // eslint-disable-next-line no-console
              if (process.env.FUZZ_DEBUG && rotulo.startsWith("fixo")) console.log(`INV ${def.id} ${caso} ${veredito} ${JSON.stringify(r).slice(0, 200)}`);
              // NOD-437: no gerir_times, excluir um time VAZIO roda direto (emenda da ADR-135); a violação é o time com bots
              // sumir sem decisão, que a linha do time do invariante confere logo abaixo.
              if (veredito === "rodou" && !viaTimes) violacoes.push({ acao: def.id, caso, motivo: `rodou sem decisão (${risco}): ${JSON.stringify(r).slice(0, 160)}` });
              if (veredito === "esperou") esperas.set(def.id, (esperas.get(def.id) ?? 0) + 1);
            } catch (e) {
              if (!ehErroDeDominio(e)) violacoes.push({ acao: def.id, caso, motivo: `erro inesperado: ${(e as Error).message.slice(0, 160)}` });
            }
            const depois = await ambas();
            if (depois !== antes) violacoes.push({ acao: def.id, caso, motivo: `o bot alvo mudou sem decisão: ${antes} → ${depois}` });
          }
        }
      }
      // eslint-disable-next-line no-console
      console.log(`fuzz-acoes[invariante de decisão]: esperas por ação ${JSON.stringify(Object.fromEntries(esperas))}; ${violacoes.length} violação(ões)`);
      expect(violacoes, relatarViolacoes(SEMENTE, N, violacoes)).toEqual([]);
      // Por AÇÃO (revisão 4): sem espera numa delas, o invariante não foi exercitado nela (tudo recusado na validação), e uma
      // regressão só nela passaria. As entradas fixas são válidas, então cada ação arriscada tem de esperar ao menos uma vez.
      const semEspera = arriscadas.map((d) => d.id).filter((id) => !esperas.get(id));
      expect(semEspera, "ações arriscadas em que nenhuma chamada chegou a esperar o cartão").toEqual([]);
    }, PRAZO_DO_FUZZ_MS);
  });
}
