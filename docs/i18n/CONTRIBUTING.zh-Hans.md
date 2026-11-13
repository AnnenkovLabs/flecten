# 参与贡献

[English](../../CONTRIBUTING.md) · [简体中文](CONTRIBUTING.zh-Hans.md) · [Português (Brasil)](CONTRIBUTING.pt-BR.md) · [Español](CONTRIBUTING.es.md) · [日本語](CONTRIBUTING.ja.md) · [Українська](CONTRIBUTING.uk.md) · [Русский](CONTRIBUTING.ru.md)

## 准备

需要 Bun 1.4 和 Node 20 或更新版本。Node 仅用于 Electron。

```bash
bun install
bun run dev help
bun run app:dev
```

## PR 之前

运行所有检查：

```bash
bun test
bun run check
bun run lint
bun run build:ui
```

如果改动了窗口，请附上截图，或描述在 1480x940 和 1180x640 下的浏览器检查。检查这些状态：空、加载、停止、reduced motion。

## 代码规则

- 一个文件只负责一件事。软上限 300 行，硬上限 500 行。
- `core` 不导入 `ui`、`shell`、`store`。
- 界面不读取文件，也不调用模型。
- 来自模型、文件和 web 的数据在边界处用 schema 校验。
- 核心不写 `console`。事件通过总线传递。
- 提示词放在 `prompts/`，而非代码中。
- 写入日志前先剔除秘密。
- 注释解释原因，而非动作。
- 临时简化用 `ponytail:` 标记，并注明其局限与演进路径。

## 界面

- 改动视觉行为前先读 `design.md`。
- 组件放在 `ui/src/components`，状态和纯函数放在 `ui/src/lib`。
- 演示数据只在 `ui/src/lib/demo.ts` 中修改。组件不保存这些数据的副本。
- 令牌、字体和基础样式放在 `ui/src/app.css`。不要添加第二套令牌。
- 新组件通过 props 接收数据。仅屏幕容器允许直接导入 `demo.ts`。
- 交互元素支持键盘操作，并有 `aria-label` 或可见标签。
- 理解状态不需要动画。`prefers-reduced-motion` 必须保留静态画面。

## 依赖

新增依赖需要在 `docs/DECISIONS.md` 中记录：背景、决定、后果。先检查 Bun 标准库，再考虑包。

## 提交

一个提交即一处语义变更。消息用祈使句：`add spec parsing`、`fix page boundary`。秘密和 `.liquid/` 绝不提交。

## 行为

讨论代码和决策，而非人。侮辱、骚扰和发布他人数据不可接受。请私下向仓库所有者报告问题。见[行为准则](../../CODE_OF_CONDUCT.md)。
