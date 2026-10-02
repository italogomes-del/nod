# ADR-019 — A sonda de disponibilidade pergunta ao CLI, nunca lê a credencial

**Status** revisado

## Decisão

Mantidas as três regras acopladas sem tirar uma vírgula: (1) presença de variável de ambiente nunca é prova de autenticação; (2) a identidade que o CLI reporta é cosmética e PROIBIDA para autorização; (3) contrato de snapshot com três estados e gate pré-spawn que recusa o turno antes de gastar. Acréscimo: a sonda vira o mecanismo de INVENTÁRIO. O app local publica o snapshot no servidor junto com o heartbeat. O servidor guarda por pessoa: motor, disponível, autenticado, motivo, VERSÃO DO CLI e instante. Nunca credencial, nunca token, e o email do fornecedor NÃO é gravado.

## O que mudou

Ganha o papel de inventário. A versão do CLI entra porque alimenta os flag floors.

## Por quê

Não só sobrevive como fica mais central: o cenário que ele descrevia deixa de ser hipótese e vira o caminho principal. A regra (2) fica MAIS importante e é a que eu mais defenderia numa discussão: com o time inteiro logado com contas pessoais, a tentação de 'ela já está logada como fulana@acme.com.br no Claude, usa isso como login do nod' é enorme e economizaria uma tela. É armadilha — a pessoa troca a conta do CLI para um Gmail pessoal e o nod não pode nem piscar. Autorização vem do servidor. E a distinção que a UI precisa é de duas linhas: 'não tenho o CLI instalado' e 'tenho o CLI mas não estou logada' são botões diferentes — com o time inteiro se instalando sozinho, essa diferença é a maior parte do suporte.

