# Discord Cloud Workspace

O Cursor Bridge ganhou uma interface inspirada em Discord e paineis de desenvolvimento:
novo painel inicial, navegacao lateral, superficies arredondadas, animacoes discretas
e cores integradas aos controles nativos da janela do Windows.

## Novidades

- Tema Discord no desktop e no plugin do Roblox Studio. As preferencias de tema existentes foram preservadas: selecione Appearance > Discord para trocar.
- Explorer reposicionavel a esquerda ou a direita pelo puxador de arraste ou pelo menu Layout, com largura e preferencias salvas.
- Duas vistas do mesmo script, lado a lado ou empilhadas, com cursores e rolagem independentes. O documento, o historico de desfazer e o fluxo de salvamento sao compartilhados.
- Arraste uma aba para a lateral ou para baixo do editor para abrir uma segunda vista. Ctrl+Backslash divide lateralmente; Ctrl+Shift+Backslash empilha; Ctrl+B alterna o Explorer.
- Painel inicial com estado real da sessao, contagem de scripts e acesso a Quick Apply, busca e recuperacao. O cartao de IA usa o Quick Apply existente; nao e um novo servico de chat.
- Publicacao automatica ao alterar a versao na main, com testes antes da geracao do instalador, plugin e metadados do atualizador.

## Integridade

Os protocolos e limites de transporte foram mantidos. Os testes cobrem sincronizacao,
conflitos, protecao de rascunhos, navegacao, layouts, Monaco real com ponte simulada,
Places grandes, bundles grandes e integridade do XML do plugin.
O teste interativo dentro do Roblox Studio e a verificacao visual nativa no Windows
nao foram realizados no ambiente de desenvolvimento desta alteracao.

## Atualizacao

No aplicativo instalado, use Studio session > Check for updates, ou execute o novo
Cursor-Bridge-Setup-0.3.0.exe. Para o novo visual do plugin, substitua a copia antiga
pelo CursorBridgeV2.rbxmx desta release; evite manter duas copias do plugin ativas.
Os arquivos locais de recuperacao nao sao apagados pelo reset do layout.
