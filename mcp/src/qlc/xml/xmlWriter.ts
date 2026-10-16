/**
 * Minimal XML serializer for QLC+ workspace fragments.
 *
 * Every caption and name comes from an AI agent or a user, so all text and
 * attribute values are escaped here and nowhere else.
 */

export type XmlAttrValue = string | number | boolean | undefined | null;
export type XmlChild = XmlNode | string | undefined | null | false;

export interface XmlNode {
  tag: string;
  attrs: Record<string, XmlAttrValue>;
  children: XmlChild[];
}

// XML 1.0 forbids most C0 control characters even when escaped
const INVALID_XML_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

export function escapeXml(value: string): string {
  return value
    .replace(INVALID_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function el(
  tag: string,
  attrs: Record<string, XmlAttrValue> = {},
  ...children: (XmlChild | XmlChild[])[]
): XmlNode {
  return { tag, attrs, children: children.flat() };
}

/** Element holding only text, e.g. `<Direction>Forward</Direction>` */
export function textEl(
  tag: string,
  value: string | number,
  attrs: Record<string, XmlAttrValue> = {},
): XmlNode {
  return el(tag, attrs, String(value));
}

export function boolText(value: boolean): string {
  return value ? "True" : "False";
}

export function renderXml(node: XmlNode, indent = 0): string {
  const pad = " ".repeat(indent);
  const attrs = Object.entries(node.attrs)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => ` ${name}="${escapeXml(String(value))}"`)
    .join("");
  const children = node.children.filter(
    (child): child is XmlNode | string =>
      child !== undefined && child !== null && child !== false,
  );
  if (children.length === 0) return `${pad}<${node.tag}${attrs}/>`;
  if (children.every((child) => typeof child === "string")) {
    return `${pad}<${node.tag}${attrs}>${escapeXml(children.join(""))}</${node.tag}>`;
  }
  const body = children
    .map((child) =>
      typeof child === "string"
        ? `${" ".repeat(indent + 1)}${escapeXml(child)}`
        : renderXml(child, indent + 1),
    )
    .join("\n");
  return `${pad}<${node.tag}${attrs}>\n${body}\n${pad}</${node.tag}>`;
}

/** Serialize a fragment the way Tardis::processBufferedAction expects it */
export function xmlFragment(node: XmlNode): Buffer {
  return Buffer.from(renderXml(node), "utf8");
}
