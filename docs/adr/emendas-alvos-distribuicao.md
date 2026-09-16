# Emendas a ADRs existentes

Vindas da investigação sobre alvos de distribuição e execução local.

## Três emendas curtas a ADRs existentes (não são ADRs novos)

ADR-018 ganha uma seção 'Revisão — três alvos de distribuição' registrando a regra: o que separa código no nod é TSCONFIG POR ALVO DE BUILD; workspace só entra quando houver um segundo artefato npm que alguém de fora instale. Alvo de distribuição não é alvo de build. ADR-014 ganha o motivo forte que falta: a API key por tenant não é conveniência, é a única opção quando o executor não é a máquina do usuário — com o corolário aceito de que o nod hospedado nunca terá a experiência de zero-configuração. ADR-017 ganha uma consequência positiva que ainda não está escrita: por ter o harness em container, o nod dispensa toda a infraestrutura de conectividade que o OpenMausBot precisou construir para atravessar NAT até um laptop.

## Contexto

Nenhuma dessas três decisões muda. O que falta é registrar informação nova que a investigação produziu, para que as mesmas perguntas não voltem como se fossem inéditas.


## Consequências

- A pergunta 'é monorepo?' fica respondida por escrito, com a regra de decisão explícita, e não volta quando o próximo alvo aparecer.
- O ADR-014 passa a explicar por que a fricção de configurar chave é aceita, o que evita que alguém a trate como problema a resolver com um daemon local.
- A economia de conectividade do ADR-017 fica visível, e portanto defensável quando alguém propuser 'e se rodasse no laptop?'.
