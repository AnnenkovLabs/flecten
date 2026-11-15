// Plain interface copy. Keep runtime values as numeric parts.
export default {
  "Refresh models every hour": "每小时更新模型",
  "Update all models and their capabilities while the app is open. Manual edits are kept by default.":
    "应用打开时，更新所有模型及其能力。默认保留手动修改。",
  "Overwrite manual model edits": "覆盖模型的手动修改",
  "Allow automatic updates to replace model details you changed manually.":
    "允许自动更新替换你手动修改的模型信息。",
  "Refresh model details": "更新模型信息",
  "Unknown limits stay blank. Enter them manually if needed.":
    "未知的限制将留空。如有需要，请手动填写。",
  "Model to test": "测试模型",
  "Test connection": "测试连接",
  "Fix the API address.": "请修正 API 地址。",
  "Testing text output from the model{0}. The draft will not be saved.": [
    "正在测试模型",
    0,
    "的文本功能。草稿不会保存。",
  ],
  "Text: response received": "文本：已收到回复",
  "Connection error": "连接错误",
  "· {0} ms": ["· ", 0, " 毫秒"],
  "{0}Tools were not tested.": [0, "未测试工具。"],
  "Replay, reasoning, cache, strict tools.": "回放、推理、缓存、严格工具调用。",
  "Preserve reasoning (Qwen)": "保留推理内容（Qwen）",
  available: "支持",
  visible: "可见",
} as const;
