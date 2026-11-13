export default {
  "Module request queue is full. Wait for a pending request to finish.":
    "模块请求队列已满。请等待待处理请求完成。",
  "Project service": "项目服务",
  "Native module code runs with the permissions of the agent process.":
    "模块的原生代码以代理进程的权限运行。",
  "Project services start when this module and project are trusted.":
    "信任模块和项目后，项目服务将启动。",
  "Session services start when the agent activates this module.":
    "代理激活模块时，会话服务将启动。",
  "Use module interface": "使用模块界面",
  "Stop using module interface": "停用模块界面",
  "Resume module interfaces": "恢复模块界面",
  "Restore native interface": "恢复原生界面",
  "Interface changes can replace the entire app. Ctrl+Shift+F12 restores the native interface.":
    "模块可以替换整个应用界面。按 Ctrl+Shift+F12 恢复原生界面。",

  Modules: "模块",
  "Module folder": "模块文件夹",
  "On demand": "按需启用",
  "Could not load modules": "无法加载模块",
  "Could not update module": "无法更新模块",
  "Could not load module surface": "无法打开模块界面",
  "Loading module surface…": "正在加载模块界面…",
  "The agent activates tools, instructions, hooks and workspace surfaces for the current task. Other modules stay out of context.":
    "智能体根据当前任务启用工具、指令、钩子和工作区界面。其他模块不会占用上下文。",
  "Add a package containing .flecten-module/module.json, then review and trust its version.":
    "添加包含 .flecten-module/module.json 的软件包，然后检查内容并信任该版本。",
  "Reload local changes automatically": "自动重新加载本地更改",
  "Development reload trusts future edits in this folder. Active chats apply them between agent turns.":
    "开发模式会信任此文件夹中的后续修改。活动对话将在智能体的两轮操作之间应用更改。",
  "No modules installed. Add a module folder to get started.":
    "尚未安装模块。添加模块文件夹以开始使用。",
} as const;
