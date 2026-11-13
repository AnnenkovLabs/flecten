export default {
  "Module request queue is full. Wait for a pending request to finish.":
    "モジュールのリクエストキューがいっぱいです。処理中のリクエストが完了するまでお待ちください。",
  "Project service": "プロジェクトサービス",
  "Native module code runs with the permissions of the agent process.":
    "モジュールのネイティブコードはエージェントプロセスの権限で実行されます。",
  "Project services start when this module and project are trusted.":
    "プロジェクトサービスは、モジュールとプロジェクトを信頼すると起動します。",
  "Session services start when the agent activates this module.":
    "セッションサービスは、エージェントがモジュールを有効にすると起動します。",
  "Use module interface": "モジュールの画面を使用",
  "Stop using module interface": "モジュールの画面を停止",
  "Resume module interfaces": "モジュールの画面を再開",
  "Restore native interface": "標準の画面に戻す",
  "Interface changes can replace the entire app. Ctrl+Shift+F12 restores the native interface.":
    "モジュールはアプリ全体の画面を置き換えられます。Ctrl+Shift+F12 で標準の画面に戻せます。",

  Modules: "モジュール",
  "Module folder": "モジュールフォルダー",
  "On demand": "必要時に有効化",
  "Could not load modules": "モジュールを読み込めませんでした",
  "Could not update module": "モジュールを更新できませんでした",
  "Could not load module surface": "モジュールの画面を開けませんでした",
  "Loading module surface…": "モジュールの画面を読み込み中…",
  "The agent activates tools, instructions, hooks and workspace surfaces for the current task. Other modules stay out of context.":
    "エージェントは現在のタスクに必要なツール、指示、フック、作業画面を有効にします。他のモジュールはコンテキストを使用しません。",
  "Add a package containing .flecten-module/module.json, then review and trust its version.":
    ".flecten-module/module.json を含むパッケージを追加し、内容を確認してバージョンを信頼してください。",
  "Reload local changes automatically": "ローカルの変更を自動的に再読み込み",
  "Development reload trusts future edits in this folder. Active chats apply them between agent turns.":
    "開発モードでは、このフォルダーの今後の変更も信頼します。実行中のチャットにはエージェントのターンの間に反映されます。",
  "No modules installed. Add a module folder to get started.":
    "モジュールは未インストールです。モジュールフォルダーを追加してください。",
} as const;
