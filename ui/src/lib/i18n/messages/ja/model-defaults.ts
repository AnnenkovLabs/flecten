export default {
  "Main model": "メインモデル",
  "Default main model": "既定のメインモデル",
  "Used when Talker and Worker is off, and as the fallback for role defaults.":
    "単一エージェントのチャットおよび未設定ロールの既定モデルとして使用されます。",
  "Defaults apply to new chats. You can still choose a model in the message box.":
    "新しいチャットに適用されます。チャットごとの変更は入力欄で行えます。",
  "Talker handles your conversation. Worker carries out tasks with tools, for any kind of work.":
    "Talker が対話を即座に続け、別セッションの Worker がツール実行とファイル編集を行います。",
  "Talker model": "Talker のモデル",
  "Worker model": "Worker のモデル",
  "Understands requests, asks questions, and explains progress and results.":
    "依頼を理解し、質問し、進捗と結果を説明します。",
  "Executes tasks. A model selected in the message box overrides this default for that chat.":
    "ツール実行とファイル編集を担当します。入力欄でのモデル選択が優先されます。",
  "Use chat model": "チャットのモデルを使用",
  "Use main model": "メインモデルを使用",
  "Subagent models": "サブエージェントのモデル",
  "Choose a default for each role. Unset roles inherit the model of the agent that starts them.":
    "役割ごとにモデルを選びます。未設定の役割は、起動元のエージェントのモデルを引き継ぎます。",
  "Use parent model": "親のモデルを使用",
  Explore: "調査",
  Implement: "実行",
  Review: "確認",
  "Find information and understand the task.": "読み取り専用のコード検索と調査。",
  "Carry out a focused assignment.": "範囲を絞った実装と検証。",
  "Check results and identify risks.": "差分レビュー、境界ケース、回帰の検出。",
  "Choose an enabled model that supports tools.": "有効でツールに対応したモデルを選んでください。",
  "Choose a variant available for this model.":
    "このモデルで利用できるバリアントを選んでください。",
  "Reasoning level": "推論レベル",
  "Model default": "モデルの既定値",
  "Reasoning is not supported": "このモデルは推論に対応していません",
  "Select a model first": "先にモデルを選択してください",
  "Changing reasoning selects the inherited model for this role.":
    "推論レベルを変更すると、継承したモデルがこの役割に固定されます。",
  "Default: no reasoning": "既定：推論なし",
  "Reasoning is set by the model variant.": "推論レベルはモデルのバリアントで設定されています。",
} as const;
