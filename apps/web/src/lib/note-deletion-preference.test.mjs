import { afterEach, describe, expect, test } from "bun:test";
import {
  readConfirmNoteDeletionPreference,
  resolveStoredConfirmNoteDeletion,
  CONFIRM_NOTE_DELETION_CHANGED_EVENT,
  CONFIRM_NOTE_DELETION_STORAGE_KEY,
  writeConfirmNoteDeletionPreference,
} from "./note-deletion-preference.ts";

const originalWindow = globalThis.window;
const OriginalCustomEvent = globalThis.CustomEvent;

afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.CustomEvent = OriginalCustomEvent;
});

const installWindow = () => {
  const values = new Map();
  const events = [];
  globalThis.CustomEvent ??= class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
    },
    dispatchEvent: (event) => {
      events.push(event);
      return true;
    },
  };
  return { events, values };
};

describe("note deletion confirmation preference", () => {
  test("defaults to confirmation unless explicitly disabled", () => {
    expect(resolveStoredConfirmNoteDeletion(null)).toBe(true);
    expect(resolveStoredConfirmNoteDeletion("unsupported")).toBe(true);
    expect(resolveStoredConfirmNoteDeletion("false")).toBe(false);
  });

  test("persists changes and notifies the current document", () => {
    const { events, values } = installWindow();
    writeConfirmNoteDeletionPreference(false);
    expect(values.get(CONFIRM_NOTE_DELETION_STORAGE_KEY)).toBe("false");
    expect(readConfirmNoteDeletionPreference()).toBe(false);
    expect(events.map((event) => [event.type, event.detail])).toEqual([[CONFIRM_NOTE_DELETION_CHANGED_EVENT, false]]);
  });

  test("falls back to the default when storage is unavailable", () => {
    globalThis.window = { localStorage: { getItem: () => { throw new Error("blocked"); } } };
    expect(readConfirmNoteDeletionPreference()).toBe(true);
  });

  test("keeps the choice for this session when storage rejects the write", () => {
    const { events, values } = installWindow();
    values.set(CONFIRM_NOTE_DELETION_STORAGE_KEY, "true");
    globalThis.window.localStorage.setItem = () => {
      throw new Error("QuotaExceededError");
    };

    writeConfirmNoteDeletionPreference(false);
    expect(readConfirmNoteDeletionPreference()).toBe(false);
    expect(events.map((event) => event.detail)).toEqual([false]);

    // Once storage accepts writes again, the stored value takes over.
    const restored = installWindow();
    writeConfirmNoteDeletionPreference(true);
    expect(restored.values.get(CONFIRM_NOTE_DELETION_STORAGE_KEY)).toBe("true");
    restored.values.set(CONFIRM_NOTE_DELETION_STORAGE_KEY, "false");
    expect(readConfirmNoteDeletionPreference()).toBe(false);
  });
});
