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
  "Tasks in progress: {0}. Permissions apply to the next action; other settings apply to the next run.":
    ["正在执行的任务：", 0, "。权限从下一次操作起生效，其他设置从下一次运行起生效。"],
  Chat: "聊天",
  "Human approval required every time": "每次都需要人工批准",
  "Allow bounded built-in actions. Review eligible calls separately; ask when uncertain.":
    "自动允许安全的项目内操作；对存疑命令进行审查并在不确定时询问。",
  "Ask unless this exact action was already approved.":
    "如果此完全相同的操作尚未获批，则询问用户。",
  "Allowed for this chat": "已对此聊天允许",
  "Permission changed: call denied": "权限已更改：调用被拒绝",
  "Rule could not be saved: call denied": "规则保存失败：调用被拒绝",
  "Working directory": "工作目录",
  "Affected paths": "受影响的路径",
  "Applying decision…": "正在应用决定…",
  "Expired: waiting for confirmation": "已过期：等待确认",
  "Only identical arguments, paths and working directory will match. You can revoke this rule in Access settings.":
    "仅当所有参数、路径和工作目录完全一致时才会匹配。可在权限设置中撤销规则。",
  "For this chat": "对此聊天允许",
  "Save exact rule": "保存精确规则",
  "Remember…": "记住…",
  "Saved rules": "已保存的规则",
  "Rules are saved globally. Removing a rule takes effect when you save, including during an active run.":
    "规则全局保存。删除规则在保存后立即生效，包括正在运行的任务。",
  "All matching actions": "所有匹配的操作",
  "Exact arguments and resources": "完全一致的参数和资源",
  "Remove rule": "删除规则",
  "Destructive actions": "不可逆操作",
  "Irreversible operations like force push or deleting outside the project.":
    "如强制推送或删除项目外文件等不可逆操作。",
  "Only the requests shown here are included. New requests remain pending.":
    "仅包含此处显示的请求。新请求将继续等待。",
  "Feedback for the agent": "给代理的反馈",
  "OS sandbox available": "系统沙盒可用",
  "OS sandbox unavailable": "系统沙盒不可用",
  Access: "访问权限",
  "Access mode": "访问模式",
  Agent: "智能体",
  "Confirm changes": "确认更改",
  "Custom access": "自定义访问",
  "Reads, edits and runs commands in the project. Asks before accessing another folder or destructive actions.":
    "在项目中读取、编辑并运行命令。访问其他文件夹或执行不可逆操作前会请求确认。",
  "Reads freely. Asks before changes, commands and connected tools.":
    "读取无需确认。更改、命令和已连接工具的调用需要确认。",
  "Works across your computer without routine approvals. Process isolation is off.":
    "可在整个计算机上工作，无需常规授权确认。进程隔离已关闭。",
  "Advanced settings differ from these modes.": "高级设置与这些模式不同。",
  "Saved rules still apply in every mode.": "已保存的规则仍在所有模式中生效。",
  "Advanced access settings": "高级访问设置",
  "Action permissions": "各操作权限",
  "Process isolation": "进程隔离",
  "Isolate processes": "隔离进程",
  "Limit commands to the project and approved folders.": "将命令限制在项目和已授权文件夹内。",
  "Allow network in isolated commands": "允许隔离命令访问网络",
  "Allow shell commands inside the sandbox to reach websites and external services.":
    "允许沙盒内的 Shell 命令访问网站和外部服务。",
  "Allow folder access?": "允许访问文件夹？",
  "Folder access covers the displayed paths and their subfolders.":
    "访问权限涵盖显示的路径及其子文件夹。",
  "Access is shared with agents in this chat.": "访问权限与此聊天中的智能体共享。",
  "Repeat this action in this chat": "在此对话中允许",
  "Remember folder access": "记住文件夹访问权限",
} as const;
