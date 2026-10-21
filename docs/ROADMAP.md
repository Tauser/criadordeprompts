# Prisma Studio — roadmap

Montado em 21/10/2026 a partir de:
- a análise do código;
- dos testes medidos nesta rodada (pessoa a mais, cabeça colada, expressão);
- da pesquisa de ferramentas parecidas (InvokeAI, SwarmUI, Krita AI, ferramentas de quadrinhos);
- do que o ComfyUI local já tem instalado.

O foco é o uso principal: **editar personagens dos contos** sem que eles mudem entre as cenas.

Regras do roadmap:
- cada item entra numa branch própria e só vai para a main depois de aprovado;
- todo download de modelo é aprovado antes, com nome, origem e tamanho.

Esforço: **P** (horas), **M** (um dia), **G** (vários dias).

## Já feito (main, 44c4870)

- Contagem de rostos com aviso de pessoa a mais; a variação com gente a mais deixa de ser a melhor.
- Pessoa acrescentada por referência: a cabeça é redesenhada na cena, sem copiar o ângulo, a luz e a expressão da
  foto de referência.
- Manter a expressão não anula mais o que a ação pede no rosto.
- Auditor da Biblioteca: avisa sobre ângulo de câmera e truques de olho; selfie com caretas sem olho vesgo.
- Instruções de edição próprias removidas das 5 poses não explícitas da Biblioteca.

## Fase 0 — Base para medir e corrigir rápido

Vem primeiro porque é com ela que todos os itens seguintes são medidos.

| # | Item | O que resolve | Esforço |
|---|---|---|---|
| 0.1 | **Banco de casos** | 10 a 15 edições típicas (acrescentar personagem, pose, ação a dois, troca de cenário) com seeds fixas, rodadas no Turbo a cada mudança. | M |
| 0.2 | **Grade de comparação na tela** | O mesmo pedido em várias seeds, opções ou perfis lado a lado, como o gerador de grade do SwarmUI. | M |
| 0.3 | Rosto na borda não derruba a variação | Hoje um rosto detectado fora da imagem faz a variação falhar; o certo é só pular aquele rosto. | P |
| 0.4 | Contar pessoas também com uma pessoa só | Hoje a contagem só roda quando a passada de rosto está ligada. | P |
| 0.5 | **Cópia de segurança automática** | Banco, Biblioteca e Histórico; hoje um Histórico apagado não tem volta. | P |

## Fase 1 — Medidas objetivas do corpo

Os nós já estão no ComfyUI; falta baixar os modelos.

| # | Item | O que resolve | Esforço |
|---|---|---|---|
| 1.1 | **SDPose (pontos do corpo)** | Mede a cabeça contra os ombros (cabeça desproporcional) e conta braços e pernas (membro a mais). Vira aviso e critério para escolher a melhor variação. | M |
| 1.2 | **RT-DETR (detector de pessoas)** | Conta pessoas pelo corpo, inclusive de costas ou com o rosto escondido. Também acha cama, sofá e cadeira, para conferir o apoio da pose. | M |

Antes de entrar no Studio, cada medida é calibrada no banco de casos (0.1), para não gerar alarme falso.

## Fase 2 — Personagens dos contos

| # | Item | O que resolve | Esforço |
|---|---|---|---|
| 2.1 | **Preparo da referência** | Recorte automático na pessoa e remoção do fundo antes de mandar ao modelo, para o fundo e a luz da foto não vazarem para a cena. Avisos para referência escura, de lado ou com óculos escuros. | M |
| 2.2 | **Fichas de personagem** | Uma aba "Personagens": nome, fotos e traços que não mudam. Na edição, escolhe-se "Ana" num campo, em vez de anexar a foto de novo. | G |
| 2.3 | **Folha de referência** | Gera o personagem de frente, de perfil e de três quartos em fundo neutro; a melhor vira a referência oficial da ficha. | M |
| 2.4 | **Posição de cada pessoa** | Esquerda, direita, frente ou atrás, no lugar do "ao lado" de hoje. | P |
| 2.5 | Aviso de rosto descrito em texto | Quando o personagem tem foto de referência, escrever "olhos azuis" faz o modelo ignorar a foto. | P |
| 2.6 | Conferir se o personagem mudou | Compara o rosto do resultado com a ficha e marca a variação mais parecida. Depende de um modelo de identidade, que ainda não está no ComfyUI; precisa ser avaliado. | M |

