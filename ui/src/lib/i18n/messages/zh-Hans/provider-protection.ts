export default {
  "Connecting to API {0}": ["连接到 API ", 0],
  "Hide keys and passwords from this API?": "对该 API 隐藏密钥和密码？",
  "Without protection, the API operator could save keys and passwords from files the agent reads, or alter AI replies to prompt a harmful command.":
    "如果不启用保护，API 运营者可能保存代理所读取文件中的密钥和密码，或篡改 AI 的回复，诱导代理执行危险命令。",
  "What protection does": "保护如何生效",
  "AI sees placeholders instead of detected keys and passwords. The app restores real values in commands and file changes.":
    "AI 看到的是占位标记，而不是检测到的密钥和密码。应用会在执行命令和修改文件时还原真实值。",
  "The agent asks for your approval before running commands, changing files or visiting websites.":
    "执行命令、修改文件或访问网站前，代理会先征求您的许可。",
  "Applies only to this API. You can turn it off later in its Advanced tab.":
    "仅适用于此 API。稍后可在其“高级”选项卡中关闭保护。",
  "Why this warning?": "为什么出现此提醒？",
  "This API appears to use {0}, software for relaying AI requests. This does not prove its operator is malicious.":
    ["此 API 似乎使用了 ", 0, "，这是一种用于转发 AI 请求的软件。这并不能证明其运营者有恶意。"],
  "The access key for this API is still sent to its operator. Protection only hides secrets it can recognize.":
    "访问此 API 所用的密钥仍会发送给运营者。保护功能只能隐藏它能够识别的敏感信息。",
  "Continue without protection": "不启用保护并继续",
  "Enable protection": "启用保护",
  "Provider protection": "密钥和密码保护",
  "Hide keys and passwords from this API": "对该 API 隐藏密钥和密码",
  "Hides detected secrets from AI. The agent asks for your approval before running commands, changing files or visiting websites.":
    "向 AI 隐藏检测到的敏感信息。执行命令、修改文件或访问网站前，代理会先征求您的许可。",
} as const;
