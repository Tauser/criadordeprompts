# Validação cruzada dos campos

Data: 18/10/2026. Base: estado atual do working tree (sem commit), depois da inclusão de novas posturas e do
campo de orientação.

Este documento levanta todos os campos do compositor, mostra quais combinações já são checadas e propõe uma
matriz para as que ainda passam sem aviso. O objetivo é que nenhuma combinação que quebre a imagem ou deixe o
modelo em dúvida chegue ao ComfyUI sem que o Studio a resolva ou a mostre.

## Princípio: quatro respostas possíveis

Para cada par de campos que podem se contradizer, o Studio deve escolher uma resposta e mostrá-la no painel de
diagnóstico:

| Resposta | Quando usar | Efeito |
|---|---|---|
| **Erro** | As duas instruções são fisicamente impossíveis juntas ou se anulam | Bloqueia o envio e aponta os campos |
| **Ajuste automático** | Há uma única leitura razoável da intenção | O prompt é reescrito; o diagnóstico mostra "Ajustado: …" |
| **Aviso** | Combinação possível, mas que costuma dar resultado errado ou ambíguo | Segue, com a explicação |
| **Não avaliável** | Falta informação (texto livre, foto sem metadados) | Segue; a verificação não conta como falha |

Um ajuste automático **nunca é silencioso**. Se a intenção puder ter duas leituras, a resposta é aviso ou erro.

## Inventário dos campos

### Campos de atributo (Básico e Avançado)

Cada um aceita *livre*, *definir* (biblioteca ou texto), *manter da foto* (só edição) e *usar referência*.

| Campo | Aba | Metadados que a opção da biblioteca carrega hoje |
|---|---|---|
| Estilo | Básico | nenhum |
| Pessoa | Básico | pessoas |
| Cenário | Básico | apoios oferecidos |
| Roupa (+ aplicar a) | Básico | nenhum |
| Pose | Básico | pessoas, postura, orientação, olhar, apoios, enquadramento mínimo |
| Ação | Básico | pessoas, postura, orientação, olhar, apoios, enquadramento mínimo |
| Expressão | Básico | olhar |
| Luz | Básico | nenhum |
| Rosto, corpo, pele, cabelo | Avançado | nenhum |
| Câmera | Avançado | **nenhum** |
| Enquadramento | Avançado | área visível |

### Outros campos

- **Topo:** modo (criar ou editar), referências, foto alvo, máscara e personagens adicionais (até 3).
- **Básico:** detalhes adicionais em texto livre.
- **Saída:** execução (completa ou turbo), resolução, formato, variações, verificar, aprimorar.
- **Cena** (aba Avançado):
  - Pessoas pedidas.
  - Só na edição: pessoas na foto, enquadramento da foto, apoios existentes, permitir acrescentar apoios e permitir reenquadrar.
- **Parâmetros:** seed, passos, CFG, tamanho personalizado e prompt negativo.
- **Conteúdo:** modo adulto e as duas confirmações.

## O que já é validado

| Combinação | Resposta atual |
|---|---|
| Duas opções com postura, orientação ou olhar diferentes | Erro (*deitado* genérico combina com uma posição deitada específica) |
| Pose ou ação que exige apoio × cenário que não o oferece | Erro, salvo "permitir acrescentar apoios" |
| Pose que exige corpo inteiro × enquadramento menor ou reenquadramento bloqueado | Erro |
| Manter pose ou expressão × opção que declara postura, orientação ou olhar | Não avaliável |
| Trocar a pessoa × manter o rosto | Aviso |
| Roupa para todos × menos de duas pessoas, ou roupa não definida | Erro |
| Manter da foto, ou resolução original, no modo criar | Erro |
| Referência ausente, repetida ou igual à foto alvo | Erro |
| Opção adulta sem modo adulto ou sem confirmações | Erro |
| Tamanho personalizado com máscara | Erro no backend; a interface desativa |
| Turbo × passos, CFG e aprimorar | Ajuste silencioso: o turbo fixa 8 passos e CFG 1 e desliga o aprimoramento |
| Texto livre e detalhes | Não avaliável |

