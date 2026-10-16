import { Action } from "./actionCodes.js";
import { functionExists, type EditSession } from "./editSession.js";
import { nativeInt, nativeSceneValue, nativeString, nativeUIntPair } from "./nativeCodec.js";
import type { FunctionInfo, ProjectModel } from "./projectModel.js";
import { chaserStepXml, clampDmx, type SceneXmlSpec, type SpeedSpec } from "./xml/functions.js";
import type { XmlNode } from "./xml/xmlWriter.js";

/**
 * Update a scene in place. Deleting and recreating a scene would make QLC+
 * drop it from every chaser, collection and cue list, and break sequences
 * bound to it, so scenes are always edited value by value.
 *
 * QLC+ cannot unset a single channel over the network (the action needs the
 * old value it only has locally), so a fixture losing channels is removed
 * and its remaining values are set again.
 */
export function queueSceneUpdate(
  session: EditSession,
  current: FunctionInfo,
  next: Pick<SceneXmlSpec, "name" | "speed" | "fixtures">,
): void {
  const id = current.id;
  if (next.name !== current.name) {
    session.add(Action.FunctionSetName, id, [nativeString(next.name)], `rename scene ${id}`);
  }
  queueSpeed(session, current, next.speed);

  const oldValues = new Map<string, number>();
  const oldFixtures = new Set(current.sceneFixtures ?? []);
  for (const v of current.values ?? []) oldValues.set(`${v.fixtureId}:${v.channel}`, v.value);

  const newFixtures = new Map(next.fixtures.map((f) => [f.fixtureId, f.values]));

  for (const fixtureId of oldFixtures) {
    if (!newFixtures.has(fixtureId)) {
      session.add(Action.SceneRemoveFixture, id, [nativeSceneValue(fixtureId, 0, 0)], `remove fixture ${fixtureId} from scene ${id}`);
    }
  }

  for (const [fixtureId, values] of newFixtures) {
    const wanted = new Set(values.map((v) => v.channel));
    const loses = (current.values ?? []).some((v) => v.fixtureId === fixtureId && !wanted.has(v.channel));
    if (loses) {
      session.add(Action.SceneRemoveFixture, id, [nativeSceneValue(fixtureId, 0, 0)], `reset fixture ${fixtureId} in scene ${id}`);
    }
    if (values.length === 0) {
      if (loses || !oldFixtures.has(fixtureId)) {
        session.add(Action.SceneAddFixture, id, [nativeSceneValue(fixtureId, 0, 0)], `add fixture ${fixtureId} to scene ${id}`);
      }
      continue;
    }
    for (const v of values) {
      const value = clampDmx(v.value);
      if (!loses && oldValues.get(`${fixtureId}:${v.channel}`) === value) continue;
      session.add(
        Action.SceneSetChannelValue,
        id,
        [nativeSceneValue(fixtureId, v.channel, value)],
        `scene ${id}: fixture ${fixtureId} channel ${v.channel} = ${value}`,
      );
    }
  }

  session.verify((model) => {
    const scene = model.functions.find((f) => f.id === id);
    if (!scene) return `scene ${id} disappeared`;
    const actual = new Map((scene.values ?? []).map((v) => [`${v.fixtureId}:${v.channel}`, v.value]));
    for (const [fixtureId, values] of newFixtures) {
      for (const v of values) {
        if (actual.get(`${fixtureId}:${v.channel}`) !== clampDmx(v.value)) {
          return `scene ${id}: fixture ${fixtureId} channel ${v.channel} is ${actual.get(`${fixtureId}:${v.channel}`) ?? "unset"}, expected ${clampDmx(v.value)}`;
        }
      }
    }
    return undefined;
  });
}

