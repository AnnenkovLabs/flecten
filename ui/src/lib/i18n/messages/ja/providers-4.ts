// Plain interface copy. Keep runtime values as numeric parts.
export default {
  "Refresh models every hour": "モデルを1時間ごとに更新",
  "Update all models and their capabilities while the app is open. Manual edits are kept by default.":
    "アプリを開いている間、すべてのモデルと対応機能を更新します。手動で変更した内容は標準で保持されます。",
  "Overwrite manual model edits": "モデルの手動変更を上書き",
  "Allow automatic updates to replace model details you changed manually.":
    "自動更新で、手動で変更したモデルの情報を置き換えることを許可します。",
  "Refresh model details": "モデル情報を更新",
  "Unknown limits stay blank. Enter them manually if needed.":
    "不明な上限は空欄のままです。必要に応じて手動で入力してください。",
  "Model to test": "接続テスト用モデル",
  "Test connection": "接続をテスト",
  "Fix the API address.": "APIのアドレスを修正してください。",
  "Testing text output from the model{0}. The draft will not be saved.": [
    "モデル",
    0,
    "のテキスト応答を確認しています。下書きは保存されません。",
  ],
  "Text: response received": "テキスト：応答を受信しました",
  "Connection error": "接続エラー",
  "· {0} ms": ["· ", 0, " ミリ秒"],
  "{0}Tools were not tested.": [0, "ツールは確認していません。"],
  "Replay, reasoning, cache, strict tools.": "再送、推論、キャッシュ、厳密なツール呼び出し。",
  "Preserve reasoning (Qwen)": "推論を保持 (Qwen)",
  available: "あり",
  visible: "表示",
} as const;
