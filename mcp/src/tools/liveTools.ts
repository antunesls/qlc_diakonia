import { z } from "zod";
import type { ToolDefinition } from "../mcpCompat.js";
import { Action } from "../qlc/actionCodes.js";
import { nativeInt, nativePointF, nativeSceneValue } from "../qlc/nativeCodec.js";
import { findFixture, findFunction, findWidget, type VcWidgetInfo } from "../qlc/projectModel.js";
import { Dmx, json, opt, Percent, readyClient, Ref, tool } from "./toolkit.js";

/**
 * Live control acts on the model already held by the client: no project
 * refresh per command, so these tools stay fast enough for a running show.
 */
function liveWidget(ref: string | number, type: VcWidgetInfo["type"]): VcWidgetInfo {
  const client = readyClient();
  const widget = findWidget(client.getModel(), ref);
  if (widget.type !== type) throw new Error(`'${widget.caption}' is a ${widget.type}, not a ${type}`);
  return widget;
}

export function createLiveTools(): ToolDefinition[] {
  return [
    tool(
      "qlc_function_start",
      "Start functions immediately (scenes, chasers, shows...), independently of the Virtual Console.",
      z.object({ functions: z.array(Ref).min(1) }),
      async ({ functions }) => {
        const client = readyClient();
        const targets = functions.map((ref) => findFunction(client.getModel(), ref));
        for (const fn of targets) await client.sendAction(Action.FunctionStart, fn.id);
        return json(targets.map((f) => f.name), "Started");
      },
    ),

    tool(
      "qlc_function_stop",
      "Stop running functions.",
      z.object({ functions: z.array(Ref).min(1) }),
      async ({ functions }) => {
        const client = readyClient();
        const targets = functions.map((ref) => findFunction(client.getModel(), ref));
        for (const fn of targets) await client.sendAction(Action.FunctionStop, fn.id);
        return json(targets.map((f) => f.name), "Stopped");
      },
    ),

    tool(
      "qlc_slider_set",
      "Move a Virtual Console slider. Give either a DMX value (0-255) or a percentage.",
      z.object({
        widget: Ref.describe("Slider ID or exact caption"),
        value: opt(Dmx),
        percent: opt(Percent),
      }),
      async ({ widget, value, percent }) => {
        const slider = liveWidget(widget, "slider");
        if (value === undefined && percent === undefined) throw new Error("Give value or percent");
        const dmx = value ?? Math.round(((percent as number) / 100) * 255);
        await readyClient().sendAction(Action.VCSliderSetValue, slider.id, nativeInt(dmx));
        return json({ widget: slider.caption, value: dmx }, "Slider moved");
      },
    ),

    tool(
      "qlc_cuelist_control",
      "Control a Virtual Console cue list: play, stop, next, previous, or jump to a step (0-based).",
      z.object({
        widget: Ref.describe("Cue list ID or exact caption"),
        command: z.enum(["play", "stop", "next", "previous", "goto"]),
        step: opt(z.number().int().min(0)).describe("goto only"),
      }),
      async ({ widget, command, step }) => {
        const cueList = liveWidget(widget, "cuelist");
        const client = readyClient();
        switch (command) {
          case "play":
            await client.sendAction(Action.VCCueListPlayClicked, cueList.id);
            break;
          case "stop":
            await client.sendAction(Action.VCCueListStopClicked, cueList.id);
            break;
          case "next":
            await client.sendAction(Action.VCCueListNextClicked, cueList.id);
            break;
          case "previous":
            await client.sendAction(Action.VCCueListPreviousClicked, cueList.id);
            break;
          case "goto":
            if (step === undefined) throw new Error("goto needs a step");
            await client.sendAction(Action.VCCueListSetIndex, cueList.id, nativeInt(step));
            break;
        }
        return json({ widget: cueList.caption, command, step }, "Cue list command sent");
      },
    ),

    tool(
      "qlc_speeddial_set",
      "Set the time of a Virtual Console speed dial (ms) and apply it to its functions.",
      z.object({
        widget: Ref,
        timeMs: z.number().int().min(0),
        apply: opt(z.boolean()).describe("Apply immediately to the controlled functions (default true)"),
      }),
      async ({ widget, timeMs, apply }) => {
        const dial = liveWidget(widget, "speeddial");
        const client = readyClient();
        await client.sendAction(Action.VCSpeedDialSetTime, dial.id, nativeInt(timeMs));
        if (apply ?? true) await client.sendAction(Action.VCSpeedDialApply, dial.id);
        return json({ widget: dial.caption, timeMs }, "Speed dial set");
      },
    ),

    tool(
      "qlc_xypad_set",
      "Move a Virtual Console XY pad. Coordinates are 0-100% of the pan (x) and tilt (y) range.",
      z.object({ widget: Ref, x: Percent, y: Percent }),
      async ({ widget, x, y }) => {
        const pad = liveWidget(widget, "xypad");
        await readyClient().sendAction(
          Action.VCXYPadSetPosition,
          pad.id,
          nativePointF((x / 100) * 255, (y / 100) * 255),
        );
        return json({ widget: pad.caption, x, y }, "XY pad moved");
      },
    ),

    tool(
      "qlc_simpledesk_set",
      "Set raw channels of a fixture through the QLC+ Simple Desk (overrides functions until reset). Channels are 0-based within the fixture.",
      z.object({
        fixture: Ref,
        values: z.array(z.object({ channel: z.number().int().min(0).max(511), value: Dmx })).min(1),
        reset: opt(z.boolean()).describe("Release these channels instead of setting them"),
      }),
      async ({ fixture, values, reset }) => {
        const client = readyClient();
        const f = findFixture(client.getModel(), fixture);
        for (const v of values) {
          if (v.channel >= f.channels) throw new Error(`Fixture '${f.name}' has only ${f.channels} channels`);
          await client.sendAction(
            reset ? Action.SimpleDeskResetChannel : Action.SimpleDeskSetChannel,
            f.id,
            nativeSceneValue(f.id, v.channel, v.value),
          );
        }
        return json({ fixture: f.name, values }, reset ? "Channels released" : "Channels set");
      },
    ),
  ];
}
