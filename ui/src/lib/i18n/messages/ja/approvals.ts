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
  "Tasks in progress: {0}. Permissions apply to the next action; other settings apply to the next run.":
    ["実行中のタスク: ", 0, "。権限は次の操作から、その他の設定は次回の実行から適用されます。"],
  Chat: "チャット",
  "Human approval required every time": "毎回、人による承認が必要です",
  "Allow bounded built-in actions. Review eligible calls separately; ask when uncertain.":
    "安全なプロジェクト内操作を自動許可し、判断が分かれるコマンドは確認します。",
  "Ask unless this exact action was already approved.":
    "同一の操作が承認済みでない場合に確認します。",
  "Allowed for this chat": "このチャットで許可済み",
  "Permission changed: call denied": "権限が変更されたため拒否しました",
  "Rule could not be saved: call denied": "ルールを保存できなかったため拒否しました",
  "Working directory": "作業ディレクトリ",
  "Affected paths": "対象パス",
  "Applying decision…": "判断を適用中…",
  "Expired: waiting for confirmation": "期限切れ: 確認待ち",
  "Only identical arguments, paths and working directory will match. You can revoke this rule in Access settings.":
    "すべての引数、パス、作業ディレクトリが一致する場合のみ適用します。権限設定から取り消せます。",
  "For this chat": "このチャットで許可",
  "Save exact rule": "完全一致ルールを保存",
  "Remember…": "記憶する…",
  "Saved rules": "保存済みルール",
  "Rules are saved globally. Removing a rule takes effect when you save, including during an active run.":
    "ルールはグローバルに保存されます。ルールの削除は保存時に反映され、実行中のタスクにも適用されます。",
  "All matching actions": "一致するすべての操作",
  "Exact arguments and resources": "引数とリソースの完全一致",
  "Remove rule": "ルールを削除",
  "Destructive actions": "元に戻せない操作",
  "Irreversible operations like force push or deleting outside the project.":
    "force push やプロジェクト外の削除など、元に戻せない操作。",
  "Only the requests shown here are included. New requests remain pending.":
    "表示されたリクエストのみが対象です。新しいリクエストは保留されます。",
  "Feedback for the agent": "エージェントへのコメント",
  "OS sandbox available": "OSサンドボックスは利用可能",
  "OS sandbox unavailable": "OSサンドボックスは利用不可",
  Access: "アクセス",
  "Access mode": "アクセスモード",
  Agent: "エージェント",
  "Confirm changes": "変更を確認",
  "Custom access": "カスタムアクセス",
  "Reads, edits and runs commands in the project. Asks before accessing another folder or destructive actions.":
    "プロジェクト内で読み取り、編集、コマンドを実行します。別のフォルダーへのアクセスや元に戻せない操作には確認が必要です。",
  "Reads freely. Asks before changes, commands and connected tools.":
    "読み取りは確認なしで行います。変更、コマンド、接続ツールの使用前に確認します。",
  "Works across your computer without routine approvals. Process isolation is off.":
    "通常の許可確認なしでコンピューター全体を操作します。プロセスの隔離は無効です。",
  "Advanced settings differ from these modes.": "詳細設定がこれらのモードと異なります。",
  "Saved rules still apply in every mode.":
    "保存済みルールはすべてのモードで引き続き適用されます。",
  "Advanced access settings": "アクセスの詳細設定",
  "Action permissions": "操作ごとの許可",
  "Process isolation": "プロセスの隔離",
  "Isolate processes": "プロセスを隔離する",
  "Limit commands to the project and approved folders.":
    "コマンドの実行範囲をプロジェクトと許可済みフォルダーに制限します。",
  "Allow network in isolated commands": "隔離されたコマンドでネットワークを許可",
  "Allow shell commands inside the sandbox to reach websites and external services.":
    "サンドボックス内のシェルコマンドがウェブサイトや外部サービスへ接続できるようにします。",
  "Allow folder access?": "フォルダーへのアクセスを許可しますか？",
  "Folder access covers the displayed paths and their subfolders.":
    "表示されたパスとそのサブフォルダーがアクセス対象になります。",
  "Access is shared with agents in this chat.":
    "アクセス許可は、このチャットのエージェント間で共有されます。",
  "Repeat this action in this chat": "このチャットで許可",
  "Remember folder access": "フォルダーへのアクセスを記憶",
} as const;
