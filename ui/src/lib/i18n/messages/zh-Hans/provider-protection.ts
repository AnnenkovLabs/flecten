export default {
  "Connecting to API {0}": ["正在连接 API ", 0],
  "Hide keys and passwords from this API?": "是否向此 API 屏蔽密钥与密码？",
  "Without protection, the API operator could save keys and passwords from files the agent reads, or alter AI replies to prompt a harmful command.":
    "第三方 API 中继可能会记录智能体读取文件中的密钥，或篡改响应中的工具调用。",
  "What protection does": "保护如何生效",
  "AI sees placeholders instead of detected keys and passwords. The app restores real values in commands and file changes.":
    "在请求发出前将检测到的密钥与令牌替换为占位符，并在本地修改文件和执行命令时还原真实值。",
  "The agent asks for your approval before running commands, changing files or visiting websites.":
    "执行命令、修改文件或访问网站前，代理会先征求您的许可。",
  "Applies only to this API. You can turn it off later in its Advanced tab.":
    "仅对此提供商生效，随时可在其“高级”标签页中更改。",
  "Why this warning?": "为什么出现此提醒？",
  "This API appears to use {0}, software for relaying AI requests. This does not prove its operator is malicious.":
    ["此端点匹配 ", 0, " API 中继网关特征。使用中继不代表存在恶意，但运营方可见请求内容。"],
  "The access key for this API is still sent to its operator. Protection only hides secrets it can recognize.":
    "此 API 自身的访问密钥仍会发送用于鉴权；屏蔽仅覆盖可识别格式的敏感凭据。",
  "Continue without protection": "不启用保护并继续",
  "Enable protection": "启用保护",
  "Provider protection": "密钥和密码保护",
  "Hide keys and passwords from this API": "向此 API 屏蔽密钥与密码",
  "Hides detected secrets from AI. The agent asks for your approval before running commands, changing files or visiting websites.":
    "在出站请求中屏蔽检测到的密钥，并在修改文件、运行命令或访问网页前要求确认。",
} as const;
