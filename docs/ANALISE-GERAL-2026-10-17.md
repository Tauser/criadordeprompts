# Análise geral do Prisma Studio

Revisão posterior: [segunda análise e correções](D:/Projetos/GeraImg/studio/docs/ANALISE-GERAL-2026-10-17-REVISAO-2.md).
O texto abaixo foi preservado como histórico da primeira rodada; o novo relatório atualiza os achados e as evidências.

Data: 17/10/2026. Base: commit `49a5269`, incluindo o estado local de `catalog/defaults.json` que já estava modificado antes da análise.

## Parecer

O projeto tem uma arquitetura adequada para um estúdio local com uma pessoa e uma GPU. O pedido estruturado, o compilador separado do modelo, a biblioteca orientada por metadados e a persistência em SQLite formam uma boa base para evoluir o produto.

Os fluxos cobertos pela suíte estão funcionando. Entretanto, há falhas concretas na recuperação após interrupções, na composição com máscara e em alguns estados da interface. As garantias do README estão mais fortes do que a implementação permite afirmar hoje. Eu manteria a estrutura atual e faria uma rodada de correções de confiabilidade antes de ampliar funcionalidades ou redesenhar a interface.

## Escopo e evidências

Foram examinados o backend, frontend, catálogo, scripts, documentação, testes e os trechos relevantes do ComfyUI instalado em `C:/GeraImg/ComfyUI_windows_portable/ComfyUI`. A interface compilada atual foi inspecionada em uma prévia isolada, com dados temporários, executor desativado e cliente ComfyUI simulado.

| Verificação | Resultado |
|---|---|
| Ruff, backend e scripts | Passou |
| Testes do backend | 61 passaram, incluindo os 2 testes HTTP com ComfyUI simulado |
| TypeScript | Passou |
| Testes do frontend | 12 passaram em 2 arquivos |
| Build Vite | Passou; saída em `data/audit-frontend-dist` |
| Correspondência do build | Os nomes dos bundles gerados coincidem com os de `frontend/dist` |
| Interface desktop | Inspecionada em 1280 × 720 |
| Cenários adicionais | Reproduções isoladas descritas nos achados abaixo |

Os primeiros testes sofreram restrições do sandbox: operações de arquivo na pasta temporária e comunicação por loopback. A execução em diretório temporário do projeto e, quando necessário, fora dessas restrições, passou. Essas falhas iniciais não foram classificadas como defeitos do aplicativo.

Não foram enviados trabalhos ao ComfyUI real. Fidelidade visual, tempo de geração, consumo de VRAM e qualidade do avaliador de 9B continuam sem validação nesta análise. Não foi feita uma auditoria de vulnerabilidades publicadas das dependências nem um teste real de interface em celular.

Algumas saídas das reproduções foram preservadas em [results.json](D:/Projetos/GeraImg/studio/data/audit-repro/results.json). Os cenários de interrupção simulam o estado persistido nos pontos indicados; não representam falhas da suíte original.

## Arquitetura e manutenção

**Pontos fortes:**

- O domínio não depende de HTTP, GPU ou banco. Isso permite testar regras e redação sem carregar modelos.
- O contrato Pydantic rejeita campos desconhecidos e combinações inválidas de intenção, valor e referência.
- `keep`, `set`, `transfer` e `free` tornam explícito o que cada campo pretende fazer.
- O compilador usa blocos intermediários e checa sua cobertura na renderização. A classificação dos itens não entra como condição escondida na redação de outras categorias.
- Referências têm identificador estável e a foto alvo ocupa o primeiro slot.
- O aprimoramento exige revisão e mantém o prompt original disponível.
- SQLite usa WAL, transações e eventos de estado. A biblioteca tem controle de revisão para evitar sobrescritas concorrentes simples.
- O armazenamento por hash valida o formato e evita duplicar conteúdo idêntico.
- Os detalhes de protocolo e IDs de nós estão concentrados na infraestrutura do ComfyUI.
- O frontend mantém lógica de workspace em funções puras e possui fallback de SSE para polling.

**Limites atuais:** `application` depende diretamente da infraestrutura, sem interfaces explícitas; isso é aceitável para o tamanho atual. O executor concentra agendamento, upload, recuperação, geração, avaliação e armazenamento. Ele é o ponto que mais precisa de invariantes e testes de interrupção. Não há motivo demonstrado para introduzir Redis, Celery, microsserviços ou outro banco neste momento.

