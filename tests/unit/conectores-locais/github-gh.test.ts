import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarBackendGh } from "../../../src/adapters/conectores-locais/github/backend-gh.ts";
import { ambienteDoGh, executarGithubNaMaquina } from "../../../src/adapters/conectores-locais/github/maquina.ts";
import { validarArgsGithub } from "../../../src/domain/github.ts";

/**
 * O lado da MÁQUINA do conector github (ADR-048): o que o proxy do turno e o app desktop executam no
 * Mac da pessoa, contra um `gh` FALSO. O falso registra cada argv em $HOME/gh.log, guarda o stdin do
 * POST em $HOME/corpo.json e responde pelo modo escrito em $HOME/modo ($HOME/espera = segundos de sono).
 */
const GH_FALSO = `#!/bin/sh
LOG="$HOME/gh.log"
printf '%s\\n' "$@" >> "$LOG"
echo "--" >> "$LOG"
MODO=$(cat "$HOME/modo" 2>/dev/null)
ESPERA=$(cat "$HOME/espera" 2>/dev/null)
[ -f "$HOME/modo_lento" ] && sleep 2
if [ -n "$ESPERA" ]; then
  touch "$HOME/rodando-$$"; sleep 1
  [ "$(ls "$HOME"/rodando-* | wc -l)" -gt 1 ] && touch "$HOME/sobreposto"
  sleep "$ESPERA"; rm -f "$HOME/rodando-$$"
fi
if [ "$MODO" = "sem_login" ]; then echo "To get started with GitHub CLI, please run:  gh auth login" >&2; exit 4; fi
if [ "$MODO" = "nao_achou" ]; then echo "gh: Not Found (HTTP 404)" >&2; exit 1; fi
case "$*" in
  *"--input -"*) cat > "$HOME/corpo.json"; echo '{"user":{"login":"marlon"},"html_url":"https://github.com/leapy/nod/pull/7#issuecomment-1"}';;
  *vnd.github.diff*) i=0; while [ $i -lt 3000 ]; do echo "+linha $i do diff"; i=$((i+1)); done;;
  *pulls/7) echo '{"number":7,"title":"Arruma o login","state":"open","user":{"login":"bruno"},"base":{"ref":"main"},"head":{"ref":"feat/login","sha":"abc1234"},"body":"descricao","html_url":"https://github.com/leapy/nod/pull/7","_links":{"self":"https://api.github.com/x"}}';;
  *) echo '[]';;
esac
`;

/**
 * medido em 2026-09-24: sob a suíte inteira com outra suíte rodando na mesma máquina, spawnar o
 * servidor stdio + o gh falso passou dos 5 s padrão do projeto unit (4 de 779 testes, uma rodada em
 * três). O teto por teste sobe só aqui, onde há processo de verdade.
 */
const PROCESSO = { timeout: 20_000 };

let casa: string;
let gh: string;
const ambiente = () => ({ PATH: "/usr/bin:/bin", HOME: casa, SEGREDO_DO_SERVIDOR: "nao-vaza" });
const executar = (capacidade: string, argumentos: Record<string, unknown>) => executarGithubNaMaquina({ capacidade, argumentos, ambiente: ambiente(), bin: gh });

beforeEach(() => {
  casa = mkdtempSync(join(tmpdir(), "nod-gh-"));
  gh = join(casa, "gh");
  writeFileSync(gh, GH_FALSO);
  chmodSync(gh, 0o755);
});

afterEach(() => {
  rmSync(casa, { recursive: true, force: true });
});

