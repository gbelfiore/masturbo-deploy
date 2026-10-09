function detectNotesKind(text) {
  const raw = String(text || "").trim();
  if (!raw) return "empty";
  if ((raw.startsWith("{") || raw.startsWith("[")) && isJson(raw)) return "json";
  if (looksLikeHtml(raw)) return "html";
  if (looksLikeMarkdown(raw)) return "markdown";
  return "text";
}

function renderNotesPreview(container, text, labels) {
  const raw = String(text || "").trim();
  const kind = detectNotesKind(raw);
  container.className = `notes-preview notes-${kind}`;
  container.innerHTML = "";
  const head = document.createElement("div");
  head.className = "notes-preview-head";
  const title = document.createElement("span");
  title.textContent = labels.notes || "Release notes";
  const badge = document.createElement("span");
  badge.className = "pill";
  badge.textContent = kindLabel(kind, labels);
  head.append(title, badge);
  container.appendChild(head);
  const body = document.createElement("div");
  body.className = "notes-preview-body";
  if (kind === "empty") {
    body.textContent = labels.empty || "";
  } else if (kind === "json") {
    const pre = document.createElement("pre");
    pre.className = "notes-json";
    pre.textContent = JSON.stringify(JSON.parse(raw), null, 2);
    body.appendChild(pre);
  } else if (kind === "html") {
    body.appendChild(sanitizeHtml(raw));
  } else if (kind === "markdown") {
    body.appendChild(sanitizeHtml(markdownToHtml(raw)));
  } else {
    body.classList.add("is-plain");
    body.textContent = raw;
  }
  container.appendChild(body);
  body.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    const url = link.getAttribute("href");
    if (url) vscode.postMessage({ type: "openUrl", url });
  });
}

function kindLabel(kind, labels) {
  if (kind === "markdown") return labels.markdown || "Markdown";
  if (kind === "html") return labels.html || "HTML";
  if (kind === "json") return labels.json || "JSON";
  if (kind === "empty") return labels.text || "Text";
  return labels.text || "Text";
}

function isJson(raw) {
  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

function looksLikeHtml(raw) {
  return /^\s*</.test(raw) && /<\/[a-z][^>]*>|<[a-z][^>]*\/?>/i.test(raw) && (raw.match(/<[a-z]/gi) || []).length >= 1;
}

function looksLikeMarkdown(raw) {
  return /^(#{1,6}\s|```|>\s|\s*[-*+]\s|\s*\d+\.\s)/m.test(raw)
    || /\[[^\]]+\]\([^)]+\)/.test(raw)
    || /(^|\s)(\*\*|__).+\2/.test(raw)
    || /`[^`]+`/.test(raw)
    || /^\s*\|.+\|\s*$/m.test(raw);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function markdownToHtml(src) {
  const fences = [];
  let text = src.replace(/\r\n/g, "\n");
  text = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, _lang, code) => {
    const id = fences.length;
    fences.push(`<pre class="notes-code"><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
    return `\n%%FENCE${id}%%\n`;
  });
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.trim().match(/^%%FENCE(\d+)%%$/);
    if (fence) {
      out.push(line.trim());
      i += 1;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const n = heading[1].length;
      out.push(`<h${n}>${inlineMarkdown(heading[2])}</h${n}>`);
      i += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const bits = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        bits.push(inlineMarkdown(lines[i].replace(/^>\s?/, "")));
        i += 1;
      }
      out.push(`<blockquote>${bits.join("<br>")}</blockquote>`);
      continue;
    }
    if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && /^\s*\|.+\|\s*$/.test(lines[i])) {
        const cells = lines[i].replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((cell) => cell.trim());
        if (!/^\s*:?-{3,}/.test(cells.join(""))) rows.push(cells);
        i += 1;
      }
      if (rows.length) {
        const head = rows.shift();
        const thead = `<thead><tr>${head.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join("")}</tr></thead>`;
        const tbody = rows.length
          ? `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`
          : "";
        out.push(`<table>${thead}${tbody}</table>`);
      }
      continue;
    }
    if (/^(\s*[-*+]|\s*\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (i < lines.length && /^(\s*[-*+]|\s*\d+\.)\s+/.test(lines[i])) {
        items.push(`<li>${inlineMarkdown(lines[i].replace(/^(\s*[-*+]|\s*\d+\.)\s+/, ""))}</li>`);
        i += 1;
      }
      out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push("<hr>");
      i += 1;
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const para = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|```|>\s|(\s*[-*+]|\s*\d+\.)\s+|%%FENCE|\s*\|.+\|)/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    out.push(`<p>${para.map(inlineMarkdown).join("<br>")}</p>`);
  }
  return out.join("\n").replace(/%%FENCE(\d+)%%/g, (_, n) => fences[Number(n)]);
}

function inlineMarkdown(value) {
  let text = escapeHtml(value);
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^\w*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  text = text.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  text = text.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (_, prefix, url) => {
    const clean = url.replace(/[.,;:!?)]+$/, "");
    return `${prefix}<a href="${clean}">${clean}</a>${url.slice(clean.length)}`;
  });
  text = text.replace(/(^|[\s])@([A-Za-z0-9-]+)/g, '$1<span class="notes-mention">@$2</span>');
  return text;
}

function sanitizeHtml(html) {
  const allowed = new Set([
    "P", "BR", "STRONG", "B", "EM", "I", "A", "UL", "OL", "LI", "H1", "H2", "H3", "H4", "H5", "H6",
    "CODE", "PRE", "BLOCKQUOTE", "HR", "SPAN", "DIV", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD",
    "IMG", "DEL", "INS", "SUP", "SUB",
  ]);
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  const clean = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === 8) {
        child.remove();
        return;
      }
      if (child.nodeType !== 1) return;
      if (!allowed.has(child.tagName)) {
        const parent = child.parentNode;
        while (child.firstChild) parent.insertBefore(child.firstChild, child);
        child.remove();
        clean(node);
        return;
      }
      [...child.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = attr.value || "";
        if (name.startsWith("on") || name === "srcdoc" || name === "style") {
          child.removeAttribute(attr.name);
          return;
        }
        if ((name === "href" || name === "src") && !/^(https?:|mailto:|#)/i.test(value)) {
          child.removeAttribute(attr.name);
        }
      });
      if (child.tagName === "A") {
        child.setAttribute("rel", "noreferrer");
      }
      clean(child);
    });
  };
  clean(wrap);
  return wrap;
}
