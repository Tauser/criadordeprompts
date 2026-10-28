# Interação entre participantes: análise de prompt (28/10)

Objetivo: cenas com duas ou mais pessoas que se tocam ou interagem sem anomalias, como braços e mãos a mais, corpos
fundidos, papéis trocados, pescoço torcido ou apoio impossível.

Base: compilador 1.21.0 ([compiler.py](../backend/src/prisma_studio/domain/compiler.py)), renderizador
([render_qwen21.py](../backend/src/prisma_studio/domain/render_qwen21.py)), os 107 itens de grupo do catálogo
(90 ações, 12 poses, 5 sujeitos) e as medições em [ROADMAP.md](ROADMAP.md).

---

## 1. O diagnóstico em uma frase

O prompt descreve **a cena** com fatos de **um corpo só**: uma postura, um olhar, uma orientação, um apoio. A
interação, que é a parte difícil, fica num único texto livre, e nele o papel de cada pessoa depende da ordem das
palavras. O modelo recebe dois corpos e nenhum mapa de quem é quem, de onde cada mão está e de qual corpo fica na
frente. As anomalias aparecem justamente onde esse mapa falta.

## 2. O que já funciona (e deve ficar)

- **Contagem exata** ("exactly two distinct people and no one else") e **pessoas diferentes entre si** ao gerar só com
  opções: papéis certos em 10 de 10.
- **Abertura da edição** dizendo qual foto deve sair: a pessoa acrescentada aparece em 12 de 12.
- **Elenco antes da ação**, para que "the first person" aponte para alguém que já existe.
- **Cláusula de anatomia** ("exactly two arms, two hands…") e cláusula de olhos para grupos.
- **Avisos**: editar e acrescentar alguém numa pose a dois dá certo em 2 a 3 de 10, então o Studio sugere Criar; uma
  pose com papéis por lugar pede a posição do personagem.

Detalhe importante: no Turbo (CFG ≤ 1) o **prompt negativo não tem efeito** ([rules.py:542](../backend/src/prisma_studio/domain/rules.py:542)).
Todo controle de anomalia precisa estar no texto positivo, na estrutura ou na verificação depois da geração.

## 3. Causas das anomalias, com exemplos do código atual

### 3.1 Fatos de cena aplicados a todos os corpos

`posture`, `gaze`, `orientation` e `support` valem para a cena inteira. O texto sai no singular ("The body is…",
"The eyes look at the camera."), e o modelo o aplica a **todos**. Quando os papéis diferem, o fato contradiz a própria ação:

| Item | Metadado | O que a ação descreve | Efeito provável |
|---|---|---|---|
| `action.sexy_whisper` | `gaze: camera` | quem sussurra está com o rosto na orelha do outro; só o outro olha a câmera | as duas cabeças giram para a câmera: pescoço torcido ou boca longe da orelha |
| `action.sexy_bed_gaze` | `gaze: away` | "gazing into each other's eyes" | "look away from the camera" é fraco; falta o valor *um para o outro* |
| `action.fun_piggyback` | `posture: any` | um carrega em pé e o outro vai sentado nas costas | sem postura por pessoa, as pernas de quem é carregado tendem a sumir ou se fundir |
| `action.family_grandparents` | `posture: seated`, `support: seat` | a criança está **no colo**, não no banco | "The body is supported by a seat" puxa a criança para o banco |
| `pose.family_child_hip` | `posture: standing` | a criança está **no quadril** de um adulto | "standing" para os três: criança em pé ou um terceiro par de pernas |
| `action.sexy_neck_kiss` | `orientation: three_quarter` | uma pessoa atrás e outra na frente | uma só orientação para dois corpos em profundidades diferentes |

Os valores de `gaze` também não têm **"um para o outro"**, que é o olhar mais comum numa interação. Por isso 14 itens
usam `away`.

### 3.2 Papéis amarrados pela ordem do texto

