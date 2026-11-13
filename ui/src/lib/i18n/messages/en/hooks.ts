export default {
  "A deny decision always stops this action. This setting controls unexpected failures only.":
    "A deny decision always stops this action. This setting controls unexpected failures only.",
  "A name you will recognize": "A name you will recognize",
  Action: "Action",
  "Action blocked": "Action blocked",
  "Add hook": "Add hook",
  "All events": "All events",
  "Can block the action": "Can block the action",
  "Check a tool before it runs, add project context, or notify another service when work finishes. Choose an event above to create your first hook.":
    "Check a tool before it runs, add project context, or notify another service when work finishes. Choose an event above to create your first hook.",
  Conditions: "Conditions",
  "Conditions did not match": "Conditions did not match",
  "Connect your workflow": "Connect your workflow",
  "Context added": "Context added",
  "Continue without waiting. This hook cannot block an action or add context to the current step.":
    "Continue without waiting. This hook cannot block an action or add context to the current step.",
  Duplicate: "Duplicate",
  "Enable hook {0}": ["Enable hook ", 0, ""],
  "Enter the full hook URL.": "Enter the full hook URL.",
  "Every occurrence": "Every occurrence",
  "Example command": "Example command",
  "Example message": "Example message",
  "Example path": "Example path",
  Execution: "Execution",
  Hook: "Hook",
  "Hook failed": "Hook failed",
  "Hook passed": "Hook passed",
  "Hook timeout must be between 0.1 and 60 seconds.":
    "Hook timeout must be between 0.1 and 60 seconds.",
  "Hooks run from top to bottom within each event. A blocking decision stops the remaining hooks.":
    "Hooks run from top to bottom within each event. A blocking decision stops the remaining hooks.",
  "Move down": "Move down",
  "Move up": "Move up",
  "Observes only": "Observes only",
  "Only run when every filled condition matches. Paths are relative to the project folder; an empty field matches everything.":
    "Only run when every filled condition matches. Paths are relative to the project folder; an empty field matches everything.",
  "Run a command": "Run a command",
  "Run test": "Run test",
  "Run your scripts or send an HTTP request when the agent reaches an event.":
    "Run your scripts or send an HTTP request when the agent reaches an event.",
  "Runs in the project folder. Event data arrives as JSON on stdin. Exit 0 succeeds; exit 2 denies a blocking event.":
    "Runs in the project folder. Event data arrives as JSON on stdin. Exit 0 succeeds; exit 2 denies a blocking event.",
  "Send an HTTP request": "Send an HTTP request",
  "Sends a POST request containing the event data. Your endpoint can return a decision and additional context.":
    "Sends a POST request containing the event data. Your endpoint can return a decision and additional context.",
  "Stop the action if the hook crashes, times out, or returns an invalid response.":
    "Stop the action if the hook crashes, times out, or returns an invalid response.",
  Success: "Success",
  "Test hook": "Test hook",
  "Test this draft without saving. The command or HTTP request really runs using the example below, even if the hook is disabled.":
    "Test this draft without saving. The command or HTTP request really runs using the example below, even if the hook is disabled.",
  "The hook changed after this test. Run it again to check the current draft.":
    "The hook changed after this test. Run it again to check the current draft.",
  "This event has reached its limit of {0} hooks.": [
    "This event has reached its limit of ",
    0,
    " hooks.",
  ],
  "This event observes an action that already happened. A deny decision has no effect.":
    "This event observes an action that already happened. A deny decision has no effect.",
  "Timeout, seconds": "Timeout, seconds",
  "Tool name": "Tool name",
  "Tool result": "Tool result",
  "Untitled hook": "Untitled hook",
  "Update the example or the conditions, then run the test again.":
    "Update the example or the conditions, then run the test again.",
  When: "When",
  "Your hooks": "Your hooks",
  "{0} conditions": ["", 0, " conditions"],
  "{0} copy": ["", 0, " copy"],
  "{0} enabled": ["", 0, " enabled"],
  "Inherited environment variables": "Inherited environment variables",
  "One variable name per line. Only these extra variables are passed from the app environment.":
    "One variable name per line. Only these extra variables are passed from the app environment.",
  "Before each run in this session.": "Before each run in this session.",
  "Before a user message reaches the model.": "Before a user message reaches the model.",
  "Before a tool runs. A denial prevents execution.":
    "Before a tool runs. A denial prevents execution.",
  "After a tool returns, including failed calls.": "After a tool returns, including failed calls.",
  "After a run completes, except cancellation or error.":
    "After a run completes, except cancellation or error.",
  "After each run, including cancellation or error.":
    "After each run, including cancellation or error.",
  "Before enforcing a tool permission decision. A hook can deny but cannot grant access.":
    "Before enforcing a tool permission decision. A hook can deny but cannot grant access.",
  "After a summary is generated, before it replaces context.":
    "After a summary is generated, before it replaces context.",
  "When the session emits a notification.": "When the session emits a notification.",
  "When a subagent starts or finishes. Only the start can be blocked.":
    "When a subagent starts or finishes. Only the start can be blocked.",
  "Before a group of tools runs. Conditions match one tool in the group.":
    "Before a group of tools runs. Conditions match one tool in the group.",
  "Response format": "Response format",
  "Text output": "Text output",
  "JSON decision and context": "JSON decision and context",
  "Use ordinary scripts and formatters. Output is a log; exit code 2 can still block an action.":
    "Use ordinary scripts and formatters. Output is a log; exit code 2 can still block an action.",
  "Return a JSON object with decision, reason, or additionalContext. Empty output is accepted.":
    "Return a JSON object with decision, reason, or additionalContext. Empty output is accepted.",
  "Recent hook activity": "Recent hook activity",
  "Actual hook runs in the current task, newest first. Test runs appear in the editor only.":
    "Actual hook runs in the current task, newest first. Test runs appear in the editor only.",
  "No hooks have run in this task yet.": "No hooks have run in this task yet.",
} as const;
