# fechado/

Pasta fechada do nod (ADA-282, [LICENSING.md](../oss/publico/LICENSING.md)). O que mora aqui **não vai para o repo
público**: o `oss/manifesto.json` exclui `fechado/**` e a varredura do export confere.

Entra aqui (e só aqui, ou só nos servidores do nod):

- **Marketplace pago**: curadoria, listagem paga, repasse e o catálogo hospedado do nod.
- **Pagamentos**: assinatura, cobrança, faturas e limites por plano pago.
- **Recursos de empresa**: SSO (OIDC/SAML), marca branca, política gerenciada pela organização, log de auditoria
  administrativa e afins.

Regra: o núcleo (Apache 2.0) não importa nada daqui. O recurso fechado se liga ao núcleo por um ponto de extensão do
núcleo (registro, flag ou serviço HTTP), para o núcleo compilar e passar nos testes sem esta pasta. Hoje ela está vazia:
nenhum desses recursos existe no código ainda.
