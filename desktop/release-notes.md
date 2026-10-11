# nod 0.2.0-rc.1 — preview sem assinatura

Integração do desktop macOS com a main atual, Sonnet como padrão dos agentes, decisões e permissões diretamente no chat e cooperação iniciada pelo agente acordado por rotina. Preserva gestão/exclusão recuperável, geração de execução e isolamento de sessões. O app aceita versões candidatas `-rc.N` na checagem de compatibilidade.

- Guia desta versão: https://github.com/gamefik/nod/blob/desktop-v0.2.0-rc.1/docs/release-desktop.md
- Servidor: mesma tag, protocolo 1, migrações 0001–0012; URL HTTPS de produção pendente. Versão mínima do app permanece 0.1.0.
- Sonnet é um alias do Claude Code. Sondas usam Haiku. Agentes existentes são atualizados pela API da pessoa, sem sobrescrever instruções ou acessos.
- UATs reais validaram consultas e cooperação de um salto; criação autônoma de tarefas ClickUp pelo destinatário continua pendente.
- Atualização manual: instalar novo DMG e preservar configuração cifrada; servidor exige backup antes da migração. Atualização desde a preview ainda não aceita nativamente.

## Registro de distribuição

Versão/tag: 0.2.0-rc.1 / desktop-v0.2.0-rc.1.
SHA, PR e Actions: registrados no rascunho da release após o merge do candidato.
Validação local desta versão em 17/09/2026: npm ci, gate completo (684 testes: 371 unitários, 217 integração, 49 conformidade, 47 concorrência), build web e desktop aprovados. Banco exclusivo inicialmente vazio, migrações 0001–0012. Pacote Intel local e smoke do proxy aprovados, sem assinatura; não equivalem ao aceite dos DMGs.
DMGs Intel/ARM e manifesto SHA-256 anexados à release após conferência dos downloads. Empacotamento local Intel; ARM produzido por build cruzado.
Assinatura/notarização: ausentes por escolha explícita do mantenedor em 17/09/2026, como na preview anterior. Os controles de distribuição assinada permanecem intactos para a versão estável.
Aceite Intel: pendente (pessoa, Mac, macOS e resultado).
Aceite ARM: pendente (pessoa, Mac, macOS e resultado).
Servidor HTTPS e recuperação: endereço e backup de produção ainda não informados.

Publicação experimental, sem assinatura Apple nem notarização: o macOS pode bloquear a abertura. O smoke do runtime Intel não equivale ao aceite de instalação, login e atualização; ARM não foi executado nativamente. Requer servidor HTTPS configurado pelo time. Não há suporte validado a Windows nem atualização automática. A exceção desta preview está registrada em `docs/processo-de-release.md`; os requisitos completos de distribuição assinada ficam para a versão estável.
