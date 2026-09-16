# ADR-002 — Classificação de dado pessoal por ORIGEM, como função pura no core, com default 'toca'

**Frente** Dados · **Status** decidido · **Épicos** E4, E2, E8, E11

## Decisão

Uma função pura em core/ recebe a procedência do dado (qual conector, qual fonte, qual concessão) e devolve se o item toca dado de aprendiz. A classificação é por ORIGEM declarada no ato da concessão do conector, nunca por inspeção de texto. Conector que não declarou sensibilidade classifica como TOCA — o default é fechado. A classificação é carimbada na linha do item no momento da criação e é imutável: se a regra mudar depois, o item antigo exibe a justificativa que valia quando nasceu.

## Contexto

Os épicos falam repetidamente em 'item que toca dado de aprendiz' como categoria conhecida, e E4.2 exige que esse item nasça desmarcado 'POR ORIGEM E NÃO POR TEXTO'. Sem um classificador, isso é decidido caso a caso por quem escreve o código — disciplina de desenvolvedor no ponto mais sensível do produto. E toda outra decisão da arquitetura pergunta 'e se tocar dado de aprendiz?' e nenhuma sabe responder.

## Alternativas rejeitadas

### Classificar por inspeção do texto do item (regex de CPF, detecção de nome)

E4.2 rejeita explicitamente: 'independentemente do texto final do item'. E o único mecanismo parecido nos repos é server/redact.ts do OpenMausBot, que conhece apenas token/secret/password/apikey — é higiene de log, roda na escrita do log e não na montagem do item, e não sabe nada sobre dado pessoal. Texto é sinal fraco: um item pode tocar o contrato de um aprendiz sem citar o nome dele.

### Default 'não toca' quando o conector não declarou

Vaza por omissão, que é a lição que a migration 0008_fresh_install_search_allowlist.sql do Buzz registra ao INVERTER a denylist de kinds sensíveis para allowlist positiva. Tipo novo nasce fora da proteção até alguém lembrar. Com menor de idade, o custo do falso positivo (item desmarcado que a pessoa marca) é um clique; o do falso negativo é incidente reportável.

### Deixar a classificação implícita no código de cada conector

É a definição de disciplina de desenvolvedor. E torna impossível o aceite de E4.2 que exige restrição de banco: 'uma restrição do banco exige a coluna de autoria preenchida sempre que origem sensível e selecionado forem ambos verdadeiros' — sem um campo de classificação, não há o que restringir.

## Evidência

E4.2 (aceite literal: 'Dado um conector declarado como contendo dado de aprendiz no ato da concessão... o item nasce com selecionado falso... independentemente do texto final do item' e 'Dado um conector que não declarou sensibilidade... o item nasce desmarcado por padrão, nunca marcado'). A ausência é a outra evidência: a verificação de origem do próprio épico diz que 'procurou classificação de sensibilidade e não achou nada' nos dois repositórios.

## Consequências

- É o sétimo arquivo de core/ e deveria ser o primeiro: core/dado-pessoal.ts. Barato agora, impossível de retroagir — reclassificar itens já decididos exige a informação de procedência que não foi guardada.
- Toda concessão de conector (E2.4) ganha um campo de declaração de sensibilidade, e a tela de concessão precisa perguntá-lo em português.
- A classificação carimbada e imutável significa que a linha do item guarda tanto o resultado quanto a versão da regra. É uma coluna a mais e resolve o aceite de E4.2 sobre item antigo reaberto.
- É a entrada do ADR-004: o que pode entrar na trilha depende de o sistema saber o que é dado pessoal.

## Reversibilidade

cara para introduzir depois, barata para refinar. A função é pura e trocável; o que não se recupera é a procedência não gravada dos itens já criados. Trocar o default de 'toca' para 'não toca' seria trivial e é justamente o que não se deve fazer.

## Revisitar quando

Quando aparecer o primeiro conector cuja sensibilidade varia por CHAMADA e não por fonte. Aí a classificação deixa de ser propriedade da concessão e vira propriedade da resposta, e o lugar certo passa a ser o proxy MCP (ADR-013), que já vê a resposta.

