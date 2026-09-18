import type { AcaoComputador } from "../contracts/computador.ts";
import { ErroDeDominio } from "./erro.ts";

export function validarAcaoComputador(valor: unknown): AcaoComputador {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) throw new ErroDeDominio("entrada_invalida");
  const a = valor as Record<string, unknown>;
  const texto = (k: string, max = 8000) => {
    if (typeof a[k] !== "string" || (a[k] as string).length > max) throw new ErroDeDominio("entrada_invalida");
    return a[k] as string;
  };
  const numero = (k: string, min: number, max: number) => {
    const n = a[k];
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) throw new ErroDeDominio("entrada_invalida");
    return n;
  };
  const quadro = () => { const q = texto("quadro", 64); if (!/^[a-f0-9]{64}$/.test(q)) throw new ErroDeDominio("entrada_invalida"); return q; };
  const caminho = () => {
    const c = texto("caminho", 500).replace(/^\/workspace(?:\/|$)/, "");
    if (c.startsWith("/") || c.includes("\\") || c.includes("\0") || c.split("/").includes("..")) throw new ErroDeDominio("entrada_invalida");
    return c || ".";
  };
  switch (a.tipo) {
    case "observar": return { tipo: a.tipo };
    case "navegar": {
      const url = texto("url", 4000);
      // definido em 2026-09-18: DNS/endereço de destino são validados novamente no proxy de saída.
      if (!/^https?:\/\/[^\s]+$/i.test(url) || /^https?:\/\/[^/]*@/i.test(url)) throw new ErroDeDominio("entrada_invalida");
      return { tipo: a.tipo, url };
    }
    case "clicar": return { tipo: a.tipo, quadro: quadro(), x: numero("x", 0, 1279), y: numero("y", 0, 799), ...(a.botao === undefined ? {} : { botao: numero("botao", 1, 3) }), ...(a.vezes === undefined ? {} : { vezes: numero("vezes", 1, 2) }) };
    case "arrastar": return { tipo: a.tipo, quadro: quadro(), x: numero("x", 0, 1279), y: numero("y", 0, 799), destinoX: numero("destinoX", 0, 1279), destinoY: numero("destinoY", 0, 799) };
    case "dialogo": if (typeof a.aceitar !== "boolean") throw new ErroDeDominio("entrada_invalida"); return { tipo: a.tipo, aceitar: a.aceitar, quadro: quadro(), ...(a.texto === undefined ? {} : { texto: texto("texto") }) };
    case "audio": return { tipo: a.tipo, segundos: numero("segundos", 1, 10) };
    case "digitar": return { tipo: a.tipo, quadro: quadro(), texto: texto("texto") };
    case "tecla": {
      const tecla = texto("tecla", 60);
      if (!/^(?:(?:Control|Meta|Alt|Shift)\+)*(?:Enter|Tab|Escape|Backspace|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Space|F[1-9]|F1[0-2]|[a-zA-Z0-9])$/.test(tecla)) throw new ErroDeDominio("entrada_invalida");
      return { tipo: a.tipo, quadro: quadro(), tecla };
    }
    case "rolar": return { tipo: a.tipo, quadro: quadro(), delta: numero("delta", -2000, 2000) };
    case "abas": return a.aba === undefined ? { tipo: a.tipo } : { tipo: a.tipo, aba: Math.floor(numero("aba", 0, 30)) };
    case "arquivos": case "ler_arquivo": return { tipo: a.tipo, caminho: caminho() };
    case "gravar_arquivo": {
      const base64 = texto("base64", 699052);
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new ErroDeDominio("entrada_invalida");
      return { tipo: a.tipo, caminho: caminho(), base64 };
    }
    case "anexar": return { tipo: a.tipo, quadro: quadro(), caminho: caminho() };
    case "terminal": { const comando = texto("comando"); if (!comando.trim()) throw new ErroDeDominio("entrada_invalida"); return { tipo: a.tipo, comando }; }
    default: throw new ErroDeDominio("entrada_invalida");
  }
}

export function alteraComputador(a: AcaoComputador): boolean {
  return !["observar", "arquivos", "ler_arquivo", "audio"].includes(a.tipo) && !(a.tipo === "abas" && a.aba === undefined);
}

export function resumoAcaoComputador(a: AcaoComputador): string {
  if (a.tipo === "terminal") return `Executar no terminal: ${a.comando}`;
  if (a.tipo === "navegar") return `Abrir no navegador: ${a.url}`;
  if (a.tipo === "clicar") return `Clicar na posição ${a.x}, ${a.y} da tela observada`;
  if (a.tipo === "digitar") return `Digitar na tela: ${a.texto}`;
  if (a.tipo === "tecla") return `Pressionar ${a.tecla}`;
  if ("caminho" in a) return `${a.tipo}: ${a.caminho}`;
  return a.tipo;
}
