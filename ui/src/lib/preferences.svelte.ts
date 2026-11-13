export interface AppPreferences {
  sendShortcut: "enter" | "modifier-enter";
  followUpBehavior: "queue" | "steer";
}

export const preferences = $state<AppPreferences>({
  sendShortcut: "enter",
  followUpBehavior: "queue",
});

let savedFollowUp: AppPreferences["followUpBehavior"] | undefined;

/** A composer override survives status refreshes until the saved default changes. */
export function applyPreferences(value: AppPreferences | undefined): void {
  preferences.sendShortcut = value?.sendShortcut ?? "enter";
  const followUp = value?.followUpBehavior ?? "queue";
  if (savedFollowUp !== followUp) preferences.followUpBehavior = followUp;
  savedFollowUp = followUp;
}