export function queueSpeed(session: EditSession, current: FunctionInfo, speed?: SpeedSpec): void {
  if (!speed) return;
  const id = current.id;
  const now = current.speed ?? { fadeIn: 0, fadeOut: 0, duration: 0 };
  if (speed.fadeIn !== undefined && speed.fadeIn !== now.fadeIn)
    session.add(Action.FunctionSetFadeIn, id, [nativeInt(speed.fadeIn)], `function ${id} fade in`);
  if (speed.fadeOut !== undefined && speed.fadeOut !== now.fadeOut)
    session.add(Action.FunctionSetFadeOut, id, [nativeInt(speed.fadeOut)], `function ${id} fade out`);
  if (speed.duration !== undefined && speed.duration !== now.duration)
    session.add(Action.FunctionSetDuration, id, [nativeInt(speed.duration)], `function ${id} duration`);
}

/**
 * Replace a function definition while keeping its ID. QLC+ removes a
 * deleted function from chasers, collections and cue lists, so every such
 * reference is recorded first and restored after the new definition exists.
 */
export function queueFunctionReplace(
  session: EditSession,
  model: ProjectModel,
  current: FunctionInfo,
  node: XmlNode,
  type: string,
): string[] {
  const id = current.id;
  const notes: string[] = [];

  const chaserSteps = model.functions
    .filter((f) => (f.type === "Chaser" || f.type === "Sequence") && f.id !== id)
    .flatMap((f) =>
      (f.steps ?? [])
        .map((step, index) => ({ chaser: f, step, index }))
        .filter(({ step }) => step.functionId === id),
    );
  const collections = model.functions
    .filter((f) => f.type === "Collection" && f.id !== id)
    .flatMap((f) =>
      (f.functionIds ?? [])
        .map((fid, index) => ({ collection: f, fid, index }))
        .filter(({ fid }) => fid === id),
    );
  const widgets = model.vcWidgets.filter(
    (w) => w.functionId === id || w.chaserId === id || w.speedDialFunctionIds?.includes(id),
  );
  const boundSequences = model.functions.filter((f) => f.boundSceneId === id);
  if (boundSequences.length) {
    throw new Error(
      `Function ${id} is the bound scene of sequence(s) ${boundSequences.map((s) => s.name).join(", ")}; edit it as a scene instead`,
    );
  }

  session.deleteFunction(id, `replace function ${id}: delete`);
  session.addXml(Action.FunctionCreate, id, node, `replace function ${id}: create`);
  session.verify(functionExists(id, type));

  for (const { chaser, step, index } of chaserSteps) {
    session.addXml(
      Action.ChaserAddStep,
      chaser.id,
      chaserStepXml(index, {
        functionId: id,
        fadeIn: step.fadeIn,
        hold: step.hold,
        fadeOut: step.fadeOut,
        note: step.note,
      }),
      `restore step ${index} of chaser ${chaser.name}`,
    );
  }
  for (const { collection, index } of collections) {
    session.add(
      Action.CollectionAddFunction,
      collection.id,
      [nativeUIntPair(id, index)],
      `restore function ${id} in collection ${collection.name}`,
    );
  }
  for (const widget of widgets) {
    if (widget.type === "button") {
      session.add(Action.VCButtonSetFunctionID, widget.id, [nativeInt(id)], `rebind button ${widget.caption}`);
    } else if (widget.type === "slider") {
      session.add(Action.VCSliderSetFunctionID, widget.id, [nativeInt(id)], `rebind slider ${widget.caption}`);
    } else if (widget.type === "cuelist") {
      session.add(Action.VCCueListSetChaserID, widget.id, [nativeInt(id)], `rebind cue list ${widget.caption}`);
    } else {
      notes.push(`widget '${widget.caption}' (${widget.type}) may need to be rebound to function ${id}`);
    }
  }
  if (chaserSteps.length || collections.length) {
    session.verify((after) => {
      for (const { chaser, index } of chaserSteps) {
        const steps = after.functions.find((f) => f.id === chaser.id)?.steps ?? [];
        if (steps[index]?.functionId !== id) return `step ${index} of '${chaser.name}' was not restored`;
      }
      for (const { collection } of collections) {
        const ids = after.functions.find((f) => f.id === collection.id)?.functionIds ?? [];
        if (!ids.includes(id)) return `collection '${collection.name}' lost function ${id}`;
      }
      return undefined;
    });
  }
  return notes;
}
