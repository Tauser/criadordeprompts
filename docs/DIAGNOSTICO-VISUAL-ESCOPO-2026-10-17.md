# Diagnóstico visual do escopo de roupa

Data: 17/10/2026. Teste autorizado após a análise da geração anterior. Escopo: estudos acadêmicos não
sexuais de personagens inteiramente fictícios, declarados adultos de 30 anos ou mais. As fotos anteriores
não foram usadas. A validação visual foi feita por inspeção das imagens produzidas, sem o avaliador de 9B.

## Resultado

**A instrução chegou ao modelo, mas a edição controlada não a cumpriu. Não há uma correção visual
comprovada para essa falha.** A geração nova aplicou o escopo aos dois participantes, com uma falha adicional
na diferenciação das características dos personagens. Isso não valida o funcionamento da edição.

| Caso | Observação visual | Pedido |
|---|---|---|
| Controle com roupas | Duas figuras adultas em pé, ambas vestidas com túnicas. A instrução de roupa compartilhada foi atendida. | `ffe14968c3a049e9ba99cf1b77b66bd5` |
| Novo estudo de figura não sexual | Ambas as figuras ficaram sem roupas. Os desenhos dos dois personagens ficaram muito semelhantes e não atenderam convincentemente à diferenciação solicitada. | `2ee1aa89ac8242debdc72c810fb3ebee` |
| Edição do controle | As duas figuras continuaram vestidas. O resultado apresentou também granulação e contraste fortes que não estavam na imagem alvo. | `8f7ea491dcf1401a8f0e4c1ef7253494` |

Os dois primeiros pedidos usaram a mesma composição e seed, mudando a escolha de roupa. O terceiro foi
uma edição do primeiro desenho: alvo com duas pessoas, quantidade existente e pedida igual a dois, escopo
`all`, instrução completa do item neutro e preservação dos demais atributos. As três execuções terminaram
sem erros técnicos registrados.

## Condições controladas

- Compilador 1.4.0, perfil completo Qwen Image 2.1, 40 passos, CFG 1, denoise 1 e seed `20261017`.
- Uma variação por pedido, com aprimorador e verificador automático desativados.
- Geração nova: 768 × 1024; edição: tamanho original do controle, também 768 × 1024.
- Estilo de desenho acadêmico a carvão, pose neutra em pé, fundo simples e sem ação sexual.
- Na edição foi usado exclusivamente o desenho produzido pelo controle.

## Conferência técnica

No grafo persistido da edição, o nó `TextEncodeQwenImage21` recebeu a instrução completa, o escopo para
ambos e a referência no primeiro slot. O sampler usou a seed planejada e o latent de saída desse nó. A
resolução `0` mantém o tamanho da primeira referência, conforme a implementação instalada em
`C:/GeraImg/ComfyUI_windows_portable/ComfyUI/comfy_extras/nodes_qwen.py`.

A referência do controle está registrada como RGBA, com alpha entre 253 e 255. A comparação entre
descartar o alpha e compor sobre branco mostrou diferença máxima de um nível por canal. Essa diferença
pequena não oferece explicação suficiente para a textura forte observada no resultado. Não foi confirmada
uma causa de normalização, transporte ou ligação de nós nesta conferência.

O estado `completed` confirma o término do workflow; não confirma o cumprimento visual das instruções.
A nova regra corrige o escopo expresso pelo software. Esses testes mostram que ela não oferece garantia
de obediência do modelo nem de preservação das características dos dois personagens.

Os três casos são uma amostra pequena. O teste de edição usa uma única imagem contendo duas pessoas;
não testa a inclusão de outra pessoa a partir de uma segunda referência. Não foi estabelecida a causa
interna da falha no modelo, e não se deve atribuí-la automaticamente à classificação de pessoa real.

## Evidências preservadas

- [Pedidos, prompts, parâmetros, IDs e observações](D:/Projetos/GeraImg/studio/data/diagnostics/wardrobe-scope-20261017T165456Z/evidence.json).
- [Controle com roupas](D:/Projetos/GeraImg/studio/data/diagnostics/wardrobe-scope-20261017T165456Z/control_robes.png).
- [Geração artística não sexual](D:/Projetos/GeraImg/studio/data/diagnostics/wardrobe-scope-20261017T165456Z/neutral_figure_study.png).
- [Edição do controle](D:/Projetos/GeraImg/studio/data/diagnostics/wardrobe-scope-20261017T165456Z/neutral_edit_from_control.png).

As cópias PNG são idênticas aos arquivos registrados pelo Studio, verificadas pelo SHA-256. Os pedidos
também ficaram disponíveis no histórico da aplicação. Não houve novas alterações de regras ou de parâmetros
após esses três testes.