## Fase 3 — Controle da cena

| # | Item | O que resolve | Esforço |
|---|---|---|---|
| 3.1 | **Máscara por texto (SAM 3)** | Escreve-se "a mulher" ou "a camiseta" e a máscara sai sozinha. | M |
| 3.2 | Corrigir área no resultado | Botão no resultado que abre o editor de máscara já com essa imagem. | P |
| 3.3 | Pedido por região | Mais de uma máscara, cada uma com seu pedido ("esta pessoa faz isso, aquela faz aquilo"). | G |
| 3.4 | Pose por esqueleto (ControlNet do Qwen) | Força a pose exata. Primeiro é preciso testar se o modelo aceita; se não, fica a pose por foto, que já existe. | M |

## Fase 4 — Qualidade final e velocidade

| # | Item | O que resolve | Esforço |
|---|---|---|---|
| 4.1 | **Gerar em 1024 e ampliar no fim** | 1024, depois detalhe de rosto, depois ampliação (SeedVR2 ou upscaler). Fica mais rápido e evita os picos de memória com LoRA. Medido contra 1536 no banco de casos. | M |
| 4.2 | Detalhe de mãos | Passada como a do rosto, para mãos e dedos. Usa os pontos do SDPose (1.1). | M |
| 4.3 | Cache int8 no Completo | Para os picos de memória em 1536 com LoRA, com aviso quando a memória estiver no limite. | P |
| 4.4 | Prompt mais enxuto | Tirar repetições do texto montado; menos espaço para contradição. Medido no banco de casos. | M |
| 4.5 | Revisor de defeitos sim/não | Perguntas objetivas ao modelo de visão ("mão com seis dedos?"). Só depois de 1.1, e nunca como nota geral. | M |

## Fase 5 — Fluxo de trabalho

| # | Item | O que resolve | Esforço |
|---|---|---|---|
| 5.1 | Pedidos salvos | Reaproveitar uma cena inteira, como os presets do SwarmUI. | M |
| 5.2 | Fila em lote por conto | Várias cenas de uma vez, rodando enquanto você faz outra coisa. Depende das fichas (2.2). | G |
| 5.3 | Aviso no celular | Notificação quando a geração termina. | P |
| 5.4 | Busca e paginação no Histórico | Pendente desde a revisão de 17/10. | M |
| 5.5 | Acesso pela rede local | Falta a regra no firewall; ver [ACESSO-LAN.md](ACESSO-LAN.md). Precisa da sua autorização como administrador. | P |
| 5.6 | Biblioteca: ângulo de câmera | Tirar só o trecho de câmera das 3 opções que o auditor marca, sem mexer no resto. | P |

## Fora do roadmap, e por quê

- **LoRA de consistência de rosto:** nos seus testes, as edições ficaram melhores sem LoRA.
- **Tapar a cabeça da referência com uma mancha:** é gambiarra; o preparo da referência (2.1) resolve melhor.
- **Desenho ao vivo (Krita):** feito para quem desenha à mão.
- **Revisor com nota geral:** o modelo de visão local já se mostrou fraco; só perguntas objetivas (4.5).
- **"Descrever a partir da foto" e "Trocar pessoas":** removidos depois de medidos; não voltam.
- **Contagem exata no texto ("exatamente N pessoas"):** testada, sem diferença medida.

## Ordem sugerida

0.3, 0.4 e 0.5 (rápidos) → 0.1 e 0.2 (medir) → 1.1 e 1.2 → 2.1 e 2.4 → 2.2 e 2.3 → 4.1 → o restante conforme o uso.
