export default {
  "Trust project?": "このプロジェクトを信頼しますか？",
  "Trust and continue": "信頼して続行",
  "Project trusted": "プロジェクトを信頼しました",
  "Configured modules, MCP servers and hooks can run with your account permissions.":
    "設定済みのモジュール、MCPサーバー、フックをアカウントの権限で実行できるようになります。",
  "Read files?": "ファイルを読み取りますか？",
  "Change files?": "ファイルを変更しますか？",
  "Run command?": "コマンドを実行しますか？",
  "Access the network?": "ネットワークに接続しますか？",
  "Use connected tool?": "接続済みツールを使いますか？",
  "Activate skill?": "スキルを有効にしますか？",
  "Allow this action?": "この操作を許可しますか？",
  "More options": "その他の選択肢",
  "Add a note (optional)": "メモを追加（任意）",
  "Only this action in this folder.": "このフォルダーでの同一操作のみ。",
  "Tasks in progress: {0}. Permissions apply to the next action; other settings apply to the next run.":
    ["実行中のタスク: ", 0, "。権限は次の操作から、その他の設定は次回の実行から適用されます。"],
  Chat: "チャット",
  "Always ask a person": "必ず人に確認する",
  "These checkpoints cannot be bypassed by saved approvals or automatic review.":
    "保存済みの許可や自動審査でこれらの確認を省略することはできません。",
  "Human approval required every time": "毎回、人による承認が必要です",
  "Allow bounded built-in actions. Review eligible calls separately; ask when uncertain.":
    "範囲が限定された組み込み操作を許可します。対象の呼び出しは個別に審査し、不確かな場合は確認します。",
  "Ask unless this exact action was already approved.":
    "同一の操作が承認済みでない場合に確認します。",
  "Allowed for this chat": "このチャットで許可済み",
  "Permission changed: call denied": "権限が変更されたため拒否しました",
  "Rule could not be saved: call denied": "ルールを保存できなかったため拒否しました",
  "Working directory": "作業ディレクトリ",
  "Affected paths": "対象パス",
  "Applying decision…": "判断を適用中…",
  "Expired: waiting for confirmation": "期限切れ: 確認待ち",
  "Save this exact action for this project?": "この操作をこのプロジェクト用に保存しますか？",
  "Only identical arguments, paths and working directory will match. You can revoke this rule in Permissions.":
    "すべての引数、パス、作業ディレクトリが一致する場合のみ適用します。権限設定から取り消せます。",
  "For this chat": "このチャットで許可",
  "Save exact rule": "完全一致ルールを保存",
  "Remember…": "記憶する…",
  "Allow bounded built-in actions. Ask before arbitrary code or external tools.":
    "範囲が限定された組み込み操作を許可します。任意のコードや外部ツールは確認します。",
  "Allows ordinary actions. Destructive rules and sandbox limits still apply.":
    "通常の操作を許可します。破壊的操作のルールとサンドボックスの制限は引き続き適用されます。",
  "Saved rules": "保存済みルール",
  "Rules belong to this project. Removing a rule takes effect when you save, including during an active run.":
    "ルールはこのプロジェクトに適用されます。削除は保存時に反映され、実行中も有効です。",
  "No saved rules.": "保存済みルールはありません。",
  "All matching actions": "一致するすべての操作",
  "Exact arguments and resources": "引数とリソースの完全一致",
  "Configured scope": "設定された範囲",
  "Remove rule": "ルールを削除",
  "Destructive actions": "元に戻せない操作",
  "A separate checkpoint for irreversible operations, even when ordinary actions are allowed.":
    "通常の操作が許可されていても、元に戻せない操作は個別に確認します。",
  "Execution boundary": "実行の境界",
  "Sandbox limits apply independently of permissions. External paths stay blocked while workspace isolation is enabled.":
    "サンドボックスの制限は権限とは独立しています。作業フォルダーの隔離中は外部パスがブロックされます。",
  "Workspace isolation enabled": "作業フォルダーの隔離は有効",
  "Workspace isolation disabled": "作業フォルダーの隔離は無効",
  "Only the requests shown here are included. New requests remain pending.":
    "表示されたリクエストのみが対象です。新しいリクエストは保留されます。",
  "What should the agent do instead? (optional)": "代わりに何をすべきですか？（任意）",
  "Feedback for the agent": "エージェントへのコメント",
  "OS sandbox available": "OSサンドボックスは利用可能",
  "OS sandbox unavailable": "OSサンドボックスは利用不可",
} as const;
