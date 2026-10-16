import { z } from "zod";
import type { ToolDefinition } from "../mcpCompat.js";
import { Action } from "../qlc/actionCodes.js";
import { fixtureExists } from "../qlc/editSession.js";
import { genericDimmerDefinition, type FixtureDef } from "../qlc/fixtureLibrary.js";
import { fixtureMode, getFixtureLibrary } from "../qlc/libraryProvider.js";
import { nativeInt, nativeString, nativeVector3D } from "../qlc/nativeCodec.js";
import { getNativeClient } from "../qlc/nativeClient.js";
import {
  findFixture,
  findFixtureGroup,
  findFreeAddress,
  isAddressRangeFree,
} from "../qlc/projectModel.js";
import { describeMode } from "../qlc/sceneComposer.js";
import { fixtureGroupXml, fixtureXml, universeXml } from "../qlc/xml/engine.js";
import {
  commitReport,
  freshModel,
  json,
  newSession,
  opt,
  readyClient,
  Ref,
  requireFeature,
  tool,
} from "./toolkit.js";

export const IO_FEATURE = "io";
export const GROUP_DELETE_FEATURE = "fixtureGroupDelete";

function library() {
  return getFixtureLibrary(getNativeClient());
}

async function loadDefinition(manufacturer: string, model: string): Promise<FixtureDef> {
  if (manufacturer === "Generic" && model === "Generic") return genericDimmerDefinition(1);
  const def = await library().get(manufacturer, model);
  if (!def) {
    throw new Error(
      `Fixture '${manufacturer} ${model}' is not in the fixture library`,
    );
  }
  return def;
}