describe("conector github na máquina pelo gh (ADR-048)", PROCESSO, () => {
  it("lê o PR resumido por `gh api` com argv separado, e o ambiente do gh não leva segredo do processo", async () => {
    const r = await executar("pr_ver", { repositorio: "leapy/nod", numero: 7 });
    expect(r).toMatchObject({ isError: false, codigo: "ok" });
    expect(JSON.parse(r.conteudo)).toMatchObject({ numero: 7, titulo: "Arruma o login", autor: "bruno", head: "feat/login", head_sha: "abc1234" });
    expect(r.conteudo).not.toContain("_links");
    expect(readFileSync(join(casa, "gh.log"), "utf8").split("\n")).toEqual(["api", "--method", "GET", "-H", "Accept: application/vnd.github+json", "repos/leapy/nod/pulls/7", "--", ""]);
    const env = ambienteDoGh(ambiente());
    expect(env.SEGREDO_DO_SERVIDOR).toBeUndefined();
    expect(env.PATH).toContain("/opt/homebrew/bin");
    expect(env.HOME).toBe(casa);
  });

  it("o diff grande volta cortado ao orçamento, com a marca de corte", async () => {
    const r = await executar("pr_diff", { repositorio: "leapy/nod", numero: 7 });
    expect(r.isError).toBe(false);
    expect(r.conteudo.length).toBeLessThan(8_400);
    expect(r.conteudo).toContain("+linha 0 do diff");
    expect(r.conteudo).toMatch(/\[cortado pelo nod: \d+ de \d+ caracteres ficaram de fora/);
  });

  it("comentar manda o texto pelo stdin, nunca pela linha de comando", async () => {
    const comentario = "LGTM; mas veja `rm -rf ~` e $(id) no script";
    const r = await executar("pr_comentar", { repositorio: "leapy/nod", numero: 7, texto: comentario });
    expect(JSON.parse(r.conteudo)).toEqual({ ok: true, autor: "marlon", url: "https://github.com/leapy/nod/pull/7#issuecomment-1" });
    expect(JSON.parse(readFileSync(join(casa, "corpo.json"), "utf8"))).toEqual({ body: comentario });
    const argv = readFileSync(join(casa, "gh.log"), "utf8");
    expect(argv).not.toContain("LGTM");
    expect(argv).toContain("repos/leapy/nod/issues/7/comments");
  });

  it("gh sem login vira a frase do que fazer; 404 vira 'não encontrado'; gh ausente diz para instalar", async () => {
    writeFileSync(join(casa, "modo"), "sem_login");
    expect(await executar("pr_ver", { repositorio: "leapy/nod", numero: 7 })).toEqual({ isError: true, codigo: "sem_login", conteudo: expect.stringContaining("rode `gh auth login` nesta máquina") });
    writeFileSync(join(casa, "modo"), "nao_achou");
    expect((await executar("pr_ver", { repositorio: "leapy/nod", numero: 7 })).codigo).toBe("nao_encontrado");
    const ausente = await executarGithubNaMaquina({ capacidade: "issue_ver", argumentos: { repositorio: "leapy/nod", numero: 3 }, ambiente: ambiente(), bin: join(casa, "nao-existe") });
    expect(ausente).toMatchObject({ isError: true, codigo: "gh_ausente" });
    expect(ausente.conteudo).toContain("não está instalado");
  });

  it.each([
    [{ repositorio: "foo/bar;rm -rf ~", numero: 1 }],
    [{ repositorio: "--repo=x", numero: 1 }],
    [{ repositorio: "x/..git", numero: 1 }],
    [{ repositorio: "leapy/nod", numero: "1; touch pwned" }],
    [{ repositorio: "leapy/nod --method DELETE", numero: 1 }],
  ])("argumento malicioso %j é recusado e nenhum processo sobe", async (args) => {
    const r = await executar("pr_ver", args);
    expect(r).toMatchObject({ isError: true, codigo: "argumento_invalido" });
    expect(existsSync(join(casa, "gh.log"))).toBe(false);
    expect(existsSync(join(casa, "pwned"))).toBe(false);
  });

  it("capacidade que não existe não chega ao gh", async () => {
    expect(await executar("merge", { repositorio: "leapy/nod", numero: 1 })).toMatchObject({ isError: true, codigo: "capacidade_desconhecida" });
    expect(existsSync(join(casa, "gh.log"))).toBe(false);
  });

  it("F: pr_comentarios faz as duas requisições em PARALELO; pr_checks divide UM prazo entre as duas em sequência", async () => {
    // Cada requisição dorme e deixa uma marca enquanto dorme: a segunda só vê a marca da primeira se
    // as duas rodaram AO MESMO TEMPO (sem relógio de parede, que pisca com a máquina carregada).
    writeFileSync(join(casa, "espera"), "1");
    expect((await executar("pr_comentarios", { repositorio: "leapy/nod", numero: 7 })).isError).toBe(false);
    expect(existsSync(join(casa, "sobreposto"))).toBe(true);
    rmSync(join(casa, "espera"));
    writeFileSync(join(casa, "modo_lento"), "");
    // Prazo de 3 s para a capacidade: a primeira requisição dorme 2 s, a segunda só tem ~1 s e morre.
    const backend = criarBackendGh({ env: ambienteDoGh(ambiente()), bin: gh, prazoMs: 3_000 });
    // Com prazo por requisição (12 s cada, como antes) as duas passariam em ~4 s; com um prazo só, a segunda morre.
    await expect(backend.executar(validarArgsGithub("pr_checks", { repositorio: "leapy/nod", numero: 7 }))).rejects.toMatchObject({ codigo: "falha" });
  });
});