O catálogo escreve os papéis por lugar ("the adult on the left", "the adult behind", "the rider"). O renderizador
acrescenta "taking its roles in the order it describes them" ([render_qwen21.py:356](../backend/src/prisma_studio/domain/render_qwen21.py:356)).
Isso já foi medido como frágil (o primeiro recebia o papel e a anatomia do outro), e por isso a posição virou
obrigatória. Ainda assim:
- se o personagem fica "à esquerda" e o texto começa por "the adult on the left", o papel do primeiro e o lugar do
  segundo coincidem, e nada detecta o conflito;
- "the adult in front" e "the adult behind" mudam de sentido em relação à câmera conforme a orientação.

### 3.3 Mãos sem dono

As anomalias mais frequentes (braço a mais, mão saindo do lugar errado) vêm de **mãos não atribuídas**. Um abraço
descreve "arms wrapped around each other" sem dizer **qual mão de quem toca o quê**. O modelo precisa resolver quatro
mãos em dois corpos sobrepostos e, na dúvida, desenha mais uma. A cláusula de anatomia diz quantas mãos cada pessoa
tem, mas não **onde** estão.

### 3.4 Sobreposição sem ordem de profundidade

Nos pontos em que um corpo passa na frente do outro (braço atrás das costas, perna entre pernas), o modelo funde os
contornos. O prompt nunca diz **qual corpo fica na frente** ali nem **por onde o membro some e reaparece**.

### 3.5 Pose a dois + ação a dois descrevem os corpos duas vezes

Para **uma** pessoa, o compilador já separa: "keep the requested pose for the torso and legs, and let the arms and
hands follow this action" ([render_qwen21.py:297](../backend/src/prisma_studio/domain/render_qwen21.py:297)). Para
**grupos** essa linha não entra (`not group`). Pose e ação a dois juntas viram duas descrições completas dos mesmos
corpos, e esse é o caminho mais curto para membros duplicados.

### 3.6 Edição que acrescenta alguém e muda a interação no mesmo passo

Medido: 2 a 3 de 10. O modelo precisa, ao mesmo tempo, inventar um corpo, preservar outro e reposicionar os dois.
Hoje o Studio só avisa.

### 3.7 Ninguém tem sexo declarado: o corpo de um vaza para o outro

Sintoma relatado: partes do corpo de homem aparecendo numa mulher. Hoje o sexo de cada pessoa **não existe em
lugar nenhum** do sistema:
- a ficha tem só nome, notas e fotos ([app.py:117](../backend/src/prisma_studio/api/app.py:117)), e o personagem do
  pedido tem referência, descrição e posição ([request.py:59](../backend/src/prisma_studio/domain/request.py:59));
- o personagem herda "facial identity, body shape, skin tone and hairstyle of the person in <imageN>". O sexo fica a
  cargo do modelo, que o deduz de uma foto que muitas vezes mostra só o rosto;
- os itens de grupo dizem "two adults" (42 vezes), "the adult on the left", "the right adult's chest", sempre com
  "their". **Nenhuma palavra do prompt prende um corpo masculino a uma pessoa e um feminino à outra**;
- a roupa com escopo "todos" diz "Every person wears it": uma peça feminina pedida para os dois puxa o corpo do homem
  para o feminino, e o contrário também;
- gerando só com opções, `Others` pede pessoas "diferentes", mas não diz o sexo de cada uma.

Por que vaza: num modelo de difusão, os atributos de um conceito se espalham para a região vizinha (*attribute
leakage*). Num abraço ou numa cena íntima, as duas pessoas ocupam a mesma região, e "a man and a woman" dito uma vez
no começo não basta: a cada menção neutra ("the adult", "their chest") o modelo escolhe de novo, e no ponto de
contato escolhe errado.

## 4. Princípios de redação (para o catálogo e o renderizador)

1. **Descreva o contato, não o sentimento.** "the second person's right hand rests on the first person's lower back"
   rende mais que "a tender embrace". Para o Qwen, adjetivo de clima é ruído; ponto de contato é estrutura.
2. **Toda mão tem dono e destino.** Numa interação, as quatro mãos são citadas, nem que seja "the other hand hangs
   relaxed at the side".
