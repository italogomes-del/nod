#!/usr/bin/env node
// ADA-282: monta o snapshot público do nod a partir do gamefik/nod (privado), aplicando oss/manifesto.json, e o varre
// antes de qualquer publicação. Open core por exportação com histórico zerado (docs/open-source/auditoria.md, ADR-160):
// o repo público recebe UM commit por exportação, tirado de um ref do privado, nunca o histórico.
//
//   node scripts/oss/exportar.mjs                      export a seco num diretório temporário + varredura (padrão)
//   node scripts/oss/exportar.mjs --saida /tmp/oss     idem, num diretório escolhido (precisa estar vazio ou não existir)
//   node scripts/oss/exportar.mjs --ref <sha>          exporta outro ref (padrão HEAD); só o que está commitado entra
//   node scripts/oss/exportar.mjs --repo <dir>         exporta outro clone (padrão: o repo onde o script mora)
//   node scripts/oss/exportar.mjs --json               resumo em JSON (para a CI)
//   node scripts/oss/exportar.mjs --push=<dono/repo>   publica: só com o repo IGUAL ao manifesto, varredura limpa,
//                                                      LICENSE sem titular pendente e árvore do privado limpa.
//
// Sem --push nada sai da máquina. O push nunca roda na CI nem pelos bots: é decisão do Marlon (ADA-282).
// Sai 0 com a varredura limpa, 1 com achado (padrão proibido ou gitleaks) e 2 com erro de uso/configuração.

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TITULAR_PENDENTE = "<TITULAR A DEFINIR>";
/** Qualquer campo "<... A DEFINIR>" nos arquivos de oss/publico (titular, contato de segurança) barra o push. */
const PLACEHOLDER = /<[^<>\n]*A DEFINIR>/g;

const RAIZ_REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// ---------------------------------------------------------------- manifesto

/** Lê e valida o manifesto. Erro de forma vira exceção com a chave culpada (a CLI sai 2). */
export function validarManifesto(m) {
  const erros = [];
  if (!m || typeof m !== "object") throw new Error("manifesto: não é um objeto");
  if (m.versao !== 1) erros.push("versao precisa ser 1");
  if (typeof m.repoPublico !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(m.repoPublico)) erros.push("repoPublico precisa ser dono/repo");
  if (!Array.isArray(m.excluir) || m.excluir.some((g) => typeof g !== "string" || !g)) erros.push("excluir precisa ser lista de globs");
  if (m.imagensRevisadas !== undefined && (!Array.isArray(m.imagensRevisadas) || m.imagensRevisadas.some((g) => typeof g !== "string" || !g))) {
    erros.push("imagensRevisadas precisa ser lista de globs");
  }
  for (const [i, r] of (m.reescrever ?? []).entries()) {
    if (typeof r.para !== "string") erros.push(`reescrever[${i}].para precisa ser texto`);
    if ((typeof r.de === "string") === (typeof r.regex === "string")) erros.push(`reescrever[${i}] precisa de "de" OU "regex"`);
    if (r.caixa !== undefined && r.caixa !== "preservar") erros.push(`reescrever[${i}].caixa só aceita "preservar"`);
    if (r.regex) {
      try {
        new RegExp(r.regex, "g");
      } catch (e) {
        erros.push(`reescrever[${i}].regex inválida: ${e.message}`);
      }
    }
  }
  for (const [i, p] of (m.proibidos ?? []).entries()) {
    if ((typeof p.padrao === "string") === (typeof p.regex === "string")) erros.push(`proibidos[${i}] precisa de "padrao" OU "regex"`);
    if (typeof p.motivo !== "string" || !p.motivo) erros.push(`proibidos[${i}].motivo é obrigatório`);
    if (p.regex) {
      try {
        new RegExp(p.regex, "g");
      } catch (e) {
        erros.push(`proibidos[${i}].regex inválida: ${e.message}`);
      }
    }
  }
  for (const [i, a] of (m.aceitos ?? []).entries()) {
    if (!Array.isArray(a.arquivos) || !a.arquivos.length) erros.push(`aceitos[${i}].arquivos precisa de globs`);
    if (typeof a.proibido !== "string") erros.push(`aceitos[${i}].proibido precisa citar o motivo do proibido aceito`);
    if (typeof a.porque !== "string" || !a.porque) erros.push(`aceitos[${i}].porque é obrigatório`);
  }
  if (erros.length) throw new Error(`manifesto inválido:\n  - ${erros.join("\n  - ")}`);
  return m;
}

