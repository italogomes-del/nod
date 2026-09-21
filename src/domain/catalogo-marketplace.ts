import {
  APPS_MARKETPLACE,
  CATEGORIA_PADRAO,
  DESCRICAO_PADRAO,
  type AppComLogo,
} from "../contracts/marketplace.ts";

/** O que o provedor diz existir: só o mínimo que o `GET /auth_configs` garante. */
export type AppDoProvedor = { slug: string; nome: string; logo: string | null };

const CURADORIA = new Map(APPS_MARKETPLACE.map((a) => [a.slug, a]));
const ORDEM = new Map(APPS_MARKETPLACE.map((a, i) => [a.slug, i]));

/**
 * definido em 2026-09-21 (ADR-041): quem diz o que EXISTE é o provedor; quem diz como se CHAMA em
 * português é a curadoria. App configurado no painel e sem curadoria entra com o nome do provedor
 * e a descrição padrão — aparece torto, mas aparece, que é o ponto do ADR.
 *
 * A ordem é a da curadoria primeiro (o dia a dia conhecido), o resto em ordem alfabética: app novo
 * no painel entra no fim da grade, não no meio dela.
 */
export function mesclarCatalogo(doProvedor: readonly AppDoProvedor[]): AppComLogo[] {
  const apps = doProvedor.map((p) => {
    const c = CURADORIA.get(p.slug);
    return {
      slug: p.slug,
      nome: c?.nome ?? p.nome,
      descricao: c?.descricao ?? DESCRICAO_PADRAO,
      categoria: c?.categoria ?? CATEGORIA_PADRAO,
      logo: p.logo,
    };
  });
  return apps.sort((a, b) => {
    const ia = ORDEM.get(a.slug) ?? Infinity;
    const ib = ORDEM.get(b.slug) ?? Infinity;
    return ia !== ib ? ia - ib : a.nome.localeCompare(b.nome, "pt-BR");
  });
}

/**
 * O piso: a curadoria inteira, sem logo. É o que a tela mostra quando não há chave configurada ou
 * quando a chamada ao provedor falha — catálogo velho é melhor que grade vazia, e a curadoria é a
 * única lista que não depende de rede.
 */
export function catalogoDoPiso(): AppComLogo[] {
  return APPS_MARKETPLACE.map((a) => ({ ...a, logo: null }));
}
