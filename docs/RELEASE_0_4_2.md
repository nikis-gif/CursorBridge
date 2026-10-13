# Cursor Bridge v0.4.2 - Focused workbench and AI removal / Área de trabalho sem IA integrada

## PT-BR

Esta versão remove completamente o sistema de chat de IA que não estava funcional no aplicativo distribuído. O CursorBridge mantém seu editor Luau profissional e a integração local com Roblox Studio.

- Removidos: painel Chat / Código / Notas, botão lateral de assistente, atalho Ctrl+Shift+A, login ChatGPT, seletor de modelos, geração de respostas, integração OAuth e comandos relacionados do Electron.
- A interface principal volta a destacar **Workspace, Explorer, Busca, Quick Apply, Recuperação e Atalhos**, sem telas nem avisos de assinatura.
- **Quick Apply não foi alterado**. Ctrl+L, pré-visualização de alterações, conferência de destinos, limites de importação, cópias de segurança e aplicação no Roblox Studio permanecem iguais.
- Editor Monaco, Ctrl+Z, Ctrl+Y, editor dividido, salvamento, recuperação, busca global, temas e sincronização Studio preservados.
- Atualização sem exclusão automática de backups, rascunhos ou arquivos antigos de conversas. Dados do antigo painel de IA, se existentes no computador, permanecem armazenados mas não aparecem no aplicativo.
- Sem novos pacotes de ícones, dependências de IA ou mudança na licença proprietária `UNLICENSED`.

O arquivo TXT de Quick Apply pode ser preparado externamente; o CursorBridge não gera esse código por conta própria.

## English

This release removes the inactive embedded ChatGPT / AI project system. The desktop remains a local Roblox Studio Luau workbench.

- Removed in-app assistant, project chat/notes/snippets panel, model picker, account sign-in, OAuth credentials integration, inference code, assistant IPC, activity rail entry, and Ctrl+Shift+A shortcut.
- Streamlined workbench navigation without subscription notices or inactive chat controls.
- **Quick Apply is unchanged**: Ctrl+L, script bundle TXT contract, destination review, previews, backups, safeguards and Studio application work exactly as before.
- Monaco editing, native undo/redo, split editors, Studio synchronization, existing drafts and recovery history are preserved.
- The update does not delete historical user data. Old local AI project records remain inert in the app's data directory.
- No OpenAI account integration, new icon pack, licensing change or cloud requirement. Repository remains `UNLICENSED`.

The Windows installer and Roblox Studio plugin are tested by the release pipeline.
