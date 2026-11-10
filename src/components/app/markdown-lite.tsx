import { cn } from "@/lib/utils";

/** Inline: **bold**, _italic_ (whole phrase), `code`. */
function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|(?<![A-Za-z0-9])_[^_]+_(?![A-Za-z0-9]))/g;
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(pattern)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    const token = m[0];
    if (token.startsWith("**")) out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) out.push(<code key={key++} className="rounded bg-muted px-1 font-mono text-[0.85em]">{token.slice(1, -1)}</code>);
    else out.push(<em key={key++}>{token.slice(1, -1)}</em>);
    last = i + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Renders the small markdown subset Blink generates itself (the compiled
 * policy preview): headings, paragraphs, lists, blockquotes, and tables.
 * It never renders HTML, so text is always shown as text.
 */
export function MarkdownLite({ source, className }: { source: string; className?: string }) {
  const lines = source.split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push(<h3 key={key++} className="mt-6 border-t pt-4 text-base font-semibold text-foreground first:mt-0 first:border-0 first:pt-0">{inline(line.slice(3))}</h3>);
      i++;
    } else if (line.startsWith("# ")) {
      blocks.push(<h2 key={key++} className="text-lg font-semibold text-foreground">{inline(line.slice(2))}</h2>);
      i++;
    } else if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        const cells = lines[i].split("|").slice(1, -1).map((c) => c.trim());
        if (!cells.every((c) => /^-+$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={key++} className="overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr>{head?.map((c, j) => <th key={j} className="px-2 py-1.5 font-medium">{c}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((r, j) => (
                <tr key={j} className="border-t border-border">
                  {r.map((c, k) => (
                    <td key={k} className={cn("px-2 py-1 text-foreground", k === 0 || /^[A-Z_,\s]+$/.test(c) ? "font-mono text-[11px]" : "")}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith("- ")) items.push(lines[i++].slice(2));
      blocks.push(
        <ul key={key++} className="list-disc space-y-1 pl-5 text-sm text-foreground">
          {items.map((item, j) => (
            <li key={j}>{inline(item)}</li>
          ))}
        </ul>,
      );
    } else if (line.startsWith("> ")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) quote.push(lines[i++].slice(2));
      blocks.push(
        <blockquote key={key++} className="rounded-r-md border-l-4 border-border bg-muted px-3 py-2 text-sm text-foreground">
          {inline(quote.join(" "))}
        </blockquote>,
      );
    } else {
      blocks.push(
        <p key={key++} className="text-sm text-foreground">
          {inline(line)}
        </p>,
      );
      i++;
    }
  }
  return <div className={cn("space-y-3", className)}>{blocks}</div>;
}
