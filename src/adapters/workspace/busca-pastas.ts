import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";

/**
 * definido em 2026-09-18: o produto descobre a pasta do projeto em vez de mandar a pessoa procurar
 * no Finder — o agente chutava "~/Projetos/nod" para um repositório que mora em "~/code/nod".
 * A varredura lê SÓ nomes de diretório, nunca conteúdo de arquivo, e nunca sai da pasta pessoal.
 */
export type Candidata = { caminho: string; nome: string; git: boolean; pontuacao: number };
export type Busca = { candidatas: Candidata[]; truncado: boolean };

/** Pastas onde projetos costumam morar; ordena a fila, não restringe o alcance. */
export const BASES_PROVAVEIS = ["code", "dev", "Projetos", "projects", "src", "repos", "work", "Documents", "Desktop"] as const;
/** Nunca descer aqui: volume alto, irrelevante para projetos, ou privado do sistema. */
export const IGNORADAS = new Set(["node_modules", "Library", "Applications", "venv", "target", "dist", "build", "vendor", "Pictures", "Music", "Movies", "Downloads"]);
/** Marcas de raiz de projeto: elevam a candidata acima de uma pasta homônima qualquer. */
export const MARCAS_PROJETO = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml", "Gemfile"] as const;
export const PROFUNDIDADE_MAX = 4;
export const ENTRADAS_MAX = 20_000;
export const MS_MAX = 2_500;
export const RESULTADOS_MAX = 8;

/** Sem acento e sem caixa: "Relatório" e "relatorio" devem casar. */
function normalizar(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Busca em largura a partir da pasta pessoal, com orçamento de entradas e de tempo.
 * `podeAutorizar` é a MESMA regra usada para conceder: candidata não autorizável não é oferecida,
 * para o card nunca propor uma pasta que a concessão vai recusar depois.
 */
export async function buscarPastas(termo: string, opcoes: { podeAutorizar: (caminho: string) => Promise<boolean> | boolean; base?: string; agora?: () => number }): Promise<Busca> {
  const alvo = normalizar(termo.trim());
  if (alvo === "") return { candidatas: [], truncado: false };
  const agora = opcoes.agora ?? Date.now;
  const limite = agora() + MS_MAX;
  const raiz = await realpath(opcoes.base ?? homedir());
  const achadas = new Map<string, Candidata>();
  let entradas = 0;
  let truncado = false;
  let fila: string[] = [raiz];

  // nivel é a distância da base até os FILHOS examinados, então o corte é < PROFUNDIDADE_MAX:
  // com PROFUNDIDADE_MAX=4, a candidata mais funda aceita é ~/a/b/c/alvo.
  for (let nivel = 0; nivel < PROFUNDIDADE_MAX && fila.length > 0; nivel++) {
    const proxima: string[] = [];
    for (const dir of fila) {
      if (entradas >= ENTRADAS_MAX || agora() >= limite) { truncado = true; break; }
      let itens;
      try { itens = await readdir(dir, { withFileTypes: true }); }
      catch { continue; } // pasta sem permissão ou removida no meio da varredura não derruba a busca
      for (const item of itens) {
        entradas++;
        // Link não é seguido: evita ciclo e evita escapar da pasta pessoal por um atalho.
        if (!item.isDirectory() || item.isSymbolicLink()) continue;
        if (item.name.startsWith(".") || IGNORADAS.has(item.name)) continue;
        const caminho = join(dir, item.name);
        proxima.push(caminho);
        const nome = normalizar(item.name);
        const pontuacaoNome = nome === alvo ? 100 : nome.startsWith(alvo) ? 60 : nome.includes(alvo) ? 30 : 0;
        if (pontuacaoNome === 0 || achadas.has(caminho)) continue;
        if (!await opcoes.podeAutorizar(caminho)) continue;
        const git = await existe(join(caminho, ".git"));
        const marca = git || (await Promise.all(MARCAS_PROJETO.map(m => existe(join(caminho, m))))).some(Boolean);
        // Mais raso vence empate: ~/code/nod antes de ~/code/velho/backup/nod.
        achadas.set(caminho, { caminho, nome: item.name, git, pontuacao: pontuacaoNome + (git ? 25 : 0) + (marca ? 10 : 0) - nivel * 2 });
      }
    }
    if (truncado) break;
    // Locais prováveis primeiro: acha ~/code/nod antes de gastar orçamento no resto da home.
    fila = nivel === 0 ? ordenarPorProbabilidade(proxima) : proxima;
  }

  const candidatas = [...achadas.values()].sort((a, b) => b.pontuacao - a.pontuacao || a.caminho.length - b.caminho.length);
  return { candidatas: candidatas.slice(0, RESULTADOS_MAX), truncado: truncado || candidatas.length > RESULTADOS_MAX };
}

function ordenarPorProbabilidade(caminhos: string[]): string[] {
  const peso = (c: string) => {
    const i = BASES_PROVAVEIS.indexOf(basename(c) as typeof BASES_PROVAVEIS[number]);
    return i === -1 ? BASES_PROVAVEIS.length : i;
  };
  return [...caminhos].sort((a, b) => peso(a) - peso(b));
}

async function existe(caminho: string): Promise<boolean> {
  try { await stat(caminho); return true; } catch { return false; }
}

/** Reexportado para quem monta o card: mesma noção de "dentro" usada na concessão. */
export function dentroDe(raiz: string, alvo: string): boolean {
  const r = relative(raiz, alvo);
  return r === "" || (r !== ".." && !r.startsWith(`..${sep}`) && dirname(r) !== "..");
}
