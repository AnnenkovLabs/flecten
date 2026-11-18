export default {
  "Main model": "主模型",
  "Default main model": "默认主模型",
  "Used when Talker and Worker is off, and as the fallback for role defaults.":
    "用于单智能体对话，以及未单独指定模型的角色。",
  "Defaults apply to new chats. You can still choose a model in the message box.":
    "应用于新对话；仍可在输入框中为单个对话切换模型。",
  "Talker handles your conversation. Worker carries out tasks with tools, for any kind of work.":
    "Talker 在对话中保持即时响应，Worker 在独立会话中调用工具并修改文件。",
  "Talker model": "Talker 模型",
  "Worker model": "Worker 模型",
  "Understands requests, asks questions, and explains progress and results.":
    "理解请求、提出问题，并解释进度和结果。",
  "Executes tasks. A model selected in the message box overrides this default for that chat.":
    "负责运行工具与编辑文件；在输入框中选择其他模型时会覆盖此默认值。",
  "Use chat model": "使用对话模型",
  "Use main model": "使用主模型",
  "Subagent models": "子代理模型",
  "Choose a default for each role. Unset roles inherit the model of the agent that starts them.":
    "为每个角色选择默认模型。未设置的角色沿用启动它们的代理的模型。",
  "Use parent model": "使用父代理模型",
  Explore: "探索",
  Implement: "执行",
  Review: "审查",
  "Find information and understand the task.": "只读代码搜索与分析。",
  "Carry out a focused assignment.": "针对具体子任务的代码修改与验证。",
  "Check results and identify risks.": "审查变更差异、边界情况与潜在回归。",
  "Choose an enabled model that supports tools.": "请选择已启用且支持工具的模型。",
  "Choose a variant available for this model.": "请选择此模型可用的变体。",
  "Reasoning level": "推理级别",
  "Model default": "模型默认值",
  "Reasoning is not supported": "此模型不支持推理",
  "Select a model first": "请先选择模型",
  "Changing reasoning selects the inherited model for this role.":
    "更改推理级别会将继承的模型设为此角色的专用模型。",
  "Default: no reasoning": "默认：不推理",
  "Reasoning is set by the model variant.": "推理级别由模型变体设定。",
} as const;
