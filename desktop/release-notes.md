# nod 0.2.0-rc.1 — candidata para validação

Integração do desktop macOS com a main atual, Sonnet como padrão dos agentes, decisões e permissões diretamente no chat e cooperação iniciada pelo agente acordado por rotina. Preserva gestão/exclusão recuperável, geração de execução e isolamento de sessões. O app aceita versões candidatas `-rc.N` na checagem de compatibilidade.

- Guia desta versão: https://github.com/marlonwlv/nod/blob/v0.2.0-rc.1/docs/release-desktop.md
- Servidor: mesma tag, protocolo 1, migrações 0001–0012; URL HTTPS de produção pendente. Versão mínima do app permanece 0.1.0.
- Sonnet é um alias do Claude Code. Sondas usam Haiku. Agentes existentes são atualizados pela API da pessoa, sem sobrescrever instruções ou acessos.
- UATs reais validaram consultas e cooperação de um salto; criação autônoma de tarefas ClickUp pelo destinatário continua pendente.
- Atualização manual: instalar novo DMG e preservar configuração cifrada; servidor exige backup antes da migração. Atualização desde a preview ainda não aceita nativamente.

## Registro de distribuição

Versão/tag: 0.2.0-rc.1 / v0.2.0-rc.1.
SHA, PR e Actions: preencher com o commit candidato aprovado.
Gate/builds desta versão: em validação; não reutilizar contagens da preview.
DMGs e hashes: pendentes de build assinado em runners nativos Intel e ARM.
Assinatura/notarização: secrets Apple ausentes em 17/09/2026; controles mantidos obrigatórios.
Aceite Intel: pendente (pessoa, Mac, macOS e resultado).
Aceite ARM: pendente (pessoa, Mac, macOS e resultado).
Servidor HTTPS e recuperação: endereço e backup de produção ainda não informados.

Este rascunho não está pronto para distribuição. Não publicar antes de completar artefatos, assinatura, servidor e aceite conforme `docs/processo-de-release.md`. Não há suporte validado a Windows nem atualização automática.
