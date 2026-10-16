import { describe, expect, it } from "vitest";
import { parseProjectModel } from "../src/qlc/projectModel.js";
import { layoutWidgets } from "../src/qlc/vcLayout.js";
import { fixtureGroupXml, fixtureXml } from "../src/qlc/xml/engine.js";
import {
  chaserXml,
  collectionXml,
  efxXml,
  rgbMatrixXml,
  sceneXml,
  scriptXml,
  sequenceStepValues,
  sequenceXml,
  showXml,
} from "../src/qlc/xml/functions.js";
import { widgetXml } from "../src/qlc/xml/vc.js";
import { escapeXml, renderXml, type XmlNode } from "../src/qlc/xml/xmlWriter.js";

function workspace(engine: XmlNode[], widgets: XmlNode[] = []): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE Workspace>
<Workspace xmlns="http://www.qlcplus.org/Workspace">
<Engine>${engine.map((n) => renderXml(n)).join("\n")}</Engine>
<VirtualConsole><Frame Caption="Main" ID="0">${widgets.map((n) => renderXml(n)).join("\n")}</Frame></VirtualConsole>
</Workspace>`;
}

describe("XML fragment builders", () => {
  it("escapes agent-provided text and drops XML-invalid characters", () => {
    expect(escapeXml(`a<b>&"c'\u0001`)).toBe("a&lt;b&gt;&amp;&quot;c&apos;");
    const xml = renderXml(sceneXml({ id: 1, name: `R&B "Wash" <1>`, fixtures: [] }));
    expect(xml).toContain('Name="R&amp;B &quot;Wash&quot; &lt;1&gt;"');
  });

  it("round-trips engine objects through the project parser", async () => {
    const model = await parseProjectModel(
      workspace([
        fixtureXml({ id: 3, name: "PAR 1", manufacturer: "Generic", model: "Generic RGB", mode: "RGB", universe: 0, address: 9, channels: 3 }),
        fixtureGroupXml({ id: 2, name: "Pars", width: 2, height: 1, heads: [{ fixtureId: 3, head: 0, x: 0, y: 0 }, { fixtureId: 4, head: 0, x: 1, y: 0 }] }),
        sceneXml({ id: 10, name: "Red", speed: { fadeIn: 500 }, fixtures: [{ fixtureId: 3, values: [{ channel: 1, value: 0 }, { channel: 0, value: 300 }] }, { fixtureId: 4, values: [] }] }),
        chaserXml({ id: 11, name: "Chase", runOrder: "PingPong", steps: [{ functionId: 10, hold: 1000 }, { functionId: 12, fadeIn: 200, note: "two" }] }),
        collectionXml({ id: 12, name: "Both", functionIds: [10, 11] }),
        sequenceXml({ id: 13, name: "Seq", boundSceneId: 10, boundSceneChannelCount: 3, steps: [{ hold: 500, values: [{ fixtureId: 3, channel: 0, value: 255 }, { fixtureId: 3, channel: 2, value: 0 }] }] }),
        efxXml({ id: 14, name: "Circle", algorithm: "Circle", fixtures: [{ fixtureId: 3 }] }),
        rgbMatrixXml({ id: 15, name: "Waves", fixtureGroupId: 2, algorithm: "Waves", colors: [0xffff0000] }),
        showXml({ id: 16, name: "Show", tracks: [{ id: 0, name: "T1", items: [{ functionId: 10, startTime: 0, duration: 2000 }, { functionId: 11, startTime: 2000 }] }] }),
        scriptXml({ id: 17, name: "Script", lines: ["startfunction:10", "wait:1s"] }),
      ]),
    );

    expect(model.fixtures[0]).toEqual({ id: 3, name: "PAR 1", manufacturer: "Generic", model: "Generic RGB", mode: "RGB", universe: 0, address: 9, channels: 3 });
    expect(model.fixtureGroups[0]).toMatchObject({ id: 2, width: 2, height: 1, heads: [{ fixtureId: 3 }, { fixtureId: 4 }] });
    const fn = (id: number) => model.functions.find((f) => f.id === id)!;
    expect(fn(10)).toMatchObject({ type: "Scene", speed: { fadeIn: 500, fadeOut: 0, duration: 0 }, sceneFixtures: [3, 4] });
    // values are sorted by channel and clamped to DMX range
    expect(fn(10).values).toEqual([{ fixtureId: 3, channel: 0, value: 255 }, { fixtureId: 3, channel: 1, value: 0 }]);
    expect(fn(11)).toMatchObject({ type: "Chaser", runOrder: "PingPong", steps: [{ functionId: 10, hold: 1000 }, { functionId: 12, fadeIn: 200, note: "two" }] });
    expect(fn(12).functionIds).toEqual([10, 11]);
    expect(fn(13)).toMatchObject({ boundSceneId: 10, steps: [{ hold: 500, values: [{ fixtureId: 3, channel: 0, value: 255 }] }] });
    expect(fn(14)).toMatchObject({ algorithm: "Circle", efxFixtures: [{ fixtureId: 3, head: 0, mode: 0 }] });
    expect(fn(15)).toMatchObject({ algorithm: "Waves", fixtureGroupId: 2, colors: [0xffff0000] });
    expect(fn(16).tracks?.[0].items).toEqual([
      { uid: 0, functionId: 10, startTime: 0, duration: 2000 },
      { uid: 1, functionId: 11, startTime: 2000, duration: undefined },
    ]);
    expect(fn(17).lines).toEqual(["startfunction:10", "wait:1s"]);
  });

  it("writes sequence steps in the fixtureID:ch,val syntax, skipping zeros", () => {
    expect(
      sequenceStepValues([
        { fixtureId: 2, channel: 1, value: 10 },
        { fixtureId: 1, channel: 4, value: 0 },
        { fixtureId: 1, channel: 0, value: 255 },
        { fixtureId: 2, channel: 0, value: 20 },
      ]),
    ).toBe("1:0,255:2:0,20,1,10");
  });

  it("lays out and serializes a Virtual Console tree", async () => {
    const [frame] = layoutWidgets([
      {
        type: "frame",
        caption: "Colors",
        columns: 2,
        children: [
          { type: "button", caption: "Red", functionId: 10 },
          { type: "button", caption: "Blue", functionId: 11, action: "flash" },
          { type: "slider", caption: "Dimmer", mode: "level", channels: [{ fixtureId: 3, channel: 0 }] },
        ],
      },
    ]);
    const assign = (w: any, id: { n: number }) => {
      w.id = id.n++;
      w.children?.forEach((c: any) => assign(c, id));
    };
    assign(frame, { n: 5 });
    if (frame.type !== "frame") throw new Error("expected frame");
    // two columns: the slider wraps to a second row, below the taller of the two buttons
    expect(frame.children.map((c) => [c.x, c.y])).toEqual([[10, 45], [130, 45], [10, 125]]);
    expect(frame.width).toBeGreaterThanOrEqual(130 + 110 + 10);
    expect(frame.height).toBeGreaterThanOrEqual(125 + 220 + 10);

    const xml = renderXml(widgetXml(frame));
    expect(xml).toContain('<Slider Caption="Dimmer" ID="8" WidgetStyle="Slider" InvertedAppearance="false">');
    expect(xml).toContain('<Action Override="0" ForceLTP="0">Flash</Action>');

    const model = await parseProjectModel(workspace([], [widgetXml(frame)]));
    expect(model.vcWidgets.map((w) => [w.id, w.type, w.caption, w.parentId])).toEqual([
      [5, "frame", "Colors", 0],
      [6, "button", "Red", 5],
      [7, "button", "Blue", 5],
      [8, "slider", "Dimmer", 5],
    ]);
    expect(model.vcWidgets[1]).toMatchObject({ functionId: 10, action: "toggle", framePath: ["Colors"] });
    expect(model.vcWidgets[3]).toMatchObject({ sliderMode: "level", levelChannels: [{ fixtureId: 3, channel: 0 }] });
  });

  it("starts master sliders full and level sliders at zero", () => {
    const [master, sub, level] = layoutWidgets([
      { type: "slider", caption: "Master", mode: "grandmaster" },
      { type: "slider", caption: "Sub", mode: "submaster" },
      { type: "slider", caption: "Dim", mode: "level", channels: [{ fixtureId: 0, channel: 0 }] },
    ]).map((w, index) => ({ ...w, id: index + 1 }));
    expect(renderXml(widgetXml(master))).toContain('Value="255"');
    expect(renderXml(widgetXml(sub))).toContain('Value="255"');
    expect(renderXml(widgetXml(level))).toContain('Value="0"');
  });
});
