import { Action } from "./actionCodes.js";
import {
  classifyChannel,
  defaultFixtureDirectories,
  genericDimmerDefinition,
  LocalFixtureLibrary,
  resolveMode,
  type ChannelDef,
  type FixtureDef,
  type FixtureLibrary,
  type LibraryEntry,
  type ModeDef,
} from "./fixtureLibrary.js";
import type { QlcNativeClient } from "./nativeClient.js";
import type { FixtureInfo } from "./projectModel.js";

/** Feature name advertised by the QLC+ fork for NetFixtureLibraryQuery */
export const FIXTURE_LIBRARY_FEATURE = "fixtureLibrary";

interface RemoteChannel {
  name: string;
  preset?: string;
  group?: string;
  groupByte?: number;
  colour?: string;
  capabilities?: { min: number; max: number; name: string; preset?: string; color?: string }[];
}

interface RemoteDef {
  manufacturer: string;
  model: string;
  type: string;
  channels: RemoteChannel[];
  modes: { name: string; channels: string[]; heads?: number[][] }[];
}

/** Convert the fork's JSON fixture definition into the local model */
export function fixtureDefFromJson(data: RemoteDef): FixtureDef {
  const channels = new Map<string, ChannelDef>();
  for (const ch of data.channels ?? []) {
    const { role, fine } = classifyChannel(ch.name, ch.preset, ch.group, ch.colour, ch.groupByte ?? 0);
    channels.set(ch.name, {
      name: ch.name,
      role,
      fine,
      preset: ch.preset,
      group: ch.group,
      capabilities: (ch.capabilities ?? []).map((cap) => ({
        ...cap,
        color: cap.color && /^#[0-9a-f]{6}$/i.test(cap.color) ? cap.color.toLowerCase() : undefined,
      })),
    });
  }
  return {
    manufacturer: data.manufacturer,
    model: data.model,
    type: data.type,
    modes: (data.modes ?? []).map((mode) => ({
      name: mode.name,
      channels: mode.channels.map(
        (name) => channels.get(name) ?? { name, role: "other", fine: false, capabilities: [] },
      ),
      heads: mode.heads ?? [],
    })),
  };
}

class RemoteFixtureLibrary implements FixtureLibrary {
  private readonly cache = new Map<string, FixtureDef | undefined>();

  constructor(private readonly client: QlcNativeClient) {}

  async search(query: string, limit: number): Promise<LibraryEntry[]> {
    const result = await this.client.request(Action.NetFixtureLibraryQuery, { op: "search", query, limit });
    return (Array.isArray(result) ? result : []) as LibraryEntry[];
  }

  async manufacturers(): Promise<string[]> {
    const result = await this.client.request(Action.NetFixtureLibraryQuery, { op: "manufacturers" });
    return (Array.isArray(result) ? result : []).map(String);
  }

  async get(manufacturer: string, model: string): Promise<FixtureDef | undefined> {
    const key = `${manufacturer}\u0000${model}`.toLowerCase();
    if (this.cache.has(key)) return this.cache.get(key);
    const result = (await this.client.request(Action.NetFixtureLibraryQuery, {
      op: "get",
      manufacturer,
      model,
    })) as RemoteDef | null;
    const def = result ? fixtureDefFromJson(result) : undefined;
    this.cache.set(key, def);
    return def;
  }
}

let localLibrary: LocalFixtureLibrary | null = null;
let configuredDirectories: string[] = [];

export function configureFixtureDirectories(directories: string[]): void {
  configuredDirectories = directories;
  localLibrary = null;
}

export function getLocalFixtureLibrary(): LocalFixtureLibrary {
  localLibrary ??= new LocalFixtureLibrary(
    configuredDirectories.length ? configuredDirectories : defaultFixtureDirectories(),
  );
  return localLibrary;
}

/**
 * The fork's library is authoritative: it is exactly what QLC+ loads,
 * including user fixtures. Local .qxf files are the fallback on stock QLC+.
 */
export function getFixtureLibrary(client: QlcNativeClient | null): FixtureLibrary {
  if (client?.hasFeature(FIXTURE_LIBRARY_FEATURE)) return new RemoteFixtureLibrary(client);
  return getLocalFixtureLibrary();
}

/** Channel layout of a patched fixture */
export async function fixtureMode(
  library: FixtureLibrary,
  fixture: FixtureInfo,
): Promise<{ mode: ModeDef; known: boolean }> {
  if (fixture.manufacturer === "Generic" && fixture.model === "Generic") {
    return { mode: genericDimmerDefinition(fixture.channels).modes[0], known: true };
  }
  let def: FixtureDef | undefined;
  try {
    def = await library.get(fixture.manufacturer, fixture.model);
  } catch {
    def = undefined;
  }
  const mode = resolveMode(def, fixture.mode, fixture.channels);
  return { mode, known: def !== undefined && mode.channels.length === fixture.channels };
}
