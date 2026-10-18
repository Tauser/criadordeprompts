# Prisma Studio — Arquitetura

Aplicativo local para criar e editar imagens com o ComfyUI (Qwen Image 2.1). Uma pessoa, uma GPU (RTX 4070, 12 GB), Windows.

## Princípios

1. **O pedido estruturado é a fonte de verdade.** O prompt é um resultado derivado e reproduzível do pedido.
2. **Garantias separadas por nível.** Execução e cobertura das instruções verificadas nos cenários testados;
   fidelidade visual medida, nunca prometida. A validação local de grafos ainda não confere todos os tipos das ligações.
3. **Nada muda o pedido em silêncio.** Aprimorador e verificação produzem diferenças visíveis; o padrão é enviar o texto compilado.
4. **Regras por categoria e metadado.** Nenhum nome, ID ou palavra de opção vira condição no código. Fonte do valor, texto livre e classificação não mudam a composição de outros atributos.
5. **O estado de execução vem do ComfyUI.** O Studio registra intenções (enviar, cancelar) e observa o resultado por `/api/jobs`.

## Camadas

```text
frontend/ (React + TS + Vite)  ──HTTP/SSE──►  backend/src/prisma_studio/api (FastAPI)
                                                 │
                     application (casos de uso) ─┼─► domain (puro: pedido, regras, compilador, verificação)
                                                 │
            worker (executor durável) ───────────┼─► infrastructure/comfy (cliente, workflows-contrato)
                                                 └─► infrastructure/db (SQLite) · storage (arquivos por hash)
```

- `domain` não importa HTTP, banco, arquivos nem ComfyUI. Testável sem GPU.
- `application` coordena: preparar pedido, criar trabalho, biblioteca, tradução.
- `worker` executa trabalhos em etapas, persiste transições e reconcilia com o ComfyUI.
- `infrastructure/comfy` é o único módulo que conhece endpoints, IDs de nós e formatos do ComfyUI.

## Pedido (contrato v1)

Cada atributo tem uma **intenção** independente da origem do valor:

| Intenção | Significado | Origem do valor |
|---|---|---|
| `keep` | Manter da foto alvo (só edição) | — |
| `set` | Definir um novo valor | item do catálogo ou texto |
| `transfer` | Trazer de uma imagem de referência | id da referência |
| `free` | Sem instrução; o modelo decide | — |

Categorias: subject, face, body, skin, hair, wardrobe, environment, pose, expression, action, lighting, style, camera, framing.
Referências têm id estável; na edição, `target_id` aponta a foto alvo (sempre `<image1>`).

## Compilador

`pedido → avaliação → representação intermediária (blocos tipados) → render por família de modelo → verificação de cobertura`

- **Blocos**: `Header`, `Operation(categoria)`, `WardrobeScope`, `Transfer(ref, aspectos)`, `Character`, `Keep(aspectos)`, `Participants`, `MinimumFraming`, `Guidance`, `Details`, `Manual`.
- **Agrupamento por referência**: rosto, corpo, pele e cabelo vindos da mesma imagem viram um único `Transfer` (sem contradições).
- **Render Qwen 2.1** segue o guia oficial do modelo: operação primeiro; preservação numa cláusula geral sem repintar o que fica; identidade apontando para a referência, sem descrever traços; frases afirmativas; tags `<imageN>` somente com duas ou mais imagens; nada de resolução no texto.
- **Cobertura**: cada bloco gera um trecho identificado; a compilação falha se um bloco não aparecer ou se um aspecto estiver ao mesmo tempo mantido e alterado.
- **Determinismo**: mesmos dados e versões → mesmo texto. A versão do compilador é registrada no trabalho.
- **Escopo de roupa (compilador 1.4.0)**: `wardrobe_scope` aceita `primary` (padrão compatível com pedidos
  antigos) ou `all`. `all` exige uma instrução `set` de roupa e um grupo declarado de pelo menos duas
  pessoas, considerando a quantidade pedida, as pessoas existentes e os personagens adicionados.
  O escopo é um bloco próprio na prévia; não reescreve a descrição escolhida nem as identidades das
  referências. Em grupos, `primary` explicita a primeira pessoa e `all` explicita ambos/todos os
  participantes. O checklist produz um requisito de roupa por pessoa alcançada pelo escopo. O modo
  manual continua literal. Classificação e confirmações de opções adultas não são alteradas pelo escopo.

## Execução

Estados do pedido: `created → preparing → (refining → review) → generating → (verifying) → completed | failed | cancelled | lost`. Estados de cada etapa: `created → submitting → queued → running → completed | failed | cancelled | lost`, com `uncertain` quando o envio não pôde ser confirmado.

- O trabalho é gravado no SQLite **antes** do envio. Cada etapa grava início, fim, duração e identificador externo.
- `POST /api/jobs/{id}/cancel` do ComfyUI (atômico, idempotente) para cancelar; `GET /api/jobs/{id}` para observar.
- Reconciliação na inicialização e a cada consulta: trabalho que some do ComfyUI vira `lost`; envio sem confirmação (ou interrompido por um reinício) vira `uncertain`, continua sendo procurado no ComfyUI e só é reenviado quando o usuário confirma. Falha de conexão antes do envio volta a etapa para `created`, porque nada pode ter chegado.
- Uma fila própria com concorrência 1 para imagem, aprimorador e verificação (uma GPU). A tradução da biblioteca é uma prévia: vai direto à fila do ComfyUI, que também executa um trabalho por vez, e não é registrada no SQLite.
- A trava de instância só é liberada depois que a thread do executor encerra. Respostas HTTP 5xx ou JSON
  ilegível não provam recusa do ComfyUI: consultas são repetidas e envios ambíguos mantêm a etapa incerta.

## Edição com máscara

A máscara é desenhada na interface. O workflow prepara a edição no tamanho normalizado; depois o Studio
recompõe o resultado sobre a foto original, no tamanho e orientação dela. A máscara efetiva da recomposição
é a área pintada, com suavização somente dentro dela. Fora dessa área, os pixels decodificados são os da
foto original. O resultado final é armazenado em PNG; isso não significa igualdade dos bytes do arquivo
com um original JPEG ou WEBP.

## Verificação automática

Gera N variações (seeds diferentes). Em lote, o modelo de texto/visão de 9B recebe cada resultado e uma lista de verificação derivada dos blocos do compilador e responde por item (`met`, `partial`, `unmet`, `unknown`). A melhor variação é destacada com o placar. A confiabilidade do avaliador é medida, não presumida.

## Conteúdo

A classificação +18 apenas organiza e filtra a biblioteca; não altera a composição de outros atributos. Duas proteções permanecem: (1) opções adultas exigem a confirmação de que todas as pessoas retratadas são adultas; (2) na edição de fotos com opções adultas, exige-se a confirmação de que a pessoa retratada é fictícia ou consentiu. O comportamento próprio dos modelos não é contornado; o Studio apenas o torna visível.

## Dados

- Diretório de dados único e configurável (padrão `studio/data`, fora do Git): `studio.db`, `files/<hash>`.
- Catálogo padrão versionado em `catalog/defaults.json`; personalizações do usuário no banco.
- Exclusões em lote do histórico são transacionais. A limpeza de bytes sem referências ocorre depois do
  commit, mantendo a trava de escrita: falhas de disco deixam órfãos para limpeza posterior e não restauram
  entradas cujas imagens já foram apagadas. Os rascunhos protegidos são os informados pelo cliente que apaga;
  ainda não há registro persistido de rascunhos de outras abas ou dispositivos.

## Decisões (ADR)

Ver `docs/adr/`.