## Achados prioritários

P1 indica risco de execução duplicada, alteração indevida da imagem ou bloqueio de um fluxo central. P2 indica falha funcional em um cenário específico. P3 indica acabamento, operação ou evolução. A prioridade considera o aplicativo local descrito pelo projeto.

### A01 — P1: reinício no estado `submitting` pode reenviar um trabalho já aceito

**Evidência:** [executor.py:217](D:/Projetos/GeraImg/studio/backend/src/prisma_studio/worker/executor.py:217).

O executor grava `submitting`, chama `/prompt` e só depois grava `queued`. Se o processo cair depois de o ComfyUI aceitar o trabalho e antes do segundo commit, a recuperação chama `submit()` novamente, sem consultar o ID existente.

Na reprodução com `FakeComfy`, o trabalho já aceito terminou localmente como `failed`, com `duplicate prompt id`. Essa proteção do fake não existe no `PromptQueue.put` instalado: o método faz `heapq.heappush` sem deduplicar por ID. Executar esse método isoladamente com o mesmo ID duas vezes produziu duas entradas. Isso confirma a premissa de risco no ComfyUI local sem executar nada na GPU.

Também há reenvio automático quando uma tarefa `uncertain` recebe `missing`. Ausência no histórico não prova que ela nunca foi aceita: o servidor pode ter reiniciado ou seu histórico pode ter sido limpo. O README afirma que envios incertos nunca são reenviados automaticamente, mas o código faz esse reenvio.

**Correção:** reconciliar estados `submitting` e `uncertain` antes de enviar; quando não houver prova suficiente, manter a incerteza visível e exigir uma decisão explícita. O UUID escolhido pelo cliente identifica o trabalho, mas não torna `/prompt` idempotente.

### A02 — P1: criação do pedido e gravação do prompt não são atômicas

**Evidência:** [runs.py:73](D:/Projetos/GeraImg/studio/backend/src/prisma_studio/application/runs.py:73).

O pedido fica visível no banco em uma transação, e `prompt`, `effective_prompt` e `compiled_json` são gravados em outra. Uma interrupção entre elas deixa um pedido `created` com prompt nulo. O executor não recompila nem bloqueia esse estado antes de montar o workflow.

**Reprodução:** interromper o caso de uso imediatamente após o `repository.create()` e retomar o executor produziu `graph['10']['inputs']['prompt'] = None`. A mesma separação também abre uma janela de concorrência com a thread do executor.

**Correção:** inserir pedido, prompt, configurações e representação compilada na mesma transação; validar os invariantes de pedidos recuperados antes de executá-los.

### A03 — P1: a máscara não preserva os pixels da foto original como anunciado

**Evidência:** [executor.py:108](D:/Projetos/GeraImg/studio/backend/src/prisma_studio/worker/executor.py:108), [files.py:65](D:/Projetos/GeraImg/studio/backend/src/prisma_studio/infrastructure/storage/files.py:65), [workflows.py:123](D:/Projetos/GeraImg/studio/backend/src/prisma_studio/infrastructure/comfy/workflows.py:123).

A foto inteira é redimensionada para múltiplos de 32 antes de virar o destino da composição. Uma entrada de 1000 × 700 passa a 992 × 672; fotos acima do limite de pixels também são reduzidas. Logo, a identidade fora da máscara só pode se referir à cópia normalizada, não ao arquivo original. O arredondamento separado das duas dimensões ainda altera ligeiramente a proporção.

Além disso, `GrowMask` expande a área em 16 pixels, permitindo alterações fora da região desenhada. O `FeatherMask` instalado aplica gradientes nas bordas do canvas, não suaviza o contorno interno de uma área pintada. Uma máscara localizada no centro mantém seu contorno duro depois da expansão.

**Correção:** separar a imagem preparada para o modelo da imagem usada para composição final, preservando o original; usar padding/crop quando apropriado; definir e mostrar a máscara efetiva; aplicar uma suavização do contorno compatível com a garantia desejada. Ajustar os textos da interface e do README até existir teste de igualdade de pixels.

### A04 — P1: máscara aceita tamanho personalizado incompatível com o alvo

**Evidência:** [runs.py:62](D:/Projetos/GeraImg/studio/backend/src/prisma_studio/application/runs.py:62), [workflows.py:98](D:/Projetos/GeraImg/studio/backend/src/prisma_studio/infrastructure/comfy/workflows.py:98).

