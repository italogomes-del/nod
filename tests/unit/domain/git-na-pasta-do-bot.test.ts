import { describe, expect, it } from "vitest";
import { decidirHook, type Confirmar } from "../../../src/adapters/executor/hook-nativas.ts";
import { gitForaDaPastaDoBot } from "../../../src/domain/git-na-pasta-do-bot.ts";

const HOME = "/Users/m";
const PASTA = "/Users/m/nod/Dev 4";
const CLONE = "/Users/m/code/leapy/main-repos/leapy";
const naPasta = (comando: string, cwd: string | null = PASTA) => gitForaDaPastaDoBot(comando, { cwd, pastaDoBot: PASTA, home: HOME });

describe("git que mexe na pasta de trabalho só dentro de ~/nod/<bot> (ADR-065)", () => {
  it("nega trocar de branch, commitar ou descartar no clone da pessoa, por cd, -C ou cwd", () => {
    expect(naPasta(`cd ${CLONE} && git switch -c feat/filtros`)).toContain(`mexeria em ${CLONE}, fora da sua pasta`);
    expect(naPasta("cd ~/code/leapy/main-repos/leapy && git checkout main")).toContain(CLONE);
    expect(naPasta(`git -C ${CLONE} commit -am "fix"`)).toContain("git commit");
    expect(naPasta("git pull", CLONE)).toContain("git pull");
    expect(naPasta("git stash", CLONE)).toContain("git stash");
    expect(naPasta("gh pr checkout 481", CLONE)).toContain("gh pr checkout");
    // O commit que o Claude Code escreve, com heredoc numa substituição: a pasta vem do cd que está antes.
    expect(naPasta(`cd ${CLONE} && git commit -m "$(cat <<'EOF'\nfeat: x\nEOF\n)"`)).toContain("git commit");
  });

  it("a mensagem diz como fazer certo: worktree na pasta do bot", () => {
    expect(naPasta("git switch main", CLONE)).toContain(`worktree add "${PASTA}/<repo>-<task>" -b <branch> origin/main`);
  });

  it("deixa rodar dentro da worktree do bot, inclusive com espaço no nome e heredoc no commit", () => {
    expect(naPasta(`cd ~/nod/"Dev 4"/leapy-86akr9u9u && git commit -m "$(cat <<'EOF'\nfeat: filtros\nEOF\n)"`)).toBeNull();
    expect(naPasta("git switch -c feat/filtros", `${PASTA}/leapy-86akr9u9u`)).toBeNull();
    expect(naPasta(`git -C "${PASTA}/leapy-86akr9u9u" rebase origin/main`, CLONE)).toBeNull();
  });

  it("o que só lê, o fetch, o push e o worktree add no clone da pessoa passam: é por eles que a worktree nasce", () => {
    for (const comando of [
      `git -C ${CLONE} fetch origin`,
      `git -C ${CLONE} worktree add "${PASTA}/leapy-86akr9u9u" -b feat/filtros origin/main`,
      "git status && git log --oneline -5",
      "git stash list",
      "git push -u origin feat/filtros",
      "gh pr view 481",
      "npm test",
    ]) expect(naPasta(comando, CLONE), comando).toBeNull();
  });

  it("pasta que depende do shell, ou cwd desconhecido, não passa quando o git mexe", () => {
    expect(naPasta("cd $REPO && git commit -m x")).toContain("roda numa pasta que não deu para conferir");
    expect(naPasta("git commit -m x", null)).toContain("não deu para conferir");
    expect(naPasta("git status", null)).toBeNull();
  });

  it("o hook nega antes do servidor quando o config traz a pasta do bot; config antigo não liga a cerca", async () => {
    const pedidos: unknown[] = [];
    const confirmar: Confirmar = async (p) => { pedidos.push(p); return { permitir: true }; };
    const evento = { tool_name: "Bash", tool_input: { command: "git switch main" }, cwd: CLONE };
    const negado = await decidirHook(evento, confirmar, { pastaDoBot: PASTA, home: HOME });
    expect(negado.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(negado.hookSpecificOutput.permissionDecisionReason).toContain("fora da sua pasta");
    expect(pedidos).toEqual([]);
    expect((await decidirHook(evento, confirmar)).hookSpecificOutput.permissionDecision).toBe("allow");
  });
});
