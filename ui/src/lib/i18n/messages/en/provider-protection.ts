export default {
  "Connecting to API {0}": ["Connecting to API ", 0],
  "Hide keys and passwords from this API?": "Mask secrets sent to this API?",
  "Without protection, the API operator could save keys and passwords from files the agent reads, or alter AI replies to prompt a harmful command.":
    "Third-party API relays can log secrets from files the agent reads or tamper with tool calls in responses.",
  "What protection does": "What protection does",
  "Applies only to this API. You can turn it off later in its Advanced tab.":
    "Applies only to this provider. Change anytime in its Advanced tab.",
  "Why this warning?": "Why this warning?",
  "This API appears to use {0}, software for relaying AI requests. This does not prove its operator is malicious.":
    [
      "This endpoint matches ",
      0,
      ", an LLM API relay gateway. A relay is not necessarily malicious, but its operator can inspect traffic.",
    ],
  "The access key for this API is still sent to its operator. Protection only hides secrets it can recognize.":
    "This provider's own API key is still sent to authenticate requests. Masking covers recognized secret formats only.",
  "Continue without protection": "Continue without protection",
  "Enable protection": "Enable protection",
  "Provider protection": "Provider protection",
  "Hide keys and passwords from this API": "Mask secrets sent to this API",
  "AI sees placeholders instead of detected keys and passwords. The app restores real values in commands and file changes.":
    "Replaces detected keys and tokens with placeholders before requests leave your machine, then restores real values locally in edits and commands.",
  "The agent asks for your approval before running commands, changing files or visiting websites.":
    "The agent asks for your approval before running commands, changing files or visiting websites.",
  "Hides detected secrets from AI. The agent asks for your approval before running commands, changing files or visiting websites.":
    "Masks detected secrets in outbound requests and requires approval before edits, commands, or web fetches.",
} as const;