A máscara força `resolution=0`, mas não limpa nem rejeita `output.width/height`. A interface também deixa o tamanho personalizado disponível. Assim, o latent pode usar dimensões diferentes das da foto e da máscara, enquanto a composição está configurada com `resize_source=False`.

**Reprodução:** alvo de 1000 × 700 com tamanho personalizado de 1024 × 1024 resultou em destino e máscara de 992 × 672 e latent quadrado de 1024 × 1024.

**Correção:** estabelecer uma única dimensão efetiva para edição com máscara e validá-la no backend; refletir essa regra nos controles da interface.

### A05 — P1: uma resposta JSON inesperada do avaliador pode bloquear a fila

**Evidência:** [verification.py:66](D:/Projetos/GeraImg/studio/backend/src/prisma_studio/domain/verification.py:66), [executor.py:199](D:/Projetos/GeraImg/studio/backend/src/prisma_studio/worker/executor.py:199).

`parse_verdicts('{"results":null}', checks)` lança `TypeError`. O parser captura `ValueError` e `AttributeError`, mas não esse caso. O erro escapa de `_step`, a iteração do executor é interrompida, e o pedido continua em `verifying`. Nas iterações seguintes, o mesmo resultado persistido produz o mesmo erro, impedindo o avanço dos pedidos posteriores.

**Correção:** validar o formato da resposta com um contrato próprio; transformar formatos inválidos em avaliação indisponível ou `unknown`; isolar falhas por pedido para que uma saída do modelo não paralise a fila.

### A06 — P2: verificação com dez referências sobrescreve o carregador do modelo

**Evidência:** [workflows.py:146](D:/Projetos/GeraImg/studio/backend/src/prisma_studio/infrastructure/comfy/workflows.py:146).

O nó `80` é reservado ao `CLIPLoader`, mas os `LoadImage` recebem IDs `70 + index`. A verificação envia o resultado gerado mais as referências: com dez referências são onze imagens, e a última sobrescreve o nó `80`. `TextGenerate.clip` passa a apontar para uma imagem.

**Reprodução:** `text_graph()` com onze imagens devolveu `graph['80']['class_type'] == 'LoadImage'`, mantendo `clip=['80', 0]`.

O validador local verifica se o nó existe, mas não valida o tipo da saída ligada à entrada. Portanto, esse conflito passa pela checagem de links do Studio.

**Correção:** usar faixas de IDs que não se sobreponham ou um alocador de IDs; testar o limite completo de referências e os tipos das conexões relevantes.

### A07 — P2: recuperação pode concluir menos variações do que as solicitadas

**Evidência:** [executor.py:124](D:/Projetos/GeraImg/studio/backend/src/prisma_studio/worker/executor.py:124).

`_create_image_tasks()` retorna se encontrar qualquer tarefa de imagem. Cada posição é inserida em uma transação separada. Uma queda depois de inserir a primeira posição de quatro impede que as outras três sejam recriadas.

**Reprodução:** deixando persistida apenas a primeira tarefa de um pedido de quatro variações, o executor concluiu o pedido com uma única imagem e `status=completed`.

**Correção:** criar o lote de tarefas atomicamente ou reconciliar as posições ausentes de forma idempotente. Adicionar unicidade em `(run_id, kind, position)`. A criação da tarefa de aprimoramento e a transição para `refining` também precisam resistir a interrupções entre os dois passos.

### A08 — P2: repetição recompila usando a biblioteca atual e perde o prompt aprimorado aprovado

**Evidência:** [runs.py:81](D:/Projetos/GeraImg/studio/backend/src/prisma_studio/application/runs.py:81).

O botão promete o mesmo pedido com a mesma seed, mas `repeat()` chama `create()`, que resolve novamente os itens do catálogo. Se uma opção mudar de descrição, o prompt da repetição muda. Se o original passou por aprimoramento aprovado, o novo trabalho também não reaproveita necessariamente seu `effective_prompt`: o aprimoramento roda novamente.

**Reprodução:** trocar a descrição do jardim por uma rua nevada na biblioteca fez uma repetição com a mesma seed usar o novo cenário.

**Correção:** distinguir repetir a execução congelada de reutilizar o formulário com o catálogo atual. Para repetição, preservar prompt efetivo, parâmetros, referências e versões; registrar também os identificadores dos modelos. Mesmo assim, igualdade bit a bit da imagem exige controlar o ambiente de execução.

