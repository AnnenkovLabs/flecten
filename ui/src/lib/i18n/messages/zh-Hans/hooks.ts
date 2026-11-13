export default {
  "A deny decision always stops this action. This setting controls unexpected failures only.":
    "拒绝决定始终会阻止此操作。此设置仅控制意外故障。",
  "A name you will recognize": "便于识别的名称",
  Action: "操作",
  "Action blocked": "操作已阻止",
  "Add hook": "添加钩子",
  "All events": "所有事件",
  "Can block the action": "可以阻止操作",
  "Check a tool before it runs, add project context, or notify another service when work finishes. Choose an event above to create your first hook.":
    "在工具运行前进行检查、添加项目上下文，或在工作完成时通知其他服务。选择上方事件以创建第一个钩子。",
  Conditions: "条件",
  "Conditions did not match": "条件不匹配",
  "Connect your workflow": "连接你的工作流程",
  "Context added": "已添加的上下文",
  "Continue without waiting. This hook cannot block an action or add context to the current step.":
    "无需等待即可继续。此钩子无法阻止操作或向当前步骤添加上下文。",
  Duplicate: "复制",
  "Enable hook {0}": ["启用钩子 ", 0, ""],
  "Enter the full hook URL.": "请输入完整的钩子 URL。",
  "Every occurrence": "每次发生时",
  "Example command": "示例命令",
  "Example message": "示例消息",
  "Example path": "示例路径",
  Execution: "执行",
  Hook: "钩子",
  "Hook failed": "钩子失败",
  "Hook passed": "钩子成功",
  "Hook timeout must be between 0.1 and 60 seconds.": "钩子超时必须为 0.1 到 60 秒。",
  "Hooks run from top to bottom within each event. A blocking decision stops the remaining hooks.":
    "每个事件中的钩子按从上到下的顺序运行。阻止决定会停止其余钩子。",
  "Move down": "下移",
  "Move up": "上移",
  "Observes only": "仅观察",
  "Only run when every filled condition matches. Paths are relative to the project folder; an empty field matches everything.":
    "仅在所有已填写条件均匹配时运行。路径相对于项目文件夹；空字段匹配所有值。",
  "Run a command": "运行命令",
  "Run test": "运行测试",
  "Run your scripts or send an HTTP request when the agent reaches an event.":
    "当代理到达某个事件时运行脚本或发送 HTTP 请求。",
  "Runs in the project folder. Event data arrives as JSON on stdin. Exit 0 succeeds; exit 2 denies a blocking event.":
    "在项目文件夹中运行。事件数据以 JSON 形式通过 stdin 传入。退出码 0 表示成功；退出码 2 拒绝可阻止的事件。",
  "Send an HTTP request": "发送 HTTP 请求",
  "Sends a POST request containing the event data. Your endpoint can return a decision and additional context.":
    "发送包含事件数据的 POST 请求。你的端点可以返回决定和附加上下文。",
  "Stop the action if the hook crashes, times out, or returns an invalid response.":
    "如果钩子崩溃、超时或返回无效响应，则停止操作。",
  Success: "成功",
  "Test hook": "测试钩子",
  "Test this draft without saving. The command or HTTP request really runs using the example below, even if the hook is disabled.":
    "无需保存即可测试草稿。即使钩子已禁用，命令或 HTTP 请求仍会使用下方示例实际执行。",
  "The hook changed after this test. Run it again to check the current draft.":
    "此测试后钩子已更改。请再次测试当前草稿。",
  "This event has reached its limit of {0} hooks.": ["此事件已达到 ", 0, " 个钩子的上限。"],
  "This event observes an action that already happened. A deny decision has no effect.":
    "此事件观察已发生的操作。拒绝决定不会产生影响。",
  "Timeout, seconds": "超时，秒",
  "Tool name": "工具名称",
  "Tool result": "工具结果",
  "Untitled hook": "未命名钩子",
  "Update the example or the conditions, then run the test again.":
    "请更新示例或条件，然后再次运行测试。",
  When: "何时",
  "Your hooks": "你的钩子",
  "{0} conditions": ["", 0, " 个条件"],
  "{0} copy": ["", 0, " 的副本"],
  "{0} enabled": ["", 0, " 个已启用"],
  "Inherited environment variables": "继承的环境变量",
  "One variable name per line. Only these extra variables are passed from the app environment.":
    "每行一个变量名称。仅从应用环境传递这些额外变量。",
  "Before each run in this session.": "在此会话的每次运行之前。",
  "Before a user message reaches the model.": "在用户消息发送给模型之前。",
  "Before a tool runs. A denial prevents execution.": "在工具运行之前。拒绝决定会阻止执行。",
  "After a tool returns, including failed calls.": "在工具返回结果之后，包括失败的调用。",
  "After a run completes, except cancellation or error.": "在运行完成后，取消或错误除外。",
  "After each run, including cancellation or error.": "在每次运行后，包括取消或错误。",
  "Before enforcing a tool permission decision. A hook can deny but cannot grant access.":
    "在执行工具权限决定之前。钩子可以拒绝，但无法授予访问权限。",
  "After a summary is generated, before it replaces context.": "在生成摘要后、替换上下文之前。",
  "When the session emits a notification.": "在会话发出通知时。",
  "When a subagent starts or finishes. Only the start can be blocked.":
    "在子代理启动或结束时。只能阻止启动。",
  "Before a group of tools runs. Conditions match one tool in the group.":
    "在一组工具运行之前。所有条件必须匹配组中的同一个工具。",
  "Response format": "响应格式",
  "Text output": "文本输出",
  "JSON decision and context": "JSON 决定和上下文",
  "Use ordinary scripts and formatters. Output is a log; exit code 2 can still block an action.":
    "适用于普通脚本和格式化工具。输出会记入日志；退出码 2 仍可阻止操作。",
  "Return a JSON object with decision, reason, or additionalContext. Empty output is accepted.":
    "返回包含 decision、reason 或 additionalContext 的 JSON 对象。允许空输出。",
  "Recent hook activity": "最近的钩子活动",
  "Actual hook runs in the current task, newest first. Test runs appear in the editor only.":
    "当前任务中的实际钩子运行，最新的在前。测试运行仅显示在编辑器中。",
  "No hooks have run in this task yet.": "此任务中尚未运行钩子。",
} as const;
