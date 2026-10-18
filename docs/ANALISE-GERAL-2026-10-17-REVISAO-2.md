# Prisma Studio — segunda revisão geral e correções

Data: 17/10/2026. Escopo: versão local em `D:/Projetos/GeraImg/studio`, incluindo as alterações que já
estavam no diretório antes desta rodada. A análise anterior foi preservada como histórico. Este relatório
atualiza seu parecer e distingue as correções já existentes das realizadas nesta revisão.

## Parecer

A arquitetura continua adequada para o estúdio local: domínio independente, compilação estruturada,
SQLite para execução e arquivos por hash. Não há evidência que justifique trocar esse conjunto por uma
arquitetura distribuída. A versão atual já incorpora grande parte das correções da primeira análise,
principalmente criação atômica de pedidos, recuperação das variações, repetição do prompt congelado,
preservação dos pixels fora da máscara e compatibilidade de UUID com acesso HTTP na LAN.

Esta rodada encontrou falhas adicionais em respostas de rede, concorrência da interface, exclusão de
histórico e encerramento do executor. Foram corrigidas com testes de regressão. O resultado é uma melhora
na recuperação e na integridade dos dados; não é uma garantia de que o modelo atenderá visualmente a cada
instrução nem de ausência de todos os defeitos possíveis.

## Correções realizadas

| ID | Prioridade | Problema confirmado e comportamento corrigido |
|---|---|---|
| R01 | P1 | O cliente do ComfyUI tratava HTTP 5xx, JSON inválido ou confirmação sem ID como recusa definitiva. Agora erros temporários de consulta são recuperáveis; respostas ambíguas de envio mantêm a etapa incerta e o ID enviado. Uma resposta com ID diferente também não é aceita silenciosamente. Recusas explícitas HTTP 4xx continuam distintas. |
| R02 | P1 | O cliente web aceitava HTTP 200 com corpo inválido como sucesso. Isso podia limpar a tentativa de envio sem receber um pedido válido. Agora respostas ilegíveis, nulas, listas ou primitivas são rejeitadas; erros HTTP mantêm seu código mesmo com corpo nulo. |
| R03 | P1 | HTTP 5xx limpava o ID da tentativa, e uma consulta 404 logo depois de um timeout também o descartava. O POST original poderia ainda estar concluindo. Agora respostas ambíguas preservam o ID, a consulta continua e uma repetição da mesma tentativa usa o mesmo identificador. |
| R04 | P2 | A disponibilidade da prévia dependia apenas de estados atualizados em um efeito. Agora o envio também exige que a prévia pertença ao objeto de workspace atual, fechando a janela em que um pedido novo ainda podia usar a validade da prévia anterior. |
| R05 | P2 | Um GET atrasado podia sobrescrever um snapshot SSE mais novo; eventos de um pedido anterior podiam alterar a tela atual; erros repetidos de SSE iniciavam consultas paralelas. O acompanhamento agora ignora essas respostas antigas e inicia um único polling. Eventos malformados também acionam o fallback. |
| R06 | P2 | Salvar ou remover um item e abrir outro antes da resposta podia alterar o estado do novo editor. A resposta agora fica vinculada ao item original. Traduções são descartadas se o texto de origem mudou; uma criação de tradução que termina após sair do item é cancelada. O término de uma tradução antiga não remove o indicador de uma nova. |
| R07 | P1 | Cancelar uma tradução desconhecida encaminhava o ID diretamente ao ComfyUI, podendo atingir trabalho de outra aplicação. O serviço agora confirma que a tradução lhe pertence antes de cancelar. IDs desconhecidos retornam 404; repetir o cancelamento de uma tradução encerrada não reenvia a operação. |
| R08 | P1 | Uma exceção ao cancelar um pedido escapava da proteção por pedido e interrompia a iteração inteira da fila. Agora cancelamentos passam pelo mesmo isolamento e limite de erros inesperados. Os pedidos seguintes continuam avançando. |
| R09 | P2 | Era possível aprovar um aprimoramento vazio pela API e redefinir uma etapa incerta de um pedido que já estava sendo cancelado. As duas operações agora são rejeitadas antes de alterar o pedido. O ajuste também resolveu a falha de lint encontrada na revisão inicial. |
| R10 | P1 | A exclusão em lote confirmava cada pedido separadamente. Se outro ID estivesse ativo ou ausente, o cliente recebia erro depois de já apagar parte da seleção. O lote agora usa uma única transação e desfaz a operação se qualquer pedido não puder ser removido. IDs repetidos são tratados uma única vez. |
| R11 | P1 | A remoção de bytes ocorria dentro da transação SQL. Uma falha posterior no disco podia desfazer o banco sem restaurar imagens já apagadas. Agora o histórico é confirmado antes da limpeza, mantendo a trava de escrita. Falhas de limpeza deixam arquivos órfãos registrados no log; não restauram histórico com imagens faltantes. Uploads e registro de resultados compartilham essa trava. |
| R12 | P1 | O encerramento liberava a trava de instância depois de sinalizar a parada, mesmo que a thread ainda estivesse executando. Agora aguarda o executor terminar antes de liberar a trava; o encerramento não bloqueia o event loop e também executa a limpeza se a inicialização falhar. |
| R13 | P2 | Selecionar mais fotos do que o limite podia realizar uploads e só falhar ao atualizar o workspace. A interface agora rejeita o lote antes do primeiro upload quando ultrapassa dez referências. |