### A09 — P2: um pedido explícito de uma pessoa desaparece do prompt

**Evidência:** [compiler.py:67](D:/Projetos/GeraImg/studio/backend/src/prisma_studio/domain/compiler.py:67).

O bloco de participantes só é criado quando o total é maior que um. Um pedido válido com `participants.requested=1` e os demais campos livres gera apenas `Create an image.` e a orientação genérica de coerência. Não informa que deve haver uma pessoa.

**Correção:** representar também a quantidade um quando ela foi explicitamente pedida. Auditar os campos do contrato que precisam se tornar instruções, porque verificar a cobertura dos blocos existentes não detecta um bloco que deixou de ser criado.

### A10 — P2: JPEG com orientação EXIF é normalizado na direção errada

**Evidência:** [files.py:74](D:/Projetos/GeraImg/studio/backend/src/prisma_studio/infrastructure/storage/files.py:74).

`normalized_png()` converte para RGB e redimensiona sem aplicar `ImageOps.exif_transpose`. A conversão remove a orientação EXIF. Isso afeta o modo de edição com resolução original, que é o padrão do frontend, e a edição com máscara. A visualização do navegador pode mostrar a imagem orientada, enquanto a cópia enviada ao modelo fica girada.

**Reprodução:** um JPEG de dimensões armazenadas 80 × 40 com orientação EXIF 6 corresponde visualmente a 40 × 80, mas a normalização do Studio gerou PNG de 64 × 32 sem orientação. O `LoadImage` do ComfyUI instalado aplica `exif_transpose`, portanto o caminho normalizado se comporta de forma diferente do carregamento direto.

**Correção:** unificar orientação, dimensões informadas ao frontend e coordenadas da máscara antes de redimensionar.

### A11 — P2: restauração de referências pode reativar uma referência removida

**Evidência:** [workspace.ts:76](D:/Projetos/GeraImg/studio/frontend/src/state/workspace.ts:76).

**Reprodução:** aplicar rosto da referência A, depois rosto da B, remover A e remover B deixa `references=[]` e `face={intent:'transfer', reference_id:'a'}`. O histórico de restauração de B ainda guardava A.

**Impacto:** a remoção termina com um formulário inválido e não restaura uma escolha disponível.

**Correção:** limpar referências removidas também das cadeias de restauração e validar a escolha anterior antes de restaurá-la.

### A12 — P2: recuperação de envio da interface é incompleta e o atalho permite envios paralelos

**Evidência:** [Studio.tsx:50](D:/Projetos/GeraImg/studio/frontend/src/components/Studio.tsx:50), [Studio.tsx:98](D:/Projetos/GeraImg/studio/frontend/src/components/Studio.tsx:98), [Studio.tsx:155](D:/Projetos/GeraImg/studio/frontend/src/components/Studio.tsx:155).

A recuperação de `PENDING_KEY` ocorre apenas ao montar o componente. Depois de uma resposta perdida, a mensagem promete localizar o pedido quando o servidor voltar, mas não inicia uma rotina de reconciliação. O usuário pode enviar novamente, e cada tentativa usa um UUID novo. Uma montagem durante indisponibilidade também não repete a consulta automaticamente; ao encontrar um pedido, a chave pendente não é limpa.

O botão observa `submitting`, mas o atalho Ctrl+Enter só verifica `valid` e `busy`, e `submit()` não possui uma trava própria. Enquanto a resposta inicial não chega, novas teclas podem criar novos pedidos. Além disso, a prévia antiga permanece válida durante o debounce de uma alteração: a interface pode enviar uma versão que ainda não é a exibida no prompt, embora o backend a valide novamente.

**Correção:** manter um identificador por tentativa lógica, travar todos os caminhos de envio e reconciliar até obter resposta conclusiva; associar a prévia à versão do pedido e impedir envio enquanto ela estiver desatualizada.

### A13 — P2: exclusão do histórico protege apenas o rascunho visível

**Evidência:** [Studio.tsx:207](D:/Projetos/GeraImg/studio/frontend/src/components/Studio.tsx:207), [runs.py:111](D:/Projetos/GeraImg/studio/backend/src/prisma_studio/application/runs.py:111).

`keepFiles` é montado somente com os arquivos do workspace atual. Os rascunhos de criação e edição são separados. Se uma imagem estiver anexada apenas ao rascunho do outro modo, apagar o último trabalho que a referencia pode apagar seu arquivo. Ao voltar ao modo anterior, o rascunho aponta para um hash inexistente.

