# ADR 0003 — Regras de redação seguem o guia oficial do Qwen Image 2.1

**Decisão:** o render do compilador segue o guia do aprimorador oficial do Qwen 2.1 (workflow oficial em `GeraImg/downloads/qwen21-edicao-oficial.json`): operação primeiro, preservação em cláusula geral, identidade por referência sem descrição de traços, frases afirmativas, tags `<imageN>` apenas com 2+ imagens, sem resolução no texto.

**Motivo:** descrever detalhadamente o que deve ser preservado faz o modelo regenerar esses elementos; a referência de identidade descrita em palavras degrada a semelhança.

**Verificação:** comparações visuais controladas (mesma seed, referências e parâmetros).
