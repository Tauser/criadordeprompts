# Estudo de figura: ajuste e teste controlado

Data: 17/10/2026.

## Diagnóstico

Os seis trabalhos examinados chegaram ao workflow de imagem com a instrução de figura e com o aprimorador desligado. Concluir uma execução não demonstra que a imagem atendeu ao pedido. Não havia evidência de que o Studio tivesse removido a instrução.

O último pedido também acumulava alterações de pessoa, cenário, luz, estilo, enquadramento, pose e ação. A troca da pessoa aparecia junto com a preservação da identidade do rosto. Além disso, o pedido misturava estudo de figura e instruções sexualizadas; ele não foi reutilizado para o teste neutro.

Havia um problema de composição textual: uma descrição de resultado, como um estudo de figura, era colocada dentro do molde de troca de roupa (`Change the clothing to ...`). A solução é permitir uma instrução completa de edição nos metadados do item, mantendo a descrição para geração separada.

## Alterações

- Campo opcional `edit_prompt` nos itens da biblioteca. Na edição, ele é usado como instrução completa, sem receber outro verbo ou molde da categoria. Na geração nova, permanece o `prompt` descritivo.
- O checklist automático usa a instrução efetivamente compilada quando esse campo está presente.
- Campo correspondente no editor da biblioteca, com validação de tamanho e de conteúdo vazio.
- Nova opção **Estudo de figura · adulto fictício (neutro)**, separada do item existente. A instrução descreve figura adulta fictícia, apresentação anatômica neutra e ausência de ênfase na anatomia íntima.
- Aviso quando o pedido tenta trocar a pessoa e manter a identidade do rosto. O aviso não muda escolhas automaticamente.
- Orientação na interface para comparar uma variação por vez, com seed fixa e uma alteração por teste.
- Compilador identificado como versão `1.3.0`.

Os itens e pedidos anteriores foram preservados, incluindo a alteração que já existia em `catalog/defaults.json`.

## Resultado na GPU local

Foi executada **uma geração nova**, sem foto alvo e sem referências. A saída é um estudo de figura adulto em desenho a carvão, com pose em pé neutra e apresentação não sexual. A inspeção visual confirmou o atendimento a esse pedido na primeira execução.

| Parâmetro | Valor |
|---|---|
| Modelo | Qwen Image 2.1 completo já instalado |
| Seed | `2276005834` |
| Dimensões | 768 × 1024 |
| Passos | 40 |
| CFG | 1 |
| Sampler / scheduler | euler / simple |
| Denoise | 1 |
| Variações | 1 |
| Aprimoramento / verificação por modelo | Desligados |
| Job ComfyUI | `71376cf7-2df1-46f9-ba9b-2094841d9b43` |

[Imagem de controle](D:/Projetos/GeraImg/output/prisma/calibration-neutral_00001_.png).

O pedido, prompt e grafo usados ficaram em `studio/data/figure-study-calibration/`. O grafo foi validado contra o ComfyUI local antes da execução; não usa APIs pagas. A fila estava vazia.

Este resultado confirma capacidade de **geração nova de estudo de figura neutro** nessa configuração. Não comprova a mesma alteração na edição de uma referência específica, preservação de identidade ou taxa de sucesso em outras seeds. Também não permite atribuir resultados anteriores a uma regra do modelo sobre pessoas reais/fictícias.

Não houve uma sequência de tentativas de prompt, troca de modelo ou varredura de parâmetros. Aumentar CFG ou passos não foi necessário nesse controle e não deve ser apresentado como garantia de obediência.

## Uso

Na biblioteca, a nova opção fica em Roupa e aparece no compositor com as opções adultas ativadas. Para estudo de figura não sexual, combine-a com uma pose neutra e retire ações sexualizadas. Para manter a mesma pessoa na edição, use **Manter da foto** no campo Pessoa, em vez de pedir sua substituição e preservar o rosto ao mesmo tempo.

Para avaliar mudanças, anote o requisito que não foi atendido e compare a mesma seed, dimensões e referência, alterando apenas um campo por vez. O campo `edit_prompt` corrige a forma da instrução; ele não mede nem garante a resposta visual do modelo.

## Validação de software e disponibilização

- Ruff passou.
- 74 testes do backend passaram.
- 14 testes do frontend passaram.
- TypeScript e build de produção passaram.
- O frontend compilado foi atualizado.
- O Studio foi recarregado após confirmar ausência de pedidos ativos; o ComfyUI permaneceu em execução.
- A API do Studio respondeu HTTP 200 e carregou as 304 opções, incluindo a nova instrução de edição.