A identificação de arquivos ainda usados e sua remoção também ocorrem depois da transação de exclusão do pedido, abrindo uma janela com a criação de outro pedido que use o mesmo arquivo.

**Correção:** proteger ambos os rascunhos e definir uma política consistente de referências/leases ou coleta de lixo para arquivos. Uma operação destrutiva não deve depender apenas do estado de uma tela.

### A14 — P2: tradução pode escrever no item errado e não usa o executor durável

**Evidência:** [Library.tsx:75](D:/Projetos/GeraImg/studio/frontend/src/components/Library.tsx:75), [translation.py:18](D:/Projetos/GeraImg/studio/backend/src/prisma_studio/application/translation.py:18).

A tradução captura o texto do item A, mas ao terminar aplica o resultado ao `draft` corrente. É possível abrir B durante a espera. Se o usuário aceitar a substituição, a tradução de A pode ir para B. O polling também continua sem mecanismo de cancelamento ao sair do editor.

No backend, as traduções são enviadas diretamente ao ComfyUI e guardadas apenas em memória, sem o registro SQLite, a validação de grafo e o agendamento do executor. Elas podem entrar na fila do ComfyUI durante outra etapa e somem da visão do Studio após reiniciar. Isso diverge da fila única descrita na arquitetura; não significa que o ComfyUI necessariamente executará dois modelos simultaneamente.

**Correção:** vincular o resultado ao ID e à versão do item original, cancelar/desconsiderar resultados antigos e integrar a tradução ao mecanismo de tarefas persistidas.

### A15 — P2: scripts identificam o processo apenas pelo PID

**Evidência:** [iniciar.ps1:10](D:/Projetos/GeraImg/studio/scripts/iniciar.ps1:10), [parar.ps1:5](D:/Projetos/GeraImg/studio/scripts/parar.ps1:5).

Um PID antigo pode ser reutilizado pelo Windows. `iniciar.ps1` pode concluir que o Studio está aberto por encontrar outro processo com aquele número; `parar.ps1` pode encerrar esse outro processo. O script de início também anuncia a URL mesmo se todas as tentativas de health check falharem.

**Correção:** validar identidade do processo, momento de início e serviço/porta; detectar saída prematura; anunciar sucesso somente depois de confirmar a inicialização.

## Interface e experiência de uso

O compositor à esquerda e prompt, resultado e histórico à direita oferecem uma hierarquia fácil de acompanhar. Tipografia, contraste geral, espaçamento e ação principal estão consistentes na tela desktop inspecionada. A exibição do prompt em blocos, das diferenças do aprimorador e da verificação por requisito ajuda a entender o resultado. A barra fixa mantém a ação principal acessível.

Há oportunidades de acabamento além dos defeitos funcionais:

- O catálogo possui **303 itens: 204 comuns e 99 adultos**. A tela informa **98 itens com metadados incompletos**, correspondentes às 67 ações e 31 poses adultas. Completar os metadados é necessário para oferecer a mesma capacidade de análise de conflitos nesses itens; o sistema atualmente os marca como desconhecidos.
- A categoria de roupa não possui opção comum: contém um único item adulto. No modo padrão, o seletor oferece apenas ausência de instrução ou texto livre. É uma lacuna perceptível em um compositor visual.
- A biblioteca administrativa mostra todos os itens, independentemente do filtro do compositor. Um filtro próprio por classificação melhoraria a organização, especialmente porque a ordem alfabética inicia a lista com vários itens adultos.
- O histórico busca somente os 40 pedidos mais recentes e não oferece paginação ou busca. Pedidos antigos continuam no banco, mas deixam de ser acessíveis por essa tela. Ver [client.ts:36](D:/Projetos/GeraImg/studio/frontend/src/api/client.ts:36).
- O editor de máscara usa `role='dialog'`, mas não gerencia foco como modal, não oferece desfazer e não trata explicitamente `pointercancel`/perda de captura. A experiência de teclado e toque precisa de validação dedicada.
- Se a biblioteca não carregar, o aplicativo permanece em “Carregando…” depois do aviso temporário, sem uma ação persistente de tentar novamente.
- Há textos fortes demais: “fora dela, a foto fica idêntica”, “tamanho original” e “detalhes não alteram as outras instruções”. O último só pode descrever a composição textual: uma instrução livre contraditória ainda pode influenciar o modelo.

