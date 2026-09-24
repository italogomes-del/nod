import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CAMINHO_SERVIDOR_GITHUB, configGithubNativo } from "../../../src/adapters/conectores-locais/github/nativo.ts";
import { criarClienteMcp, type ClienteMcp } from "../../../src/adapters/mcp-proxy/cliente-mcp.ts";

/**
 * O conector nativo de verdade (processo stdio + backend gh) contra um `gh` FALSO posto primeiro no
 * PATH. O falso registra cada argv em $HOME/gh.log e responde pelo modo escrito em $HOME/modo — o
 * ambiente do gh é a allowlist de conector nativo, então o teste só conversa com ele por HOME.
 */
const GH_FALSO = `#!/bin/sh
LOG="$HOME/gh.log"
printf '%s\\n' "$@" >> "$LOG"
echo "--" >> "$LOG"
MODO=$(cat "$HOME/modo" 2>/dev/null)
if [ "$MODO" = "sem_login" ]; then echo "To get started with GitHub CLI, please run:  gh auth login" >&2; exit 4; fi
if [ "$MODO" = "nao_achou" ]; then echo "gh: Not Found (HTTP 404)" >&2; exit 1; fi
case "$*" in
  *"--input -"*) cat > "$HOME/corpo.json"; echo '{"user":{"login":"marlon"},"html_url":"https://github.com/leapy/nod/pull/7#issuecomment-1"}';;
  *vnd.github.diff*) i=0; while [ $i -lt 3000 ]; do echo "+linha $i do diff"; i=$((i+1)); done;;
  *pulls/7) echo '{"number":7,"title":"Arruma o login","state":"open","user":{"login":"bruno"},"base":{"ref":"main"},"head":{"ref":"feat/login","sha":"abc1234"},"body":"descricao","additions":3,"deletions":1,"changed_files":2,"html_url":"https://github.com/leapy/nod/pull/7","_links":{"self":"https://api.github.com/x"}}';;
  *) echo '[]';;
esac
`;

let casa: string;
let cliente: ClienteMcp;

function texto(r: { conteudo: string }): string {
  return r.conteudo;
}

beforeEach(() => {
  casa = mkdtempSync(join(tmpdir(), "nod-gh-"));
  const dir = mkdtempSync(join(casa, "bin-"));
  writeFileSync(join(dir, "gh"), GH_FALSO);
  chmodSync(join(dir, "gh"), 0o755);
  const r = configGithubNativo({ onde: "maquina_da_pessoa", envConector: {}, ghLogado: true, app: null, ambiente: { PATH: `${dir}:/usr/bin:/bin`, HOME: casa, SEGREDO_DO_SERVIDOR: "nao-vaza" } });
  if (!r.ok) throw new Error("jeito");
  expect(r.cfg.jeito).toBe("gh");
  expect(r.cfg.args).toEqual([CAMINHO_SERVIDOR_GITHUB]);
  expect(r.cfg.env.SEGREDO_DO_SERVIDOR).toBeUndefined();
  cliente = criarClienteMcp({ nome: "github", transporte: "stdio", comando: r.cfg.comando, args: r.cfg.args, env: r.cfg.env, timeoutMs: 10_000 });
});

afterEach(async () => {
  await cliente.fechar();
  rmSync(casa, { recursive: true, force: true });
});

