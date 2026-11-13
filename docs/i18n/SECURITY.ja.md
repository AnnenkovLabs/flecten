# セキュリティ

[English](../../SECURITY.md) · [简体中文](SECURITY.zh-Hans.md) · [Português (Brasil)](SECURITY.pt-BR.md) · [Español](SECURITY.es.md) · [日本語](SECURITY.ja.md) · [Українська](SECURITY.uk.md) · [Русский](SECURITY.ru.md)

## サポート対象バージョン

`main` ブランチのみがサポートされます。

## 報告方法

脆弱性について公開 issue を開かないでください。GitHub の非公開 security advisory を使用するか、リポジトリの所有者に連絡してください。バージョン、再現手順、潜在的な影響を記載してください。

7 日以内の回答を想定してください。修正と詳細の開示は報告者と調整されます。

## 最初に確認すべき点

- `liquid://` プロトコルのパストラバーサル;
- `preload` ブリッジと `ipcRenderer` へのアクセス;
- ウィンドウの `contextIsolation`、`sandbox`、`nodeIntegration`;
- CSP と外部リソースの読み込み;
- ログと `events.jsonl` からのトークン削除;
- `bash` コマンドと許可セット外へのファイル書き込み;
- `flecten.config.json` からの MCP サーバーとフックの起動;
- 子 MCP プロセスへの環境変数の受け渡し;
- `SKILL.md` と MCP 応答を介した指示注入。

アーキテクチャ上のセキュリティ境界は [docs/SECURITY.md](../../docs/SECURITY.md) に記述されています。
