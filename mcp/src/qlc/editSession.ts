import { Action, actionName } from "./actionCodes.js";
import { nativeByteArray } from "./nativeCodec.js";
import type { QlcNativeClient } from "./nativeClient.js";
import { IdAllocator, type ProjectModel } from "./projectModel.js";
import { renderXml, type XmlNode } from "./xml/xmlWriter.js";

/** Largest XML fragment carried by one ByteArray section */
export const MAX_FRAGMENT_BYTES = 0xffff - 64;

export interface QueuedAction {
  code: number;
  objectId: number;
  sections: Buffer[];
  description: string;
  xml?: string;
}

export interface CommitResult {
  dryRun: boolean;
  actions: { action: string; objectId: number; description: string; xml?: string }[];
  model: ProjectModel;
  problems: string[];
}

export type Verifier = (model: ProjectModel) => string | undefined;

/**
 * Collects native actions, sends them in order, then reloads the project
 * from QLC+ and runs the verifiers against what QLC+ actually holds.
 *
 * QLC+ applies creation fragments silently: a malformed fragment or an ID
 * clash is only visible in its log. Verification against a fresh transfer is
 * therefore the only reliable way to report success to the agent.
 */
export class EditSession {
  readonly ids: IdAllocator;
  private readonly actions: QueuedAction[] = [];
  private readonly verifiers: Verifier[] = [];

  constructor(
    private readonly client: QlcNativeClient,
    readonly model: ProjectModel,
  ) {
    this.ids = new IdAllocator(model);
  }

  get size(): number {
    return this.actions.length;
  }

  add(code: number, objectId: number, sections: Buffer[], description: string): this {
    this.actions.push({ code, objectId, sections, description });
    return this;
  }

  /** Buffered creation action carrying an XML fragment */
  addXml(code: number, objectId: number, node: XmlNode, description: string): this {
    const xml = renderXml(node);
    const bytes = Buffer.from(xml, "utf8");
    if (bytes.length > MAX_FRAGMENT_BYTES) {
      throw new Error(
        `${description}: XML fragment is ${bytes.length} bytes, above the ${MAX_FRAGMENT_BYTES} byte protocol limit. Split it into smaller parts.`,
      );
    }
    this.actions.push({ code, objectId, sections: [nativeByteArray(bytes)], description, xml });
    return this;
  }

  /**
   * Buffered delete actions read the object from the ID and only need a
   * non-empty XML payload; VC widget deletion reads the ID attribute.
   */
  deleteFunction(id: number, description = `delete function ${id}`): this {
    return this.addXml(Action.FunctionDelete, id, { tag: "Function", attrs: { ID: id }, children: [] }, description);
  }

  deleteFixture(id: number): this {
    return this.addXml(Action.FixtureDelete, id, { tag: "Fixture", attrs: { ID: id }, children: [] }, `delete fixture ${id}`);
  }

  deleteWidget(id: number): this {
    return this.addXml(Action.VCWidgetDelete, id, { tag: "Widget", attrs: { ID: id }, children: [] }, `delete widget ${id}`);
  }

  verify(verifier: Verifier): this {
    this.verifiers.push(verifier);
    return this;
  }

  async commit(): Promise<CommitResult> {
    const actions = this.actions.map((a) => ({
      action: actionName(a.code),
      objectId: a.objectId,
      description: a.description,
      xml: a.xml,
    }));

    if (this.client.dryRun) {
      return { dryRun: true, actions, model: this.model, problems: [] };
    }

    for (const action of this.actions) {
      await this.client.sendAction(action.code, action.objectId, ...action.sections);
    }
    const model = this.actions.length ? await this.client.refreshProject() : this.model;
    const problems = this.verifiers
      .map((verifier) => verifier(model))
      .filter((problem): problem is string => Boolean(problem));
    // Fragments are long; only echo them back when something went wrong
    return {
      dryRun: false,
      actions: problems.length ? actions : actions.map(({ xml: _xml, ...rest }) => rest),
      model,
      problems,
    };
  }
}

export function functionExists(id: number, type?: string): Verifier {
  return (model) => {
    const fn = model.functions.find((f) => f.id === id);
    if (!fn) return `function ${id} was not created by QLC+ (check the QLC+ log for the reason)`;
    if (type && fn.type !== type) return `function ${id} is a ${fn.type}, expected ${type}`;
    return undefined;
  };
}

export function functionGone(id: number): Verifier {
  return (model) =>
    model.functions.some((f) => f.id === id) ? `function ${id} still exists` : undefined;
}

export function fixtureExists(id: number): Verifier {
  return (model) =>
    model.fixtures.some((f) => f.id === id) ? undefined : `fixture ${id} was not created by QLC+`;
}

export function widgetExists(id: number): Verifier {
  return (model) =>
    [...model.vcPages, ...model.vcWidgets].some((w) => w.id === id)
      ? undefined
      : `Virtual Console widget ${id} was not created by QLC+`;
}

export function widgetGone(id: number): Verifier {
  return (model) =>
    model.vcWidgets.some((w) => w.id === id) ? `widget ${id} still exists` : undefined;
}
