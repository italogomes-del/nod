import { paraCadaPessoa } from "../src/adapters/fundo/escopos-de-fundo.ts";
import { criarDb } from "../src/db/client.ts";
import { log } from "../src/obs/log.ts";
import { criarRepos } from "../src/repositories/index.ts";
import type { Deps } from "../src/use-cases/tipos.ts";
import { limparEsperasAntigas } from "../src/use-cases/esperas-de-colega.ts";

/**
 * definido em 2026-10-27 (NOD-377): a limpeza única dos pedidos a colega abertos há mais de 7 dias (em 26/10, 40 em
 * produção, o mais velho com 21 d). Fecha cada um com o aviso "pedido antigo sem resposta (limpeza NOD-377)" SEM acordar
 * quem pediu (o contexto dele já se perdeu) — a mesma regra que o varredor passa a aplicar sozinho a cada volta; o script
 * só não espera a volta e mostra a lista. Idempotente: o pedido fechado sai da lista. Como nod_app, pessoa por pessoa (RLS).
 *
 *   node scripts/limpar-esperas-nod-377.ts --dry-run   # só lista
 *   node scripts/limpar-esperas-nod-377.ts             # fecha
 */
try {
  process.loadEnvFile(".env");
} catch {
  // sem .env: variáveis vêm do ambiente
}
const dryRun = process.argv.includes("--dry-run");
const url = process.env.DATABASE_URL;
if (!url) {
  log("erro", "limpar_esperas_sem_url", { variavel: "DATABASE_URL" });
  process.exit(1);
}
const db = criarDb(url, { max: 1 });
let total = 0;
let fechados = 0;
let falhas = 0;
try {
  await paraCadaPessoa(
    db,
    async (escopo, tx) => {
      // O caminho do fecho (o aviso gravado, o trabalho sincronizado) não usa serviços nem outros use-cases. Cada pedido
      // na sua transação (revisão 3 do PR #544): sem transação aberta esperando outra (o pool aqui tem uma conexão).
      const porPedido = <T>(fn: (d: Deps) => Promise<T>): Promise<T> =>
        tx((trx) => fn({ repos: criarRepos(trx, escopo), services: {} as Deps["services"], useCases: {} as Deps["useCases"], tx, escopo, agora: Date.now }));
      const r = await limparEsperasAntigas({ agora: Date.now }, { dryRun, porPedido });
      for (const p of r.data.pedidos) process.stdout.write(`${dryRun ? "fecharia" : (p.situacao ?? (p.fechado ? "fechado" : "falhou"))}\tpessoa=${escopo.pessoaId}\ttarefa=${p.tarefaId}\t${p.de} → ${p.colega}\t${p.idadeDias} d\n`);
      total += r.data.pedidos.length;
      fechados += r.data.fechados;
      falhas += r.data.falhas;
    },
    { aoFalhar: (_escopo, erro) => { throw erro; } },
  );
  process.stdout.write(dryRun ? `pedidos com mais de 7 d: ${total} (dry-run, nada gravado)\n` : `pedidos com mais de 7 d: ${total}; fechados: ${fechados}; falhas: ${falhas}\n`);
  // Revisão 7 do PR #544 (L5): com falha, o script sai com erro (o CA7 conferível no deploy).
  if (falhas > 0) process.exitCode = 1;
} finally {
  await db.end({ timeout: 2 });
}
