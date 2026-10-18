# Validação do Prisma Studio para publicação

Data: 18/10/2026. Projeto atual: `studio` (Prisma Studio).

## Escopo

As alterações incluem acesso pela LAN e descoberta mDNS, bloqueio de instância por pasta de dados,
recuperação de envios ao ComfyUI, criação atômica de pedidos e variações, exclusão de histórico em lote,
recomposição da edição com máscara sobre a foto original, tradução de campos, biblioteca, escopo de roupa
por participante e instruções explícitas de postura e orientação corporal.

O catálogo padrão passou de 303 para 204 itens: foram removidos 99 itens adultos, conforme a opção
`drop_adult` da revisão de importação. Os 204 itens restantes não tiveram seus dados alterados nesse diff.

O Studio não importa código das pastas antigas `criadordeprompts` e `kppb-image-studio` para executar.
`scripts/import_catalog.py` é uma ferramenta opcional que recebe um arquivo de catálogo legado como argumento.
O ComfyUI e seus modelos continuam sendo dependências externas; dados e imagens locais ficam fora do Git.

## Identificação no Git

Antes deste registro, os 23 commits do histórico local estavam atribuídos a
`Tauser Carneiro <tauser@gmail.com>`, também a identidade configurada para novos commits.
A conta autenticada no GitHub foi identificada como `Tauser`. Isso identifica metadados de autoria e conta,
sem atribuir a uma pessoa específica as edições que ainda não tinham commit.

A cópia do Studio tinha histórico próprio, branch `main` e branch `visual-galeria`, sem remoto configurado.
A branch `codex/corrigir-regras-imagens` foi encontrada na cópia local do projeto antigo; a consulta ao
remoto `Tauser/criadordeprompts` retornou somente `main` antes da publicação.

## Verificações realizadas

| Verificação | Resultado |
|---|---|
| Ruff em backend e scripts | Sem erros |
| Backend | 156 testes passaram, incluindo HTTP com ComfyUI simulado |
| Frontend | 40 testes passaram em 8 arquivos |
| TypeScript | Sem erros |
| Vite | Build de produção concluído em `frontend/dist` |
| Scripts PowerShell | Análise de sintaxe sem erros |
| JSON dos catálogos | Leitura válida |
| `git diff --check` | Sem erros |
| Arquivos candidatos ao Git | Nenhuma correspondência nos padrões verificados de chave privada, token GitHub e chave AWS; nenhum arquivo acima de 10 MB |

O teste de desfazer tradução foi ajustado para usar um campo controlado que atualiza seu valor pelo
callback, como os consumidores reais. Também verifica a invalidação de desfazer após edição manual.
O cache incremental do TypeScript (`*.tsbuildinfo`) foi adicionado ao `.gitignore`.

## Limites desta validação

Não foi enviada geração ao ComfyUI real nem medida fidelidade visual, tempo de GPU ou acesso a partir
de outro dispositivo da rede. O backend emitiu um aviso de depreciação do AnyIO/Starlette TestClient.
A busca por padrões de credenciais não substitui uma auditoria de segredos completa.
As limitações funcionais já documentadas na segunda revisão geral continuam aplicáveis.
