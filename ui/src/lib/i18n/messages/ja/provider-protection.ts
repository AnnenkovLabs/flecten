export default {
  "Connecting to API {0}": ["API への接続: ", 0],
  "Hide keys and passwords from this API?": "この API に送信するシークレットをマスクしますか？",
  "Without protection, the API operator could save keys and passwords from files the agent reads, or alter AI replies to prompt a harmful command.":
    "サードパーティの API 中継サーバーは、読み取ったファイル内の秘密情報を記録したり、ツール呼び出しを改ざんしたりする可能性があります。",
  "What protection does": "保護の仕組み",
  "AI sees placeholders instead of detected keys and passwords. The app restores real values in commands and file changes.":
    "検出したキーやトークンを送信前にプレースホルダーへ置換し、ローカルでの編集・コマンド実行時に元の値へ戻します。",
  "The agent asks for your approval before running commands, changing files or visiting websites.":
    "コマンドの実行、ファイルの変更、ウェブサイトへのアクセスの前に、エージェントがあなたの許可を求めます。",
  "Applies only to this API. You can turn it off later in its Advanced tab.":
    "このプロバイダーにのみ適用されます。「詳細」タブからいつでも変更できます。",
  "Why this warning?": "この警告が表示される理由",
  "This API appears to use {0}, software for relaying AI requests. This does not prove its operator is malicious.":
    [
      "このエンドポイントは API 中継ゲートウェイ ",
      0,
      " の特徴と一致します。悪意があるとは限りませんが、運営者は通信内容を参照できます。",
    ],
  "The access key for this API is still sent to its operator. Protection only hides secrets it can recognize.":
    "認証のため、この API 自体のアクセスキーは送信されます。マスク対象は検出可能な形式のシークレットのみです。",
  "Continue without protection": "保護せずに続行",
  "Enable protection": "保護を有効にする",
  "Provider protection": "キーとパスワードの保護",
  "Hide keys and passwords from this API": "この API に送信するシークレットをマスクする",
  "Hides detected secrets from AI. The agent asks for your approval before running commands, changing files or visiting websites.":
    "送信リクエスト内の検出シークレットをマスクし、ファイル編集・コマンド実行・Web 取得の前に承認を求めます。",
} as const;