P1 indica risco de execução indevida, inconsistência de dados ou bloqueio de fluxo central. P2 indica falha
funcional em uma situação específica. Não houve tentativa de contornar recusas dos modelos.

## Evidências de validação

| Verificação | Resultado |
|---|---|
| Backend | 133 testes passaram, incluindo API, domínio, executor e dois cenários HTTP com ComfyUI simulado |
| Frontend | 34 testes passaram em sete arquivos |
| Ruff | Sem erros em backend e scripts |
| TypeScript e Vite | Build de produção concluído e entregue em `frontend/dist` |
| Scripts PowerShell | Análise de sintaxe sem erros |
| Diff | `git diff --check` sem erros de whitespace |
| Banco real | `PRAGMA quick_check`: `ok`; esquema na versão 2 |
| Workflows no ComfyUI instalado | Geração completa, Turbo, edição com dez referências, máscara e verificação com onze imagens sem problemas encontrados pelo validador local |
| Instância atualizada | Reinício após conferir ausência de pedidos ativos; ComfyUI permaneceu disponível |

Os novos testes cobrem respostas ambíguas do ComfyUI, repetição do mesmo ID após HTTP 500 ou corpo inválido
e consulta 404, eventos SSE fora de ordem, troca de item durante gravação/tradução, cancelamento de trabalho
alheio, cancelamento com erro, aprovação sem texto, cancelamento concorrente com reenvio, rollback de lote,
falha no segundo arquivo durante limpeza, encerramento com trabalho em andamento e limite de anexos.

Os testes com ComfyUI simulado verificam protocolo e recuperação sem usar GPU. A consulta ao ComfyUI real
usou apenas `/object_info`: nos cenários com imagens, foram usados nomes já presentes no catálogo do
servidor, sem executar os grafos. A primeira passagem com nomes fictícios corretamente apontou que esses
arquivos não estavam instalados; a passagem com nomes existentes não apresentou problemas.

Na instância real, página e preparação de pedido responderam HTTP 200 por `127.0.0.1`, `192.168.1.3` e
`studio.local`. O alias anunciou `advertising`, sem erro; um cancelamento de tradução inexistente respondeu
404 e uma escrita com Origin externo respondeu 403. A interface compilada respondeu HTTP 200 pelo alias.
Nenhuma geração foi enviada ao ComfyUI real nesta revisão. O acesso foi testado no próprio servidor.

Permanece um aviso de depreciação do Starlette TestClient relacionado ao AnyIO; ele não impediu os testes.

## Pontos ainda em aberto

