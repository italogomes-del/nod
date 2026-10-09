import { describe, expect, it } from "vitest";
import { esperaEmLaco, motivoDaEsperaNegada, SLEEP_MAXIMO_S } from "../../../src/domain/espera-em-laco.ts";

/**
 * ADR-089 (#217): o laço de espera com sleep e o sleep longo são negados; o comando demorado de verdade, nunca. Os dois
 * primeiros casos são os medidos no Mac do Marlon em 09/10 (Cecília e Ze).
 */
describe("espera em laço (ADR-089)", () => {
  it.each([
    "while :; do gh run list --branch fix/x --limit 1; sleep 30; done",
    "while true; do sleep 10; gh pr checks 42; done",
    "until gh run view 123 --json status | grep -q completed; do sleep 15; done",
    "while sleep 20; do gh run list; done",
    "while :\ndo\n  gh run list\n  sleep 30\ndone",
    "cd ~/nod/Ze && while :; do git fetch; sleep 15; done > /dev/null 2>&1 &",
    "nohup bash -c 'while :; do curl -s https://x; sleep 60; done' &",
    "timeout 3600 sh -c \"until curl -sf http://deploy; do sleep 30; done\"",
    "while :; do echo $(sleep 5); done",
    "gh pr list | while read -r pr; do gh pr checks \"$pr\"; sleep 5; done",
    "while :; do for i in 1 2; do echo $i; done; sleep 30; done",
    "bash <<EOF\nwhile :; do gh run list; sleep 30; done\nEOF",
  ])("nega o laço: %s", (comando) => {
    expect(esperaEmLaco(comando)).toEqual({ tipo: "laco_com_sleep" });
  });

  it.each([
    ["sleep 120", 120],
    ["sleep 5m", 300],
    ["sleep 1h && gh run list", 3_600],
    ["nohup sleep 90 &", 90],
    ["/bin/sleep 61", 61],
    ["sleep 30 30", 60],
  ])("sleep longo: %s", (comando, segundos) => {
    const r = esperaEmLaco(comando);
    if (segundos > SLEEP_MAXIMO_S) expect(r).toEqual({ tipo: "sleep_longo", segundos });
    else expect(r).toBeNull();
  });

  it("sleep sem fim é longo", () => {
    expect(esperaEmLaco("sleep infinity")).toEqual({ tipo: "sleep_longo", segundos: Number.POSITIVE_INFINITY });
  });

  it.each([
    "npm test",
    "npm ci",
    "npm run build",
    "docker compose up -d",
    "npx vitest run tests/unit",
    "sleep 2 && curl -s http://127.0.0.1:8888/api/saude",
    "sleep 60; gh run list",
    "for i in $(seq 30); do curl -sf http://127.0.0.1:5274 && break; sleep 1; done",
    "while read -r linha; do echo \"$linha\"; done < lista.txt",
    "grep -rn sleep src",
    "grep -rn \"while :; do sleep 30; done\" docs",
    "echo 'until pronto; do sleep 300; done'",
    "# while :; do sleep 30; done\nnpm test",
    "git commit -m \"$(cat <<'EOF'\nTroca o while com sleep 90 por me_chame_as\n\nsleep 300 era o laço antigo\nEOF\n)\"",
    "cat <<EOF > notas.md\nwhile :; do sleep 30; done\nEOF",
    "git commit -m \"$(cat <<'EOF'\nIt's the bot's fix (1) for while loops\nsleep 90\nEOF\n)\"",
    "gh pr create --body \"Linha 1\nsleep 300\nwhile :; do x; done\"",
    "echo ok # sleep 300",
    "python3 -c 'import time; time.sleep(120)'",
    "node -e \"setTimeout(() => {}, 1000)\"",
  ])("passa: %s", (comando) => {
    expect(esperaEmLaco(comando)).toBeNull();
  });

  it("a mensagem aponta o me_chame_as quando ele existe e manda encerrar quando não existe", () => {
    const com = motivoDaEsperaNegada({ tipo: "laco_com_sleep" }, true);
    expect(com).toContain("me_chame_as");
    expect(com).toContain("npm ci");
    const sem = motivoDaEsperaNegada({ tipo: "sleep_longo", segundos: 300 }, false);
    expect(sem).not.toContain("me_chame_as");
    expect(sem).toContain("encerre o turno dizendo o que falta");
    expect(sem).toContain("sleep de 300 s");
  });
});
