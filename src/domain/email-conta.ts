/** Os e-mails da conta (NOD-345, ADR-124 §4). Puros: quem envia é o adaptador (src/adapters/email). */
export type EmailConta = { para: string; assunto: string; texto: string; html: string; tipo: "verificacao" | "recuperacao" };

const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

export function emailDeVerificacao(para: string, codigo: string): EmailConta {
  return {
    para,
    tipo: "verificacao",
    assunto: `${codigo} é o seu código do nod`,
    texto: `Seu código para criar a conta no nod: ${codigo}\n\nEle vale por 15 minutos. Se não foi você, ignore este e-mail.`,
    html: `<p>Seu código para criar a conta no nod:</p><p style="font-size:24px;font-weight:600;letter-spacing:4px">${escapar(codigo)}</p><p>Ele vale por 15 minutos. Se não foi você, ignore este e-mail.</p>`,
  };
}

export function emailDeRecuperacao(para: string, link: string): EmailConta {
  return {
    para,
    tipo: "recuperacao",
    assunto: "Redefinir a senha do nod",
    texto: `Para criar uma senha nova no nod, abra este link:\n${link}\n\nEle vale por 30 minutos e funciona uma vez. Se não foi você, ignore este e-mail: sua senha continua a mesma.`,
    html: `<p>Para criar uma senha nova no nod, abra este link:</p><p><a href="${escapar(link)}">Redefinir a senha</a></p><p>Ele vale por 30 minutos e funciona uma vez. Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>`,
  };
}
