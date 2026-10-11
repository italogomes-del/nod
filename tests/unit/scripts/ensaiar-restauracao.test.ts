import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * NOD-205: o ensaio de restauração roda contra a produção, então o que dá para provar sem GCP fica aqui:
 * a ordem clone → comparação → apagamento no `--simular` (sem chamar o gcloud), a recusa de apagar fora do
 * prefixo antes de qualquer chamada, a validação do instante e a decisão da comparação.
 */
const RAIZ = join(import.meta.dirname, "../../..");
const SCRIPT = join(RAIZ, "infra/gcp/ensaiar-restauracao.sh");
const WORKFLOW = join(RAIZ, ".github/workflows/ensaio-restauracao.yml");
// Um gcloud que não existe: se o script chamar o gcloud de verdade, falha.
const ENV = { ...process.env, GCLOUD: "/nao/existe/gcloud", GITHUB_STEP_SUMMARY: "" };
const tmp = mkdtempSync(join(tmpdir(), "ensaio-205-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function rodar(args: string[]) {
  const r = spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8", env: ENV, timeout: 20_000 });
  return { status: r.status, saida: r.stdout + r.stderr };
}

/** Carrega o script como biblioteca (sem rodar o main) e executa um trecho. */
function funcao(trecho: string) {
  const r = spawnSync("bash", ["-c", `source "$1"; ${trecho}`, "ensaio", SCRIPT], { encoding: "utf8", env: ENV, timeout: 20_000 });
  return { status: r.status, saida: r.stdout + r.stderr };
}

function medidas(nome: string, producao: Record<string, string>, copia: Record<string, string>) {
  const arquivo = join(tmp, nome);
  const linhas = [...Object.entries(producao).map(([k, v]) => `producao ${k} ${v}`), ...Object.entries(copia).map(([k, v]) => `copia ${k} ${v}`)];
  writeFileSync(arquivo, linhas.join("\n") + "\n");
  return arquivo;
}

const BASE = { migracoes_n: "66", migracoes_md5: "2b5b02083a4f0418134796fe6d7967ec", migracoes_ultima: "0066_maquina_do_bot.sql", pessoas_count: "12", pessoas_live: "12", tabelas: "68", linhas: "5000" };

describe("ensaiar-restauracao.sh", () => {
  it("passa no bash -n", () => {
    expect(spawnSync("bash", ["-n", SCRIPT]).status).toBe(0);
  });

  it("--simular imprime clone → comparação pela nod-vm → apagamento, sem chamar o gcloud", () => {
    const { status, saida } = rodar(["--simular", "--copia", "nod-pg-ensaio-42"]);
    expect(status, saida).toBe(0);
    const ordem = [
      saida.indexOf("sql instances clone nod-pg nod-pg-ensaio-42"),
      saida.indexOf("compute ssh nod-vm"),
      saida.indexOf("sql instances patch nod-pg-ensaio-42 --no-deletion-protection"),
      saida.indexOf("sql instances delete nod-pg-ensaio-42"),
      saida.indexOf("sql instances list --filter=name:nod-pg-ensaio-*"),
    ];
    expect(ordem.every((i) => i >= 0), saida).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(saida).toContain("--tunnel-through-iap");
    expect(saida).not.toContain("/nao/existe");
  });

  it("--simular com instante passa o --point-in-time; instante fora do formato é recusado antes do gcloud", () => {
    expect(rodar(["--simular", "ensaiar", "--copia", "nod-pg-ensaio-1", "--instante", "2026-10-09T12:00:00Z"]).saida).toContain("--point-in-time=2026-10-09T12:00:00Z");
    for (const ruim of ["2026-10-09 12:00", "2026-10-09T12:00:00-03:00", "x; rm -rf /"]) {
      const { status, saida } = rodar(["--simular", "ensaiar", "--copia", "nod-pg-ensaio-1", "--instante", ruim]);
      expect(status).toBe(2);
      expect(saida).not.toContain("[simular]");
    }
  });

  it("a função de apagar recusa nome fora do prefixo nod-pg-ensaio-, antes de qualquer chamada", () => {
    for (const nome of ["nod-pg", "nod-pg-ensaio-", "x-nod-pg-ensaio-1", "nod-pg-ensaio-1;rm", "NOD-PG-ENSAIO-1", ""]) {
      const { status, saida } = funcao(`SIMULAR=1; apagar_copia '${nome}'`);
      expect(status, nome).not.toBe(0);
      expect(saida).not.toContain("[simular]");
    }
    const cli = rodar(["--simular", "apagar", "--copia", "nod-pg"]);
    expect(cli.status).not.toBe(0);
    expect(cli.saida).toContain("recusado");
    expect(cli.saida).not.toContain("[simular]");
  });

  it("a função de apagar aceita uma cópia de ensaio: espera o clone, tira a proteção e apaga", () => {
    const { status, saida } = funcao("SIMULAR=1; apagar_copia nod-pg-ensaio-77");
    expect(status, saida).toBe(0);
    expect(saida.indexOf("operations list --instance=nod-pg ")).toBeLessThan(saida.indexOf("instances patch nod-pg-ensaio-77"));
    expect(saida.indexOf("instances patch nod-pg-ensaio-77")).toBeLessThan(saida.indexOf("instances delete nod-pg-ensaio-77"));
  });

  it("comparação: tudo igual bate", () => {
    const { status, saida } = funcao(`avaliar '${medidas("igual", BASE, { ...BASE, linhas: "4990" })}'`);
    expect(status, saida).toBe(0);
    expect(saida).toContain("Resultado: bateu");
    expect(saida).toContain("count(*) como nod_dono");
  });

  it("comparação: divergência em migrações, pessoas ou tabelas falha; linhas não", () => {
    for (const [chave, valor] of [["migracoes_md5", "outro"], ["pessoas_count", "11"], ["tabelas", "67"], ["migracoes_n", "65"]] as const) {
      const { status, saida } = funcao(`avaliar '${medidas(chave, BASE, { ...BASE, [chave]: valor })}'`);
      expect(status, chave).not.toBe(0);
      expect(saida).toContain("NÃO bateu");
    }
  });

  it("comparação vazia não conta: produção com 0 falha mesmo com a cópia igual", () => {
    const vazio = { ...BASE, migracoes_n: "0", migracoes_md5: "-", tabelas: "0", pessoas_count: "0", pessoas_live: "0" };
    const { status, saida } = funcao(`avaliar '${medidas("vazio", vazio, vazio)}'`);
    expect(status).not.toBe(0);
    expect(saida).toContain("comparação vazia não conta");
  });

  it("RLS escondendo pessoas do nod_dono: compara por n_live_tup e escreve o método", () => {
    const rls = { ...BASE, pessoas_count: "0", pessoas_live: "12" };
    const { status, saida } = funcao(`avaliar '${medidas("rls", rls, rls)}'`);
    expect(status, saida).toBe(0);
    expect(saida).toContain("n_live_tup");
    expect(funcao(`avaliar '${medidas("rls-diverge", rls, { ...rls, pessoas_live: "10" })}'`).status).not.toBe(0);
  });

  it("medida faltando na cópia falha", () => {
    const { pessoas_count: _p, ...semPessoas } = BASE;
    expect(funcao(`avaliar '${medidas("faltando", BASE, semPessoas)}'`).status).not.toBe(0);
  });

  it("a senha do banco entra por -e na VM e nunca por echo", () => {
    const remoto = funcao("script_comparacao").saida;
    expect(remoto).toContain("export PGPASSWORD");
    expect(remoto).toContain("docker run --rm -e PGPASSWORD ");
    expect(remoto).not.toMatch(/echo[^\n]*PGPASSWORD/);
  });
});

describe("workflow ensaio-restauracao", () => {
  const yml = readFileSync(WORKFLOW, "utf8");

  it("só roda à mão, com cópia de nome determinístico e concurrency que não cancela", () => {
    expect(yml).toMatch(/^on:\n {2}workflow_dispatch:\n/m);
    expect(yml).not.toMatch(/^ {2}(push|pull_request|schedule|workflow_run):/m);
    expect(yml).toContain("COPIA: nod-pg-ensaio-${{ github.run_id }}");
    expect(yml).toMatch(/cancel-in-progress: false/);
    expect(yml).toMatch(/timeout-minutes: 60/);
    expect(yml).toContain("service_account: ${{ vars.GCP_ENSAIO_SA }}");
  });

  it("o passo de apagar roda sempre (always) e vem depois do ensaio", () => {
    const apagar = yml.indexOf("name: Apagar a cópia");
    expect(apagar).toBeGreaterThan(yml.indexOf("name: Clonar e comparar"));
    expect(yml.slice(apagar)).toMatch(/if: always\(\)/);
    expect(yml.slice(apagar)).toContain('ensaiar-restauracao.sh apagar --copia "$COPIA"');
  });
});

describe("papéis do ensaio no provisionar.sh", () => {
  const prov = readFileSync(join(RAIZ, "infra/gcp/provisionar.sh"), "utf8");
  const permissoes = (papel: string) =>
    (new RegExp(`papel_customizado ${papel} "[^"]*" \\\\\\n\\s+(\\S+)`).exec(prov)?.[1] ?? "").split(",");

  it("só usa permissões cloudsql que existem (não há cloudsql.operations.*)", () => {
    expect(prov).not.toMatch(/cloudsql\.operations\./);
    expect(permissoes("nodEnsaioLeitura")).toEqual([
      "cloudsql.instances.get",
      "cloudsql.instances.list",
      "cloudsql.instances.clone",
      "cloudsql.instances.create",
    ]);
    expect(permissoes("nodEnsaioApagar")).toEqual(["cloudsql.instances.update", "cloudsql.instances.delete"]);
  });
});
