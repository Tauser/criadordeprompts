# Prisma Studio

Estúdio local para criar e editar imagens com o ComfyUI e o Qwen Image 2.1. Reconstruído do zero em 17/10/2026, a partir da auditoria do projeto anterior (`criadordeprompts`).

## Uso

```powershell
scripts\instalar.ps1          # uma vez: cria .venv e instala as dependências
Iniciar-Studio.bat            # ou scripts\iniciar.ps1 -Port 8780 -ComfyUrl http://127.0.0.1:8188
Parar-Studio.bat
```

Abra http://127.0.0.1:8780. O ComfyUI precisa estar aberto em `http://127.0.0.1:8188` (o GeraImg o inicia). Sem ele, os pedidos ficam na fila do Studio e seguem quando o ComfyUI voltar.

Para experimentar sem GPU: `python scripts\fake_comfy.py` e inicie com `-ComfyUrl http://127.0.0.1:8199`.

## O que o Studio garante, e o que depende do modelo

| Nível | Situação |
|---|---|
| O workflow é executável | **Garantido.** Cada grafo é validado contra o `/object_info` do ComfyUI instalado antes de entrar na fila; o erro aparece com o nó e a entrada |
| Tudo o que foi pedido chega ao prompt | **Garantido.** O compilador transforma o pedido em blocos tipados e falha se algum bloco não aparecer no texto ou se um atributo for mantido e alterado ao mesmo tempo |
| Nada muda o pedido em silêncio | **Garantido.** O aprimorador é opcional e sempre pausa para revisão com a diferença palavra a palavra |
| A área fora da máscara fica idêntica | **Garantido** (recomposição pixel a pixel com `ImageCompositeMasked`) |
| Execução sobrevive a reinícios | **Garantido.** Estado no SQLite, reconciliação com `/api/jobs`, IDs de trabalho escolhidos pelo Studio (sem duplicar envios) |
| A imagem cumpre cada instrução | **Depende do modelo.** O Studio mede com a verificação automática (modelo local de 9B), que também pode errar |

## Estrutura

```text
backend/src/prisma_studio/   domain (pedido, regras, compilador, verificação) · application · infrastructure (comfy, db, storage) · worker · api
frontend/           React + TypeScript + Vite (dist/ já compilado e servido pelo backend)
catalog/            defaults.json (183 opções importadas) e review-v1.json (correções explícitas da importação)
docs/               ARCHITECTURE.md e ADRs
scripts/            instalar, iniciar, parar, verificar, import_catalog, fake_comfy
data/               (fora do Git) studio.db, files/, logs/
```

## Verificação

```powershell
scripts\verificar.ps1
```

Lint, testes do servidor (domínio, executor, API e ponta a ponta contra o ComfyUI simulado) e testes da interface. Nenhum trabalho é enviado ao ComfyUI real.

## Pendências conhecidas

- Validação visual com o ComfyUI real: redação do compilador, referências na geração, máscara e confiabilidade do avaliador de 9B, sempre com seed, referências e resolução controladas.
- Medir os tempos por etapa (já registrados em cada tarefa) para confirmar a hipótese de troca de modelos na VRAM.
- Tipos do frontend escritos à mão a partir do contrato; gerar a partir do schema em `/api/contract`.
