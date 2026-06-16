export const customHeadScriptEnvName = "RENEWLET_CUSTOM_HEAD_SCRIPT";

export type CustomHeadScript = {
  markup: string;
  scriptOrigin: string;
  connectOrigins: string[];
};

type ScriptAttribute = {
  key: string;
  value: string;
};

export function parseCustomHeadScript(raw: string | undefined): CustomHeadScript | undefined {
  const markup = raw?.trim() ?? "";
  if (!markup) return undefined;
  if (!/<\/script>\s*$/i.test(markup)) {
    throw new Error("custom head script must include an explicit closing script tag");
  }

  const match = /^<script\b([\s\S]*?)>([\s\S]*)<\/script>$/i.exec(markup);
  if (!match) {
    throw new Error("custom head script must be a single script tag");
  }
  if ((match[2] ?? "").trim() !== "") {
    throw new Error("custom head script must not contain inline JavaScript");
  }

  const attrs = parseScriptAttributes(match[1] ?? "");
  const seenAttrs = new Set<string>();
  for (const attr of attrs) {
    const key = attr.key.toLowerCase().trim();
    if (!key || seenAttrs.has(key)) {
      throw new Error("custom head script must not contain duplicate or empty attributes");
    }
    seenAttrs.add(key);
    if (key.startsWith("on")) {
      throw new Error("custom head script must not contain inline event handlers");
    }
  }

  const src = scriptAttrValue(attrs, "src");
  if (!src) {
    throw new Error("custom head script must contain one src attribute");
  }

  const scriptOrigin = httpURLOrigin(src);
  const connectOrigins = [scriptOrigin];
  const hostURL = scriptAttrValue(attrs, "data-host-url");
  if (hostURL) {
    try {
      appendUniqueString(connectOrigins, httpURLOrigin(hostURL));
    } catch {
      // data-host-url 来自第三方脚本约定；无效时不扩大 CSP，也不阻断 script 本身加载。
    }
  }

  return { markup, scriptOrigin, connectOrigins };
}

export function injectCustomHeadScriptHtml(html: string, script: CustomHeadScript | undefined): string {
  if (!script || html.includes(script.markup)) return html;
  const index = html.toLowerCase().lastIndexOf("</head>");
  if (index < 0) return html;
  return `${html.slice(0, index)}\n    ${script.markup}\n  ${html.slice(index)}`;
}

export function updateCustomHeadScriptStaticHeaders(headers: string, script: CustomHeadScript | undefined): string {
  if (!script) return headers;
  const cspLinePattern = /^(\s*Content-Security-Policy:\s*)(.+)$/m;
  const match = cspLinePattern.exec(headers);
  if (!match) {
    throw new Error("Missing Content-Security-Policy in packages/client/dist/_headers.");
  }
  return headers.replace(cspLinePattern, `${match[1]}${addCustomHeadScriptToContentSecurityPolicy(match[2] ?? "", script)}`);
}

export function addCustomHeadScriptToContentSecurityPolicy(policy: string, script: CustomHeadScript | undefined): string {
  if (!script) return policy;

  let foundScriptSrc = false;
  let foundConnectSrc = false;
  const directives = policy
    .split(";")
    .map((directive) => directive.trim())
    .filter(Boolean)
    .map((directive) => {
      const parts = directive.split(/\s+/);
      const name = parts[0] ?? "";
      const sources = parts.slice(1);
      if (name === "script-src") {
        foundScriptSrc = true;
        appendUniqueString(sources, script.scriptOrigin);
        return [name, ...sources].join(" ");
      }
      if (name === "connect-src") {
        foundConnectSrc = true;
        for (const origin of script.connectOrigins) appendUniqueString(sources, origin);
        return [name, ...sources].join(" ");
      }
      return directive;
    });

  if (!foundScriptSrc) {
    throw new Error("custom head script CSP update requires script-src.");
  }
  if (!foundConnectSrc) {
    throw new Error("custom head script CSP update requires connect-src.");
  }

  return directives.join("; ");
}

export function appendUniqueString(items: string[], value: string): string[] {
  if (!items.includes(value)) items.push(value);
  return items;
}

function parseScriptAttributes(source: string): ScriptAttribute[] {
  const attrs: ScriptAttribute[] = [];
  let index = 0;

  while (index < source.length) {
    index = skipWhitespace(source, index);
    if (index >= source.length) break;
    if (source[index] === "/" || source[index] === ">") {
      throw new Error("custom head script must be a single script tag");
    }

    const keyStart = index;
    while (index < source.length && !isWhitespace(source[index]) && source[index] !== "=" && source[index] !== "/" && source[index] !== ">") {
      index += 1;
    }
    const key = source.slice(keyStart, index);
    if (!key) {
      throw new Error("custom head script must not contain duplicate or empty attributes");
    }

    index = skipWhitespace(source, index);
    let value = "";
    if (source[index] === "=") {
      index += 1;
      index = skipWhitespace(source, index);
      const quote = source[index];
      if (quote === "\"" || quote === "'") {
        index += 1;
        const valueStart = index;
        while (index < source.length && source[index] !== quote) index += 1;
        if (index >= source.length) {
          throw new Error("custom head script contains an unterminated attribute value");
        }
        value = source.slice(valueStart, index);
        index += 1;
      } else {
        const valueStart = index;
        while (index < source.length && !isWhitespace(source[index]) && source[index] !== ">") index += 1;
        value = source.slice(valueStart, index);
      }
    }

    attrs.push({ key, value: value.trim() });
  }

  return attrs;
}

function scriptAttrValue(attrs: ScriptAttribute[], name: string): string {
  for (const attr of attrs) {
    if (attr.key.toLowerCase() === name) return attr.value.trim();
  }
  return "";
}

function httpURLOrigin(raw: string): string {
  const parsed = new URL(raw.trim());
  if (!parsed.hostname || (parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
    throw new Error("custom head script src must be an absolute http(s) URL without userinfo");
  }
  return `${parsed.protocol}//${parsed.host.toLowerCase()}`;
}

function skipWhitespace(source: string, index: number): number {
  while (index < source.length && isWhitespace(source[index])) index += 1;
  return index;
}

function isWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\n" || char === "\r" || char === "\t" || char === "\f";
}