## Lacunas: combinações que hoje passam sem aviso

A causa principal é que **câmera, luz, estilo e cenário quase não têm metadados**. Elas falam do mesmo
assunto que outros campos, mas o Studio não consegue comparar.

### 1. Corpo, cabeça e olhar *(maior impacto visual)*

| Combinação | Problema | Resposta proposta |
|---|---|---|
| Orientação **de costas** × olhar **para a câmera** | O modelo gira a cabeça 180° | **Ajuste:** vira "olha para a câmera por cima do ombro" |
| Orientação **de perfil** × olhar **para a câmera** | Pescoço torcido 90° | **Ajuste:** "a cabeça gira em direção à câmera, até o ombro" |
| Orientação **de frente** × olhar **por cima do ombro** | Contraditório: só se olha por cima do ombro estando de costas | **Erro** |
| Orientação **de costas** × olhar para baixo, para cima, fechado ou desviado | O rosto não aparece | Segue; a verificação marca o olhar como **não avaliável** |
| Qualquer postura ou orientação declarada | Nenhuma frase limita a rotação da cabeça | **Sempre:** "a cabeça fica alinhada ao pescoço e gira no máximo até o ombro" |

Não haverá campo de cabeça (decisão de 18/10/2026). A posição da cabeça é **derivada** pelo compilador a partir
de orientação e olhar e redigida em **uma só frase**, na ordem corpo → cabeça → olhos, em vez de três frases
soltas:

| Orientação | Olhar | Cabeça gerada |
|---|---|---|
| de frente, três quartos | câmera, desviado, baixo, cima, fechado | alinhada ao corpo; só os olhos ou uma leve inclinação mudam |
| de perfil | câmera | gira em direção à câmera, até o ombro |
| de perfil | outros | alinhada ao corpo, de perfil |
| de costas | câmera ou "por cima do ombro" | gira por cima do ombro, até o limite do pescoço |
| de costas | outros | alinhada à coluna, rosto fora de vista |
| qualquer ou não informada | qualquer | nada é acrescentado além do limite anatômico |

Casos específicos, como o rosto apoiado na superfície, continuam no texto da própria pose.

### 2. Câmera × orientação e enquadramento

Na prática, as opções de câmera já descrevem a orientação: *Frontal*, *Três quartos*, *Perfil lateral*,
*Sobre o ombro* e *Vista de cima*. Ganham o metadado **vista** (frente, três quartos, perfil, costas, de cima)
e uma **área visível máxima**.

| Combinação | Resposta proposta |
|---|---|
| Câmera *Frontal* × pose **de costas** (ex.: *De quatro*) | **Erro:** "a câmera e a pose pedem lados opostos; escolha um" |
| Câmera *Perfil lateral* × pose **de frente** | **Erro** |
| Câmera *Três quartos* × pose de frente ou de perfil | **Aviso** (lados próximos) |
| Câmera *Sobre o ombro* × olhar ou expressão para a câmera | **Erro:** o rosto fica de costas para a lente |
| Câmera com vista e pose sem orientação | **Ajuste:** a orientação passa a ser a da câmera |
| Câmera *Close de detalhe* ou *Retrato 85 mm* × pose ou enquadramento de corpo inteiro | **Aviso:** a lente favorece recorte fechado |
| Câmera *Grande angular 24 mm* × enquadramento de rosto | **Aviso** |
| Câmera *Vista de cima* × pose em pé com olhar para a câmera | **Aviso:** exige cabeça inclinada para trás |

### 3. Quantidade de pessoas

Hoje o total é o **maior** entre os números informados, sem avisar quando eles discordam.

