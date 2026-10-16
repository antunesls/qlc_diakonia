import { el, textEl, type XmlNode } from "./xmlWriter.js";

/** Fixture::loadXML. `address` is 0-based, as stored by QLC+. */
export interface FixtureXmlSpec {
  id: number;
  name: string;
  manufacturer: string;
  model: string;
  mode: string;
  universe: number;
  address: number;
  channels: number;
  crossUniverse?: boolean;
}

export function fixtureXml(spec: FixtureXmlSpec): XmlNode {
  return el(
    "Fixture",
    {},
    textEl("Manufacturer", spec.manufacturer),
    textEl("Model", spec.model),
    textEl("Mode", spec.mode),
    textEl("ID", spec.id),
    textEl("Name", spec.name),
    textEl("Universe", spec.universe),
    spec.crossUniverse ? textEl("CrossUniverse", "True") : undefined,
    textEl("Address", spec.address),
    textEl("Channels", spec.channels),
  );
}

export interface FixtureGroupHeadSpec {
  fixtureId: number;
  head: number;
  x: number;
  y: number;
}

/** FixtureGroup::loadXML: a grid of fixture heads, used by RGB Matrices */
export interface FixtureGroupXmlSpec {
  id: number;
  name: string;
  width: number;
  height: number;
  heads: FixtureGroupHeadSpec[];
}

export function fixtureGroupXml(spec: FixtureGroupXmlSpec): XmlNode {
  return el(
    "FixtureGroup",
    { ID: spec.id },
    textEl("Name", spec.name),
    el("Size", { X: spec.width, Y: spec.height }),
    spec.heads.map((head) =>
      textEl("Head", head.head, { X: head.x, Y: head.y, Fixture: head.fixtureId }),
    ),
  );
}

/** Universe::loadXML, used by IOAddUniverse */
export function universeXml(id: number, name: string): XmlNode {
  return el("Universe", { Name: name, ID: id });
}