1. **Tradução da biblioteca não é durável.** Continua em memória e vai diretamente à fila do ComfyUI. Um
   reinício perde o acompanhamento; uma resposta perdida ao criar a tradução ainda não tem a mesma
   reconciliação das etapas de geração. Integrá-la ao executor exige um fluxo próprio persistido.
2. **Rascunhos de outros dispositivos ou abas não têm proteção persistida no servidor.** A exclusão
   protege os dois rascunhos enviados pela tela que solicita a remoção e os arquivos usados por pedidos
   persistidos. Uma segunda tela com arquivos apenas em rascunho ainda não anuncia essas referências.
   Para uso simultâneo, falta uma política de retenção ou registro de rascunhos no servidor.
3. **Validação de grafo ainda é parcial.** Confere classes, entradas e opções, mas não todos os tipos das
   ligações entre nós. Passar nessa checagem não substitui executar e observar o workflow.
4. **A confirmação de pessoa fictícia é declaratória.** O Studio não contém um classificador obrigatório
   que determine se uma foto retrata uma pessoa real. O comportamento próprio do modelo é separado das
   regras codificadas no aplicativo. Não foi acrescentada uma classificação presumida nesta rodada.
5. **Operação e catálogo.** Continuam pendentes backup automatizado, paginação/busca de histórico e
   metadados incompletos de parte do catálogo. Não foram introduzidas mudanças nesses dados para esta
   revisão.
6. **Acesso por outro dispositivo.** O teste HTTP no próprio servidor não confirma a travessia do
   firewall. Não foi encontrada regra com nome `PrismaStudio-LAN-*`. A criação administrativa anteriormente
   bloqueada pela revisão automática não foi repetida; seu escopo e a autorização pendente estão em
   [ACESSO-LAN.md](D:/Projetos/GeraImg/studio/docs/ACESSO-LAN.md).
7. **Fidelidade e desempenho do modelo.** Qualidade de edição, tempo por geração, VRAM e precisão do
   avaliador continuam exigindo calibração visual com exemplos e seeds controladas. Testes de software
   não medem esses resultados.

## Arquivos principais

- [Cliente ComfyUI](D:/Projetos/GeraImg/studio/backend/src/prisma_studio/infrastructure/comfy/client.py),
  [executor](D:/Projetos/GeraImg/studio/backend/src/prisma_studio/worker/executor.py) e
  [casos de uso](D:/Projetos/GeraImg/studio/backend/src/prisma_studio/application/runs.py).
- [Persistência e limpeza](D:/Projetos/GeraImg/studio/backend/src/prisma_studio/infrastructure/db/repository.py)
  e [API](D:/Projetos/GeraImg/studio/backend/src/prisma_studio/api/app.py).
- [Compositor](D:/Projetos/GeraImg/studio/frontend/src/components/Studio.tsx),
  [biblioteca](D:/Projetos/GeraImg/studio/frontend/src/components/Library.tsx),
  [acompanhamento](D:/Projetos/GeraImg/studio/frontend/src/lib/useRun.ts) e
  [cliente HTTP](D:/Projetos/GeraImg/studio/frontend/src/api/client.ts).

## Correção posterior: IDs das respostas do avaliador

Em uma investigação posterior, o avaliador devolveu IDs `1`, `2`, etc. em vez dos IDs de blocos enviados
no checklist. O parser descartava essas avaliações e apresentava todos os requisitos como `unknown`,
resultando em nota zero sem que isso demonstrasse descumprimento de todos os requisitos.

O checklist agora apresenta somente os IDs nomeados e solicita sua cópia exata. O parser também aceita
o formato numérico antigo quando a resposta contém um conjunto completo, único e sem mistura de IDs,
de 1 até a quantidade de requisitos. A associação usa o número, não a ordem da resposta. Conjuntos
incompletos, duplicados ou misturados não recebem associação presumida.

Passaram 41 testes de parser, executor e integração HTTP com ComfyUI simulado, além do Ruff nos arquivos
alterados. Nenhuma geração real foi disparada nessa correção. Ela afeta a leitura de avaliações futuras;
os resultados históricos não foram reprocessados. A avaliação é posterior à geração e não decide se o
workflow de imagem será executado.