3. **Um corpo é a âncora.** Primeiro, quem sustenta o peso e onde (chão, cama, colo); depois, quem se apoia nele.
4. **Uma pessoa por frase.** "The first person …. The second person …." em vez de uma frase com "each other".
   "Each other" é ótimo para reciprocidade simples (aperto de mão) e péssimo quando os papéis são assimétricos.
5. **Lugar pela imagem, papel pelo nome.** Esquerda e direita são da imagem (o renderizador já faz isso nos
   personagens), e o papel ("o carregador", "quem sussurra") se liga ao ordinal **antes** da descrição.
6. **Termos diretos.** Nada de eufemismos geométricos ("V-shaped geometry"). O codificador entende linguagem corporal
   comum melhor que abstrações.
7. **Substantivo com sexo em toda menção, nunca pronome neutro.** Quando o sexo é conhecido, "the woman's right hand
   on the man's waist" em vez de "the left adult's right hand on the right adult's waist". Repetir o substantivo é a
   técnica mais eficaz contra vazamento de atributos: cada menção reancora o corpo certo.
8. **Âncora visual por pessoa.** Quando as duas pessoas se parecem, um traço curto e distinto ("the first person, in
   the red dress") ajuda o modelo a manter os papéis na região certa. Os personagens já trazem isso; para pessoas
   geradas só por opções, o bloco `Others` pode sugerir.

## 5. Proposta de estrutura: papéis e contatos

Acrescentar a `Requirements` **um bloco opcional de papéis**, usado só pelos itens de grupo. Ele não substitui o
`prompt`, que continua sendo o texto principal. Serve para o compilador gerar fatos **por pessoa** e para as regras
validarem o item.

```json
{
  "id": "action.fun_piggyback",
  "category": "action",
  "label": "Cavalinho",
  "prompt": "two adults laughing in a piggyback ride",
  "requirements": {
    "participants": 2,
    "minimum_framing": "full",
    "support_any_of": ["floor"],
    "roles": [
      {"name": "carrier", "posture": "standing", "gaze": "camera", "support": "floor",
       "text": "stands bent slightly forward, both hands holding the back of the rider's knees"},
      {"name": "rider", "posture": "carried", "gaze": "camera", "support": "body", "layer": "behind",
       "text": "sits high on the carrier's back, both arms wrapped around the carrier's shoulders, legs around the carrier's waist"}
    ]
  }
}
```

O compilador liga **papel → ordinal** de forma explícita, pela posição escolhida ou pela ordem dos papéis, e o
renderizador escreve uma frase por pessoa:

> Action: two adults laughing in a piggyback ride. The first person is the carrier: stands bent slightly forward, both
> hands holding the back of the second person's knees; their feet are on the floor. The second person is the rider,
> just behind the first person: sits high on the first person's back, both arms wrapped around the first person's
> shoulders, legs around the first person's waist; they are held by the first person's body, not by the floor. Where
> the bodies overlap, the first person is closer to the camera. Four hands in total, each where described.

O que isso resolve:
- **3.1:** postura, olhar e apoio passam a ser por pessoa; o fato de cena só é escrito quando **todos** os papéis
  concordam (o `agreed()` atual continua valendo para isso).
- **3.2:** o papel é nomeado e ligado ao ordinal antes de ser descrito; "taking its roles in the order…" sai.
- **3.3:** as regras contam as mãos citadas por papel (no máximo 2) e avisam no catálogo quando uma mão aparece duas
  vezes.
- **3.4:** `layer` (`front`/`behind`) gera a frase de sobreposição.

Valores novos necessários no vocabulário:
- `gaze`: `partner` ("each looks into the other's eyes" / "looks at the first person's face");
- `support`: `body` (colo, costas, braços do outro) e `posture: carried`;
- `Requirements` deixa de rejeitar `roles`; o restante continua `extra='forbid'`.

Compatibilidade: um item sem `roles` funciona exatamente como hoje. A migração é gradual, começando pelos itens das
seções 3.1 e 6.1.

### 5.1 Sexo de cada pessoa

**Dado:** um campo `sex` (`female` | `male` | não informado) em três lugares:
- **ficha** (escolhido uma vez e reaproveitado em todo pedido com ela);
- **pessoa principal** do pedido (na edição, a pessoa da foto; ao criar, quando não vem de ficha);
- **pessoas geradas só por opções** (segunda, terceira…), já que hoje elas não têm onde ser descritas.

Na tela: um seletor simples, com a ajuda só no hover e o aviso embaixo do campo, como nos outros formulários. "Não
informado" mantém o comportamento atual.

**Renderização**, quando o sexo é conhecido:
1. *Elenco ancorado*: "The first person is a woman and the second person is a man." logo depois do cabeçalho, antes
   de qualquer roupa ou ação.
2. *Substantivo no lugar de "person"*: o renderizador já escreve "the first person" em vários lugares; com o sexo,
   escreve "the first person, the woman," na primeira menção e "the woman" nas seguintes. Isso vale para o personagem
   ("Add a second person, a man, …"), para a roupa, para os papéis e para a contagem ("exactly two people: one woman
   and one man").
3. *Anatomia por pessoa* no lugar da cláusula genérica: "The woman has a female body throughout: female face, chest,
   waist, hips and genitals. The man has a male body throughout: male face, chest, hips and genitals. Where their
   bodies touch, each keeps their own anatomy." No modo adulto, termos diretos; no modo padrão, sem "genitals".
4. *Papéis com sexo*: com o bloco `roles` da seção 5, "The woman is the rider…". Sem esse bloco, o vínculo continua
   sendo pela posição, mas dito com sexo: "The adult on the left is the woman."
5. *Roupa para todos com sexos diferentes*: "Every person wears it, each in the version that fits their own body." E a
   tela avisa quando a roupa é para todos e o casal é misto, sugerindo descrever a roupa de cada um nos Detalhes.

**Regras:** avisar quando há duas ou mais pessoas, uma ação ou pose de contato, e o sexo de alguém não foi informado
("Diga quem é mulher e quem é homem; sem isso o corpo de um pode passar para o outro").

**Catálogo:** os itens continuam neutros ("two adults"). Quem dá o sexo é o pedido, não o item, assim a mesma ação
serve para qualquer casal. Itens que hoje dizem "two adults" sem papéis passam a ser renderizados com o elenco já
ancorado antes deles.

**Implementado (compilador 1.22.0, 28/10), ainda sem medição de imagem:**
- Dado: `participants.sexes` no pedido, uma posição por pessoa (1ª, 2ª…), e `sex` na ficha. A ficha preenche a posição
  dela ao entrar na cena (como principal ou personagem); quando um personagem sai, os sexos de quem vem depois sobem
  junto. Pedidos salvos guardam os sexos, como escolha da cena.
- Tela: "Quem é quem" no bloco Cena (aparece com 2 ou mais pessoas; clicar de novo limpa) e "Sexo" na ficha.
- Itens 1, 3 e 5 como descritos, e o aviso `sex_unknown` quando há pose ou ação a dois e falta o sexo de alguém.
- Item 2 de forma mais conservadora: os ordinais continuam ("the first person"), porque a redação atual foi medida
  (por exemplo, 12 de 12 ao acrescentar pessoa). O sexo vai junto de cada menção: "the first person (a woman) and the
  second person (a man)" na pose ou ação, "Add a second person, a man, …" no personagem e "exactly two distinct
  people, one woman and one man," na contagem. Substituir "person" por "the woman" fica para depois da medição.
- Item 4 depende do bloco `roles` (P1). O aviso na tela para roupa de casal misto não foi feito: só a frase no prompt.

## 6. Mudanças, por prioridade

### P0: rápidas e sem esquema novo

1. **Sexo de cada pessoa** (seção 5.1): campo na ficha e no pedido, elenco ancorado, substantivo em vez de "person",
   anatomia por pessoa e aviso quando falta. É a mudança com maior efeito esperado para o vazamento de corpo.
2. **Linter do catálogo** (teste): todo item de grupo cujo `gaze`/`orientation`/`posture` não vale para todas as
   pessoas deve declarar `any`. Corrigir já: `sexy_whisper` (gaze → `any`, olhar dentro do texto),
   `family_grandparents` e `family_child_hip` (postura/apoio que não valem para a criança), `sexy_neck_kiss`
   (orientação → `any`). Revisar os 14 `away` que na verdade são "um para o outro".
3. **Pose a dois + ação a dois**: estender ao grupo a regra que já existe para uma pessoa. A pose fica dona do tronco
   e das pernas; a ação, só das mãos, do contato e do rosto. Se as duas descrevem contato de corpo inteiro, avisar
   que duas interações juntas costumam duplicar membros.
4. **Contagem de mãos explícita** na cláusula de anatomia quando há grupo e ação/pose de contato: "Four hands in
   total: two belong to the first person and two to the second." É barato e mensurável.
5. **Conflito de posição × papel**: avisar quando a posição escolhida para o personagem coincide com o lugar do papel
   que o texto dá ao primeiro.

### P1: papéis e contatos (seção 5)

6. Esquema `roles` + renderização por pessoa + frase de sobreposição.
7. Migrar primeiro as 7 ações `sexy_*`, as 12 poses de grupo e as ações de colo, carregar e abraço.
8. Valor `partner` de olhar e apoio `body`.

### P2: controle estrutural e verificação

9. **Esqueleto de duas pessoas**: hoje a transferência de pose por esqueleto vale só para "the first person". O
   SDPose detecta várias pessoas; um esqueleto a dois como referência é o controle mais forte que existe para
   interação, mais que qualquer texto. Poses do catálogo podem levar um esqueleto de exemplo.
10. **Edição em dois passos** para "acrescentar + interagir" (hoje 2 a 3 de 10): passo 1, acrescentar lado a lado
   (12 de 12 medido); passo 2, com as duas pessoas já na foto, aplicar a pose a dois. É uma hipótese a medir; se
   passar de 6 de 10, vira o caminho padrão em vez do aviso.
11. **Verificação depois da geração**: o RT-DETR já conta corpos. Somar pontos-chave (pulsos e tornozelos por pessoa)
    para marcar imagens com mais de 2 mãos ou 2 pés por corpo e sugerir outra seed.

## 7. Como medir

Acrescentar ao [banco de casos](../benchmark/casos.json) um bloco de interação, sempre com as seeds 3, 8, 11 e 21 no
Turbo:

| Caso | Por que está aqui |
|---|---|
| sussurro (olhares diferentes) | 3.1: olhar por pessoa |
| cavalinho (carregar) | 3.1/3.4: postura e apoio por pessoa, sobreposição |
| abraço por trás (`neck_kiss`) | 3.4: profundidade |
| deitados de lado se olhando | olhar `partner`, apoio na cama |
| pose a dois + ação a dois | 3.5 |
| colo (avós com criança) | apoio `body` |
| casal misto em contato de corpo inteiro (abraço, deitados), com e sem sexo informado | 3.7: vazamento de anatomia |
| casal misto com roupa para os dois | 3.7: roupa puxando o corpo |
| editar: acrescentar + abraçar (1 passo × 2 passos) | 3.6 / item 10 |

Critério de acerto por imagem: número certo de pessoas, **2 mãos e 2 pés por corpo**, **cada corpo inteiro do
sexo pedido** (rosto, tórax, quadril e, no modo adulto, genitais), papéis certos, nenhum contorno
fundido no ponto de contato e apoio crível. Registrar no ROADMAP como nas medições anteriores (antes → depois).

## 8. O que não fazer

- Não criar metadados que nenhuma regra lê (`splayed`, `curve`, `depth`): o efeito deles cabe no `prompt`.
- Não usar eufemismos para "despistar" o modelo: piora a aderência.
- Não somar cláusulas genéricas de qualidade ("perfect anatomy, no extra limbs"): sem CFG elas não têm efeito, e
  frases concretas por pessoa funcionam melhor.
