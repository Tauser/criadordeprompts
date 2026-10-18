# Comparação visual: preservação longa e curta

Data: 17/10/2026. Teste de edição totalmente vestida, com as duas referências já disponíveis no Studio.

## Resultado

**Ambos os pedidos aplicaram a troca de roupa às duas pessoas.** A hipótese de que a cláusula longa de
preservação seja um bloqueio geral para edição de roupas não foi confirmada neste teste. A versão curta
não apresentou melhora clara no requisito principal.

| Variante | Pedido | Observação |
|---|---|---|
| Preservação longa | `c482662845af4d3ab8ca34136b282120` | Duas pessoas distintas, ambas com camisa azul-clara de mangas compridas, calça escura e sapatos fechados. |
| Preservação curta | `2fd7016ab9df42dca227d06548694cc6` | O mesmo requisito foi cumprido para ambas; há pequenas diferenças de pose, caimento e aparência. |

As imagens foram inspecionadas diretamente. Os dois workflows terminaram sem erro. As características
faciais se mantiveram visualmente semelhantes às referências, sem uma medição biométrica de identidade.

## Controle da comparação

- Mesmas duas referências, na mesma ordem; a foto alvo contém uma pessoa e a segunda é acrescentada por referência.
- Duas pessoas pedidas, uma já presente na foto e escopo de roupa para todas.
- Mesma seed `20261017`, perfil completo Qwen Image 2.1, 40 passos, CFG 1, Euler, Simple e denoise 1.
- Resolução 1024, latent da primeira referência, uma variação; aprimorador e verificação automática desligados.
- Mesmas instruções de roupa, pose, composição e personagem adicional no prompt final.
- A única diferença entre os textos finais é a cláusula de preservação. A variante longa usa o modo
  estruturado; a curta usa o modo manual para essa substituição controlada. Os prompts efetivamente
  registrados foram conferidos contra os preparados. O modo manual deixa o checklist vazio, sem efeito
  sobre a amostragem porque a verificação estava desligada.

Na variante curta, a lista de atributos a manter foi substituída por uma frase de preservação das
identidades faciais e dos cabelos a partir das respectivas referências. Não foram alterados parâmetros do
modelo entre os dois testes.

O tempo entre criação e conclusão inclui a espera pela geração anterior que já estava executando. Esses
intervalos não devem ser apresentados como tempo puro de inferência. Os horários de início/fim das tarefas
e suas durações foram preservados no JSON de evidências.

## Limites da conclusão

O teste comprova que essa configuração conseguiu editar a roupa das duas pessoas com ambas as versões de
preservação. Não identifica a causa das falhas dos outros pedidos nem prova que toda cláusula de preservação
seja inofensiva em qualquer cena. Foi usada uma cena e uma seed; retirar a preservação globalmente não é
uma correção sustentada por este resultado. Não foram enviadas novas gerações durante esta análise final.

## Evidências

- [Resultado com preservação longa](D:/Projetos/GeraImg/studio/data/diagnostics/prompt-preservation-20261017T212348Z/preservation_long.png).
- [Resultado com preservação curta](D:/Projetos/GeraImg/studio/data/diagnostics/prompt-preservation-20261017T212348Z/preservation_short.png).
- [Prompts, configurações, resultados e observações](D:/Projetos/GeraImg/studio/data/diagnostics/prompt-preservation-20261017T212348Z/evidence.json).

As cópias PNG foram verificadas por SHA-256 e são idênticas aos arquivos registrados pelo Studio.
