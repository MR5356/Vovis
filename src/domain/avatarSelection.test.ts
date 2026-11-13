import { describe, expect, it } from "vitest";
import {
  availableBuiltinAvatars,
  avatarName,
  avatarSettingsSchema,
  builtinAvatars,
  defaultAvatarSettings,
  resolveAvatarId,
} from "./avatar";

describe("available presenter selection", () => {
  it("defaults to the assistant and keeps the two hidden built-ins in the asset catalog", () => {
    expect(defaultAvatarSettings.selected).toBe("assistant");
    expect(avatarSettingsSchema.parse({}).selected).toBe("assistant");
    expect(availableBuiltinAvatars.map(({ id }) => id)).toEqual(["assistant"]);
    expect(builtinAvatars.map(({ id }) => id)).toEqual([
      "lecturer",
      "engineer",
      "assistant",
    ]);
  });

  it.each(["lecturer", "engineer"])(
    "migrates stored %s selection without changing other settings",
    (selected) => {
      const stored = {
        enabled: true,
        selected,
        position: "left",
        size: 34,
        imports: [
          { id: "84605b9a-9e74-4304-bad6-6257f59a816c", name: "My model" },
        ],
      };
      const migrated = avatarSettingsSchema.parse(
        JSON.parse(JSON.stringify(stored)),
      );
      expect(migrated).toEqual({ ...stored, selected: "assistant" });
      expect(avatarSettingsSchema.parse(migrated)).toEqual(migrated);
      // Presentation messages from an already-open older window can skip schema parsing.
      expect(resolveAvatarId(selected)).toBe("assistant");
      expect(avatarName(selected, migrated)).toBe("科技助手");
    },
  );

  it("preserves local imported IDs and names even when the name matches a hidden built-in", () => {
    const id = "84605b9a-9e74-4304-bad6-6257f59a816c";
    const settings = avatarSettingsSchema.parse({
      selected: id,
      imports: [{ id, name: "知性讲师" }],
    });
    expect(settings.selected).toBe(id);
    expect(resolveAvatarId(id)).toBe(id);
    expect(avatarName(id, settings)).toBe("知性讲师");
    expect(resolveAvatarId("assistant")).toBe("assistant");
  });
});
