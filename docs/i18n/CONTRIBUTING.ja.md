# コントリビュート

[English](../../CONTRIBUTING.md) · [简体中文](CONTRIBUTING.zh-Hans.md) · [Português (Brasil)](CONTRIBUTING.pt-BR.md) · [Español](CONTRIBUTING.es.md) · [日本語](CONTRIBUTING.ja.md) · [Українська](CONTRIBUTING.uk.md) · [Русский](CONTRIBUTING.ru.md)

## 準備

Bun 1.4 と Node 20 以降が必要です。Node は Electron にのみ必要です。

```bash
bun install
bun run dev help
bun run app:dev
```

## PR の前に

すべてのチェックを実行してください:

```bash
bun test
bun run check
bun run lint
bun run build:ui
```

ウィンドウを変更した場合は、スクリーンショットを添付するか、1480x940 と 1180x640 でのブラウザ確認を記述してください。状態を確認: 空、読み込み中、停止、reduced motion。

## コードルール

- 1 ファイルは 1 つのことを担当します。ソフト上限 300 行、ハード上限 500 行。
- `core` は `ui`、`shell`、`store` をインポートしません。
- インターフェースはファイルを読まず、モデルも呼びません。
- モデル・ファイル・web からのデータは境界でスキーマにより検証されます。
- コアは `console` に書きません。イベントはバスを通ります。
- プロンプトはコードではなく `prompts/` に置きます。
- ログに書き込む前にシークレットは削除されます。
- コメントは動作ではなく理由を説明します。
- 一時的な簡略化は `ponytail:` で、その限界と発展の道筋を記します。

## インターフェース

- 視覚的な動作を変える前に `design.md` を読んでください。
- コンポーネントは `ui/src/components`、状態と純粋関数は `ui/src/lib` に置きます。
- デモデータは `ui/src/lib/demo.ts` でのみ変更します。コンポーネントはそのデータのコピーを保持しません。
- トークン、フォント、基本スタイルは `ui/src/app.css` に置きます。2 つ目のトークンセットを追加しないでください。
- 新しいコンポーネントは props でデータを受け取ります。`demo.ts` の直接インポートは画面コンテナでのみ許可されます。
- インタラクティブ要素はキーボードで操作でき、`aria-label` または可視ラベルを持ちます。
- 状態の理解にアニメーションは不要です。`prefers-reduced-motion` は静止フレームを残す必要があります。

## 依存関係

新しい依存関係には `docs/DECISIONS.md` への記録が必要です: 文脈、決定、結果。まず Bun の標準ライブラリを確認し、次にパッケージを検討してください。

## コミット

1 コミットは 1 つの意味の変更です。メッセージは命令形: `add spec parsing`、`fix page boundary`。シークレットと `.liquid/` はコミットしません。

## 行動

人ではなくコードと決定を議論してください。侮辱、ハラスメント、他者のデータの公開は許容されません。問題はリポジトリの所有者に非公開で報告してください。[行動規範](../../CODE_OF_CONDUCT.md) を参照。
