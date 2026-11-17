# Provider protection

Protection is an explicit setting on each provider. Adding an API first runs a bounded, credential-free inspection of public gateway signals. When New API or One API fingerprints are found, the user must choose **Continue without protection** or **Enable protection**. Escape, backdrop clicks and closing the settings draft cannot dismiss that choice. The provider's Advanced tab can change protection later, including enabling it when the gateway is unknown.

The detector identifies observable software fingerprints. It cannot establish nationality, operator identity, malicious intent or a deployment's authenticity. Headers, pages and assets can be removed or forged. The source-pinned evidence and exact probe limits are recorded in the internal PROVIDER-GATEWAY-RESEARCH.md research notes.

## Request and tool boundaries

`src/providers/registry.ts` creates a protection runtime only for an enabled provider. Protected fallback providers share a vault within that active provider chain, while the selected provider controls tool protection. An unprotected provider does not inherit masking merely because another configured provider is protected.

Before a protected request leaves the process, the vault scans a copy of the system prompt, message history, tool schemas and request options. The final JSON HTTP body is scanned again after protocol-specific extra fields have been merged. Raw user messages remain unchanged in application memory. Authentication still sends the selected API credential in the provider's authentication header: a service must receive its own credential to authenticate the request. This setting protects context secrets, not the credential used to authorize that service.

Secrets become references such as `[[secret_<64 hexadecimal characters>]]`. Each vault uses a random 32-byte HMAC-SHA256 key. Equal values within that runtime have equal tags; other runtimes cannot correlate them through the tag. The map and HMAC key remain in process memory. No persistent mapping is written.

The scanner recognizes:

- Sensitive dotenv, JSON and YAML assignments, authorization schemes, URL userinfo and sensitive query fields.
- JWTs, complete and incomplete PEM private-key blocks, and known credential formats for AWS, Google, GitHub, OpenAI, Slack, Stripe, npm, PyPI, GitLab, Hugging Face, DigitalOcean, Databricks, Linear, Square and SendGrid.
- Exact copies of registered secrets, including JSON-escaped, URL-encoded, base64, base64url and hexadecimal representations. Each representation restores to its exact original bytes.

Scanners parse lexical formats. Tool permissions, continuation, retries and execution decisions use typed state and existing APIs rather than text heuristics.

A model can retain a tag inside a file edit or tool argument. Immediately before local schema validation and authorization, the harness resolves known tags. Unknown, incomplete or foreign-runtime tags fail closed. File data in native read, grep, glob, write, edit and apply_patch can restore arbitrary secret bytes. Delegated prompts, memory, context pages, todo, ask and done keep validated tags instead of sending originals to another model or store.

For executable and external-tool arguments, restored values currently accept only ASCII letters, digits and `_-./:@%+=,`. A password containing quotes, whitespace, dollar expansion or other shell syntax is rejected with guidance to use an environment/file or an encoded representation. This prevents a secret value from becoming shell source. `ponytail:` a future typed argv/env capability can carry arbitrary secret bytes without shell interpretation.

Configured tool, permission and subagent hooks receive tagged arguments and results on this path. Shell checkpoint command metadata is tagged before persistence. Local recovery snapshots may contain original file contents because undo must restore those files; snapshots remain subject to the existing local storage and path restrictions.

## Actions from a protected provider

The existing permission engine requires a fresh human answer for protected writes, shell commands, network actions, MCP, skills, module operations and subagent launches. Explicit deny rules still win. Saved broad allows, automatic permission review, session grants and “always allow” cannot bypass this checkpoint. Approval is limited to the prepared operation. Without a human approval channel, the action fails closed.

A delegated launch itself needs approval even when the configured child uses an unprotected provider. That launch authorizes delegation under the child's existing permissions; it does not automatically mark the other provider as protected. Secret references in the delegation remain opaque.

This checkpoint does not decide whether an instruction is malware. It prevents the provider from silently turning a response into a privileged action. A user-approved command can still read files or use the network according to the configured sandbox.

## Responses and output

Protected responses enforce declared tool names, unique nonempty tool-call IDs, the request's tool-choice setting, a completed terminal event, at most 128 calls and a combined 1 MiB tool-argument inspection budget. An invalid response cannot silently fail over to an unprotected model.

Partial tool arguments are withheld. Model text, reasoning and provider data are assembled and scanned before publication, with a 16 MiB inspection limit. This handles credentials split across chunks and copies repeated in different fields. `ponytail:` protected model text currently appears after response completion; an incremental scanner that preserves multiline and arbitrarily split credentials can restore streaming.

Tool results are scanned before full tool-log writes and model delivery. Protected foreground process logs and tool-output events buffer up to 2 MiB before disk writes or callbacks. Stdout and stderr are assembled independently and scanned together; channel groups retain their first-seen ordering rather than exact interleaving. Overflow suppresses the buffered output in full, since even a completed line can belong to an unfinished multiline secret. Protected PTY tool output follows the same boundary. Background job snapshots withhold incomplete output and scan completed logs; truncated protected logs are suppressed.

Known vault values also register with shared log redaction. Explicit disposal releases registrations. A finalizer releases registrations when a provider runtime becomes unreachable; garbage collection is not a deterministic expiry deadline. Retaining an active provider retains its map so tags remain usable.

## Source ideas and limits

The implementation adopts selected source-backed principles, without importing a daemon, proxy or dependency:

- Pipelock: bidirectional secret inspection, encoded representations, bounded inspection and refusal when content cannot be fully inspected. Reviewed commit [`1be109ee54b9950ab0eb66130c8560a411a4ae8f`](https://github.com/pipelab-org/pipelock/tree/1be109ee54b9950ab0eb66130c8560a411a4ae8f), particularly [text DLP](https://github.com/pipelab-org/pipelock/blob/1be109ee54b9950ab0eb66130c8560a411a4ae8f/internal/scanner/text_dlp.go) and [encoding views](https://github.com/pipelab-org/pipelock/blob/1be109ee54b9950ab0eb66130c8560a411a4ae8f/internal/scanner/text_encodings.go).
- Holone: declared-tool checks, protocol anomaly detection and refusal of oversized or incomplete calls. Reviewed commit [`c63d7664523f8626f348c5745fa03019bca2f5f2`](https://github.com/vanndh/holone/tree/c63d7664523f8626f348c5745fa03019bca2f5f2), particularly the [inspection engine](https://github.com/vanndh/holone/blob/c63d7664523f8626f348c5745fa03019bca2f5f2/internal/inspect/inspect.go).
- Flecten: reversible opaque references and the existing typed human approval boundary instead of deleting credentials from useful local workflows.

This is not full feature parity with either project, an OS-wide firewall, a malware scanner, TLS interception or a perfect prompt-injection classifier. It does not inspect image pixels or OCR attachments. An arbitrary unknown opaque value without recognizable context may not be detected. Novel encodings, deliberate secret fragmentation across separate tool results and transformations not registered with the vault are outside the current scanner's guarantees.

Provider recreation or application restart creates a new vault. Historical tags cannot be resolved by that replacement runtime; the model must reread the original local source. Tags are not durable secret-storage identifiers. Existing local project trust, sandbox, extension trust and secret storage rules continue to apply.

## Verification

Unit tests cover gateway contracts and forged/weak signals, credential-free bounded probes, secret formats and representations, malformed references, protected stream buffering, overflow suppression and provider settings. Integration tests exercise a real HTTP transport and a real read-to-edit secret roundtrip, human-only approval, tagged hooks, log output and blocked delegation without an approval channel. The hidden Electron scenario checks the two-button dialog, provider-scoped persistence and disabling protection at 1480x940 and 1180x640.
