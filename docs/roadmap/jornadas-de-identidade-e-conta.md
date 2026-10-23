# Jornadas de identidade e conta

Decisões do Marlon em 2026-10-23. Referências no Linear: NOD-345 (Jornada 1), NOD-347 (Jornada 2) e NOD-346
(Jornada 3). A implementação desta rodada inclui as Jornadas 1 e 3. A Jornada 2 é especificada agora para que o modelo
de identidade não crie um beco sem saída, mas fica no backlog.

## Norte

A pessoa percebe valor antes de criar conta. Depois, consegue entrar por Google ou e-mail e senha, recuperar o acesso e
cuidar dos próprios dados sem suporte. O cadastro liga uma conta ao trabalho que já existe; não cria um nod vazio.

## Jornada 1 — Entrar no nod

### Passo a passo

1. A pessoa baixa e abre o app.
2. O nod prepara um espaço provisório e abre a conversa, sem tela de login, e-mail ou senha.
3. Ela conversa com o Nod e pode criar bots. Uma indicação discreta diz que criar conta protege e sincroniza o espaço.
4. Quando escolher criar conta, usa qualquer conta Google ou e-mail e senha.
5. O nod volta para a mesma conversa, com os mesmos bots, rotinas, acessos e arquivos.
6. Se esquecer a senha, pede a recuperação, usa o link recebido e entra com a nova senha.
7. Em outro dispositivo, entra na conta e pareia o computador pelo fluxo seguro já existente.

### Regras de produto

- Sem login não é modo demonstração: o trabalho é real e permanece no espaço provisório.
- Criar conta nunca apaga, copia parcialmente nem troca o espaço por um vazio.
- Conta nova converte o espaço provisório automaticamente, sem perguntar sobre importação.
- Se as credenciais forem de uma conta existente, antes de trocar de espaço o nod oferece importar o trabalho, criar
  outra conta ou cancelar e continuar no provisório; nada é descartado ou sobrescrito silenciosamente.
- Google aceita Gmail pessoal e Workspace; domínio não concede acesso por si só no produto público.
- Mensagens de cadastro, entrada e recuperação não revelam se um e-mail existe.
- A pessoa pode sair da sessão atual e de todas as outras. A lista de sessões é parte da conta, não da primeira entrega.
- Onboarding, ativação e o melhor momento de convidar para criar conta serão trabalhados em jornada própria.
- Qualquer bot conduz os fluxos de conta (decisão do Marlon, 23/10): os cartões aparecem na conversa do bot com quem a
  pessoa está falando. Quando o fluxo começa pela interface (menu da conta, Minha conta › Sessões), ele abre na conversa
  do bot nod, o bot fixo.
- Todos os cartões do processo ficam dentro do chat, inclusive campos de e-mail, senha e código e a confirmação de sair
  das outras sessões: sem painel flutuante e sem modal. Esses valores ficam só no cartão e nunca entram em transcript,
  trilha, memória ou contexto do modelo.
- Começar pelo chat ("criar minha conta", "quero trocar de conta", "quero alterar minha senha", "sair dos outros
  computadores", "conectar outro computador") é a NOD-351: reconhecer a intenção em qualquer bot e chamar a ferramenta
  que abre o mesmo cartão desta jornada, sem fluxo paralelo. A NOD-345 não depende da NOD-351.
- O lembrete "Seu espaço está só neste computador" fica fixo no menu da conta. Proposta até decisão do Marlon: uma fala
  discreta do bot na conversa quando houver algo que valha guardar (ex.: a primeira rotina), uma vez só.
- Protótipo aprovado pelo Marlon em 23/10: v3 em https://gamefik.github.io/nod-prototipos/nod-345/ (commit `4f2b14b`
  de gamefik/nod-prototipos). Passos de referência, todos com `/proposta`: começar sem cadastro `#j1-1`, `#j1-2`;
  criar conta no chat `#j2-1` a `#j2-7` (conferindo `#j2-5`, código errado `#j2-6`); conta existente e importação
  `#j3-1` a `#j3-4` (levando `#j3-2`, falha `#j3-4`); entrar e recuperar a senha `#j4-1` a `#j4-6` (senha trocada
  `#j4-6`); sair das outras sessões no chat, sem modal, `#j5-2`, `#j5-3`; conectar outro computador `#j5-4` a `#j5-7`
  (código vencido `#j5-8`); pedidos pelo chat a qualquer bot `#j6-1` a `#j6-7`, que é referência visual da NOD-351.

