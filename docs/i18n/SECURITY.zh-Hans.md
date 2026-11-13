# 安全

[English](../../SECURITY.md) · [简体中文](SECURITY.zh-Hans.md) · [Português (Brasil)](SECURITY.pt-BR.md) · [Español](SECURITY.es.md) · [日本語](SECURITY.ja.md) · [Українська](SECURITY.uk.md) · [Русский](SECURITY.ru.md)

## 受支持的版本

仅支持 `main` 分支。

## 如何报告

不要为漏洞创建公开 issue。请使用 GitHub 的私密 security advisory，或写信给仓库所有者。注明版本、复现步骤和潜在影响。

预计 7 天内回复。修复与细节披露会与报告者协调。

## 优先检查项

- `liquid://` 协议中的路径遍历；
- `preload` 桥接与对 `ipcRenderer` 的访问；
- 窗口中的 `contextIsolation`、`sandbox`、`nodeIntegration`；
- CSP 与外部资源加载；
- 从日志和 `events.jsonl` 中剔除令牌；
- `bash` 命令与向允许集合之外写入文件；
- 从 `flecten.config.json` 启动 MCP 服务器和钩子；
- 向子 MCP 进程传递环境变量；
- 通过 `SKILL.md` 和 MCP 响应注入指令。

架构层面的安全边界见 [docs/SECURITY.md](../../docs/SECURITY.md)。
