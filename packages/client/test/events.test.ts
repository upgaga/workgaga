import { describe, expect, it } from "vitest";
import { WINDOW_EVENTS, type WindowEventName } from "../src/constants/events";

describe("window events", () => {
  it("exposes the metadata panel toggle event", () => {
    const eventName: WindowEventName = WINDOW_EVENTS.TOGGLE_METADATA_PANEL;

    expect(eventName).toBe("cherry:toggle-metadata-panel");
  });
});
