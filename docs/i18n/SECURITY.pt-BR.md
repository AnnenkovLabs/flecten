# Segurança

[English](../../SECURITY.md) · [简体中文](SECURITY.zh-Hans.md) · [Português (Brasil)](SECURITY.pt-BR.md) · [Español](SECURITY.es.md) · [日本語](SECURITY.ja.md) · [Українська](SECURITY.uk.md) · [Русский](SECURITY.ru.md)

## Versões suportadas

Apenas o branch `main` é suportado.

## Como relatar

Não abra uma issue pública para uma vulnerabilidade. Use um security advisory privado do GitHub ou escreva ao proprietário do repositório. Inclua a versão, os passos de reprodução e o impacto potencial.

Espere uma resposta em até 7 dias. A correção e a divulgação de detalhes são coordenadas com o autor do relato.

## O que verificar primeiro

- path traversal no protocolo `liquid://`;
- a ponte `preload` e o acesso a `ipcRenderer`;
- `contextIsolation`, `sandbox` e `nodeIntegration` na janela;
- CSP e o carregamento de recursos externos;
- a remoção de tokens de logs e `events.jsonl`;
- comandos `bash` e escrita de arquivos fora do conjunto permitido;
- a inicialização de servidores MCP e hooks a partir de `flecten.config.json`;
- a passagem do ambiente para processos MCP filhos;
- injeção de instruções via `SKILL.md` e respostas MCP.

As fronteiras arquitetônicas de segurança estão descritas em [docs/SECURITY.md](../../docs/SECURITY.md).
