import { z } from "zod";

const PostId = z
  .string()
  .min(1)
  .max(20)
  .refine(
    (value) => [...value].every((character) => character >= "0" && character <= "9"),
    "Expected a numeric X post ID.",
  );
const Username = z
  .string()
  .min(1)
  .max(15)
  .refine((value) =>
    [...value].every(
      (character) =>
        (character >= "a" && character <= "z") ||
        (character >= "A" && character <= "Z") ||
        (character >= "0" && character <= "9") ||
        character === "_",
    ),
  );

export const SearchInput = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .describe(
      "X search query, for example from:OpenAI lang:en -is:retweet. Searches the last 7 days.",
    ),
});

function postId(value: string): string | undefined {
  if (PostId.safeParse(value).success) return value;
  const url = URL.parse(value);
  const parts = url?.pathname.split("/").filter(Boolean) ?? [];
  const id = parts.at(-1) ?? "";
  const path =
    (parts.length === 3 && parts[1] === "status") ||
    (parts.length === 4 && parts[0] === "i" && parts[1] === "web" && parts[2] === "status");
  if (
    url &&
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.port &&
    ["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname) &&
    path &&
    PostId.safeParse(id).success
  )
    return id;
  return undefined;
}

export const FetchInput = z.object({
  id: z
    .string()
    .min(1)
    .max(2048)
    .refine(
      (value) => postId(value) !== undefined,
      "Pass a numeric post ID or an https://x.com/user/status/ID URL.",
    )
    .describe("Post ID from search or an X/Twitter post URL."),
});

export const SearchOutput = z.object({
  results: z.array(z.object({ id: PostId, title: z.string(), url: z.url() })),
});
export const FetchOutput = z.object({
  id: PostId,
  title: z.string(),
  text: z.string(),
  url: z.url(),
  metadata: z.object({
    author: z.string().optional(),
    created_at: z.string().optional(),
    conversation_id: z.string().optional(),
    public_metrics: z.record(z.string(), z.number().int().nonnegative()).optional(),
  }),
});

const Post = z.object({
  id: PostId,
  text: z.string(),
  author_id: PostId.optional(),
  created_at: z.iso.datetime().optional(),
  conversation_id: PostId.optional(),
  public_metrics: z.record(z.string(), z.number().int().nonnegative()).optional(),
  note_tweet: z.object({ text: z.string() }).optional(),
});
const Includes = z
  .object({
    users: z.array(z.object({ id: PostId, username: Username })).optional(),
  })
  .optional();
const SearchResponse = z
  .object({
    data: z.array(Post).optional(),
    includes: Includes,
    meta: z.object({ result_count: z.number().int().nonnegative() }).optional(),
  })
  .refine((value) => value.data !== undefined || value.meta?.result_count === 0);
const FetchResponse = z.object({ data: Post, includes: Includes });

export class XApiFailure extends Error {}

export class XPosts {
  constructor(
    readonly accessToken: string,
    readonly fetcher: typeof fetch = fetch,
  ) {}

  async search(query: string, signal: AbortSignal): Promise<z.infer<typeof SearchOutput>> {
    const input = SearchInput.parse({ query });
    const raw = await this.#request(
      "/2/tweets/search/recent",
      { query: input.query, max_results: "10" },
      signal,
    );
    const response = SearchResponse.safeParse(raw);
    if (!response.success)
      throw new XApiFailure(
        "X returned an invalid search response or an unavailable search result.",
      );
    const posts = response.data;
    return { results: (posts.data ?? []).map((post) => this.#summary(post, posts.includes)) };
  }

  async fetch(id: string, signal: AbortSignal): Promise<z.infer<typeof FetchOutput>> {
    const input = PostId.parse(postId(FetchInput.parse({ id }).id));
    const raw = await this.#request(`/2/tweets/${input}`, {}, signal);
    const response = FetchResponse.safeParse(raw);
    if (!response.success)
      throw new XApiFailure(
        "The post is unavailable, deleted, or outside your X account's permissions.",
      );
    const { data: post, includes } = response.data;
    if (post.id !== input) throw new XApiFailure("X returned a different post ID.");
    const author = includes?.users?.find((user) => user.id === post.author_id)?.username;
    return {
      ...this.#summary(post, includes),
      text: post.note_tweet?.text ?? post.text,
      metadata: {
        ...(author ? { author } : {}),
        ...(post.created_at ? { created_at: post.created_at } : {}),
        ...(post.conversation_id ? { conversation_id: post.conversation_id } : {}),
        ...(post.public_metrics ? { public_metrics: post.public_metrics } : {}),
      },
    };
  }

  #summary(post: z.infer<typeof Post>, includes: z.infer<typeof Includes>) {
    const author = includes?.users?.find((user) => user.id === post.author_id)?.username;
    const preview = (post.note_tweet?.text ?? post.text).split("\n").join(" ").slice(0, 180);
    return {
      id: post.id,
      title: `${author ? `@${author}: ` : ""}${preview}`,
      url: `https://x.com/${author ?? "i/web"}/status/${post.id}`,
    };
  }

  async #request(
    path: string,
    parameters: Record<string, string>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const url = new URL(path, "https://api.x.com");
    url.search = new URLSearchParams({
      "tweet.fields": "author_id,created_at,conversation_id,public_metrics,note_tweet",
      expansions: "author_id",
      "user.fields": "username",
      ...parameters,
    }).toString();
    try {
      const response = await this.fetcher(url, {
        headers: { authorization: `Bearer ${this.accessToken}`, accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      });
      if (!response.ok) {
        const messages: Record<number, string> = {
          400: "X rejected the search query. Check its operators and syntax.",
          401: "X authorization expired or was revoked. Reconnect your X account.",
          402: "Your X application needs API credits or an API plan that permits this request.",
          403: "Your X application or account does not have access to this endpoint or post.",
          404: "The X post does not exist or is unavailable.",
          429: "X API rate limit reached. Wait before trying again.",
        };
        throw new XApiFailure(
          messages[response.status] ?? "X API is unavailable. Try again later.",
        );
      }
      return await response.json();
    } catch (error) {
      if (error instanceof XApiFailure) throw error;
      if (signal.aborted) throw new XApiFailure("X request cancelled.");
      throw new XApiFailure("X API request timed out, failed, or returned invalid JSON.");
    }
  }
}
