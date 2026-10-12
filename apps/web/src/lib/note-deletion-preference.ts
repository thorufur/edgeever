import { useSyncExternalStore } from "react";

export const CONFIRM_NOTE_DELETION_STORAGE_KEY = "edgeever.confirmNoteDeletion";

export const CONFIRM_NOTE_DELETION_CHANGED_EVENT = "edgeever:confirm-note-deletion-changed";

// Ask before moving notes to Trash unless explicitly disabled.
export const resolveStoredConfirmNoteDeletion = (stored: string | null): boolean =>
  stored !== "false";

// Holds the choice while localStorage rejects writes, so the toggle still works
// for the rest of this page session.
let unsavedPreference: boolean | null = null;

export const readConfirmNoteDeletionPreference = (): boolean => {
  if (typeof window === "undefined") return true;
  if (unsavedPreference !== null) return unsavedPreference;
  try {
    return resolveStoredConfirmNoteDeletion(
      window.localStorage?.getItem(CONFIRM_NOTE_DELETION_STORAGE_KEY) ?? null,
    );
  } catch {
    return true;
  }
};

export const writeConfirmNoteDeletionPreference = (enabled: boolean) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(CONFIRM_NOTE_DELETION_STORAGE_KEY, enabled ? "true" : "false");
    unsavedPreference = null;
  } catch {
    // Private mode / blocked storage — keep the choice in memory for this session.
    unsavedPreference = enabled;
  }
  window.dispatchEvent(
    new CustomEvent(CONFIRM_NOTE_DELETION_CHANGED_EVENT, { detail: enabled }),
  );
};

const subscribe = (onChange: () => void) => {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === CONFIRM_NOTE_DELETION_STORAGE_KEY) onChange();
  };
  window.addEventListener(CONFIRM_NOTE_DELETION_CHANGED_EVENT, onChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(CONFIRM_NOTE_DELETION_CHANGED_EVENT, onChange);
    window.removeEventListener("storage", handleStorage);
  };
};

export const useConfirmNoteDeletionPreference = () =>
  useSyncExternalStore(subscribe, readConfirmNoteDeletionPreference, () => true);
