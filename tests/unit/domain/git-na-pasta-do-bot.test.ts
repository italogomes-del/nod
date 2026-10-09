import { describe, expect, it } from "vitest";
import { decidirHook, type Confirmar } from "../../../src/adapters/executor/hook-nativas.ts";
import { arquivoForaDaPastaDoBot, gitForaDaPastaDoBot } from "../../../src/domain/git-na-pasta-do-bot.ts";

const HOME = "/Users/m";
const PASTA = "/Users/m/nod/Dev 4";
const CLONE = "/Users/m/code/acme/main-repos/acme";
const naPasta = (comando: string, cwd: string | null = PASTA) => gitForaDaPastaDoBot(comando, { cwd, pastaDoBot: PASTA, home: HOME });

describe("git que mexe na pasta de trabalho só dentro de ~/nod/<bot> (ADR-065)", () => {
  it("nega trocar de branch, commitar ou descartar no clone da pessoa, por cd, -C ou cwd", () => {
    expect(naPasta(`cd ${CLONE} && git switch -c feat/filtros`)).toContain(`mexeria em ${CLONE}, fora da sua pasta`);
    expect(naPasta("cd ~/code/acme/main-repos/acme && git checkout main")).toContain(CLONE);
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
    expect(naPasta(`cd ~/nod/"Dev 4"/acme-86akr9u9u && git commit -m "$(cat <<'EOF'\nfeat: filtros\nEOF\n)"`)).toBeNull();
    expect(naPasta("git switch -c feat/filtros", `${PASTA}/acme-86akr9u9u`)).toBeNull();
    expect(naPasta(`git -C "${PASTA}/acme-86akr9u9u" rebase origin/main`, CLONE)).toBeNull();
  });

  it("o que só lê, o fetch, o push e o worktree add no clone da pessoa passam: é por eles que a worktree nasce", () => {
    for (const comando of [
      `git -C ${CLONE} fetch origin`,
      `git -C ${CLONE} worktree add "${PASTA}/acme-86akr9u9u" -b feat/filtros origin/main`,
      "git status && git log --oneline -5",
      "git stash list",
      "git push -u origin feat/filtros",
      "gh pr view 481",
      "npm test",
    ]) expect(naPasta(comando, CLONE), comando).toBeNull();
  });

  it("ADR-088: na task, a worktree nova nasce dentro da pasta dela; fora (a raiz do bot, outro lugar) é negada com o caminho certo", () => {
    const TASK = `${PASTA}/fix-filtros-abc123`;
    const naTask = (comando: string, cwd: string | null = TASK) => gitForaDaPastaDoBot(comando, { cwd, pastaDoBot: TASK, home: HOME, daTask: true });
    for (const comando of [
      `git -C ${CLONE} worktree add "${TASK}/acme" -b feat/filtros origin/main`,
      `git -C ${CLONE} worktree add -b feat/filtros ~/nod/"Dev 4"/fix-filtros-abc123/acme origin/main`,
      `cd ${TASK} && git -C ${CLONE} worktree add --detach "${TASK}/acme"`,
      `git worktree add acme -b feat/x`,
      `git -C ${CLONE} worktree list`,
    ]) expect(naTask(comando), comando).toBeNull();
    const naRaiz = naTask(`git -C ${CLONE} worktree add "${PASTA}/acme-86akr9u9u" -b feat/filtros origin/main`);
    expect(naRaiz).toContain(`criaria a worktree em ${PASTA}/acme-86akr9u9u, fora da pasta desta task`);
    expect(naRaiz).toContain(`worktree add "${TASK}/<repo>" -b <branch> origin/main`);
    expect(naRaiz).toContain("o nod apaga a worktree");
    expect(naTask(`git -C ${CLONE} worktree add ../outra -b x`)).toContain("/Users/m/code/acme/main-repos/outra");
    expect(naTask(`git -C ${CLONE} worktree add "$DESTINO" -b x`)).toContain("numa pasta que não deu para conferir");
    // Revisão do #225: `worktree move` segue a regra do add; caixa e acento (NFD) não enganam a comparação.
    expect(naTask(`git -C ${CLONE} worktree move "${TASK}/acme" "${PASTA}/acme"`)).toContain("fora da pasta desta task");
    expect(naTask(`git -C ${CLONE} worktree move "${TASK}/acme" "${TASK}/acme-2"`)).toBeNull();
    expect(naTask(`git -C ${CLONE} worktree add "/users/m/NOD/dev 4/fix-filtros-abc123/acme" -b x`)).toBeNull();
    expect(gitForaDaPastaDoBot(`git -C ${CLONE} worktree add "/Users/m/nod/Cecília/t-1/acme" -b x`, { cwd: null, pastaDoBot: "/Users/m/nod/Cecília/t-1".normalize("NFD"), home: HOME, daTask: true })).toBeNull();
    // A mensagem do git que mexe fora da pasta também ensina a worktree dentro da task.
    expect(naTask("git switch main", CLONE)).toContain(`worktree add "${TASK}/<repo>"`);
  });

  it("ADR-088: sem task, a worktree nasce dentro da pasta do bot, como antes", () => {
    expect(naPasta(`git -C ${CLONE} worktree add /tmp/acme -b x`)).toContain("criaria a worktree em /tmp/acme, fora da sua pasta");
    expect(naPasta(`git -C ${CLONE} worktree add "${PASTA}" -b x`)).toContain("fora da sua pasta");
    expect(naPasta(`git -C ${CLONE} worktree add "${PASTA}/acme-86akr9u9u" -b x`)).toBeNull();
  });

  it("pasta que depende do shell, ou cwd desconhecido, não passa quando o git mexe", () => {
    expect(naPasta("cd $REPO && git commit -m x")).toContain("roda numa pasta que não deu para conferir");
    expect(naPasta("git commit -m x", null)).toContain("não deu para conferir");
    expect(naPasta("git status", null)).toBeNull();
  });

  it("ADR-066: gravar fora da pasta do bot vai ao servidor com o arquivo (o modo decide); dentro, só a trilha", async () => {
    expect(arquivoForaDaPastaDoBot(`${CLONE}/apps/web/filtros.tsx`, { cwd: PASTA, pastaDoBot: PASTA, home: HOME })).toBe(`${CLONE}/apps/web/filtros.tsx`);
    expect(arquivoForaDaPastaDoBot(`${PASTA}/acme-86akr9u9u/apps/web/filtros.tsx`, { cwd: CLONE, pastaDoBot: PASTA, home: HOME })).toBeNull();
    expect(arquivoForaDaPastaDoBot("notas.md", { cwd: PASTA, pastaDoBot: PASTA, home: HOME })).toBeNull();
    const pedidos: unknown[] = [];
    const confirmar: Confirmar = async (p) => { pedidos.push(p); return { permitir: true }; };
    const pastas = { pastaDoBot: PASTA, home: HOME };
    await decidirHook({ tool_name: "Edit", tool_input: { file_path: `${CLONE}/apps/web/filtros.tsx` }, cwd: PASTA }, confirmar, pastas);
    await decidirHook({ tool_name: "Write", tool_input: { file_path: `${PASTA}/acme-x/a.ts` }, cwd: PASTA }, confirmar, pastas);
    await decidirHook({ tool_name: "Read", tool_input: { file_path: `${CLONE}/README.md` }, cwd: PASTA }, confirmar, pastas);
    expect(pedidos).toEqual([
      { ferramenta: "Edit", contamina: false, arquivo: `${CLONE}/apps/web/filtros.tsx` },
      { ferramenta: "Write", contamina: false },
      { ferramenta: "Read", contamina: false },
    ]);
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