| Combinação | Problema | Resposta proposta |
|---|---|---|
| "Pessoas pedidas = 1" × ação para 2 (ex.: *abraço*) | Vira 2 em silêncio | **Erro:** "você pediu 1 pessoa; a ação exige 2" |
| "Pessoas pedidas = 1" × personagem adicional | Vira 2 em silêncio | **Erro** com o mesmo formato |
| Edição: pessoas na foto (3) > pessoas pedidas (1) | O prompt diz "ao menos 1"; remover pessoas não é suportado | **Aviso:** "o Studio não remove pessoas" |
| Pose para 1 pessoa × total maior que 1 | Não fica claro quem faz a pose | **Aviso:** a pose vale para a pessoa principal (deixar explícito no prompt) |

### 4. Máscara × campos de cena (edição)

A máscara limita a mudança à área pintada. Campos que mudam a cena inteira contradizem isso.

| Combinação | Resposta proposta |
|---|---|
| Máscara × enquadramento ou câmera definidos | **Erro:** não dá para reenquadrar dentro de uma área |
| Máscara × cenário ou luz definidos | **Aviso:** "só muda dentro da área pintada" |
| Máscara × pose ou ação definida | **Aviso:** o corpo fora da máscara não se move; a pose pode ficar quebrada |
| Máscara × resolução | Já resolvido (a resolução fica desativada) |

### 5. Luz × cenário

As luzes carregam hora e lugar implícitos (*Noite urbana*, *Sol do meio-dia*, *Luz de janela*, *Luz de velas*,
*Hora azul*). Os cenários também (*Cobertura à noite*, *Vinhedo ao entardecer*, *Rua urbana · chuva*,
*Praia*). Metadados novos: **período** (dia, dourada, azul, noite, qualquer) e **ambiente** (interno,
externo, qualquer), na luz e no cenário.

| Combinação | Resposta proposta |
|---|---|
| Período diferente (ex.: *Sol do meio-dia* × *Cobertura à noite*) | **Erro** |
| *Luz de janela* × cenário externo (floresta, praia, deserto) | **Aviso:** não há janela |
| *Noite urbana* × cenário natural (praia, floresta) | **Aviso:** a luz descreve postes e vitrines |
| *Sol do meio-dia* ou *Dia nublado* × cenário interno sem janela | **Aviso** |
| Edição: luz definida × cenário mantido | Não avaliável (o período da foto é desconhecido) |

### 6. Estilo × outros campos

| Combinação | Resposta proposta |
|---|---|
| Estilo *Anime* ou *Ilustração* × câmera com lente (50, 85 ou 24 mm) | **Aviso** leve: termos fotográficos puxam para o realismo |
| Estilo não realista × "pele" ou "rosto" transferidos de foto | **Aviso:** a identidade fotográfica tende a ser estilizada |

### 7. Saída e parâmetros

| Combinação | Hoje | Resposta proposta |
|---|---|---|
| Turbo × passos ou CFG informados | Ignorados em silêncio (a interface desativa) | **Ajuste** mostrado: "o turbo usa 8 passos e CFG 1" |
| CFG ≤ 1 × prompt negativo preenchido | A interface desativa; via API é ignorado | **Aviso:** "o negativo não tem efeito" |
| Variações > 1 × seed fixa | Usa seed, seed+1, … | **Informação** no resultado (já é o comportamento esperado) |
| Formato vertical (9:16) × enquadramento *plano aberto* | Sem aviso | **Aviso** leve |

### 8. Texto livre

Detalhes, descrições em texto e o prompt manual continuam **não avaliáveis**. Procurar palavras-chave daria
falsa segurança. A mensagem atual ("pode contradizer os campos") é a resposta correta.

## Metadados novos necessários

| Categoria | Metadado | Valores |
|---|---|---|
| Câmera | vista | frente, três quartos, perfil, costas, de cima, qualquer |
| Câmera | área visível máxima | rosto, meio corpo, corpo inteiro, aberto |
| Luz | período, ambiente | dia, dourada, azul, noite, qualquer · interno, externo, qualquer |
| Cenário | período, ambiente | os mesmos |

