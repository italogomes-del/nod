# ADR-015 — Credencial cifrada com chave única do secret manager, ambiente do executor montado do zero, e health check de decifra no boot

**Frente** Credenciais · **Status** decidido · **Épicos** E10, E2, E1, E11

## Decisão

Chave de cada tenant cifrada numa tabela tenant_credential, com UMA camada de cifra usando uma chave única vinda do secret manager do PaaS — sem DEK por linha na v1. O ambiente de cada turno é montado a partir de objeto VAZIO por uma função pura que recebe (tenant, agente, canal) e devolve um Record com nomes de uma allowlist fixa em código; nunca spread de process.env. Um health check no boot decifra UMA credencial de teste e FALHA o deploy se não conseguir. Teto mensal de gasto por tenant verificado ANTES do turno, não depois.

## Contexto

E10.3 é P0 e exige chave cifrada que nunca aparece em log, ambiente do executor começando vazio, teste que coloca chave no ambiente do servidor e prova que ela não chega ao executor, e teto mensal por tenant onde 'um tenant que estoura o teto para de consumir sem afetar os demais'.

## Alternativas rejeitadas

### Envelope encryption KEK/DEK com rotação de KEK planejada

Foi a proposta da frente e cria trabalho contínuo que 3 engenheiros não fazem — a própria consequência escrita dizia 'trabalho chato que ninguém quer fazer depois', o que é reconhecimento de que ninguém vai fazer. Uma KEK que nunca roda é pior que não ter, porque cria falsa sensação e adiciona caminho de falha. A DEK por linha só paga quando se quer revogar uma credencial sem tocar as outras, o que com 70 clientes e um UPDATE é desnecessário. Uma camada entrega a proteção que importa (dump de backup, log de query, leitura acidental) por uma fração da máquina.

### Um secret do PaaS por tenant

Provisionar cliente vira deploy: quase todo PaaS reinicia o container quando um secret muda, e a maioria tem teto baixo de secrets. O OpenMausBot só consegue porque cada workspace é um systemd com EnvironmentFile próprio (fleet.ts:167) — modelo de um-processo-por-tenant que o nod não segue.

### Herdar process.env e apagar as chaves perigosas (denylist)

Falha por omissão: toda variável nova que alguém adicionar ao container vaza até alguém lembrar de acrescentá-la. O OpenMausBot mantém as duas listas e a assimetria é reveladora — a denylist PROVIDER_CREDENTIAL_ENV (config.ts:759-772) existe só para consertar o caso legado, enquanto o caminho novo (a Box) nasce com allowlist. Herdar-e-apagar custa duas camadas de defesa e ainda deixa dúvida; começar vazio custa uma função de dez linhas.

### Passar a credencial como argumento de linha de comando

Fica visível em ps para qualquer processo do container e vaza em log de crash. O OpenMausBot usa arquivo com modo 0600 quando precisa (drivers/pi.ts:537), nunca argv.

### Gateway próprio de LLM guardando todas as chaves

É o que o OpenMausBot escolheu para o modo gerenciado (fleet.ts:283-287 valida uma URL de gateway por slug) e é boa arquitetura — mas é um segundo sistema no caminho crítico de todo turno, com SLA próprio. Fica como evolução, não v1.

## Evidência

O padrão de allowlist está verificado e é exatamente o certo: server/box-credential-env.test.ts:6-8 declara em prosa 'The box is created with noEnv: true, so the only keys its agents ever see are the ones this OpenMausBot forwards. Forward exactly what the user already configured here; never invent, never leak unrelated variables.' A implementação em server/box.ts:779-789 parte de const out: Record<string,string> = {} e só preenche a partir de BOX_FORWARDED_CREDENTIAL_ENV (box.ts:793-802). O teste decisivo é box-credential-env.test.ts:30-32, que prova que uma ANTHROPIC_API_KEY solta no ambiente do servidor NÃO é encaminhada — que é literalmente o aceite de E10.3. Sobre cifra: NÃO achei envelope encryption de credencial de tenant em nenhum dos dois repos; é extrapolação e é honesto dizer. A verificação de origem de E2.4 confirma: 'a credencial NÃO é cifrada hoje, e todo o esquema de cifra existente é do keychain do sistema operacional, que não existe num servidor multi-tenant'. Para teto de gasto o modelo existe: server/spend.ts:31-41 soma o mês contra um teto.

## Consequências

- Rotação de chave é UPDATE, não deploy — provisionar cliente deixa de tocar infraestrutura.
- O health check de decifra no boot é a trava que faltava: uma variável de ambiente errada é descoberta no deploy, não no primeiro turno de um cliente. Sem ele, 'nenhum agente de nenhum cliente funciona' com causa que não aparece em log de aplicação é o pior incidente possível.
- Toda integração nova exige acrescentar o nome à allowlist — atrito deliberado, que é o ponto. Um agente com shell dentro do executor não consegue se mover lateralmente: não há o que ler no ambiente.
- A função de montagem vira o ponto único a auditar em revisão de segurança e no relatório de LGPD: é um arquivo, não um grep pelo repositório.
- O teto de gasto verificado ANTES do turno é o que E10.3 exige e nenhuma frente trouxe — a linha de custo é gravada depois, fire-and-forget, e não impede nada. Sem verificação prévia, um agente em loop gasta o mês de um cliente numa madrugada e ninguém vê acontecer.
- Backup do Postgres passa a conter material cifrado, o que obriga a retenção da chave a ser pelo menos tão longa quanto a do backup.

## Reversibilidade

barata para a allowlist (função pura com teste), média para o lugar da chave. Migrar de uma camada para envelope depois é reescrever as 70 linhas cifradas com o sistema no ar — chato mas mecânico, e mais barato que o contrário. Migrar de Postgres cifrado para um gateway é mais barato ainda, porque o gateway lê do banco durante a transição.

## Revisitar quando

Quando o primeiro cliente exigir trazer a própria chave de KMS (BYOK), ou quando a atribuição de custo por turno parar de fechar com a fatura do provedor em mais de alguns por cento por dois meses — os dois sinais empurram para o gateway.

