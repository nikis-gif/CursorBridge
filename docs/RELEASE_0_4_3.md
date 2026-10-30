# Cursor Bridge v0.4.3 - Runtime security update / Atualização de segurança do runtime

## PT-BR

Esta atualização incorpora as correções de segurança de Node.js e Electron preparadas na PR #6.

- Electron atualizado de **44.7.0 para 44.10.0**, com **Node.js 24.22.1** embutido no aplicativo Windows.
- Desenvolvimento e compilação exigem Node.js **22.23.4–22.x, 24.22.1–24.x ou 26.12.1–26.x**, com **npm 10.9.0+**. As verificações de engines rejeitam versões incompatíveis; a CI usa Node.js 22.23.4.
- Aplicativo, lockfile e identificação de versão do plugin alinhados em **0.4.3**. O protocolo e o formato das configurações do plugin permanecem iguais.
- Editor Monaco, sincronização, **Quick Apply**, pré-visualizações, proteções contra conflitos, backups, rascunhos e recuperação preservados. Esta atualização não introduz limpeza de dados nem recursos de IA.

Para receber o novo runtime, instale **Cursor-Bridge-Setup-0.4.3.exe** ou aceite a atualização oferecida pelo aplicativo após a publicação. Atualizar apenas o Node.js do computador não atualiza o Electron instalado. O plugin **CursorBridgeV2.rbxmx** é distribuído separadamente e sua instalação no Studio continua manual.

A CI verifica regressões, compilação, integridade XML do plugin e versões do runtime empacotado. Os testes de navegador simulam a ponte; não comprovam integração real com Roblox Studio. Instalação limpa, atualização desde 0.4.2, pareamento, sincronização, Quick Apply e recuperação em Windows exigem validação manual registrada na PR antes da publicação. Consulte o [guia de lançamento](GITHUB_RELEASE.md).

## English

This update ships the Node.js and Electron security changes prepared in PR #6.

- Upgrade Electron **44.7.0 to 44.10.0**, embedding **Node.js 24.22.1** in the Windows application.
- Development and builds require Node.js **22.23.4–22.x, 24.22.1–24.x or 26.12.1–26.x**, with **npm 10.9.0+**. Engine checks reject incompatible versions; CI uses Node.js 22.23.4.
- Align the application, lockfile and Studio plugin product version at **0.4.3**, preserving the plugin protocol and settings schema.
- Preserve Monaco editing, synchronization, **Quick Apply**, previews, conflict protection, backups, drafts and recovery. No data cleanup or AI features are introduced.

Install **Cursor-Bridge-Setup-0.4.3.exe**, or accept the application's update offer after publication, to receive the patched embedded runtime. Updating the host Node.js alone does not update an installed Electron application. **CursorBridgeV2.rbxmx** remains a separate, manually installed Studio plugin.

CI checks regressions, builds, plugin XML integrity and packaged runtime versions. Browser tests simulate the bridge and do not establish real Roblox Studio compatibility. A clean install, upgrade from 0.4.2, pairing, synchronization, Quick Apply and recovery on Windows require manual results recorded in the PR before publication. See the [release guide](GITHUB_RELEASE.md).