export function createFixtureTools(): ToolDefinition[] {
  return [
    tool(
      "qlc_fixture_library_search",
      "Search the QLC+ fixture library by manufacturer, model and type. Every search word must match. Plain dimmer channels are the built-in manufacturer 'Generic', model 'Generic'.",
      z.object({
        query: z.string().describe("Words to search, e.g. 'par rgbw', 'moving head beam', 'Chauvet'"),
        limit: opt(z.number().int().min(1).max(100)),
      }),
      async ({ query, limit }) => {
        const results = await library().search(query, limit ?? 25);
        return json(results, `${results.length} fixture definitions found`);
      },
    ),

    tool(
      "qlc_fixture_definition",
      "Modes of a fixture definition, with every channel and its role (dimmer, red, pan, shutter, gobo...).",
      z.object({
        manufacturer: z.string(),
        model: z.string(),
        withCapabilities: opt(z.boolean()).describe("Also list the DMX ranges of each channel"),
      }),
      async ({ manufacturer, model, withCapabilities }) => {
        const def = await loadDefinition(manufacturer, model);
        return json({
          manufacturer: def.manufacturer,
          model: def.model,
          type: def.type,
          modes: def.modes.map((mode) => ({
            name: mode.name,
            channelCount: mode.channels.length,
            heads: mode.heads.length || 1,
            channels: withCapabilities
              ? mode.channels.map((ch, index) => ({
                  index,
                  name: ch.name,
                  role: ch.fine ? `${ch.role}_fine` : ch.role,
                  capabilities: ch.capabilities.map((c) => `${c.min}-${c.max}: ${c.name}`),
                }))
              : describeMode(mode),
          })),
        });
      },
    ),

    tool(
      "qlc_fixture_list",
      "List the fixtures patched in the project with universe, DMX address (1-based) and, optionally, each channel with its role.",
      z.object({
        withChannels: opt(z.boolean()),
      }),
      async ({ withChannels }) => {
        const model = await freshModel(readyClient());
        const lib = library();
        const fixtures = await Promise.all(
          model.fixtures.map(async (f) => {
            const base = {
              id: f.id,
              name: f.name,
              manufacturer: f.manufacturer,
              model: f.model,
              mode: f.mode,
              universe: f.universe + 1,
              address: f.address + 1,
              channels: f.channels,
            };
            if (!withChannels) return base;
            const { mode, known } = await fixtureMode(lib, f);
            return { ...base, definitionFound: known, channelMap: describeMode(mode) };
          }),
        );
        return json(fixtures);
      },
    ),

    tool(
      "qlc_fixture_add",
      "Patch one or more fixtures of the same type. Addresses are 1-based; without an address the first free range of the universe is used, and several fixtures are patched back to back. Returns the new fixture IDs.",
      z.object({
        manufacturer: z.string(),
        model: z.string(),
        mode: opt(z.string()).describe("Mode name; defaults to the first mode of the definition"),
        channels: opt(z.number().int().min(1).max(512)).describe(
          "Generic dimmers only: number of channels per fixture",
        ),
        name: opt(z.string()).describe(
          "Fixture name. With count > 1 a number is appended, or use {n} as placeholder, e.g. 'PAR {n}'",
        ),
        count: opt(z.number().int().min(1).max(256)),
        universe: opt(z.number().int().min(1).max(256)).describe("1-based universe (default 1)"),
        address: opt(z.number().int().min(1).max(512)).describe("1-based start address"),
        gap: opt(z.number().int().min(0).max(511)).describe("Free channels between fixtures"),
      }),
      async (input) => {
        const session = await newSession();
        const generic = input.manufacturer === "Generic" && input.model === "Generic";
        let modeName: string;
        let channels: number;
        if (generic) {
          channels = input.channels ?? 1;
          modeName = `${channels} Channel`;
        } else {
          const def = await loadDefinition(input.manufacturer, input.model);
          const mode = input.mode
            ? def.modes.find((m) => m.name.toLowerCase() === input.mode!.toLowerCase())
            : def.modes[0];
          if (!mode) {
            throw new Error(
              `Mode '${input.mode}' not found. Available: ${def.modes.map((m) => m.name).join(", ")}`,
            );
          }
          modeName = mode.name;
          channels = mode.channels.length;
          input.manufacturer = def.manufacturer;
          input.model = def.model;
        }

        const universe = (input.universe ?? 1) - 1;
        if (!session.model.universes.some((u) => u.id === universe) && universe > 0) {
          throw new Error(`Universe ${universe + 1} does not exist; add it with qlc_universe_add`);
        }
        const count = input.count ?? 1;
        const gap = input.gap ?? 0;
        const reserved: { universe: number; address: number; channels: number }[] = [];
        const created: { id: number; name: string; universe: number; address: number }[] = [];
        let next = input.address !== undefined ? input.address - 1 : undefined;

        for (let n = 1; n <= count; n += 1) {
          let address = next;
          if (address === undefined) {
            address = findFreeAddress(session.model, universe, channels + gap, reserved);
            if (address === undefined) {
              throw new Error(`No free range of ${channels} channels left in universe ${universe + 1}`);
            }
          } else if (
            !isAddressRangeFree(session.model, universe, address, channels) ||
            reserved.some((r) => address! <= r.address + r.channels - 1 && r.address <= address! + channels - 1)
          ) {
            throw new Error(
              `Address ${address + 1}-${address + channels} of universe ${universe + 1} overlaps an existing fixture`,
            );
          }
          const id = session.ids.fixture();
          const base = input.name ?? input.model;
          const name = base.includes("{n}")
            ? base.replace("{n}", String(n))
            : count > 1
              ? `${base} ${n}`
              : base;
          session.addXml(
            Action.FixtureCreate,
            id,
            fixtureXml({
              id,
              name,
              manufacturer: input.manufacturer,
              model: input.model,
              mode: modeName,
              universe,
              address,
              channels,
            }),
            `create fixture ${name}`,
          );
          session.verify(fixtureExists(id));
          reserved.push({ universe, address, channels: channels + gap });
          created.push({ id, name, universe: universe + 1, address: address + 1 });
          next = input.address !== undefined ? address + channels + gap : undefined;
        }

        const result = await session.commit();
        return commitReport(result, `Patched ${count} fixture(s), ${channels} channels each, mode '${modeName}'`, {
          fixtures: created,
        });
      },
    ),

    tool(
      "qlc_fixture_remove",
      "Remove fixtures from the project. Scenes and other functions lose the values of removed fixtures.",
      z.object({ fixtures: z.array(Ref).min(1) }),
      async ({ fixtures }) => {
        const session = await newSession();
        const targets = fixtures.map((ref) => findFixture(session.model, ref));
        for (const f of targets) session.deleteFixture(f.id);
        session.verify((model) => {
          const left = targets.filter((t) => model.fixtures.some((f) => f.id === t.id));
          return left.length ? `fixtures still present: ${left.map((f) => f.name).join(", ")}` : undefined;
        });
        const result = await session.commit();
        return commitReport(result, `Removed ${targets.length} fixture(s)`);
      },
    ),

    tool(
      "qlc_fixture_update",
      "Rename a fixture and/or move it to another DMX address in the same universe (1-based).",
      z.object({
        fixture: Ref,
        name: opt(z.string().min(1)),
        address: opt(z.number().int().min(1).max(512)),
      }),
      async ({ fixture, name, address }) => {
        const session = await newSession();
        const f = findFixture(session.model, fixture);
        if (name) session.add(Action.FixtureSetName, f.id, [nativeString(name)], `rename fixture ${f.id}`);
        if (address !== undefined) {
          if (!isAddressRangeFree(session.model, f.universe, address - 1, f.channels, f.id)) {
            throw new Error(`Address ${address} overlaps another fixture in universe ${f.universe + 1}`);
          }
          session.add(Action.FixtureMove, f.id, [nativeInt(address - 1)], `move fixture ${f.id}`);
        }
        session.verify((model) => {
          const now = model.fixtures.find((x) => x.id === f.id);
          if (!now) return "fixture disappeared";
          if (name && now.name !== name) return `name is still '${now.name}'`;
          if (address !== undefined && now.address !== address - 1) return `address is still ${now.address + 1}`;
          return undefined;
        });
        return commitReport(await session.commit(), `Updated fixture ${f.name}`);
      },
    ),

    tool(
      "qlc_fixture_position",
      "Place fixtures in the 2D/3D stage views. Coordinates are millimeters from the stage origin: x from stage left, y up from the floor, z from the back of the stage towards the audience. The stage size (meters, default 5x3x5) is reported in the result. Either give explicit `items`, or a `row` that spreads the fixtures evenly across the stage width at one height and depth.",
      z.object({
        items: opt(
          z
            .array(
              z.object({
                fixture: Ref,
                x: z.number(),
                y: z.number(),
                z: z.number(),
                rotation: opt(z.object({ x: z.number(), y: z.number(), z: z.number() })).describe(
                  "Degrees around each axis",
                ),
              }),
            )
            .min(1),
        ),
        row: opt(
          z.object({
            fixtures: z.array(Ref).min(1).describe("Fixtures from stage left to stage right"),
            y: opt(z.number()).describe("Height in mm (default: stage height minus 300, i.e. on a truss)"),
            z: opt(z.number()).describe("Depth in mm (default: middle of the stage)"),
            xStart: opt(z.number()).describe("First fixture x in mm (default: evenly spaced margins)"),
            xEnd: opt(z.number()).describe("Last fixture x in mm"),
            rotation: opt(z.object({ x: z.number(), y: z.number(), z: z.number() })),
          }),
        ),
      }),
      async ({ items, row }) => {
        if (!items && !row) throw new Error("Give `items` or `row`");
        const session = await newSession();
        const stage = session.model.stage;
        const mm = stage.units === 1 ? 304.8 : 1000;
        const width = stage.width * mm;
        const placements: { id: number; name: string; x: number; y: number; z: number; rotation?: { x: number; y: number; z: number } }[] = [];

        for (const item of items ?? []) {
          const f = findFixture(session.model, item.fixture);
          placements.push({ id: f.id, name: f.name, x: item.x, y: item.y, z: item.z, rotation: item.rotation });
        }
        if (row) {
          const count = row.fixtures.length;
          const spacing = width / count;
          const xStart = row.xStart ?? spacing / 2;
          const xEnd = row.xEnd ?? width - spacing / 2;
          const step = count > 1 ? (xEnd - xStart) / (count - 1) : 0;
          row.fixtures.forEach((ref, index) => {
            const f = findFixture(session.model, ref);
            placements.push({
              id: f.id,
              name: f.name,
              x: Math.round(count > 1 ? xStart + index * step : (xStart + xEnd) / 2),
              y: row.y ?? Math.max(0, stage.height * mm - 300),
              z: row.z ?? Math.round((stage.depth * mm) / 2),
              rotation: row.rotation,
            });
          });
        }

        for (const p of placements) {
          // the 3D view addresses fixture items as fixture << 16 | head << 8 | linked
          const itemId = p.id * 65536;
          session.add(Action.FixtureSetPosition, itemId, [nativeVector3D(p.x, p.y, p.z)], `position fixture ${p.id}`);
          if (p.rotation) {
            session.add(
              Action.FixtureSetRotation,
              itemId,
              [nativeVector3D(p.rotation.x, p.rotation.y, p.rotation.z)],
              `rotate fixture ${p.id}`,
            );
          }
        }
        session.verify((model) => {
          for (const p of placements) {
            const now = model.placements.find((x) => x.fixtureId === p.id && x.head === 0 && x.linked === 0);
            if (!now) return `fixture ${p.name} has no stage position`;
            if (Math.abs(now.x - p.x) > 1 || Math.abs(now.y - p.y) > 1 || Math.abs(now.z - p.z) > 1) {
              return `fixture ${p.name} is at ${now.x},${now.y},${now.z} instead of ${p.x},${p.y},${p.z}`;
            }
          }
          return undefined;
        });
        return commitReport(await session.commit(), `Placed ${placements.length} fixture(s)`, {
          stage: { ...stage, unit: stage.units === 1 ? "feet" : "meters" },
          placements: placements.map(({ name, x, y, z: depth }) => ({ fixture: name, x, y, z: depth })),
        });
      },
    ),

    tool(
      "qlc_fixture_group_create",
      "Create a fixture group: a grid of fixture heads used by RGB Matrices and as a selection unit. Fixtures with several heads (LED bars) contribute one cell per head. Layout fills rows of `columns` cells (default: one row).",
      z.object({
        name: z.string().min(1),
        fixtures: z.array(Ref).min(1).describe("Fixtures in grid order"),
        columns: opt(z.number().int().min(1).max(512)),
      }),
      async ({ name, fixtures, columns }) => {
        const session = await newSession();
        const lib = library();
        const heads: { fixtureId: number; head: number }[] = [];
        for (const ref of fixtures) {
          const f = findFixture(session.model, ref);
          const { mode } = await fixtureMode(lib, f);
          const headCount = Math.max(1, mode.heads.length);
          for (let head = 0; head < headCount; head += 1) heads.push({ fixtureId: f.id, head });
        }
        const width = columns ?? heads.length;
        const height = Math.ceil(heads.length / width);
        const id = session.ids.group();
        session.addXml(
          Action.FixtureGroupCreate,
          id,
          fixtureGroupXml({
            id,
            name,
            width,
            height,
            heads: heads.map((h, index) => ({ ...h, x: index % width, y: Math.floor(index / width) })),
          }),
          `create fixture group ${name}`,
        );
        session.verify((model) =>
          model.fixtureGroups.some((g) => g.id === id) ? undefined : "fixture group was not created",
        );
        return commitReport(await session.commit(), `Created fixture group '${name}' (${width}x${height})`, {
          groupId: id,
        });
      },
    ),

    tool(
      "qlc_fixture_group_delete",
      "Delete a fixture group (requires the QLC+ fork: stock QLC+ ignores this action over the network).",
      z.object({ group: Ref }),
      async ({ group }) => {
        const client = readyClient();
        requireFeature(client, GROUP_DELETE_FEATURE, "Deleting fixture groups");
        const model = await freshModel(client);
        const g = findFixtureGroup(model, group);
        await client.request(Action.NetFixtureGroupDelete, { id: g.id });
        const after = await client.refreshProject();
        if (after.fixtureGroups.some((x) => x.id === g.id)) throw new Error("QLC+ did not delete the group");
        return json({ deleted: g.id }, `Deleted fixture group '${g.name}'`);
      },
    ),

    tool(
      "qlc_universe_add",
      "Add a DMX universe to the project.",
      z.object({ name: opt(z.string().min(1)) }),
      async ({ name }) => {
        const session = await newSession();
        const id = session.model.universes.length;
        const label = name ?? `Universe ${id + 1}`;
        session.addXml(Action.IOAddUniverse, id, universeXml(id, label), `add universe ${label}`);
        session.verify((model) => (model.universes.some((u) => u.id === id) ? undefined : "universe was not added"));
        return commitReport(await session.commit(), `Added universe ${id + 1}`, { universe: id + 1 });
      },
    ),

    tool(
      "qlc_io_list",
      "List the I/O plugins and lines available on the QLC+ machine (DMX USB, ArtNet, sACN, MIDI, OSC...) and the current patch of each universe (requires the QLC+ fork).",
      z.object({}),
      async () => {
        const client = readyClient();
        requireFeature(client, IO_FEATURE, "Listing I/O plugins");
        return json(await client.request(Action.NetIOQuery, {}));
      },
    ),

    tool(
      "qlc_io_patch",
      "Patch a universe to an I/O plugin line (requires the QLC+ fork). Plugin names and line numbers are those of qlc_io_list; plugin 'None' unpatches.",
      z.object({
        universe: z.number().int().min(1).describe("1-based universe"),
        direction: z.enum(["output", "input", "feedback"]),
        plugin: z.string().min(1).describe("Plugin name as listed by qlc_io_list, e.g. 'ArtNet', 'DMX USB', 'E1.31'"),
        line: z.number().int().min(0),
        params: opt(z.record(z.string(), z.string())).describe(
          "Plugin parameters, e.g. {\"outputIP\": \"192.168.1.50\", \"outputUni\": \"1\"}",
        ),
      }),
      async ({ universe, direction, plugin, line, params }) => {
        const client = readyClient();
        requireFeature(client, IO_FEATURE, "Patching I/O");
        const result = await client.request(Action.NetIOPatch, {
          universe: universe - 1,
          direction,
          plugin,
          line,
          params,
        });
        await client.refreshProject();
        return json(result, `Universe ${universe} ${direction} patched to ${plugin} line ${line}`);
      },
    ),
  ];
}
