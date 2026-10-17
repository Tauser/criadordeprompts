# KPPB Studio — Arquitetura

Aplicativo local para criar e editar imagens com o ComfyUI (Qwen Image 2.1). Uma pessoa, uma GPU (RTX 4070, 12 GB), Windows.

## Princípios

1. **O pedido estruturado é a fonte de verdade.** O prompt é um resultado derivado e reproduzível do pedido.
2. **Garantias separadas por nível.** Execução (garantida), cobertura das instruções (garantida), fidelidade visual (medida, nunca prometida).
3. **Nada muda o pedido em silêncio.** Aprimorador e verificação produzem diferenças visíveis; o padrão é enviar o texto compilado.
4. **Regras por categoria e metadado.** Nenhum nome, ID ou palavra de opção vira condição no código. Fonte do valor, texto livre e classificação não mudam a composição de outros atributos.
5. **O estado de execução vem do ComfyUI.** O Studio registra intenções (enviar, cancelar) e observa o resultado por `/api/jobs`.

## Camadas

```text
frontend/ (React + TS + Vite)  ──HTTP/SSE──►  backend/src/kppb/api (FastAPI)
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

- **Blocos**: `Header`, `Operation(categoria)`, `Transfer(ref, aspectos)`, `Keep(aspectos)`, `Participants`, `Framing`, `Guidance`, `MaskScope`, `Details`.
- **Agrupamento por referência**: rosto, corpo, pele e cabelo vindos da mesma imagem viram um único `Transfer` (sem contradições).
- **Render Qwen 2.1** segue o guia oficial do modelo: operação primeiro; preservação numa cláusula geral sem repintar o que fica; identidade apontando para a referência, sem descrever traços; frases afirmativas; tags `<imageN>` somente com duas ou mais imagens; nada de resolução no texto.
- **Cobertura**: cada bloco gera um trecho identificado; a compilação falha se um bloco não aparecer ou se um aspecto estiver ao mesmo tempo mantido e alterado.
- **Determinismo**: mesmos dados e versões → mesmo texto. A versão do compilador é registrada no trabalho.

## Execução

Estados: `created → preparing → (refining) → submitted → running → (verifying) → completed | failed | cancelled | lost | uncertain`.

- O trabalho é gravado no SQLite **antes** do envio. Cada etapa grava início, fim, duração e identificador externo.
- `POST /api/jobs/{id}/cancel` do ComfyUI (atômico, idempotente) para cancelar; `GET /api/jobs/{id}` para observar.
- Reconciliação na inicialização e a cada consulta: trabalho ausente do ComfyUI vira `lost`; envio sem confirmação vira `uncertain` e nunca é reenviado automaticamente.
- Uma fila própria com concorrência 1 compartilhada por imagem, aprimorador, tradução e verificação (uma GPU).

## Edição com máscara

A máscara é desenhada na interface. O workflow gera a edição e recompõe sobre a foto original com `ImageCompositeMasked` (máscara expandida e suavizada). Fora da máscara, o resultado é idêntico ao original.

## Verificação automática

Gera N variações (seeds diferentes). Em lote, o modelo de texto/visão de 9B recebe cada resultado e uma lista de verificação derivada dos blocos do compilador e responde por item (`met`, `partial`, `unmet`, `unknown`). A melhor variação é destacada com o placar. A confiabilidade do avaliador é medida, não presumida.

## Conteúdo

A classificação +18 apenas organiza e filtra a biblioteca; não altera a composição de outros atributos. Duas proteções permanecem: (1) opções adultas exigem a confirmação de que todas as pessoas retratadas são adultas; (2) na edição de fotos com opções adultas, exige-se a confirmação de que a pessoa retratada é fictícia ou consentiu. O comportamento próprio dos modelos não é contornado; o Studio apenas o torna visível.

## Dados

- Diretório de dados único e configurável (padrão `studio/data`, fora do Git): `studio.db`, `files/<hash>`.
- Catálogo padrão versionado em `catalog/defaults.json`; personalizações do usuário no banco.

## Decisões (ADR)

Ver `docs/adr/`.