## Segurança, dados e operação

Para uso local, o bind padrão em loopback, a exigência de token para clientes de rede, as queries parametrizadas, o controle de revisão da biblioteca e a validação dos hashes são escolhas adequadas. Não encontrei justificativa para afirmar uma exposição remota crítica na configuração padrão.

Os pontos a endereçar são:

- **Acesso LAN incompleto:** o backend aceita `x-studio-token` ou cookie, mas o frontend não oferece autenticação nem provisiona esse cookie. Abrir a URL por outro computador não constitui um fluxo pronto de uso autenticado.
- **Validação de Host:** o middleware decide pela origem do cliente e pelo cabeçalho Origin, mas não restringe os hosts aceitos. Adicionar uma lista explícita de hosts locais/permitidos reduziria a superfície de DNS rebinding. A exploração por navegador/rede não foi testada nesta análise.
- **Uploads:** o limite de 25 MB é aplicado depois do processamento multipart pelo framework. Convém estabelecer limites de requisição, dimensões e pixels adequados à máquina; tamanho comprimido não representa o consumo de memória ao abrir a imagem.
- **Recuperação de dados:** não foi encontrado um procedimento de backup/restauração. O banco e `data/files` precisam ser preservados em conjunto. Com WAL, copiar apenas `studio.db` enquanto o processo está ativo não é um backup consistente; usar a API de backup do SQLite ou um procedimento de parada controlada.
- **Arquivos órfãos:** uploads abandonados não vinculados a trabalhos e arquivos protegidos temporariamente podem permanecer indefinidamente. Planejar uma coleta com período de retenção e proteção dos rascunhos.
- **Dependências:** o frontend tem lockfile; o Python fixa dependências diretas, mas não trava as transitivas. A instalação aceita versões futuras de Python sem um teto, apesar de dependências binárias fixadas. Vale declarar e testar a combinação suportada.

## Desempenho e observabilidade

O bundle produzido tem aproximadamente **200,36 kB de JavaScript, 64,84 kB gzip**, mais **26,59 kB de CSS, 6,49 kB gzip**. Isso é razoável para esta aplicação. Não apareceu motivo para otimização ampla do frontend antes das correções funcionais.

Os riscos maiores estão no percurso da GPU e na escala dos registros:

- O modelo de texto de 9B pode causar trocas de modelo entre aprimoramento, geração e avaliação. A duração precisa ser medida no hardware real; os nomes e configurações dos modelos, isoladamente, não demonstram que cabem ou que serão rápidos na RTX 4070.
- O KV cache está fixado em CPU. Medir custo de RAM e transferência antes de mudar essa escolha.
- Os arquivos das variações são armazenados e exibidos somente depois de todas as tarefas de imagem terminarem. Salvar cada saída assim que for concluída melhoraria o retorno ao usuário e reduziria a janela de dependência do histórico do ComfyUI.
- Cada SSE envia um snapshot completo por segundo. `run_view` consulta novamente tarefas e todos os eventos antes de selecionar os últimos 50. Consultar eventos limitados no SQL e enviar apenas mudanças evitaria trabalho crescente. O endpoint SSE também faz operações síncronas de banco dentro do gerador assíncrono.
- Não existe trava persistente para garantir um único executor por diretório de dados. Duas instâncias do backend usando o mesmo SQLite podem selecionar os mesmos pedidos. É um caso operacional a bloquear ou tornar seguro antes de aceitar múltiplas instâncias/workers.
- “Desconhecido” e “não atendido” recebem ambos zero no placar. Uma falha do avaliador pode parecer uma avaliação visual negativa. Mostrar a cobertura válida da avaliação separadamente do atendimento aos requisitos.

## Testes e garantias documentadas

A suíte cobre casos úteis: intenções inválidas, conflitos de catálogo, composição determinística, slots de referência, recusa do aprimorador, revisão, cancelamento, respostas perdidas e reinício no estado já enfileirado. Os testes HTTP simulados exercitam a passagem real pelo cliente de rede.

As lacunas encontradas são de limites e interrupções entre efeitos: salvar no banco, enviar ao serviço externo e confirmar o envio. O fake permissivo de `/object_info` e as imagens artificiais não provam a validade de tipos das conexões nem a composição de pixels dos workflows reais.