### Critérios de aceite ponta a ponta

- Instalação nova chega à conversa sem formulário de cadastro e conclui uma primeira mensagem.
- Depois de criar conta por Google, reabrir o app mostra a conversa e o bot criados antes do cadastro.
- O mesmo vale para e-mail e senha depois da verificação do e-mail.
- Ao entrar numa conta existente, importar traz o trabalho provisório sem apagar o conteúdo anterior; cancelar mantém
  a pessoa no espaço provisório daquele computador.
- Recuperação usa token único e expirado/consumido não funciona.
- Entradas inválidas devolvem a mesma resposta externa e são limitadas contra abuso.
- Fechar e reabrir o app antes do cadastro recupera o mesmo espaço provisório no mesmo computador.
- Código de verificação: enquanto é conferido, a ação mostra "Conferindo…" e não aceita envio duplo; código errado
  mantém os números e diz quantas tentativas restam; cada código aceita no máximo 5 tentativas (valor proposto) e,
  esgotadas, só resta pedir outro.
- Importar para conta existente mostra o que está indo e para onde; se falhar, nada muda dos dois lados e o bot oferece
  `Tentar de novo` e `Continuar sem conta`.
- Trocar ou redefinir a senha encerra as outras sessões e mantém a atual (ADR-124 §4).
- O código de pareamento de outro computador vale 5 minutos e um uso; vencido ou usado, a única ação é gerar outro, e
  gerar outro invalida o anterior.

### Etapas dentro desta issue-jornada

1. **Fundação de conta e identidades.** `contas`, vínculos com `pessoas`, identidades Google/senha e sessão
   revogável; migração aditiva e compatibilidade com o login atual.
2. **Baixar e usar sem login.** Bootstrap do espaço provisório, segredo no `safeStorage`, cota/limite de abuso e
   primeira conversa sem tela de entrada.
3. **Converter o espaço com Google.** Qualquer Google verificado, vínculo por `sub`, idempotência e preservação
   integral do espaço.
4. **Criar conta com e-mail e senha.** Verificação do e-mail, Argon2id, entrada e respostas sem enumeração.
5. **Recuperar senha.** Provedor de e-mail, token de uso único, prazo, rate limit e revogação das sessões.
6. **Sair e sessões.** Sair desta sessão, sair das demais e parear outro computador com a conta.

A fundação vem antes do uso sem login. Google e e-mail/senha podem seguir em paralelo depois dela; recuperação depende
de e-mail/senha; sair e sessões fecha a jornada. Essas etapas são critérios de execução da NOD-345, não novas issues.

## Jornada 2 — Trazer meu time (especificada, não implementar agora)

### Passo a passo

1. A administradora convida por e-mail ou cria um link com prazo e limite de uso.
2. Quem já tem conta entra no tenant; quem não tem usa o nod primeiro e liga a conta ao aceitar o convite.
3. A administradora escolhe `admin` ou `membro`, altera o papel e remove a pessoa.
4. A dona de cada bot escolhe `só eu` ou pessoas específicas. Sala continua com membership próprio.
5. Quem pertence a mais de um tenant troca de espaço sem trocar de conta.

### Regras de produto

- Conta é global; pessoa, papel e recursos são do tenant.
- Aceitar convite nunca mistura automaticamente o espaço pessoal e o espaço do time.
- `admin` gerencia pessoas e convites; não ganha leitura automática das conversas privadas.
- Remover alguém corta sessões daquele tenant e acesso futuro, sem apagar autoria histórica.
- A visibilidade do bot segue a ADR-099: compartilhar uso não transfere propriedade.

### Critérios de aceite para a rodada futura

- Convite por e-mail e link vence, é revogável e não pode ser reutilizado além do limite.
- Uma conta alterna entre dois tenants e a RLS nunca cruza recursos.
- Membro removido perde acesso imediatamente; a trilha continua atribuindo o que ele fez.
- Bot `só eu` não aparece para o time; compartilhado aparece apenas às pessoas escolhidas.

### Entregas futuras

