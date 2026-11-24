/**
 * Minimal, strict SOAP 1.1 client pieces for portalquery.just.ro.
 *
 * - No third-party XML dependency.
 * - DTDs and entity declarations are rejected outright (no XXE, no
 *   "billion laughs"); only the five predefined XML entities and numeric
 *   character references are decoded.
 * - Responses above MAX_RESPONSE_BYTES are rejected.
 * - Malformed markup throws instead of being silently "repaired".
 *
 * Everything parsed here is UNTRUSTED and is validated again by
 * src/server/monitoring/normalize.ts before use.
 */

export const PORTAL_NAMESPACE = "portalquery.just.ro";
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export class PortalSoapError extends Error {
  constructor(
    message: string,
    readonly kind: "malformed_xml" | "soap_fault" | "too_large" | "unexpected_shape",
  ) {
    super(message);
    this.name = "PortalSoapError";
  }
}

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Strip characters that are illegal in XML 1.0.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");
}

/** Ordered parameters; `null` is sent as xsi:nil (required-but-nillable elements). */
export type SoapParam = [name: string, value: string | null | undefined];

export function buildSoapEnvelope(operation: string, params: SoapParam[]): string {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(operation)) throw new Error("invalid operation name");
  const body = params
    .filter(([, v]) => v !== undefined) // minOccurs=0 → omit
    .map(([name, v]) => {
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) throw new Error("invalid parameter name");
      return v === null ? `<${name} xsi:nil="true" />` : `<${name}>${escapeXml(v!)}</${name}>`;
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body><${operation} xmlns="${PORTAL_NAMESPACE}">${body}</${operation}></soap:Body></soap:Envelope>`
  );
}

export function soapActionFor(operation: string): string {
  return `"${PORTAL_NAMESPACE}/${operation}"`;
}

// ---------------------------------------------------------------------------
// Strict minimal XML parser
// ---------------------------------------------------------------------------

export type XmlNode = { name: string; children: XmlNode[]; text: string; nil: boolean };

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);|&/g, (match, ref: string | undefined) => {
    if (!ref) throw new PortalSoapError("bare '&' in text", "malformed_xml");
    if (ref.startsWith("#x")) return String.fromCodePoint(parseInt(ref.slice(2), 16));
    if (ref.startsWith("#")) return String.fromCodePoint(parseInt(ref.slice(1), 10));
    const value = ENTITIES[ref];
    if (value === undefined) throw new PortalSoapError(`unknown entity &${ref};`, "malformed_xml");
    return value;
  });
}

const localName = (qname: string) => qname.slice(qname.indexOf(":") + 1);

const TOKEN =
  /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/([A-Za-z_][\w.:-]*)\s*>|<([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/y;

export function parseXml(xml: string): XmlNode {
  if (xml.length > MAX_RESPONSE_BYTES) throw new PortalSoapError("response too large", "too_large");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new PortalSoapError("DTD / entity declarations are not allowed", "malformed_xml");

  const root: XmlNode = { name: "#document", children: [], text: "", nil: false };
  const stack: XmlNode[] = [root];
  TOKEN.lastIndex = 0;
  let pos = 0;
  const source = xml.replace(/^﻿/, "");

  while (pos < source.length) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(source);
    if (!m) throw new PortalSoapError(`unexpected markup at offset ${pos}`, "malformed_xml");
    pos = TOKEN.lastIndex;
    const top = stack[stack.length - 1];

    if (m[1] !== undefined) {
      top.text += m[1]; // CDATA
    } else if (m[2] !== undefined) {
      const closing = localName(m[2]);
      if (stack.length === 1 || top.name !== closing) {
        throw new PortalSoapError(`mismatched closing tag </${m[2]}>`, "malformed_xml");
      }
      stack.pop();
    } else if (m[3] !== undefined) {
      const attrs = m[4] ?? "";
      const node: XmlNode = {
        name: localName(m[3]),
        children: [],
        text: "",
        nil: /\b(?:xsi:)?nil\s*=\s*["']true["']/.test(attrs),
      };
      top.children.push(node);
      if (m[5] !== "/") stack.push(node);
    } else if (m[6] !== undefined) {
      top.text += decodeEntities(m[6]);
    }
    // comments and processing instructions are skipped
  }
  if (stack.length !== 1) throw new PortalSoapError("unclosed element(s)", "malformed_xml");
  return root;
}

export const child = (node: XmlNode | undefined, name: string): XmlNode | undefined =>
  node?.children.find((c) => c.name === name);
export const childrenNamed = (node: XmlNode | undefined, name: string): XmlNode[] =>
  node?.children.filter((c) => c.name === name && !c.nil) ?? [];
export function textOf(node: XmlNode | undefined, name: string): string | null {
  const c = child(node, name);
  if (!c || c.nil) return null;
  const t = c.text.trim();
  return t.length > 0 ? t : null;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function soapBody(xml: string): XmlNode {
  const doc = parseXml(xml);
  const envelope = child(doc, "Envelope");
  const body = child(envelope, "Body");
  if (!body) throw new PortalSoapError("missing SOAP Envelope/Body", "unexpected_shape");
  const fault = child(body, "Fault");
  if (fault) {
    // Never echo server internals to users; keep a short code only.
    const code = textOf(fault, "faultcode") ?? "unknown";
    throw new PortalSoapError(`SOAP fault (${code.slice(0, 60)})`, "soap_fault");
  }
  return body;
}

export type PortalDosarParte = { nume: string | null; calitateParte: string | null };
export type PortalDosarSedinta = {
  complet: string | null;
  data: string | null;
  ora: string | null;
  solutie: string | null;
  solutieSumar: string | null;
  dataPronuntare: string | null;
  documentSedinta: string | null;
  numarDocument: string | null;
  dataDocument: string | null;
};
export type PortalDosarCaleAtac = { dataDeclarare: string | null; parteDeclaratoare: string | null; tipCaleAtac: string | null };
export type PortalDosar = {
  numar: string | null;
  numarVechi: string | null;
  data: string | null;
  institutie: string | null;
  departament: string | null;
  categorieCaz: string | null;
  categorieCazNume: string | null;
  stadiuProcesual: string | null;
  stadiuProcesualNume: string | null;
  obiect: string | null;
  dataModificare: string | null;
  parti: PortalDosarParte[];
  sedinte: PortalDosarSedinta[];
  caiAtac: PortalDosarCaleAtac[];
};

function toDosar(n: XmlNode): PortalDosar {
  return {
    numar: textOf(n, "numar"),
    numarVechi: textOf(n, "numarVechi"),
    data: textOf(n, "data"),
    institutie: textOf(n, "institutie"),
    departament: textOf(n, "departament"),
    categorieCaz: textOf(n, "categorieCaz"),
    categorieCazNume: textOf(n, "categorieCazNume"),
    stadiuProcesual: textOf(n, "stadiuProcesual"),
    stadiuProcesualNume: textOf(n, "stadiuProcesualNume"),
    obiect: textOf(n, "obiect"),
    dataModificare: textOf(n, "dataModificare"),
    parti: childrenNamed(child(n, "parti"), "DosarParte").map((p) => ({
      nume: textOf(p, "nume"),
      calitateParte: textOf(p, "calitateParte"),
    })),
    sedinte: childrenNamed(child(n, "sedinte"), "DosarSedinta").map((s) => ({
      complet: textOf(s, "complet"),
      data: textOf(s, "data"),
      ora: textOf(s, "ora"),
      solutie: textOf(s, "solutie"),
      solutieSumar: textOf(s, "solutieSumar"),
      dataPronuntare: textOf(s, "dataPronuntare"),
      documentSedinta: textOf(s, "documentSedinta"),
      numarDocument: textOf(s, "numarDocument"),
      dataDocument: textOf(s, "dataDocument"),
    })),
    caiAtac: childrenNamed(child(n, "caiAtac"), "DosarCaleAtac").map((c) => ({
      dataDeclarare: textOf(c, "dataDeclarare"),
      parteDeclaratoare: textOf(c, "parteDeclaratoare"),
      tipCaleAtac: textOf(c, "tipCaleAtac"),
    })),
  };
}

export function parseCautareDosareResponse(xml: string, operation = "CautareDosare"): PortalDosar[] {
  const body = soapBody(xml);
  const response = child(body, `${operation}Response`);
  if (!response) throw new PortalSoapError(`missing ${operation}Response`, "unexpected_shape");
  const result = child(response, `${operation}Result`);
  if (!result || result.nil) return [];
  return childrenNamed(result, "Dosar").map(toDosar);
}

/** Hearing-list entries (no party names in this operation). */
export type PortalSedintaDosar = {
  numar: string | null;
  data: string | null;
  ora: string | null;
  categorieCazNume: string | null;
  stadiuProcesualNume: string | null;
};
export type PortalSedinta = {
  departament: string | null;
  complet: string | null;
  data: string | null;
  ora: string | null;
  dosare: PortalSedintaDosar[];
};

export function parseCautareSedinteResponse(xml: string): PortalSedinta[] {
  const body = soapBody(xml);
  const result = child(child(body, "CautareSedinteResponse"), "CautareSedinteResult");
  if (!result || result.nil) return [];
  return childrenNamed(result, "Sedinta").map((s) => ({
    departament: textOf(s, "departament"),
    complet: textOf(s, "complet"),
    data: textOf(s, "data"),
    ora: textOf(s, "ora"),
    dosare: childrenNamed(child(s, "dosare"), "SedintaDosar").map((d) => ({
      numar: textOf(d, "numar"),
      data: textOf(d, "data"),
      ora: textOf(d, "ora"),
      categorieCazNume: textOf(d, "categorieCazNume"),
      stadiuProcesualNume: textOf(d, "stadiuProcesualNume"),
    })),
  }));
}
