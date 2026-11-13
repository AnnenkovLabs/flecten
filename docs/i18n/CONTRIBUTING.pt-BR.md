# Contribuindo

[English](../../CONTRIBUTING.md) · [简体中文](CONTRIBUTING.zh-Hans.md) · [Português (Brasil)](CONTRIBUTING.pt-BR.md) · [Español](CONTRIBUTING.es.md) · [日本語](CONTRIBUTING.ja.md) · [Українська](CONTRIBUTING.uk.md) · [Русский](CONTRIBUTING.ru.md)

## Preparação

Você precisa de Bun 1.4 e Node 20 ou mais recente. Node só é necessário para o Electron.

```bash
bun install
bun run dev help
bun run app:dev
```

## Antes de um PR

Execute todas as verificações:

```bash
bun test
bun run check
bun run lint
bun run build:ui
```

Se você mudou a janela, anexe uma captura ou descreva uma verificação no navegador em 1480x940 e 1180x640. Verifique os estados: vazio, carregando, parado, reduced motion.

## Regras de código

- Um arquivo cuida de uma coisa. Limite suave 300 linhas, limite rígido 500.
- `core` não importa `ui`, `shell` ou `store`.
- A interface não lê arquivos nem chama modelos.
- Dados do modelo, arquivos e web são validados por um esquema na fronteira.
- O núcleo não escreve em `console`. Os eventos vão pelo bus.
- Os prompts ficam em `prompts/`, não no código.
- Segredos são removidos antes de qualquer escrita em log.
- Um comentário explica o motivo, não a ação.
- Uma simplificação temporária é marcada com `ponytail:` com seu limite e um caminho de evolução.

## Interface

- Leia `design.md` antes de mudar o comportamento visual.
- Os componentes ficam em `ui/src/components`, estado e funções puras em `ui/src/lib`.
- Os dados de demo mudam apenas em `ui/src/lib/demo.ts`. Um componente não guarda uma cópia desses dados.
- Tokens, fontes e estilos base ficam em `ui/src/app.css`. Não adicione um segundo conjunto de tokens.
- Um novo componente recebe dados por props. Importar `demo.ts` diretamente só é permitido nos contêineres de tela.
- Elementos interativos funcionam pelo teclado e têm `aria-label` ou um rótulo visível.
- Animação não é necessária para entender o estado. `prefers-reduced-motion` deve deixar um quadro estático.

## Dependências

Uma nova dependência exige uma entrada em `docs/DECISIONS.md`: contexto, decisão, consequências. Verifique primeiro a biblioteca padrão do Bun, depois um pacote.

## Commits

Um commit é uma mudança de significado. Mensagem no imperativo: `add spec parsing`, `fix page boundary`. Segredos e `.liquid/` nunca são commitados.

## Comportamento

Discuta código e decisões, não pessoas. Insultos, assédio e publicar dados de outros são inaceitáveis. Relate um problema em privado ao proprietário do repositório. Veja o [Código de conduta](../../CODE_OF_CONDUCT.md).
