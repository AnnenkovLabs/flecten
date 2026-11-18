// Plain interface copy. Keep runtime values as numeric parts.
export default {
  "Auto-compaction at {0}%": [0, "%で自動圧縮"],
  "Input tokens": "入力トークン",
  "Output tokens": "出力トークン",
  "Reasoning tokens": "推論トークン",
  "Cache read tokens": "キャッシュ読み取りトークン",
  "Cache write tokens": "キャッシュ書き込みトークン",
  "Token usage": "トークン使用量",
  "Not reported": "報告なし",
  session: "セッション",
  "last turn": "直前のターン",
  "Usage by model": "モデル別の使用量",
  "Input / output tokens": "入力 / 出力トークン",
  "Worker activity": "Workerの動作状況",
  "No tool calls yet": "ツール呼び出しはまだありません",
  "Stop Worker": "Workerを停止",
  "Talker and Worker": "TalkerとWorker",
  "Separate conversation from execution": "会話と実行を分離",
  "New chats use a Talker and an independent Worker. Both use the selected model. English handoffs replace automatic translation; tool output stays live.":
    "新しいチャットを 2 セッションに分離します。Talker が対話を続け、Worker がファイル編集とコマンド実行を担当します。",
  Undo: "元に戻す",
  Redo: "やり直す",
  "Worker failed": "Workerでエラーが発生しました",
  "Call interrupted; completion was not confirmed":
    "呼び出しが中断され、完了を確認できませんでした",
} as const;
