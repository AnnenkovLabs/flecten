export default {
  "A deny decision always stops this action. This setting controls unexpected failures only.":
    "拒否の判断は必ずこの操作を停止します。この設定は予期しない障害だけに適用されます。",
  "A name you will recognize": "わかりやすい名前",
  Action: "アクション",
  "Action blocked": "アクションをブロックしました",
  "Add hook": "フックを追加",
  "All events": "すべてのイベント",
  "Can block the action": "アクションをブロック可能",
  "Check a tool before it runs, add project context, or notify another service when work finishes. Choose an event above to create your first hook.":
    "ツール実行前の確認、プロジェクトのコンテキスト追加、作業完了時の外部サービスへの通知ができます。上のイベントを選んで最初のフックを作成してください。",
  Conditions: "条件",
  "Conditions did not match": "条件が一致しませんでした",
  "Connect your workflow": "ワークフローを接続",
  "Context added": "追加されたコンテキスト",
  "Continue without waiting. This hook cannot block an action or add context to the current step.":
    "待たずに続行します。このフックはアクションをブロックしたり現在のステップにコンテキストを追加したりできません。",
  Duplicate: "複製",
  "Enable hook {0}": ["フック ", 0, " を有効化"],
  "Enter the full hook URL.": "フックの完全な URL を入力してください。",
  "Every occurrence": "毎回",
  "Example command": "コマンドの例",
  "Example message": "メッセージの例",
  "Example path": "パスの例",
  Execution: "実行",
  Hook: "フック",
  "Hook failed": "フックが失敗しました",
  "Hook passed": "フックが成功しました",
  "Hook timeout must be between 0.1 and 60 seconds.":
    "フックのタイムアウトは 0.1〜60 秒にしてください。",
  "Hooks run from top to bottom within each event. A blocking decision stops the remaining hooks.":
    "各イベント内のフックは上から順に実行されます。ブロックの判断で残りのフックは停止します。",
  "Move down": "下へ",
  "Move up": "上へ",
  "Observes only": "監視のみ",
  "Only run when every filled condition matches. Paths are relative to the project folder; an empty field matches everything.":
    "入力したすべての条件に一致した場合のみ実行します。パスはプロジェクトフォルダーからの相対パスです。空欄はすべての値に一致します。",
  "Run a command": "コマンドを実行",
  "Run test": "テストを実行",
  "Run your scripts or send an HTTP request when the agent reaches an event.":
    "エージェントがイベントに達したときにスクリプトや HTTP リクエストを実行します。",
  "Runs in the project folder. Event data arrives as JSON on stdin. Exit 0 succeeds; exit 2 denies a blocking event.":
    "プロジェクトフォルダーで実行します。イベントデータは stdin に JSON で届きます。終了コード 0 は成功、2 はブロック可能なイベントの拒否です。",
  "Send an HTTP request": "HTTP リクエストを送信",
  "Sends a POST request containing the event data. Your endpoint can return a decision and additional context.":
    "イベントデータを含む POST リクエストを送信します。接続先は判断と追加コンテキストを返せます。",
  "Stop the action if the hook crashes, times out, or returns an invalid response.":
    "フックの異常終了、タイムアウト、無効な応答が発生した場合にアクションを停止します。",
  Success: "成功",
  "Test hook": "フックをテスト",
  "Test this draft without saving. The command or HTTP request really runs using the example below, even if the hook is disabled.":
    "保存せずに下書きをテストします。フックが無効でも、下の例を使ってコマンドや HTTP リクエストが実際に実行されます。",
  "The hook changed after this test. Run it again to check the current draft.":
    "このテスト後にフックが変更されました。現在の下書きで再テストしてください。",
  "This event has reached its limit of {0} hooks.": [
    "このイベントはフック数の上限 ",
    0,
    " 件に達しています。",
  ],
  "This event observes an action that already happened. A deny decision has no effect.":
    "このイベントは実行済みのアクションを監視します。拒否の判断は影響しません。",
  "Timeout, seconds": "タイムアウト、秒",
  "Tool name": "ツール名",
  "Tool result": "ツールの結果",
  "Untitled hook": "名前のないフック",
  "Update the example or the conditions, then run the test again.":
    "例または条件を更新して、もう一度テストしてください。",
  When: "タイミング",
  "Your hooks": "フック一覧",
  "{0} conditions": ["条件 ", 0, " 件"],
  "{0} copy": ["", 0, " のコピー"],
  "{0} enabled": ["", 0, " 件有効"],
  "Inherited environment variables": "引き継ぐ環境変数",
  "One variable name per line. Only these extra variables are passed from the app environment.":
    "変数名を 1 行に 1 つ入力してください。アプリの環境からこれらの追加変数だけが渡されます。",
  "Before each run in this session.": "このセッションでの各実行の前。",
  "Before a user message reaches the model.": "ユーザーのメッセージがモデルに届く前。",
  "Before a tool runs. A denial prevents execution.": "ツールの実行前。拒否により実行を防ぎます。",
  "After a tool returns, including failed calls.":
    "ツールが結果を返した後。失敗した呼び出しも含みます。",
  "After a run completes, except cancellation or error.":
    "実行完了後。キャンセルやエラーを除きます。",
  "After each run, including cancellation or error.": "各実行の後。キャンセルやエラーも含みます。",
  "Before enforcing a tool permission decision. A hook can deny but cannot grant access.":
    "ツールの権限判断を適用する前。フックは拒否できますがアクセスを許可することはできません。",
  "After a summary is generated, before it replaces context.":
    "要約の生成後、コンテキストを置き換える前。",
  "When the session emits a notification.": "セッションが通知を発行したとき。",
  "When a subagent starts or finishes. Only the start can be blocked.":
    "サブエージェントの開始時または終了時。ブロックできるのは開始のみです。",
  "Before a group of tools runs. Conditions match one tool in the group.":
    "ツールのグループを実行する前。すべての条件がグループ内の同じツールに一致する必要があります。",
  "Response format": "応答形式",
  "Text output": "テキスト出力",
  "JSON decision and context": "JSON の判断とコンテキスト",
  "Use ordinary scripts and formatters. Output is a log; exit code 2 can still block an action.":
    "通常のスクリプトやフォーマッターに対応します。出力はログになり、終了コード 2 では引き続きアクションをブロックできます。",
  "Return a JSON object with decision, reason, or additionalContext. Empty output is accepted.":
    "decision、reason、additionalContext を含む JSON オブジェクトを返します。空の出力も受け付けます。",
  "Recent hook activity": "最近のフック実行",
  "Actual hook runs in the current task, newest first. Test runs appear in the editor only.":
    "現在のタスクでの実際の実行を新しい順に表示します。テストの実行はエディターにのみ表示されます。",
  "No hooks have run in this task yet.": "このタスクではまだフックが実行されていません。",
} as const;
