import type { ConectorGuardado } from "../contracts/conector.ts";
import { COMANDO_GITHUB_NATIVO, ENV_TOKEN_GITHUB, SLUG_GITHUB } from "../contracts/github.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { conectorPublico } from "./registrar-conector.ts";
import type { Deps } from "./tipos.ts";

export type ResultadoGithubPeloGh =
  | { ok: true; conector: ConectorGuardado }
  /**
   * `sem_gh`: não há gh logado aqui (ou o conector roda no servidor); `legado`: há o github do Composio
   * por HTTP; `desligado`: a pessoa desligou o conector. Os dois últimos só a pessoa muda.
   */
  | { ok: false; motivo: "sem_gh" | "legado" | "desligado" | "sonda_falhou" };

/**
 * Registro sem configuração (ADR-047): se o `gh` desta máquina está logado, o conector `github`
 * nasce (ou é trocado para) o nativo e é sondado na hora — habilitado, com o catálogo de nomes
 * estáveis, sem a pessoa preencher nada. Chamado quando a pessoa abre "Conectar GitHub" e quando um
 * agente pede acesso ao GitHub (pedir-acesso.ts), para o card já sair com o botão de permitir.
 *
 * Nada é CONCEDIDO aqui: conector habilitado é só o app disponível; a concessão continua sendo o
 * clique da pessoa (ADR-044). `pelaPessoa` só vem do clique em "Conectar": um agente pedindo acesso
 * nunca troca por baixo o conector que a pessoa ligou pelo Composio (as concessões dele são pelos
 * nomes GITHUB_* e deixariam de casar com o catálogo novo) nem religa o que ela desligou.
 */
export async function garantirGithubPeloGh(deps: Deps, opcoes: { pelaPessoa: boolean }): Promise<ResultadoGithubPeloGh> {
  const local = deps.services.githubLocal;
  if (!local) return { ok: false, motivo: "sem_gh" };
  const achado = await deps.repos.conectores.buscarPorSlug(SLUG_GITHUB);
  const meu = achado && achado.ownerId === deps.escopo.pessoaId ? achado : null;
  // Pedido de agente com o GitHub já pronto: nada a fazer. O clique da pessoa ("Reconectar") ressonda.
  if (meu?.comando === COMANDO_GITHUB_NATIVO && meu.habilitado && !opcoes.pelaPessoa) return { ok: true, conector: meu };
  if (meu && meu.comando !== COMANDO_GITHUB_NATIVO && !opcoes.pelaPessoa) return { ok: false, motivo: "legado" };
  // Catálogo sondado e desligado = a pessoa desligou; catálogo vazio = nunca sondou com sucesso.
  if (meu && !meu.habilitado && meu.catalogo.length > 0 && !opcoes.pelaPessoa) return { ok: false, motivo: "desligado" };
  if (!(await local.ghLogado())) return { ok: false, motivo: "sem_gh" };

  const nativo = meu?.comando === COMANDO_GITHUB_NATIVO
    ? meu
    : meu
      ? await deps.repos.conectores.tornarNativo(meu.id, { comando: COMANDO_GITHUB_NATIVO, envCifrado: null, envChaves: [] })
      // 'toca' como o github do Composio: código e issues podem citar pessoas (ADR-002, default fechado).
      : await deps.repos.conectores.criar({ nome: "GitHub", slug: SLUG_GITHUB, transporte: "stdio", comando: COMANDO_GITHUB_NATIVO, declaracao: "toca" });
  if (!nativo) return { ok: false, motivo: "sonda_falhou" };
  const sonda = await deps.services.conectores.sondar(conectorPublico(nativo));
  const agora = deps.agora();
  const atualizado = await deps.repos.conectores.registrarSonda(nativo.id, sonda.ok ? { ok: true, catalogo: sonda.ferramentas, agora } : { ok: false, motivo: sonda.motivo, agora });
  if (!sonda.ok || !atualizado) return { ok: false, motivo: "sonda_falhou" };
  return { ok: true, conector: atualizado };
}

/**
 * definido em 2026-09-24: o formato dos tokens do GitHub (clássico `ghp_`, fino `github_pat_`). Só
 * isso: se o GitHub aceita o token, quem pergunta é a rota, antes de guardar.
 */
const TOKEN = /^(ghp_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255})$/;

export function formatoDeTokenGithub(token: string): boolean {
  return TOKEN.test(token);
}

/**
 * Jeito 3 (ADR-047): o token pessoal colado no campo avançado vai CIFRADO para o env do conector
 * `github` (chave GITHUB_TOKEN), mesclado com o que já estava lá (o login do Composio, se houver).
 * Quem não tinha conector ganha o nativo; o `github` do Composio por HTTP é trocado no lugar. A
 * sonda vem depois, em OUTRA transação: `carregar` só decifra o env de linha já gravada.
 */
export async function guardarTokenGithub(deps: Deps, input: { token: string; cifrar: (s: string) => string; decifrar: (s: string) => string }): Promise<ConectorGuardado> {
  const token = input.token.trim();
  if (!formatoDeTokenGithub(token)) throw new ErroDeDominio("entrada_invalida", { cause: "token do GitHub" });
  const achado = await deps.repos.conectores.buscarPorSlug(SLUG_GITHUB);
  const meu = achado && achado.ownerId === deps.escopo.pessoaId ? achado : null;
  const nativo = meu?.comando === COMANDO_GITHUB_NATIVO ? meu : null;
  const anterior = nativo?.envCifrado ? (JSON.parse(input.decifrar(nativo.envCifrado)) as Record<string, string>) : {};
  const env = { ...anterior, [ENV_TOKEN_GITHUB]: token };
  const envCifrado = input.cifrar(JSON.stringify(env));
  const envChaves = Object.keys(env).sort();
  const salvo = nativo
    ? ((await deps.repos.conectores.atualizarEnv(nativo.id, { envCifrado, envChaves })) ? await deps.repos.conectores.buscar(nativo.id) : null)
    : meu
      ? await deps.repos.conectores.tornarNativo(meu.id, { comando: COMANDO_GITHUB_NATIVO, envCifrado, envChaves })
      : await deps.repos.conectores.criar({ nome: "GitHub", slug: SLUG_GITHUB, transporte: "stdio", comando: COMANDO_GITHUB_NATIVO, envCifrado, envChaves, declaracao: "toca" });
  if (!salvo) throw new ErroDeDominio("nao_encontrado", { cause: "conector github" });
  return salvo;
}
