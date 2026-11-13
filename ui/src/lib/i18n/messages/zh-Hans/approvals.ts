export default {
  "Trust project?": "信任此项目？",
  "Trust and continue": "信任并继续",
  "Project trusted": "已信任项目",
  "Configured modules, MCP servers and hooks can run with your account permissions.":
    "已配置的模块、MCP 服务器和钩子将能以你的账户权限运行。",
  "Read files?": "读取文件？",
  "Change files?": "修改文件？",
  "Run command?": "运行命令？",
  "Access the network?": "访问网络？",
  "Use connected tool?": "使用已连接的工具？",
  "Activate skill?": "启用技能？",
  "Allow this action?": "允许此操作？",
  "More options": "更多选项",
  "Add a note (optional)": "添加备注（可选）",
  "Only this action in this folder.": "仅允许在此文件夹中执行此完全相同的操作。",
  "Tasks in progress: {0}. Permissions apply to the next action; other settings apply to the next run.":
    ["正在执行的任务：", 0, "。权限从下一次操作起生效，其他设置从下一次运行起生效。"],
  Chat: "聊天",
  "Always ask a person": "始终询问用户",
  "These checkpoints cannot be bypassed by saved approvals or automatic review.":
    "已保存的批准和自动审查无法绕过这些人工确认。",
  "Human approval required every time": "每次都需要人工批准",
  "Allow bounded built-in actions. Review eligible calls separately; ask when uncertain.":
    "允许范围有限的内置操作。对符合条件的调用单独审查，不确定时询问用户。",
  "Ask unless this exact action was already approved.":
    "如果此完全相同的操作尚未获批，则询问用户。",
  "Allowed for this chat": "已对此聊天允许",
  "Permission changed: call denied": "权限已更改：调用被拒绝",
  "Rule could not be saved: call denied": "规则保存失败：调用被拒绝",
  "Working directory": "工作目录",
  "Affected paths": "受影响的路径",
  "Applying decision…": "正在应用决定…",
  "Expired: waiting for confirmation": "已过期：等待确认",
  "Save this exact action for this project?": "为此项目保存这一确切操作？",
  "Only identical arguments, paths and working directory will match. You can revoke this rule in Permissions.":
    "仅当所有参数、路径和工作目录完全一致时才会匹配。可在权限设置中撤销规则。",
  "For this chat": "对此聊天允许",
  "Save exact rule": "保存精确规则",
  "Remember…": "记住…",
  "Allow bounded built-in actions. Ask before arbitrary code or external tools.":
    "允许范围明确的内置操作。执行任意代码或外部工具前询问。",
  "Allows ordinary actions. Destructive rules and sandbox limits still apply.":
    "允许普通操作。破坏性操作规则和沙盒限制仍然有效。",
  "Saved rules": "已保存的规则",
  "Rules belong to this project. Removing a rule takes effect when you save, including during an active run.":
    "规则属于此项目。删除将在保存后生效，正在运行的任务也会受到影响。",
  "No saved rules.": "没有已保存的规则。",
  "All matching actions": "所有匹配的操作",
  "Exact arguments and resources": "完全一致的参数和资源",
  "Configured scope": "已配置的范围",
  "Remove rule": "删除规则",
  "Destructive actions": "不可逆操作",
  "A separate checkpoint for irreversible operations, even when ordinary actions are allowed.":
    "即使普通操作已获允许，不可逆操作仍需单独确认。",
  "Execution boundary": "执行边界",
  "Sandbox limits apply independently of permissions. External paths stay blocked while workspace isolation is enabled.":
    "沙盒限制独立于权限生效。工作目录隔离启用期间，外部路径仍被阻止。",
  "Workspace isolation enabled": "工作目录隔离已启用",
  "Workspace isolation disabled": "工作目录隔离已禁用",
  "Only the requests shown here are included. New requests remain pending.":
    "仅包含此处显示的请求。新请求将继续等待。",
  "What should the agent do instead? (optional)": "代理应该改做什么？（可选）",
  "Feedback for the agent": "给代理的反馈",
  "OS sandbox available": "系统沙盒可用",
  "OS sandbox unavailable": "系统沙盒不可用",
} as const;
