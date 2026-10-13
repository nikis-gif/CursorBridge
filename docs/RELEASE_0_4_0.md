# Cursor Bridge v0.4.0 — candidate / versão em validação

## PT-BR

- Projetos de IA locais e persistentes por Roblox Place: chats independentes, memórias manuais e códigos Luau salvos.
- Autenticação opcional com ChatGPT por OAuth/PKCE, sem chave de API e com catálogo de modelos autorizado pela conta (sujeito a elegibilidade e limites).
- Painel discreto integrado ao tema existente, com código copiável e entrada de contexto de script somente com consentimento.
- Split editor: documento fixado no painel secundário deixa de aparecer indevidamente na lista de abas primárias de outro documento; salvamento sincronizado mantém o mesmo modelo.
- Guia de atalhos revisado, preservando Ctrl+Z/Y e comandos nativos do Monaco.
- O pacote de ícones Vanilla 3 não foi redistribuído devido à licença do autor.

**Antes de lançar:** passar pela regressão completa, verificar autenticação real em Windows/Roblox Studio e resolver a elegibilidade de distribuição do Sign in with ChatGPT para um repositório atualmente marcado `UNLICENSED`.

## English

- Local Place-scoped AI project history with named chats, manual project notes and saved code.
- Optional official Sign in with ChatGPT, with account-scoped model discovery and no API key, subject to plan and deployment eligibility.
- Theme-compatible professional sidebar; selected-script context is off by default.
- Secondary split editor owns its pinned script tab visually, while Monaco models and guarded Studio write semantics remain shared.
- Expanded developer shortcut guide and new targeted persistence, stream, OIDC, and tab projection tests.
- Third-party proprietary icon ZIP excluded to respect its license.

**Release gate:** full regression, native Windows integration test, and authorization/distribution eligibility confirmation. An unlicensed public repository is not automatically an open-source deployment.