| Afirmação atual | Avaliação |
|---|---|
| Workflow executável garantido | A validação é parcial; não cobre toda a tipagem dos links e valores dinâmicos |
| Toda instrução chega ao prompt | Há a exceção confirmada de uma pessoa; cobertura dos blocos não prova cobertura de todos os campos |
| Fora da máscara fica idêntico | Não vale em relação ao arquivo original após redimensionamento/expansão |
| Execução sobrevive a reinícios | Funciona nos cenários testados, mas há janelas não atômicas confirmadas |
| Envios incertos nunca são reenviados | Contradiz o ramo `uncertain -> missing -> submit` |
| Fila única durável inclui tradução | Tradução usa caminho direto e estado em memória |
| Imagem cumpre instruções | Corretamente apresentada como dependência do modelo, ainda sem medição real |

Priorizar novos testes para os achados A01–A14, com destaque para interrupções em cada fronteira de persistência, máscara em dimensões variadas, orientação EXIF, limite de dez referências, respostas não conformes do avaliador, envios repetidos por teclado e arquivos de rascunhos inativos. Os testes de quantidade fixa de itens também podem ser complementados por invariantes de IDs, categorias e metadados.

O README ainda menciona 183 opções, enquanto o catálogo atual contém 303. A arquitetura descreve estados de execução que já diferem dos nomes efetivamente usados pelo executor (`generating`, `review`). Alinhar essas referências durante a rodada de estabilização.

## Ordem proposta de correção

1. **Executor e persistência:** resolver A01, A02, A05 e A07; impedir múltiplos executores no mesmo diretório; testar interrupções antes e depois de cada efeito externo.
2. **Integridade das imagens:** resolver A03, A04 e A10; acrescentar testes de pixels e orientação; definir precisamente a área que a máscara autoriza alterar.
3. **Fidelidade e repetição:** resolver A06, A08 e A09; congelar a execução repetida; validar o limite real de referências.
4. **Estado da interface e dados:** resolver A11–A14; proteger rascunhos e reconciliar submissões sem gerar novos IDs por acidente.
5. **Operação e produto:** resolver A15, backup, paginação, autenticação LAN se ela fizer parte do escopo, metadados e catálogo de roupas comuns.
6. **Validação real:** montar uma pequena matriz com geração/edição, completo/turbo, zero/uma/várias referências, máscara central/na borda, fotos com EXIF e aprimoramento/verificação. Fixar entradas, parâmetros e seeds; comparar o que foi pedido, o prompt efetivo, as imagens e os tempos por etapa.

Critérios para considerar a rodada concluída: nenhum reenvio automático sem reconciliação segura; nenhuma execução com prompt nulo; quantidade de variações preservada após reinício; respostas inválidas do avaliador não bloqueiam a fila; máscara e dimensões respeitam o contrato; repetição preserva o prompt efetivo; exclusão não quebra os rascunhos; evidência visual controlada no ComfyUI real.

## Alterações feitas durante a análise

Nenhum código de produção, workflow, catálogo ou dado real do usuário foi alterado. Foram instaladas as dependências do frontend pelo lockfile, executados testes e build isolado, criados dados temporários em `data/audit-*` e escrito este relatório. A modificação preexistente de `catalog/defaults.json` foi preservada. Não foram criados commits.

## Validação adicional: edição de pessoas reais e fictícias

Solicitação verificada em 17/10/2026: existência de uma regra que impeça alterações em fotos quando a pessoa não é considerada fictícia.

**Resultado: essa proibição geral não está implementada no Studio.** O contrato não distingue pessoas reais de fictícias, e não existe uma classificação visual obrigatória da foto antes de autorizar a edição. O avaliador visual de resultados não funciona como uma autorização prévia de identidade/origem.

O controle existente em [rules.py:100](D:/Projetos/GeraImg/studio/backend/src/prisma_studio/domain/rules.py:100) exige confirmações quando o pedido estruturado resolve itens adultos do catálogo. Na edição, exige `adults_only` e `consent_or_fictional`. O segundo campo significa **pessoa fictícia OU pessoa que consentiu**, conforme o texto da interface em [Studio.tsx:337](D:/Projetos/GeraImg/studio/frontend/src/components/Studio.tsx:337). Portanto, mesmo esse controle não significa “somente pessoas fictícias”. Trata-se de uma declaração do usuário, sem comprovação automática da origem da imagem ou do consentimento.

Foram executados quatro cenários de domínio, sem processamento de imagem:

| Cenário | Resultado do Studio |
|---|---|
| Edição comum de cenário, sem declaração de ficção | Aceita |
| Item adulto sem confirmações | Bloqueado: maioridade e consentimento/ficção ausentes |
| Item adulto somente com confirmação de maioridade | Bloqueado: consentimento/ficção ausente |
| Item adulto com as duas confirmações atuais | Aceito pelas regras do aplicativo |

O teste existente `test_policy_confirmations_for_adult_options` também passou. As saídas estão em [audit-policy/results.json](D:/Projetos/GeraImg/studio/data/audit-policy/results.json).

Os controles dependem dos metadados dos itens resolvidos; não constituem uma análise semântica completa dos pedidos. Assim, também não demonstram que toda solicitação sensível será detectada.

O texto de sistema do aprimorador em `resources/enhancer_edit_official.txt` não contém a proibição geral citada. O aplicativo reconhece algumas frases de recusa do aprimorador e as apresenta na revisão, mas não mantém uma decisão formal de “esta pessoa é real/fictícia”. Alguns textos do catálogo descrevem personagens como fictícios; isso é uma instrução textual, não comprovação de que uma foto anexada represente alguém fictício.

Não foram encontradas respostas de recusa correspondentes na consulta ao histórico de aprimoramentos persistidos. Nenhuma inferência foi executada na GPU nesta validação. Logo, **não está confirmado empiricamente se o modelo local recusa um pedido específico por considerar a pessoa real**; apenas está confirmado que essa não é uma proibição geral codificada no Studio. Uma recusa concreta precisa ser atribuída à etapa e à resposta efetivamente produzida, sem supor que todo tipo de edição de pessoa real tenha o mesmo comportamento.

## Status das correções (17/10/2026, após a análise)

| Achado | Status |
|---|---|
| A01 | Corrigido. Envio é feito uma única vez automaticamente; falha de conexão antes do envio volta a etapa para `created`; resposta perdida ou reinício durante `submitting` levam a `uncertain`, que só avança se o ComfyUI mostrar o trabalho ou se o usuário confirmar o reenvio (botão no painel de resultado, novo ID) |
| A02 | Corrigido. Pedido, prompt, prompt efetivo e representação compilada são inseridos na mesma transação; o executor recusa pedido recuperado sem prompt |
| A03 | Corrigido. O resultado é recomposto no Studio sobre a foto original (tamanho e orientação EXIF preservados); fora da área pintada o peso é zero e a suavização fica dentro dela |
| A04 | Corrigido. Backend rejeita tamanho personalizado com máscara; a interface desativa a opção e não o envia |
| A05, A06, A09, A10 | Já estavam corrigidos no código atual quando a análise foi revisada |
| A07 | Corrigido. Variações ausentes são recriadas em lote atômico; tarefas são únicas por `(run_id, kind, position)` (migração 2); a tarefa de aprimoramento também é idempotente |
| A08 | Corrigido. Repetir usa o prompt efetivo, as configurações e os arquivos congelados, sem reconsultar a biblioteca nem aprimorar de novo |
| A11 | Corrigido. Remover uma referência limpa as cadeias de restauração das outras |
| A12 | Corrigido. Todos os caminhos de envio passam por uma trava; a mesma tentativa reaproveita o ID; a interface consulta o servidor até obter resposta; não é possível enviar enquanto a prévia está desatualizada |
| A13 | Corrigido. A exclusão protege os rascunhos dos dois modos; exclusão do pedido e remoção dos arquivos ocorrem na mesma transação, e a criação de pedido confere os arquivos dentro da sua transação |
| A14 | Interface corrigida: a tradução fica vinculada ao item que a pediu e é cancelada ao trocar de item ou sair. No backend continua como prévia fora do executor durável (documentado em ARCHITECTURE.md) |
| A15 | Os scripts já validavam nome, linha de comando e início do processo; `iniciar.ps1` passou a conferir também o momento de início antes de considerar o Studio aberto |
| Múltiplos executores | Corrigido. Trava de instância em `data/studio.lock` |
| README e arquitetura | Afirmações ajustadas ao que é garantido hoje; estados atualizados |

Pendentes (P3): paginação/busca do histórico, backup do banco e de `data/files`, autenticação LAN no frontend, metadados das opções adultas, opções comuns de roupa, validação de tipos das ligações do grafo, envio de eventos SSE incrementais e a confirmação de pessoa fictícia.
