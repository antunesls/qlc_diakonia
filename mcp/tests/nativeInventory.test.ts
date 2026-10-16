import { describe, expect, it } from "vitest";
import {
  exactNativeCaptionKey,
  normalizeNativeCaption,
  parseNativeProjectInventory,
} from "../src/qlc/nativeInventory.js";

describe("QLC+ native project inventory", () => {
  it("discovers nested buttons, sliders, actions, ranges and frame ownership", async () => {
    const inventory = await parseNativeProjectInventory(
      Buffer.from(`<!DOCTYPE Workspace>
      <Workspace><VirtualConsole><Frame ID="1" Caption="Scenes">
        <SoloFrame ID="2" Caption="Exclusive">
          <Button ID="71" Caption="Été-chaud"><Function ID="42"/><Action>Toggle</Action></Button>
        </SoloFrame>
        <Slider ID="72" Caption="Master" WidgetStyle="Fader">
          <SliderMode>Playback</SliderMode><Level LowLimit="10" HighLimit="210"/>
          <Adjust Function="43"/>
        </Slider>
      </Frame></VirtualConsole></Workspace>`),
    );
    expect(inventory.widgets).toHaveLength(2);
    expect(inventory.buttons.get(exactNativeCaptionKey("Été-chaud"))).toMatchObject({
      id: 71,
      actionType: "toggle",
      functionId: 42,
      parentFrameKind: "soloframe",
      parentFrameId: 2,
      framePath: ["Scenes", "Exclusive"],
    });
    expect(inventory.sliders.get("master")).toMatchObject({
      id: 72,
      low: 10,
      high: 210,
      sliderMode: "playback",
      functionId: 43,
      parentFrameKind: "frame",
    });
  });

  it("keeps spaces and separators significant for runtime identity", async () => {
    const inventory = await parseNativeProjectInventory(
      Buffer.from(
        `<Workspace><VirtualConsole>
          <Button ID="1" Caption="blue speed"/>
          <Button ID="2" Caption="blue_speed"/>
          <Button ID="3" Caption="bluespeed"/>
        </VirtualConsole></Workspace>`,
      ),
    );

    expect(inventory.buttons.get("blue speed")?.id).toBe(1);
    expect(inventory.buttons.get("blue_speed")?.id).toBe(2);
    expect(inventory.buttons.get("bluespeed")?.id).toBe(3);
    expect(inventory.buttons.size).toBe(3);
    expect(exactNativeCaptionKey("Blue Speed")).toBe("blue speed");
  });

  it("retains loose normalization only as diagnostic metadata", () => {
    expect(normalizeNativeCaption("  ÉTÉ_chaud-test ")).toBe("etechaudtest");
  });

  it("rejects case-only collisions, unsafe XML and invalid ranges", async () => {
    await expect(
      parseNativeProjectInventory(
        Buffer.from(
          `<Workspace><VirtualConsole><Button ID="1" Caption="Blue Speed"/><Button ID="2" Caption="blue speed"/></VirtualConsole></Workspace>`,
        ),
      ),
    ).rejects.toThrow(/Duplicate/);
    await expect(
      parseNativeProjectInventory(
        Buffer.from(
          `<Workspace><VirtualConsole><Button ID="1" Caption="Master"/><Slider ID="2" Caption="master"/></VirtualConsole></Workspace>`,
        ),
      ),
    ).rejects.toThrow(/Duplicate/);
    await expect(
      parseNativeProjectInventory(
        Buffer.from(
          `<!DOCTYPE Workspace [<!ENTITY x "bad">]><Workspace>&x;</Workspace>`,
        ),
      ),
    ).rejects.toThrow(/entities|DTD/);
    await expect(
      parseNativeProjectInventory(
        Buffer.from(
          `<Workspace><VirtualConsole><Slider ID="1" Caption="Bad"><Level LowLimit="5" HighLimit="5"/></Slider></VirtualConsole></Workspace>`,
        ),
      ),
    ).rejects.toThrow(/range/);
  });

  it("ignores button-shaped elements outside VirtualConsole", async () => {
    const inventory = await parseNativeProjectInventory(
      Buffer.from(
        `<Workspace><Engine><Button ID="1" Caption="Wrong"/></Engine><VirtualConsole><Button ID="2" Caption="Right"/></VirtualConsole></Workspace>`,
      ),
    );
    expect(inventory.buttons.has("wrong")).toBe(false);
    expect(inventory.buttons.get("right")?.id).toBe(2);
  });
});