describe("conector github nativo pelo gh (ADR-047)", () => {
  it("lista os nomes estáveis com readOnlyHint e lê o PR resumido, por `gh api` com argv separado", async () => {
    const ferramentas = await cliente.listar();
    expect(ferramentas.map((f) => [f.name, f.annotations?.readOnlyHint])).toEqual([
      ["pr_ver", true], ["pr_diff", true], ["pr_arquivos", true], ["pr_comentarios", true], ["pr_checks", true], ["arquivo_ler", true], ["issue_ver", true], ["pr_comentar", false], ["pr_revisar", false],
    ]);
    const r = await cliente.chamar("pr_ver", { repositorio: "leapy/nod", numero: 7 });
    expect(r.isError).toBe(false);
    const pr = JSON.parse(texto(r)) as Record<string, unknown>;
    expect(pr).toMatchObject({ numero: 7, titulo: "Arruma o login", autor: "bruno", head: "feat/login", head_sha: "abc1234" });
    expect(texto(r)).not.toContain("_links");
    expect(readFileSync(join(casa, "gh.log"), "utf8").split("\n")).toEqual(["api", "--method", "GET", "-H", "Accept: application/vnd.github+json", "repos/leapy/nod/pulls/7", "--", ""]);
  });

  it("o diff grande volta cortado ao orçamento, com a marca de corte", async () => {
    const r = await cliente.chamar("pr_diff", { repositorio: "leapy/nod", numero: 7 });
    expect(r.isError).toBe(false);
    expect(texto(r).length).toBeLessThan(8_400);
    expect(texto(r)).toContain("+linha 0 do diff");
    expect(texto(r)).toMatch(/\[cortado pelo nod: \d+ de \d+ caracteres ficaram de fora/);
  });

  it("comentar manda o texto pelo stdin, nunca pela linha de comando", async () => {
    const comentario = "LGTM; mas veja `rm -rf ~` e $(id) no script";
    const r = await cliente.chamar("pr_comentar", { repositorio: "leapy/nod", numero: 7, texto: comentario });
    expect(JSON.parse(texto(r))).toEqual({ ok: true, autor: "marlon", url: "https://github.com/leapy/nod/pull/7#issuecomment-1" });
    expect(JSON.parse(readFileSync(join(casa, "corpo.json"), "utf8"))).toEqual({ body: comentario });
    const argv = readFileSync(join(casa, "gh.log"), "utf8");
    expect(argv).not.toContain("LGTM");
    expect(argv).toContain("repos/leapy/nod/issues/7/comments");
  });

  it("gh sem login vira a frase do que fazer: rode `gh auth login` nesta máquina", async () => {
    writeFileSync(join(casa, "modo"), "sem_login");
    const r = await cliente.chamar("pr_ver", { repositorio: "leapy/nod", numero: 7 });
    expect(r).toEqual({ isError: true, conteudo: expect.stringContaining("rode `gh auth login` nesta máquina") });
    writeFileSync(join(casa, "modo"), "nao_achou");
    expect(texto(await cliente.chamar("pr_ver", { repositorio: "leapy/nod", numero: 7 }))).toContain("não encontrado");
  });

  it.each([
    [{ repositorio: "foo/bar;rm -rf ~", numero: 1 }],
    [{ repositorio: "--repo=x", numero: 1 }],
    [{ repositorio: "leapy/nod", numero: "1; touch pwned" }],
    [{ repositorio: "leapy/nod --method DELETE", numero: 1 }],
  ])("argumento malicioso %j é recusado e nenhum processo sobe", async (args) => {
    const r = await cliente.chamar("pr_ver", args);
    expect(r.isError).toBe(true);
    expect(texto(r)).toContain("argumento inválido");
    expect(existsSync(join(casa, "gh.log"))).toBe(false);
    expect(existsSync(join(casa, "pwned"))).toBe(false);
  });

  it("gh ausente no PATH diz para instalar e logar", async () => {
    await cliente.fechar();
    cliente = criarClienteMcp({ nome: "github", transporte: "stdio", comando: process.execPath, args: [CAMINHO_SERVIDOR_GITHUB], env: { PATH: "/caminho/sem/gh", HOME: casa, NOD_GITHUB_JEITO: "gh" }, timeoutMs: 10_000 });
    const r = await cliente.chamar("issue_ver", { repositorio: "leapy/nod", numero: 3 });
    expect(r.isError).toBe(true);
    expect(texto(r)).toContain("não está instalado");
  });
});