Todos aceitam "qualquer" e ficam opcionais. Uma opção sem o metadado continua funcionando e gera
"não avaliável" quando a checagem precisaria dele, como já acontece com postura e olhar.

## Ordem sugerida

1. **Orientação e olhar, com a cabeça derivada** (seção 1) e **câmera × orientação** (seção 2). São as falhas visuais mais visíveis
   e usam o vocabulário recém-criado.
2. **Quantidade de pessoas** (seção 3). É pequena e corrige um ajuste hoje silencioso.
3. **Máscara × campos de cena** (seção 4).
4. **Luz × cenário** (seção 5). Exige preencher metadados de 16 luzes e 32 cenários.
5. **Estilo e saída** (seções 6 e 7). Avisos leves.

Cada etapa precisa de testes de regra (combinação → código e nível), de compilação (frase final) e,
nas etapas 1 e 2, de uma comparação com seed fixa no ComfyUI real antes e depois.

## Status da implementação (18/10/2026)

As três camadas foram implementadas. Compilador na versão `1.7.0`.

**Camada 1 — regras entre campos** (`backend/src/prisma_studio/domain/rules.py`):

| Seção | Implementado |
|---|---|
| 1. Corpo, cabeça e olhar | De costas + olhar para a câmera → **ajustado** (por cima do ombro). De perfil + câmera → **ajustado** (cabeça gira até o ombro). De frente + olhar por cima do ombro → aviso. De costas + olhar sem rosto visível → não verificado, e a verificação automática pula o olhar. Frase fixa de limite do pescoço sempre que há postura ou orientação. Sem campo de cabeça. |
| 2. Câmera | Metadado **vista** nas câmeras *Frontal*, *Três quartos*, *Perfil lateral* e *Sobre o ombro*. Lados opostos de câmera e pose → erro. Lados próximos (três quartos) → aviso. Câmera com vista e pose sem orientação → a orientação vem da câmera. **Recorte típico** em *Close de detalhe*, *Retrato 85 mm* e *Grande angular* → avisos contra pose de corpo inteiro e contra enquadramento distante. |
| 3. Pessoas | "Pessoas pedidas" menor que o exigido por uma opção ou pelos personagens → erro. Edição com mais pessoas na foto do que o pedido → aviso. |
| 4. Máscara | Enquadramento ou câmera → erro. Cenário, luz, pose ou ação → aviso. |
| 5. Luz × cenário | Metadados **horário** e **ambiente** em 8 luzes e nos 32 cenários. Noite × dia ou hora dourada → erro. Outros horários diferentes → aviso. Interno × externo → aviso. |
| 6. Estilo | Não implementado (avisos leves deixados de fora). |
| 7. Saída | Turbo com passos, CFG ou aprimoramento → **ajustado**. Prompt negativo sem efeito → aviso. |

O apoio da pose agora é único e escolhido pelo cenário (cama, assento, mesa, parede, chão, nessa ordem). As frases do corpo seguem a pose numa ordem fixa: postura, apoio, orientação, olhar e pescoço.

**Camada 2 — veredito:** o painel do prompt mostra **Incoerente · N erros**, **Apto · avisos, ajustes e não verificados** ou **Apto para gerar**. Os ajustes aparecem na lista como **Ajustado**, e cada item leva ao campo correspondente. O editor da biblioteca ganhou os campos de vista e recorte (câmera) e de horário e ambiente (luz e cenário).

**Camada 3 — análise pelo modelo local:** botão **Analisar coerência com o modelo** no painel do prompt (`POST /api/coherence`). O prompt final vai para o modelo de texto local, que aponta contradições, inclusive no texto livre, com o trecho, o problema e uma sugestão em português. É consultivo: não bloqueia a geração, fica só em memória (como a tradução) e é marcado como desatualizado quando o prompt muda. No teste real, levou de 3 a 15 s. Um pedido coerente saiu sem apontamentos, e o caso "De quatro" + "Olhar para a câmera" teve a contradição com "head in line with the spine" identificada.
