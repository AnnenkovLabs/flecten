export default {
  "Connecting to API {0}": ["API ", 0, " に接続"],
  "Hide keys and passwords from this API?": "このAPIからキーとパスワードを隠しますか？",
  "Without protection, the API operator could save keys and passwords from files the agent reads, or alter AI replies to prompt a harmful command.":
    "保護しない場合、APIの運営者がエージェントの読み取ったファイル内のキーやパスワードを保存したり、AIの回答を書き換えて危険なコマンドの実行を促したりするおそれがあります。",
  "What protection does": "保護の仕組み",
  "AI sees placeholders instead of detected keys and passwords. The app restores real values in commands and file changes.":
    "AIには、検出したキーやパスワードの代わりに目印が渡されます。コマンドやファイルの変更では、アプリが実際の値に戻します。",
  "The agent asks for your approval before running commands, changing files or visiting websites.":
    "コマンドの実行、ファイルの変更、ウェブサイトへのアクセスの前に、エージェントがあなたの許可を求めます。",
  "Applies only to this API. You can turn it off later in its Advanced tab.":
    "このAPIにのみ適用されます。後から「詳細」タブで無効にできます。",
  "Why this warning?": "この警告が表示される理由",
  "This API appears to use {0}, software for relaying AI requests. This does not prove its operator is malicious.":
    [
      "このAPIは、AIへのリクエストを中継するソフトウェア「",
      0,
      "」を使用している可能性があります。これは、運営者に悪意があることを示すものではありません。",
    ],
  "The access key for this API is still sent to its operator. Protection only hides secrets it can recognize.":
    "このAPIへのアクセスに使うキーは、引き続き運営者に送信されます。保護機能が隠せるのは、認識できた秘密情報だけです。",
  "Continue without protection": "保護せずに続行",
  "Enable protection": "保護を有効にする",
  "Provider protection": "キーとパスワードの保護",
  "Hide keys and passwords from this API": "このAPIからキーとパスワードを隠す",
  "Hides detected secrets from AI. The agent asks for your approval before running commands, changing files or visiting websites.":
    "検出した秘密情報をAIに渡さず、目印に置き換えます。コマンドの実行、ファイルの変更、ウェブサイトへのアクセスの前に、エージェントがあなたの許可を求めます。",
} as const;
