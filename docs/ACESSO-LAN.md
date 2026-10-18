# Acesso do Studio pela rede local

Configurado em 17/10/2026 com o mesmo modelo da versão anterior: acesso sem senha somente pela sub-rede privada escolhida no Windows.

## Aplicação

- Endereço local: `http://127.0.0.1:8780/`.
- Endereço LAN: `http://192.168.1.3:8780/`.
- Alias LAN: `http://studio.local:8780/`, anunciado por mDNS na interface IPv4 privada selecionada.
- Rede autorizada sem senha: `192.168.1.0/24`.
- Interface detectada: Ethernet, perfil Privado.
- O iniciador detecta novamente a rede privada nos próximos inícios. `-SomenteLocal` desativa esse modo.
- Clientes de fora da sub-rede não recebem a autorização LAN. O mecanismo anterior de token permanece disponível.
- O modo LAN valida também Host e Origin. Imagens e uploads não precisam de um login separado.
- Diagnóstico exibe o modo de acesso e o endereço.

## Validação realizada

O Studio foi reiniciado sem pedidos ativos. O health check e a preparação de um pedido responderam HTTP 200 tanto por `127.0.0.1` quanto por `192.168.1.3`, sem token. Nenhuma geração foi submetida nesses testes.

Passaram 91 testes do backend, 14 testes do frontend, Ruff, TypeScript e build. Os testes novos incluem acesso LAN, uploads/downloads, IPv4 mapeado, rejeição de outras sub-redes, Host desconhecido, origens externas e configurações públicas excessivamente amplas.

O acesso por IP foi verificado a partir deste próprio computador. Um teste a partir de outro dispositivo depende também do Windows Firewall e da conectividade dessa rede.

## Etapa administrativa pendente

A criação da regra pelo Windows Firewall retornou “Acesso negado”. A solicitação seguinte para executá-la com elevação foi bloqueada pela revisão automática de permissões, que exigiu autorização explícita para a alteração administrativa persistente e o acesso LAN sem senha. A elevação não foi executada, e a regra não foi criada por este trabalho.

O script revisável é [configurar-rede.ps1](D:/Projetos/GeraImg/studio/scripts/configurar-rede.ps1). A regra preparada permite somente:

- Direção de entrada, protocolo TCP, porta local 8780.
- Endereço local `192.168.1.3`.
- Origem `192.168.1.0/24`.
- Perfil de rede Privado.

Ela permite que dispositivos dessa sub-rede utilizem o Studio e seus arquivos sem senha. Não configura encaminhamento no roteador. O script verifica o escopo de uma regra existente antes de declarar sucesso.

Após autorização explícita, falta executar esse script com permissões administrativas e verificar a regra instalada. Não é necessário gerar ou compartilhar um token para o modo LAN solicitado.

## Alias studio.local

O iniciador habilita `--lan-alias studio.local`; o backend anuncia um serviço HTTP com seu IP e porta usando
`zeroconf==0.151.5`. O anúncio acompanha o início e encerramento do servidor e é desativado em `-SomenteLocal`.
O Host permitido inclui somente o nome configurado, os IPs selecionados e os nomes de loopback; a mesma
verificação de IP do cliente e de Origin continua aplicada ao alias. A porta permanece 8780.

O diagnóstico lista o URL e informa `network_access.mdns.status`: `advertising`, `error` ou `disabled`.
`advertising` confirma que o anúncio iniciou, sem garantir a resolução em todos os dispositivos.
Se houver erro de anúncio, o servidor continua disponível pelo IP e registra o erro no log.

Clientes precisam de suporte a mDNS e estar no mesmo segmento, sem isolamento ou bloqueio de multicast
UDP 5353. A regra HTTP pendente descrita acima continua necessária se o firewall bloquear TCP 8780.
Nenhuma regra de firewall ou alteração administrativa do arquivo hosts foi executada para criar o alias.
Se outro dispositivo já usar `studio.local`, escolha outro nome com `--lan-alias`; não use o mesmo nome em
dois computadores. A implementação usa a [biblioteca python-zeroconf](https://python-zeroconf.readthedocs.io/en/latest/api.html).

Validação em 17/10/2026: após reiniciar o Studio sem pedidos ativos, o resolvedor do Windows retornou
`192.168.1.3` para `studio.local`. A página inicial, `/api/health` e um POST em `/api/prepare` com Origin
`http://studio.local:8780` responderam HTTP 200 pelo nome. O health informou `advertising`, sem erro.
Nenhuma geração foi iniciada. A suíte completa do backend e o Ruff passaram, incluindo testes do alias,
rejeição de origens e clientes externos, anúncio restrito à interface escolhida e encerramento do mDNS.
Esse teste ocorreu no próprio computador servidor; outro dispositivo ainda não foi testado.

## Compatibilidade com HTTP local

O navegador não disponibiliza `crypto.randomUUID()` em HTTP por `studio.local` ou IP da LAN. As chamadas
diretas faziam a inclusão de fotos falhar após o upload e também afetavam geração, repetição de pedidos,
reaproveitamento de resultados e criação de itens na biblioteca. A interface agora usa um gerador UUID v4
compartilhado, com `crypto.getRandomValues()` quando `randomUUID()` está indisponível, mantendo a fonte
criptográfica de aleatoriedade e o formato dos IDs. Ver [documentação da API](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID).

A correção passou nos 18 testes da interface, incluindo inclusão de fotos em geração e edição sem
`randomUUID`, envio e repetição de pedidos nesse mesmo ambiente, além de TypeScript e build de produção.