// O path.matchesGlob do Node não casa nome com ponto em `*`/`**` (sem opção dot): "fechado/**" deixaria passar
// "fechado/.env". Por isso o caminho também é testado com o ponto inicial de cada parte trocado por um caractere neutro.
const semPonto = (caminho) => caminho.replace(/(^|\/)\./g, "$1\u0001");
const casaUm = (caminho, g) => posix.matchesGlob(caminho, g) || posix.matchesGlob(caminho, `${g.replace(/\/$/, "")}/**`);
const casa = (caminho, globs) => globs.some((g) => casaUm(caminho, g) || casaUm(semPonto(caminho), g));

// ---------------------------------------------------------------- leitura do ref

/** Lista o ref como {caminho, modo, sha} (só blobs, links simbólicos e submódulos; sem diretórios). */
export function listarRef(repo, ref) {
  const r = git(repo, ["ls-tree", "-r", "-z", "--full-tree", ref]);
  return r
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((linha) => {
      const tab = linha.indexOf("\t");
      const [modo, tipo, sha] = linha.slice(0, tab).split(" ");
      return { caminho: linha.slice(tab + 1), modo, tipo, sha };
    });
}

/** Lê os blobs pedidos de uma vez (git cat-file --batch). Devolve Map sha → Buffer. */
export function lerBlobs(repo, shas) {
  const unicos = [...new Set(shas)];
  const mapa = new Map();
  if (!unicos.length) return mapa;
  const saida = git(repo, ["cat-file", "--batch"], unicos.join("\n") + "\n");
  let i = 0;
  while (i < saida.length) {
    const fim = saida.indexOf(10, i);
    const [sha, , tamanho] = saida.subarray(i, fim).toString("utf8").split(" ");
    const n = Number(tamanho);
    mapa.set(sha, saida.subarray(fim + 1, fim + 1 + n));
    i = fim + 1 + n + 1;
  }
  return mapa;
}

