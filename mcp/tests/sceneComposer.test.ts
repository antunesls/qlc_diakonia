import { describe, expect, it } from "vitest";
import { parseFixtureDefinition } from "../src/qlc/fixtureLibrary.js";
import { parseColor } from "../src/qlc/color.js";
import { composeFixtureValues } from "../src/qlc/sceneComposer.js";

const RGBW_PAR = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE FixtureDefinition>
<FixtureDefinition xmlns="http://www.qlcplus.org/FixtureDefinition">
 <Manufacturer>Test</Manufacturer>
 <Model>RGBW Par</Model>
 <Type>Color Changer</Type>
 <Channel Name="Dimmer" Preset="IntensityMasterDimmer"/>
 <Channel Name="Red" Preset="IntensityRed"/>
 <Channel Name="Green" Preset="IntensityGreen"/>
 <Channel Name="Blue" Preset="IntensityBlue"/>
 <Channel Name="White" Preset="IntensityWhite"/>
 <Channel Name="Strobe">
  <Group Byte="0">Shutter</Group>
  <Capability Min="0" Max="9" Preset="ShutterOpen">Open</Capability>
  <Capability Min="10" Max="255" Preset="StrobeSlowToFast">Strobe slow to fast</Capability>
 </Channel>
 <Mode Name="6 Channel">
  <Channel Number="0">Dimmer</Channel>
  <Channel Number="1">Red</Channel>
  <Channel Number="2">Green</Channel>
  <Channel Number="3">Blue</Channel>
  <Channel Number="4">White</Channel>
  <Channel Number="5">Strobe</Channel>
 </Mode>
</FixtureDefinition>`;

const MOVING_HEAD = `<FixtureDefinition xmlns="http://www.qlcplus.org/FixtureDefinition">
 <Manufacturer>Test</Manufacturer>
 <Model>Spot</Model>
 <Type>Moving Head</Type>
 <Channel Name="Pan" Preset="PositionPan"/>
 <Channel Name="Pan fine" Preset="PositionPanFine"/>
 <Channel Name="Tilt" Preset="PositionTilt"/>
 <Channel Name="Color">
  <Group Byte="0">Colour</Group>
  <Capability Min="0" Max="15" Preset="ColorMacro" Res1="#ffffff">White</Capability>
  <Capability Min="16" Max="31" Preset="ColorMacro" Res1="#ff0000">Red</Capability>
  <Capability Min="32" Max="47" Preset="ColorMacro" Res1="#0000ff">Blue</Capability>
 </Channel>
 <Channel Name="Gobo">
  <Group Byte="0">Gobo</Group>
  <Capability Min="0" Max="9">Open</Capability>
  <Capability Min="10" Max="19">Star</Capability>
 </Channel>
 <Channel Name="Intensity">
  <Group Byte="0">Intensity</Group>
 </Channel>
 <Mode Name="Standard">
  <Channel Number="0">Pan</Channel>
  <Channel Number="1">Pan fine</Channel>
  <Channel Number="2">Tilt</Channel>
  <Channel Number="3">Color</Channel>
  <Channel Number="4">Gobo</Channel>
  <Channel Number="5">Intensity</Channel>
 </Mode>
</FixtureDefinition>`;

describe("fixture definitions and looks", () => {
  it("classifies channels from presets and legacy groups", async () => {
    const spot = await parseFixtureDefinition(MOVING_HEAD);
    expect(spot.modes[0].channels.map((c) => [c.role, c.fine])).toEqual([
      ["pan", false],
      ["pan", true],
      ["tilt", false],
      ["color_wheel", false],
      ["gobo", false],
      ["dimmer", false],
    ]);
  });

  it("turns a color look into RGB values and opens the shutter", async () => {
    const par = await parseFixtureDefinition(RGBW_PAR);
    const { values, warnings } = composeFixtureValues(par.modes[0], { color: "orange", dimmer: 50 });
    expect(warnings).toEqual([]);
    expect(values).toEqual([
      { channel: 0, value: 128 },
      { channel: 1, value: 255 },
      { channel: 2, value: 128 },
      { channel: 3, value: 0 },
      { channel: 5, value: 0 },
    ]);
  });

  it("maps strobe speed into the strobe range and raw channels win", async () => {
    const par = await parseFixtureDefinition(RGBW_PAR);
    const { values } = composeFixtureValues(par.modes[0], { dimmer: 100, strobe: 100, channels: { White: 77, "1": 3 } });
    expect(values).toContainEqual({ channel: 5, value: 255 });
    expect(values).toContainEqual({ channel: 4, value: 77 });
    expect(values).toContainEqual({ channel: 1, value: 3 });
  });

  it("picks the nearest color wheel slot, positions with 16 bit precision and finds gobos", async () => {
    const spot = await parseFixtureDefinition(MOVING_HEAD);
    const { values, warnings } = composeFixtureValues(spot.modes[0], {
      color: "#e01010",
      pan: 50,
      tilt: 100,
      gobo: "star",
    });
    expect(warnings).toEqual([]);
    expect(values).toEqual([
      { channel: 0, value: 128 },
      { channel: 1, value: 0 },
      { channel: 2, value: 255 },
      { channel: 3, value: 24 },
      { channel: 4, value: 10 },
      { channel: 5, value: 255 },
    ]);
  });

  it("parses colors in several notations", () => {
    expect(parseColor("#f00")).toBe(0xffff0000);
    expect(parseColor("rgb(0, 128, 255)")).toBe(0xff0080ff);
    expect(parseColor("Azul")).toBe(0xff0000ff);
    expect(parseColor("âmbar")).toBe(0xffffbf00);
    expect(() => parseColor("not a color")).toThrow(/Unrecognized/);
  });
});
