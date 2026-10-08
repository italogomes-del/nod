/**
 * Ícones de traço do menu da conta, de Seu espaço e da gaveta (definido em 2026-09-30, canvas "Menu, sidebar e
 * gaveta"): 24×24, traço 1.7, na cor do texto. Um lugar só, para o mesmo item ter o mesmo desenho nos três.
 */
const svg = (d: string, tamanho = 18): string =>
  `<svg width="${tamanho}" height="${tamanho}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ICONE = {
  plug: svg('<path d="M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0zM12 16.5V21"/>'),
  sino: svg('<path d="M18 9a6 6 0 0 0-12 0c0 6.5-2.5 7.5-2.5 8.5h17c0-1-2.5-2-2.5-8.5M10 20.5h4"/>'),
  codigo: svg('<path d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5M13.5 5l-3 14"/>'),
  // ADR-085: Este Mac — o medidor de quanto o Mac está sendo usado.
  medidor: svg('<path d="M4 16a8 8 0 0 1 16 0M12 16l3.5-4.5M3 20h18"/>'),
  monitor: svg('<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/>'),
  agentes: svg('<rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2"/>'),
  bandeira: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
  voltar: svg('<path d="M14.5 6l-6 6 6 6"/>'),
  seta: svg('<path d="M9.5 6l6 6-6 6"/>', 16),
  pontos: svg('<circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none"/>'),
  painel: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M14.5 4.5v15"/>'),
  relogio: svg('<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>', 16),
  brilho: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>', 17),
  balao: svg('<path d="M4 5h16v11H9l-5 4z"/>', 17),
  livro: svg('<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>', 17),
  pasta: svg('<path d="M3 5h6l2 3h10v12H3z"/>', 17),
  estrela: svg('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>', 17),
  escudo: svg('<path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z"/>', 17),
  mais: svg('<path d="M12 5v14M5 12h14"/>', 16),
  // O "a fazer" do bot (ADR-064): a lista marcável, a hora do "a partir de", o "na próxima rotina ou conversa" e o abrir/fechar.
  aFazer: svg('<path d="M10 6h10M10 12h10M10 18h10"/><path d="M3.5 6l1.5 1.5L7.5 5"/><path d="M3.5 12l1.5 1.5L7.5 11"/><circle cx="5.3" cy="18" r="1.4"/>', 15),
  relogioMini: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', 12),
  proxima: svg('<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8"/><path d="M20 3.5V8h-4.5"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 16"/><path d="M4 20.5V16h4.5"/>', 12),
  abrir: svg('<path d="m6 9 6 6 6-6"/>', 14),
  recolher: svg('<path d="m18 15-6-6-6 6"/>', 14),
};