function git(repo, args, input) {
  const r = spawnSync("git", ["-C", repo, ...args], { input, maxBuffer: 2 ** 31 - 1 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr?.toString().trim()}`);
  return r.stdout;
}

// ---------------------------------------------------------------- plano do export (puro)

export const ehBinario = (buf) => buf.subarray(0, 8000).includes(0);

/**
 * Aplica o manifesto a uma lista de entradas {caminho, modo, tipo, conteudo:Buffer} e devolve o snapshot e os avisos.
 * Puro: não lê disco nem git. `extras` são os arquivos de oss/publico (sobrescrevem o que houver no mesmo caminho).
 */
export function planejarExport(entradas, manifesto, extras = []) {
  const avisos = [];
  const excluidos = [];
  const usoExclusao = new Map(manifesto.excluir.map((g) => [g, 0]));
  const arquivos = new Map();

  for (const e of entradas) {
    const globs = manifesto.excluir.filter((g) => casa(e.caminho, [g]));
    if (globs.length) {
      for (const g of globs) usoExclusao.set(g, usoExclusao.get(g) + 1);
      excluidos.push(e.caminho);
      continue;
    }
    if (e.tipo === "commit" || e.modo === "160000") {
      avisos.push(`submódulo ignorado (o snapshot não carrega submódulos): ${e.caminho}`);
      continue;
    }
    arquivos.set(e.caminho, { modo: e.modo, conteudo: e.conteudo });
  }
  for (const [g, n] of usoExclusao) if (n === 0) avisos.push(`exclusão que não casa nada (sumiu do repo?): ${g}`);

  // reescritas: só texto; a ordem do manifesto vale
  const contagem = (manifesto.reescrever ?? []).map(() => 0);
  for (const [caminho, a] of arquivos) {
    if (a.modo === "120000" || ehBinario(a.conteudo)) continue;
    let texto = a.conteudo.toString("utf8");
    const original = texto;
    for (const [i, r] of (manifesto.reescrever ?? []).entries()) {
      if (r.arquivos && !casa(caminho, r.arquivos)) continue;
      const re = new RegExp(r.regex ?? escaparRegex(r.de), `g${r.caixa === "preservar" ? "i" : ""}`);
      texto = texto.replace(re, (...m) => {
        contagem[i]++;
        const para = r.regex ? r.para.replace(/\$(\d)/g, (_, n) => m[Number(n)] ?? "") : r.para;
        return r.caixa === "preservar" ? comACaixaDe(m[0], para) : para;
      });
    }
    if (texto !== original) a.conteudo = Buffer.from(texto, "utf8");
  }
  for (const [i, n] of contagem.entries()) {
    const r = manifesto.reescrever[i];
    if (n === 0) avisos.push(`reescrita que não casa nada: ${r.de ?? r.regex}`);
  }

  // package.json: tira o "private", põe a licença e remove os scripts que apontam para arquivo excluído
  const pkg = arquivos.get("package.json");
  if (pkg && manifesto.packageJson) {
    const { json, removidos } = reescreverPackageJson(JSON.parse(pkg.conteudo.toString("utf8")), manifesto.packageJson, excluidos);
    pkg.conteudo = Buffer.from(JSON.stringify(json, null, 2) + "\n", "utf8");
    for (const s of removidos) avisos.push(`script do package.json removido (aponta para arquivo excluído): ${s}`);
  }

  for (const x of extras) arquivos.set(x.caminho, { modo: x.modo ?? "100644", conteudo: x.conteudo });

  // links simbólicos (inclusive os de oss/publico): o alvo precisa ser um arquivo do snapshot ou uma pasta com arquivo
  // do snapshot; fora do repo ("..", "../x", absoluto), excluído ou inexistente sai. Repete até estabilizar (cadeia).
  let removeu = true;
  while (removeu) {
    removeu = false;
    const pastas = new Set([...arquivos.keys()].flatMap((c) => c.split("/").slice(0, -1).map((_, i, p) => p.slice(0, i + 1).join("/"))));
    for (const [caminho, a] of arquivos) {
      if (a.modo !== "120000") continue;
      const bruto = a.conteudo.toString("utf8");
      const alvo = posix.normalize(posix.join(posix.dirname(caminho), bruto)).replace(/\/$/, "");
      let motivo = null;
      if (posix.isAbsolute(bruto) || alvo === ".." || alvo.startsWith("../") || alvo === ".") motivo = "para fora do repo";
      else if (casa(alvo, manifesto.excluir)) motivo = "para arquivo excluído";
      else if (!arquivos.has(alvo) && !pastas.has(alvo)) motivo = "para algo fora do snapshot";
      if (motivo) {
        avisos.push(`link simbólico ${motivo} removido: ${caminho} → ${motivo === "para fora do repo" ? bruto : alvo}`);
        arquivos.delete(caminho);
        removeu = true;
      }
    }
  }

  return { arquivos, excluidos, avisos };
}

export function reescreverPackageJson(json, regras, excluidos) {
  const out = { ...json };
  for (const k of regras.remover ?? []) delete out[k];
  Object.assign(out, regras.definir ?? {});
  const removidos = [];
  if (out.scripts) {
    const excl = new Set(excluidos);
    const scripts = { ...out.scripts };
    for (const [nome, cmd] of Object.entries(scripts)) {
      const caminhos = cmd.match(/(?:\.\/)?(?:scripts|infra|docs)\/[\w./-]+/g) ?? [];
      if ((regras.removerScripts ?? []).includes(nome) || caminhos.some((c) => excl.has(c.replace(/^\.\//, "")))) {
        delete scripts[nome];
        removidos.push(nome);
      }
    }
    // um script que chama outro removido (npm run x) também sai, até estabilizar
    let mudou = true;
    while (mudou) {
      mudou = false;
      for (const [nome, cmd] of Object.entries(scripts)) {
        const chamados = [...cmd.matchAll(/npm run ([\w:.-]+)/g)].map((m) => m[1]);
        if (chamados.some((c) => !(c in scripts))) {
          delete scripts[nome];
          removidos.push(nome);
          mudou = true;
        }
      }
    }
    out.scripts = scripts;
  }
  return { json: out, removidos };
}

/** "LEAPY" → "LUMEN", "Leapy" → "Lumen", "leapy" → "lumen": a reescrita sem caixa devolve na caixa do original. */
export function comACaixaDe(original, para) {
  const letras = original.replace(/[^\p{L}]/gu, "");
  if (letras && letras === letras.toUpperCase() && letras.length > 1) return para.toUpperCase();
  if (letras && letras[0] === letras[0].toUpperCase()) return para[0].toUpperCase() + para.slice(1).toLowerCase();
  return para.toLowerCase();
}

const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------- varredura (pura + gitleaks)

export const EXTENSOES_DE_IMAGEM = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|avif|ico|icns|svgz|mp4|mov|webm|pdf|zip|gz|tgz|7z|rar|docx?|xlsx?|pptx?|odt|ods|sqlite3?|db)$/i;

/** Arquivos que silenciam o gitleaks se forem parar no diretório varrido: no snapshot são achado. */
const SILENCIAM_GITLEAKS = /(^|\/)\.gitleaks(ignore|\.toml)$/;

/**
 * Procura os padrões proibidos no snapshot (conteúdo e nome do arquivo; binário em latin1 e UTF-16) e os binários e
 * imagens fora da lista revisada (uma captura de tela, um PDF ou um banco novo pode ter dado real que nenhum padrão
 * pega). Devolve os achados não aceitos.
 */
export function varrerProibidos(arquivos, manifesto) {
  const achados = [];
  for (const caminho of arquivos.keys()) {
    if (SILENCIAM_GITLEAKS.test(caminho)) achados.push({ arquivo: caminho, linha: 0, motivo: "arquivo que silencia o gitleaks no snapshot", trecho: caminho });
  }
  if (manifesto.imagensRevisadas) {
    for (const [caminho, a] of arquivos) {
      const binario = a.modo !== "120000" && (EXTENSOES_DE_IMAGEM.test(caminho) || ehBinario(a.conteudo));
      if (binario && !casa(caminho, manifesto.imagensRevisadas)) {
        achados.push({ arquivo: caminho, linha: 0, motivo: "binário ou imagem fora da lista revisada (imagensRevisadas)", trecho: caminho });
      }
    }
  }
  const regras = (manifesto.proibidos ?? []).map((p) => ({
    ...p,
    re: p.regex ? new RegExp(p.regex, `g${p.flags ?? ""}`) : new RegExp(escaparRegex(p.padrao), "gi"),
  }));
  const procurar = (caminho, texto, comLinha) => {
    for (const r of regras) {
      r.re.lastIndex = 0;
      let m;
      while ((m = r.re.exec(texto))) {
        const aceito = (manifesto.aceitos ?? []).some((ac) => ac.proibido === r.motivo && casa(caminho, ac.arquivos));
        if (!aceito) {
          const linha = comLinha ? texto.slice(0, m.index).split("\n").length : 0;
          achados.push({ arquivo: caminho, linha, motivo: r.motivo, trecho: m[0] });
        }
        if (m[0] === "") r.re.lastIndex++;
      }
    }
  };
  for (const [caminho, a] of arquivos) {
    procurar(caminho, caminho, false);
    const binario = a.modo !== "120000" && ehBinario(a.conteudo);
    if (!binario) procurar(caminho, a.conteudo.toString("utf8"), true);
    else {
      procurar(caminho, a.conteudo.toString("latin1"), false);
      // texto UTF-16 (comum em binário do Windows) nos dois alinhamentos
      procurar(caminho, a.conteudo.toString("utf16le"), false);
      procurar(caminho, a.conteudo.subarray(1).toString("utf16le"), false);
    }
  }
  return achados;
}

/** Roda o gitleaks no diretório do snapshot. null = gitleaks ausente. */
export function rodarGitleaks(dir, config) {
  const bin = process.env.GITLEAKS ?? "gitleaks";
  // Nada do snapshot nem do diretório corrente pode silenciar a varredura: `gitleaks:allow` não vale e o
  // .gitleaksignore procurado é o de uma pasta vazia (o do próprio snapshot é achado em varrerProibidos). Roda numa
  // pasta vazia para não pegar .gitleaksignore/.gitleaks.toml do cwd.
  const vazio = mkdtempSync(join(tmpdir(), "nod-oss-gitleaks-cwd-"));
  const args = ["dir", resolve(dir), "--no-banner", "--redact", "--exit-code", "0", "--report-format", "json", "--report-path", "-", "--log-level", "error"];
  args.push("--ignore-gitleaks-allow", "--gitleaks-ignore-path", vazio);
  if (config) args.push("--config", config);
  let r;
  try {
    r = spawnSync(bin, args, { encoding: "utf8", maxBuffer: 2 ** 28, cwd: vazio });
  } finally {
    rmSync(vazio, { recursive: true, force: true });
  }
  if (r.error?.code === "ENOENT") return null;
  if (r.status !== 0) throw new Error(`gitleaks falhou (${r.status}): ${r.stderr.trim()}`);
  const achados = JSON.parse(r.stdout || "[]");
  return achados.map((a) => ({ arquivo: posix.relative(resolve(dir).split("\\").join("/"), a.File.split("\\").join("/")), linha: a.StartLine, regra: a.RuleID }));
}

// ---------------------------------------------------------------- disco

export function gravarSnapshot(dir, arquivos) {
  if (existsSync(dir) && readdirSync(dir).length) throw new Error(`--saida precisa estar vazia: ${dir}`);
  mkdirSync(dir, { recursive: true });
  for (const caminho of [...arquivos.keys()].sort()) {
    const a = arquivos.get(caminho);
    const destino = join(dir, caminho);
    mkdirSync(dirname(destino), { recursive: true });
    if (a.modo === "120000") symlinkSync(a.conteudo.toString("utf8"), destino);
    else {
      writeFileSync(destino, a.conteudo);
      chmodSync(destino, a.modo === "100755" ? 0o755 : 0o644);
    }
  }
}

/** Hash estável do snapshot (caminho, modo e conteúdo): prova de determinismo e linha do resumo. */
export function hashDoSnapshot(arquivos) {
  const h = createHash("sha256");
  for (const caminho of [...arquivos.keys()].sort()) {
    const a = arquivos.get(caminho);
    h.update(`${caminho}\0${a.modo}\0`).update(a.conteudo).update("\0");
  }
  return h.digest("hex");
}

// ---------------------------------------------------------------- export completo

/**
 * Export de ponta a ponta: lê o ref, aplica o manifesto, grava em `saida` e varre.
 * `extras` vêm de oss/publico NO MESMO REF (não da árvore de trabalho), para o export ser reproduzível.
 */
export function exportar({ repo = RAIZ_REPO, ref = "HEAD", manifestoPath = "oss/manifesto.json", saida, gitleaks = true } = {}) {
  const sha = git(repo, ["rev-parse", `${ref}^{commit}`]).toString().trim();
  const manifesto = validarManifesto(JSON.parse(git(repo, ["show", `${sha}:${manifestoPath}`]).toString("utf8")));
  const lista = listarRef(repo, sha);
  const dirExtras = manifesto.raizPublica ? `${manifesto.raizPublica.replace(/\/$/, "")}/` : null;
  const daRaizPublica = (c) => dirExtras && c.startsWith(dirExtras);
  const precisa = lista.filter((e) => e.tipo === "blob" && (daRaizPublica(e.caminho) || !casa(e.caminho, manifesto.excluir)));
  const blobs = lerBlobs(repo, precisa.map((e) => e.sha));
  const entradas = lista.map((e) => ({ ...e, conteudo: blobs.get(e.sha) ?? Buffer.alloc(0) }));
  const extras = entradas.filter((e) => daRaizPublica(e.caminho)).map((e) => ({ caminho: e.caminho.slice(dirExtras.length), modo: e.modo, conteudo: e.conteudo }));
  if (dirExtras && !extras.length) throw new Error(`raizPublica ${manifesto.raizPublica} não existe no ref ${sha}`);

  const plano = planejarExport(entradas, manifesto, extras);
  const dir = saida ? resolve(saida) : mkdtempSync(join(tmpdir(), "nod-oss-"));
  gravarSnapshot(dir, plano.arquivos);

  const proibidos = varrerProibidos(plano.arquivos, manifesto);
  // a config do gitleaks também vem do ref (e fica fora do snapshot), num arquivo temporário
  let vazamentos = [];
  if (gitleaks) {
    const tmpConfig = mkdtempSync(join(tmpdir(), "nod-oss-gitleaks-"));
    try {
      let configGitleaks;
      if (manifesto.gitleaksConfig) {
        configGitleaks = join(tmpConfig, "gitleaks.toml");
        writeFileSync(configGitleaks, git(repo, ["show", `${sha}:${manifesto.gitleaksConfig}`]));
      }
      vazamentos = rodarGitleaks(dir, configGitleaks);
    } finally {
      rmSync(tmpConfig, { recursive: true, force: true });
    }
  }
  const licenca = plano.arquivos.get("LICENSE")?.conteudo.toString("utf8") ?? null;

  return {
    sha,
    dir,
    manifesto,
    arquivos: plano.arquivos,
    hash: hashDoSnapshot(plano.arquivos),
    total: plano.arquivos.size,
    excluidos: plano.excluidos.length,
    avisos: plano.avisos,
    proibidos,
    gitleaks: vazamentos,
    pendencias: [
      ...(vazamentos === null ? ["gitleaks não está instalado: a varredura de segredos não rodou"] : []),
      ...(licenca === null ? ["o snapshot não tem LICENSE"] : []),
      ...[...new Set(["LICENSE", ...extras.map((x) => x.caminho)])].sort().flatMap((c) => {
        const texto = plano.arquivos.get(c)?.conteudo.toString("utf8") ?? "";
        const campos = [...new Set(texto.match(PLACEHOLDER) ?? [])];
        if (!campos.length) return [];
        const titular = campos.includes(TITULAR_PENDENTE) ? "o titular" : "campo";
        return [`${c} com ${titular} a definir (decisão do Marlon): ${campos.join(", ")}`];
      }),
    ],
  };
}

export const limpo = (r) => r.proibidos.length === 0 && Array.isArray(r.gitleaks) && r.gitleaks.length === 0;

// ---------------------------------------------------------------- push (só com flag explícita)

/**
 * Publica o snapshot como UM commit novo sobre a main do repo público. Recusa se: o repo pedido não for o do
 * manifesto, a varredura tiver achado, houver pendência (titular, gitleaks ausente) ou o privado estiver sujo.
 * `remoto` troca a URL só para os testes (repo bare local); a CLI nunca o passa e nenhuma variável de ambiente o
 * preenche, para o push não ir a outro lugar que não o repo do manifesto.
 */
export function publicar(r, { repoPedido, repo = RAIZ_REPO, remoto } = {}) {
  const recusas = [];
  if (repoPedido !== r.manifesto.repoPublico) recusas.push(`--push=${repoPedido || "(vazio)"} não é o repo do manifesto (${r.manifesto.repoPublico})`);
  if (!limpo(r)) recusas.push("a varredura tem achados");
  recusas.push(...r.pendencias);
  if (git(repo, ["status", "--porcelain"]).toString().trim()) recusas.push("a árvore do privado tem alteração por commitar");
  if (recusas.length) throw new Error(`push recusado:\n  - ${recusas.join("\n  - ")}`);

  const url = remoto ?? `https://github.com/${r.manifesto.repoPublico}.git`;
  const trabalho = mkdtempSync(join(tmpdir(), "nod-oss-push-"));
  try {
    const g = (args) => git(trabalho, args);
    g(["init", "-q", "-b", "main"]);
    g(["remote", "add", "publico", url]);
    const temMain = spawnSync("git", ["-C", trabalho, "fetch", "-q", "--depth", "1", "publico", "main"]).status === 0;
    if (temMain) g(["reset", "-q", "--soft", "FETCH_HEAD"]);
    // a árvore do commit é exatamente o snapshot: o índice começa vazio e recebe só o que está em r.dir, inclusive o
    // que um .gitignore do snapshot ou o excludesFile global ignorariam (-f)
    g(["--work-tree", r.dir, "add", "-A", "-f", "."]);
    g(["-c", "user.name=nod export", "-c", "user.email=oss@exemplo.com", "--work-tree", r.dir, "commit", "-q", "--allow-empty", "-m", `Export de gamefik/nod@${r.sha.slice(0, 12)}\n\nSnapshot ${r.hash}`]);
    g(["push", "-q", "publico", "HEAD:main"]);
    return g(["rev-parse", "HEAD"]).toString().trim();
  } finally {
    rmSync(trabalho, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- CLI

function argumentos(argv) {
  const o = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [chave, valorIgual] = a.split(/=(.*)/s);
    const valor = () => valorIgual ?? argv[++i];
    if (chave === "--ref") o.ref = valor();
    else if (chave === "--repo") o.repo = resolve(valor());
    else if (chave === "--saida") o.saida = valor();
    else if (chave === "--manifesto") o.manifestoPath = valor();
    else if (chave === "--json") o.json = true;
    else if (chave === "--push") o.push = valorIgual ?? "";
    else throw new Error(`argumento desconhecido: ${a}`);
  }
  return o;
}

const log = (linha) => process.stdout.write(`${linha}\n`);
const erro = (linha) => process.stderr.write(`${linha}\n`);

function main() {
  let o;
  try {
    o = argumentos(process.argv.slice(2));
  } catch (e) {
    erro(e.message);
    return 2;
  }
  let r;
  try {
    r = exportar({ repo: o.repo, ref: o.ref, manifestoPath: o.manifestoPath, saida: o.saida });
  } catch (e) {
    erro(`export falhou: ${e.message}`);
    return 2;
  }
  const resumo = { sha: r.sha, dir: r.dir, hash: r.hash, total: r.total, excluidos: r.excluidos, avisos: r.avisos, proibidos: r.proibidos, gitleaks: r.gitleaks, pendencias: r.pendencias, limpo: limpo(r) };
  if (o.json) log(JSON.stringify(resumo, null, 2));
  else {
    log(`snapshot de ${r.sha.slice(0, 12)} em ${r.dir}: ${r.total} arquivos, ${r.excluidos} excluídos, hash ${r.hash.slice(0, 16)}`);
    for (const a of r.avisos) log(`aviso: ${a}`);
    for (const p of r.proibidos) log(`PROIBIDO ${p.arquivo}:${p.linha} [${p.motivo}] ${p.trecho}`);
    if (r.gitleaks) for (const g of r.gitleaks) log(`GITLEAKS ${g.arquivo}:${g.linha} [${g.regra}]`);
    for (const p of r.pendencias) log(`pendência: ${p}`);
    log(limpo(r) ? "varredura limpa" : "varredura com achados: o snapshot NÃO pode ser publicado");
  }
  if (o.push !== undefined) {
    try {
      const commit = publicar(r, { repoPedido: o.push, repo: o.repo });
      log(`publicado em ${r.manifesto.repoPublico}: ${commit}`);
    } catch (e) {
      erro(e.message);
      return limpo(r) ? 2 : 1;
    }
  }
  return limpo(r) ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
