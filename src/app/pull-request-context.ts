import { z } from "zod";
import { type ContextReference, ContextReferenceSchema } from "../core/context-reference";

const PullRequestSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.string(),
  html_url: z.url(),
  user: z.object({ login: z.string() }),
  base: z.object({ ref: z.string() }),
  head: z.object({ ref: z.string() }),
});

export function pullRequestParts(raw: string): {
  owner: string;
  repository: string;
  number: number;
} {
  const url = new URL(raw);
  const [owner, repository, kind, id, extra] = url.pathname.split("/").filter(Boolean);
  const number = Number(id);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username ||
    url.password ||
    !owner ||
    !repository ||
    kind !== "pull" ||
    extra ||
    !Number.isSafeInteger(number) ||
    number <= 0
  )
    throw new Error("Укажите ссылку https://github.com/owner/repository/pull/123");
  return { owner, repository, number };
}

async function boundedBody(response: Response, limit: number): Promise<string> {
  if (!response.ok) throw new Error(`GitHub: ${response.status}. Проверьте доступ к PR.`);
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let output = "";
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) return output + decoder.decode();
      bytes += next.value.byteLength;
      if (bytes > limit) throw new Error("Контекст PR превышает допустимый размер");
      output += decoder.decode(next.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function pullRequestContext(raw: string): Promise<ContextReference> {
  const { owner, repository, number } = pullRequestParts(raw);
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls/${number}`;
  const response = await fetch(endpoint, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "Flecten" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const pr = PullRequestSchema.parse(JSON.parse(await boundedBody(response, 250_000)));
  return ContextReferenceSchema.parse({
    kind: "pull-request",
    source: pr.html_url,
    label: `${owner}/${repository} #${pr.number}: ${pr.title}`,
    text: `Author: ${pr.user.login}\nState: ${pr.state}\nBase: ${pr.base.ref}\nHead: ${pr.head.ref}\n\n${(pr.body ?? "").slice(0, 50_000)}`,
  });
}
