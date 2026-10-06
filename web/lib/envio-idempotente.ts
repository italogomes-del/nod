/**
 * Chave de idempotência do envio (definido em 2026-10-06, NOD-156): uma por fala, criada no compositor e não dentro
 * de `api.enviar`. Se a resposta se perde e a pessoa manda a MESMA fala de novo (mesmo texto e mesmos anexos), a
 * chave pendente é reusada e o servidor devolve a mensagem já gravada. Depois de um envio que deu certo, a próxima
 * fala ganha chave nova, mesmo com o mesmo texto. Com um envio em voo na conversa, outro é ignorado (Enter + botão).
 */
type Pendente = { chave: string; assinatura: string };

export type Envios = {
  /** A chave deste envio, ou `null` se já há um em voo nesta conversa. */
  iniciar(conversaId: string, texto: string, anexos: readonly string[]): string | null;
  /** Fecha o envio em voo; com `ok`, a chave pendente some e a próxima fala ganha outra. */
  concluir(conversaId: string, ok: boolean): void;
};

export function criarEnvios(gerar: () => string = () => crypto.randomUUID()): Envios {
  const pendentes = new Map<string, Pendente>();
  const emVoo = new Set<string>();
  return {
    iniciar(conversaId, texto, anexos) {
      if (emVoo.has(conversaId)) return null;
      const assinatura = JSON.stringify([texto, [...anexos]]);
      const anterior = pendentes.get(conversaId);
      const chave = anterior && anterior.assinatura === assinatura ? anterior.chave : gerar();
      pendentes.set(conversaId, { chave, assinatura });
      emVoo.add(conversaId);
      return chave;
    },
    concluir(conversaId, ok) {
      emVoo.delete(conversaId);
      if (ok) pendentes.delete(conversaId);
    },
  };
}

/** O corpo do POST conversas/:id/mensagens: `anexos` e `idEnvio` só entram quando existem (cliente antigo = só texto). */
export function corpoDoEnvio(texto: string, anexos: readonly string[] = [], idEnvio?: string): { texto: string; anexos?: readonly string[]; idEnvio?: string } {
  return { texto, ...(anexos.length ? { anexos } : {}), ...(idEnvio ? { idEnvio } : {}) };
}