1. **J2.1 — Membership e troca de espaço.** Conta global ligada a uma pessoa por tenant.
2. **J2.2 — Convites.** E-mail e link, expiração, revogação e aceite idempotente.
3. **J2.3 — Papéis e remoção.** `admin`/`membro`, último admin protegido e corte de sessões.
4. **J2.4 — Visibilidade por bot.** Só eu/pessoas escolhidas, sem herdar acesso para salas.

## Jornada 3 — Minha conta

### Passo a passo

1. No menu da conta, a pessoa vê nome, foto, e-mail e formas de entrada ligadas.
2. Edita nome, foto e `Sobre mim`; os bots próprios passam a receber o texto nos próximos turnos.
3. Adiciona ou remove Google, troca e-mail e troca senha sem se trancar para fora.
4. Pede uma exportação e recebe um arquivo quando estiver pronto.
5. Pede exclusão, confirma de novo e pode desfazer durante o prazo. Depois, todos os dados da conta são apagados.

### Regras de produto

- O menu da pessoa é separado do perfil de um bot da ADR-060.
- `Sobre mim` é texto da pessoa, marcado como contexto confiável dela, com limite de 2.000 caracteres; nesta primeira
  versão entra uma vez na parte estável do prompt apenas dos bots próprios e não vira memória editável pelo bot. Bots
  de equipe não recebem esse texto.
- Uma conta sempre mantém ao menos uma forma de entrada verificada. Remover Google exige senha ativa; remover senha
  exige Google ativo.
- Trocar e-mail exige confirmação no endereço novo e aviso no antigo. Até confirmar, o antigo continua valendo.
- Exportação é assíncrona, gera arquivo com prazo e não inclui segredos, hashes, tokens nem credenciais de apps/IA.
- Exclusão tem confirmação recente da identidade e prazo de arrependimento de 30 dias. No prazo, a conta fica suspensa;
  depois, no beta, todos os dados da conta são apagados, sem anonimização ou retenção seletiva.
- A política de retenção e suas bases legais serão revistas antes de sair do beta.

### Critérios de aceite ponta a ponta

- Alterar `Sobre mim` muda o contexto do turno seguinte de dois bots diferentes e não reescreve turnos anteriores.
- Não é possível remover a última forma de entrada.
- Troca de e-mail só conclui depois da prova no endereço novo; sessões suspeitas são revogadas.
- A exportação contém perfil, conversas, bots, memórias, rotinas, decisões e trilha legível da pessoa, sem segredos.
- Durante 30 dias a exclusão pode ser desfeita; depois do prazo, a conta e todos os seus dados são apagados, o login
  falha e a busca não devolve o conteúdo.

### Etapas dentro desta issue-jornada

1. **Perfil da pessoa e Sobre mim.** Nome, foto, texto compartilhado com os bots e inclusão no prompt.
2. **Formas de entrada.** Ligar/desligar Google, trocar e-mail e senha, mantendo uma forma verificada.
3. **Exportar meus dados.** Inventário, geração assíncrona, arquivo protegido e expiração.
4. **Pedir e desfazer exclusão.** Reautenticação, suspensão por 30 dias e restauração.
5. **Purga total do beta.** Exclusão definitiva de todos os dados da conta e prova automatizada.

Perfil pode começar depois da fundação da Jornada 1. Formas de entrada depende dos fluxos de autenticação e sessões.
Exportação é independente da exclusão. No beta, a purga total acontece ao fim do prazo de arrependimento; a política de
retenção será revista antes do lançamento público. Essas etapas são critérios de execução da NOD-346, não novas issues.

## Decisões tomadas

E-mail de verificação e recuperação será enviado pelo Resend usando o domínio `nodbot.ai`.
Conta nova converte o espaço provisório automaticamente. Conta existente exige escolha antes da troca: importar o
trabalho provisório, criar outra conta ou cancelar e continuar no provisório.
Nesta primeira versão, o `Sobre mim` é enviado apenas aos bots próprios; bots de equipe não recebem o texto.
No beta, depois dos 30 dias de arrependimento, todos os dados da conta são apagados; não há anonimização nem retenção
seletiva. A política será revista antes de sair do beta.

As demais escolhas acima são suposições de produto/arquitetura propostas para revisão, não bloqueios para validar o
fluxo da Jornada 1.
