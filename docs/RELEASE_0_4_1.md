# Cursor Bridge v0.4.1 - Project chat refinement / Refinamento do painel de projetos

## Português (Brasil)

- A área de projetos agora prioriza três seções simples: **Chat**, **Código** e **Notas**.
- Histórico, modelos e conexão com conta aparecem somente ao abrir seus controles. O seletor de Place continua acessível.
- Na versão pública, a interface explica que o envio ao ChatGPT está indisponível, em vez de exibir uma caixa de mensagem que não funciona.
- **Open ChatGPT in browser** abre o serviço oficial no navegador, sem copiar cookies ou simular uma sessão. Os chats do navegador **não** são sincronizados automaticamente com o CursorBridge.
- A biblioteca de scripts Luau, as notas por Place, as ferramentas do editor, a proteção de rascunhos e o Roblox Studio continuam independentes da integração.
- Testes automatizados cobrem o comportamento visual com e sem conta, navegação em tamanhos compactos, Monaco, Quick Apply, Places grandes e o instalador Windows.

**Atenção:** o login e as respostas por IA dentro do CursorBridge ainda estão desativados na distribuição pública. O repositório continua `UNLICENSED`. A integração oficial depende de elegibilidade/autorização de distribuição e validação real de login no Windows.

O pacote de ícones Vanilla 3 não foi incorporado devido às restrições de redistribuição.

## English

- Cleaner Chat / Code / Notes interface; history and account settings are collapsed by default.
- No misleading Send field when public installer account inference is unavailable.
- Explicit external ChatGPT browser fallback, **not** embedded ChatGPT and **not** synced conversations.
- Existing local Place projects, saved code, Monaco undo/redo, backup/recovery and Studio pairing preserved.
- CI validates Electron build, Windows packaging, real Monaco, Quick Apply and large-Place regressions.

**ChatGPT account sign-in and model inference remain disabled in packaged v0.4.1.** Distribution eligibility and native Windows sign-in QA are unresolved. Repository license remains `UNLICENSED`.
