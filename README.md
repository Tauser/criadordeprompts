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

## Acesso pela rede local

Assim como na versão anterior, o iniciador detecta a interface IPv4 em uma rede **Privada** do Windows e
libera o Studio sem senha apenas para aquela sub-rede. O endereço aparece no terminal e em **Diagnóstico**;
neste computador, os endereços configurados são `http://studio.local:8780/` e `http://192.168.1.3:8780/`.
O alias é anunciado por mDNS somente na interface privada selecionada enquanto o Studio estiver aberto.
O dispositivo cliente precisa resolver nomes `.local` e estar na mesma rede, com multicast permitido.
Se o nome não resolver, use o endereço IP. O iniciador mostra se o anúncio conseguiu iniciar;
`-SomenteLocal` também desativa o anúncio. Não é preciso editar o arquivo `hosts` dos dispositivos.

Para preparar a regra do firewall, execute uma vez `scripts\configurar-rede.ps1` com permissões administrativas.
A regra libera somente TCP 8780, perfil Privado, IP local e sub-rede detectados. Para recarregar uma instância
existente, use `scripts\iniciar.ps1 -Reiniciar`; para usar somente este computador, `-SomenteLocal -Reiniciar`.
O iniciador não modifica perfis de rede públicos nem configura encaminhamento no roteador.

Inicialização manual equivalente:

```powershell
.venv\Scripts\python.exe -m prisma_studio --host 0.0.0.0 --port 8780 --lan-ip 192.168.1.3 --allow-network 192.168.1.0/24 --lan-alias studio.local
```

Clientes de outras redes continuam exigindo `PRISMA_TOKEN`. O modo LAN valida o IP de origem, o endereço
do servidor e a origem das escritas; imagens, uploads e eventos usam a mesma regra da interface.

## O que o Studio garante, e o que depende do modelo

Para aplicar a mesma instrução de roupa a mais de uma pessoa, escolha uma opção ou descrição em **Roupa**
e selecione **Aplicar roupa a → Todas as pessoas da cena**. Informe a quantidade em **Avançado → Cena**
ou adicione outros personagens por referência. A prévia explicita “both people” para dois participantes;
a verificação automática confere cada pessoa separadamente. O padrão é **Pessoa principal**.
Esse escopo também funciona com instruções completas de edição da biblioteca, incluindo o estudo
artístico não sexual. As confirmações exigidas pelas opções adultas continuam aplicadas.

| Nível | Situação |
|---|---|
| O workflow é executável | **Verificado em parte.** Cada grafo é validado contra o `/object_info` do ComfyUI instalado antes de entrar na fila (nós, entradas e valores de lista); o tipo de cada ligação ainda não é conferido |
| Tudo o que foi pedido chega ao prompt | **Verificado para os blocos criados.** O compilador transforma o pedido em blocos tipados e falha se algum bloco não aparecer no texto ou se um atributo for mantido e alterado ao mesmo tempo; os testes cobrem quais campos geram blocos |
| Nada muda o pedido em silêncio | **Garantido.** O aprimorador é opcional e sempre pausa para revisão com a diferença palavra a palavra |
| A área fora da máscara fica idêntica | **Garantido em relação à foto original.** O resultado volta ao tamanho e à orientação da foto e é recomposto no Studio: fora da área pintada o peso é zero, e a transição suave fica dentro dela. Com máscara não há tamanho personalizado |
| Execução sobrevive a reinícios | **Garantido nos pontos testados.** Pedido, prompt e configurações entram numa única transação; as variações são recriadas se faltarem; um envio sem confirmação fica "incerto" e só é reenviado com a decisão do usuário; uma segunda instância sobre a mesma pasta de dados é recusada |
| A imagem cumpre cada instrução | **Depende do modelo.** O Studio mede com a verificação automática (modelo local de 9B), que também pode errar |

## Estrutura

```text
backend/src/prisma_studio/   domain (pedido, regras, compilador, verificação) · application · infrastructure (comfy, db, storage) · worker · api
frontend/           React + TypeScript + Vite (dist/ já compilado e servido pelo backend)
catalog/            defaults.json (catálogo padrão) e review-v1.json (correções explícitas da importação)
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

Última revisão e correções: [análise geral — segunda rodada](docs/ANALISE-GERAL-2026-10-17-REVISAO-2.md).
Validação para publicação: [verificações de 18/10/2026](docs/VALIDACAO-GIT-2026-10-18.md).

- Validação visual com o ComfyUI real: redação do compilador, referências na geração, máscara e confiabilidade do avaliador de 9B, sempre com seed, referências e resolução controladas.
- Medir os tempos por etapa (já registrados em cada tarefa) para confirmar a hipótese de troca de modelos na VRAM.
- Tipos do frontend escritos à mão a partir do contrato; gerar a partir do schema em `/api/contract`.
