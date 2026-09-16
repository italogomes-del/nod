# ADR-002 — Classificação de dado pessoal por ORIGEM, função pura, default fechado

**Status** mantido

## Decisão

Inalterado. Classifica por procedência (conector, fonte, concessão), nunca por texto. Conector que não declarou: TOCA dado de aprendiz.

## O que mudou

Nada.

## Por quê

Este é o ADR que menos foi afetado pela mudança de premissa, e vale dizer por quê em voz alta porque várias revisões trataram 'dado de aprendiz' como se fosse um problema de multi-tenant. Não é. Os ~240 aprendizes da Patrícia são dados que a Leapy opera todo dia, internamente, hoje. O nod interno vai ler exatamente esses dados. A LGPD não pergunta quantas empresas usam o software.

