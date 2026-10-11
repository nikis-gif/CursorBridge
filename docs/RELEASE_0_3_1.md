# Cursor Bridge v0.3.1 - Interface refinada / Refined interface

## PT-BR

### Interface mais discreta

O aplicativo Windows agora usa uma interface mais compacta, com cores neutras,
ícones de contorno consistentes e menos elementos decorativos. O painel inicial
foi simplificado: sem slogans, estrelas, degradês ou cartões promocionais.
Os botões Layout e Appearance têm rótulos de texto, e as ações continuam acessíveis.

- Janela inicial de até **1080 x 700**, centralizada e limitada a 90% da área útil
  da tela. Monitores menores e escalonamento do Windows são considerados.
- Explorer com largura inicial de **248 px**; larguras e posições salvas continuam
  sendo respeitadas. Divisão de scripts, arraste e atalhos foram mantidos.
- **Obsidian** volta a ser o tema padrão e o primeiro da lista no plugin.
  A antiga preferência padrão da v0.3.0 migra para Obsidian no plugin; outros temas
  salvos são preservados. O tema adicional passa a se chamar **Cursor**.
- No desktop, instalações novas usam Obsidian. A antiga preferência da v0.3.0 é
  reconhecida como Cursor, agora com cores neutras. Outros temas são preservados.
- **Toda a interface do aplicativo e do plugin permanece em inglês.** Somente
  estas notas de versão são bilíngues. A tag técnica continua sendo `v0.3.1`.

### Atualização e verificação

Use **Studio session > Check for updates** ou execute `Cursor-Bridge-Setup-0.3.1.exe`.
No Roblox Studio, substitua o plugin antigo pelo `CursorBridgeV2.rbxmx` desta release.
Não mantenha duas cópias ativas do plugin.

O protocolo de sincronização, os arquivos de recuperação e as proteções contra
conflitos não foram substituídos. A publicação executa testes da aplicação, da
integridade do plugin, da interface com Monaco real e transporte simulado, de
Places grandes e de bundles grandes antes de gerar o instalador. Testes de browser
não substituem uma verificação interativa dentro do Roblox Studio e no Windows.

## English

### A quieter interface

The Windows app now uses a more compact interface, neutral colors, consistent
outline icons, and less decoration. The home screen no longer uses slogans,
sparkles, gradients, or promotional cards. Layout and Appearance have text labels,
and all workspace actions remain accessible.

- Default window up to **1080 x 700**, centered and bounded to 90% of the display's
  usable area. Smaller displays and Windows scaling are taken into account.
- Default Explorer width of **248 px**. Saved widths and dock positions are
  respected. Split editing, dragging, and keyboard shortcuts are retained.
- **Obsidian** is again the default and first theme in the Studio plugin.
  The previous v0.3.0 default preference migrates to Obsidian in the plugin;
  other saved themes are retained. The additional theme is now called **Cursor**.
- New desktop installations use Obsidian. The previous v0.3.0 theme preference
  maps to Cursor with a neutral palette. Other saved themes are retained.
- **The entire app and plugin interface remains in English.** Only these release
  notes are bilingual. The technical tag remains `v0.3.1`.

### Update and verification

Use **Studio session > Check for updates**, or run `Cursor-Bridge-Setup-0.3.1.exe`.
In Roblox Studio, replace the old plugin with this release's `CursorBridgeV2.rbxmx`.
Do not keep two copies of the plugin active.

The synchronization protocol, recovery files, and conflict protections have not
been replaced. Publication runs application tests, plugin integrity checks,
interface tests with real Monaco and simulated transport, large-Place tests, and
large-bundle tests before packaging. Browser tests do not replace interactive
verification inside Roblox Studio and on Windows.
