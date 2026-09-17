# Modelos dos agentes

Definido em 2026-09-17: novos agentes e exemplos do seed usam `sonnet`. O alias é resolvido pelo Claude Code para o Sonnet disponível no provedor; não fixa uma versão. [Referência oficial](https://code.claude.com/docs/en/model-config).

`NOD_MODELO` pode substituir o padrão dos agentes criados pela API. O modelo persistido no perfil acompanha conversas, rotinas e pedidos a colegas; o destinatário usa o próprio modelo. Duplicação preserva o modelo do original. Turnos já enfileirados mantêm o modelo registrado na criação.

As sondas são independentes: `NOD_MODELO_SONDA` usa Haiku por padrão. O roteiro `e2e:haiku` continua usando Haiku. As medições antigas de custo de Haiku não estimam o custo do Sonnet.

Para agentes existentes, a pessoa pode usar `PATCH /api/t/:tenant/agentes/:id` com `{"modelo":"sonnet"}`. A rota verifica o escopo e registra o evento de edição. Quando o modelo muda, a sessão CLI da conversa é descartada; histórico, memória, instruções e concessões continuam no Nod. Não rode o seed para alterar agentes de uma pessoa: ele também atualiza os perfis de exemplo.

Validação real em 2026-09-17: sonda Sonnet pronta no Claude Code 2.1.273, custo reportado US$ 0,0241338. Isso valida a disponibilidade do modelo na assinatura local; não aprova automaticamente os cenários funcionais dos conectores.
