# Public gateway identification

Inspected on 17 November 2026 without running either project's code:

- [QuantumNous/new-api, `669d774976369e986f03b6e24fff1042f6f94832`](https://github.com/QuantumNous/new-api/tree/669d774976369e986f03b6e24fff1042f6f94832).
- [songquanpeng/one-api, `8df4a2670b98266bd287c698243fff327d9748cf`](https://github.com/songquanpeng/one-api/tree/8df4a2670b98266bd287c698243fff327d9748cf).

A deployment can suppress, replace or forge every public signal below. `confirmed` means an explicit project fingerprint was observed, not authenticated ownership or certainty about the deployed software. A fork can preserve the same fingerprint. `unknown` never means safe. This inspection says nothing about an operator's nationality, intent, retention policy or whether a response contains an injection.

## Source evidence and implemented checks

| Signal | Pinned source | Interpretation |
|---|---|---|
| `X-New-Api-Version` on every response | New API [`middleware/cors.go:18`](https://github.com/QuantumNous/new-api/blob/669d774976369e986f03b6e24fff1042f6f94832/middleware/cors.go#L18), installed in [`main.go:224`](https://github.com/QuantumNous/new-api/blob/669d774976369e986f03b6e24fff1042f6f94832/main.go#L224) | Explicit New API declaration, accepted even on HTTP error responses. The value is validated but never retained. |
| `X-Oneapi-Request-Id` | New API [`common/constants.go:197`](https://github.com/QuantumNous/new-api/blob/669d774976369e986f03b6e24fff1042f6f94832/common/constants.go#L197), [`middleware/request-id.go`](https://github.com/QuantumNous/new-api/blob/669d774976369e986f03b6e24fff1042f6f94832/middleware/request-id.go); One API [`common/helper/key.go:4`](https://github.com/songquanpeng/one-api/blob/8df4a2670b98266bd287c698243fff327d9748cf/common/helper/key.go#L4), [`middleware/request-id.go`](https://github.com/songquanpeng/one-api/blob/8df4a2670b98266bd287c698243fff327d9748cf/middleware/request-id.go) | Shared family signal. It cannot distinguish the two projects. |
| Exact `Cache-Version` value `b688f2fb5be447c25e5aa3bd063087a83db32a288bf6a4f35f2d8db310e40b14` | New API [`middleware/cache.go:14`](https://github.com/QuantumNous/new-api/blob/669d774976369e986f03b6e24fff1042f6f94832/middleware/cache.go#L14) | A source-pinned New API frontend signal, classified as suspected. |
| Public `GET /api/status` | New API [`router/api-router.go:28`](https://github.com/QuantumNous/new-api/blob/669d774976369e986f03b6e24fff1042f6f94832/router/api-router.go#L28); One API [`router/api.go:17`](https://github.com/songquanpeng/one-api/blob/8df4a2670b98266bd287c698243fff327d9748cf/router/api.go#L17) | No auth is needed in these sources. Only the JSON shape below is used. |
| Common status contract | New API [`controller/misc.go:50`](https://github.com/QuantumNous/new-api/blob/669d774976369e986f03b6e24fff1042f6f94832/controller/misc.go#L50); One API [`controller/misc.go:18`](https://github.com/songquanpeng/one-api/blob/8df4a2670b98266bd287c698243fff327d9748cf/controller/misc.go#L18) | Zod requires `success: true`, string `message`, and 15 typed data fields: `version`, `start_time`, `email_verification`, `github_oauth`, `github_client_id`, `system_name`, `logo`, `footer_html`, `wechat_qrcode`, `wechat_login`, `server_address`, `turnstile_check`, `turnstile_site_key`, `quota_per_unit`, `display_in_currency`. Other fields are allowed for version compatibility. Brand field values are not trusted as identity. |
| New API status extension | New API [`controller/misc.go:80`](https://github.com/QuantumNous/new-api/blob/669d774976369e986f03b6e24fff1042f6f94832/controller/misc.go#L80) | Requires typed `enable_batch_update`, `enable_drawing`, `enable_task`, `enable_data_export`, `data_export_default_time`, `default_collapse_sidebar`, `mj_notify_enabled`. Contract alone is suspected; together with the request header it confirms the observed New API fingerprint. |
| One API status extension | One API [`controller/misc.go:28`](https://github.com/songquanpeng/one-api/blob/8df4a2670b98266bd287c698243fff327d9748cf/controller/misc.go#L28) | Requires typed `lark_client_id`, `top_up_link`, `chat_link`, `oidc`, `oidc_client_id`, `oidc_well_known`, `oidc_authorization_endpoint`, `oidc_token_endpoint`, `oidc_userinfo_endpoint`. Same corroboration rule; shared One API fields alone never override a New API signal. Conflicting project-specific contracts remain unknown/suspected. |
| Exact parsed document title or title meta | New API [`web/index.html:9`](https://github.com/QuantumNous/new-api/blob/669d774976369e986f03b6e24fff1042f6f94832/web/index.html#L9); One API [`web/default/public/index.html:12`](https://github.com/songquanpeng/one-api/blob/8df4a2670b98266bd287c698243fff327d9748cf/web/default/public/index.html#L12), also air and berry themes | `New API` / `One API` is weak page branding. HTML is parsed with the existing parse5 library; scripts are never run. |
| Exact source repository anchor | New API [`web/src/components/layout/components/footer.tsx:132`](https://github.com/QuantumNous/new-api/blob/669d774976369e986f03b6e24fff1042f6f94832/web/src/components/layout/components/footer.tsx#L132); One API [`web/default/src/components/Footer.js:41`](https://github.com/songquanpeng/one-api/blob/8df4a2670b98266bd287c698243fff327d9748cf/web/default/src/components/Footer.js#L41) | Weak only. In client rendered pages the link may be absent from the initial HTML. No script bundle is downloaded. |
| Exact SHA-256 of `/favicon.ico` or `/logo.png` | New API [`web/public`](https://github.com/QuantumNous/new-api/tree/669d774976369e986f03b6e24fff1042f6f94832/web/public); One API [`web/default/public`](https://github.com/songquanpeng/one-api/tree/8df4a2670b98266bd287c698243fff327d9748cf/web/default/public), also air/berry favicon | Weak asset evidence. Even matching branding, source links and icons together never promote a backend to detected. |

Pinned asset SHA-256 values:

| Project | Asset | SHA-256 |
|---|---|---|
| New API | favicon | `18f33dbe5729c74d8a7f2ee8a7a7cced77e76914e855ca4495d8b65c18eff905` |
| New API | logo | `5b20392caae1c558b6d04743f9c0a731237914433c216caf91fd44564a8f5f2b` |
| One API | favicon, all three themes | `752c8f79e0e4c29601b162dc3e783198a764675ee2f3a7959213ebfe76791c90` |
| One API | logo, default and air themes | `c639eb5af36fb48aaa77615aa3824d533bd2d155772f324dcd4bab78b8ea2a24` |

## Other investigated source signals

These are documented rather than probed, because they need authenticated actions, are common infrastructure, or would add requests without reliable identification:

- New API `Auth-Version: 864b7076dbcd0a3c01b5520316720ebf`, [`middleware/auth.go:360`](https://github.com/QuantumNous/new-api/blob/669d774976369e986f03b6e24fff1042f6f94832/middleware/auth.go#L360), is set only after dashboard authentication. The detector never logs in.
- New API `specific_channel_version: 701e3ae1dc3f7975556d354e0675168d004891c8`, [`middleware/auth.go:717`](https://github.com/QuantumNous/new-api/blob/669d774976369e986f03b6e24fff1042f6f94832/middleware/auth.go#L717), belongs to an authenticated channel path. No generated or paid request is made.
- New API `X-New-Api-Other-Ratios`, [`controller/relay.go:912`](https://github.com/QuantumNous/new-api/blob/669d774976369e986f03b6e24fff1042f6f94832/controller/relay.go#L912), belongs to task submission responses. The detector submits no task.
- New API `X-Upstream-Request-Id`, [`common/constants.go:198`](https://github.com/QuantumNous/new-api/blob/669d774976369e986f03b6e24fff1042f6f94832/common/constants.go#L198), concerns upstream request tracking and is not unique across unrelated gateways.
- Additional New API status fields include `discord_oauth`, `linuxdo_oauth`, `telegram_oauth`, `theme`, `docs_link`, `quota_display_type`, `custom_currency_symbol`, `stripe_unit_price`, `api_info_enabled`, `uptime_kuma_enabled`, `HeaderNavModules`, `SidebarModulesAdmin`, passkeys and legal settings. These change over releases and are unnecessary once the explicit header or stable status contract matches.
- Routes `/api/models`, `/api/notice`, `/api/about`, `/api/home_page_content`, `/api/user/login` and `/api/channel` are shared across projects and forks. Route existence alone cannot identify a backend, and authenticated routes are not probed.
- Generic `Cache-Control`, CORS headers, a `session` cookie, Gin error formatting, OpenAI-compatible `/v1/models`, Chinese text, IP addresses, ASN and CDN providers are not fingerprints. No geographic or language classification is performed.
- Request ID formats differ in these snapshots, but the format is implementation detail that forks can change. No length, timestamp or regex guessing is used.
- New API supports custom names, logos, frontend settings and plugins; One API supports themes and custom branding. Removing weak assets is normal deployment configuration, not evidence of evasion.

## Request boundary and limits

`inspectProviderGateway(baseUrl, { fetch?, signal? })` returns the shared `ProviderGatewayInspection` schema. It makes four read-only GET requests: public status, page, fixed favicon and fixed logo. For a provider below a path prefix it also tries origin-root status and page, for six requests maximum. A final `v1` or `v1beta` protocol segment is removed when forming the public paths. All URLs are constructed from the configured origin and the fixed probe paths. URL queries and fragments are stripped. Embedded username/password URLs and non-HTTP schemes are rejected before networking.

Probes use only an `Accept` header. They receive no API key, custom provider headers, proxy credentials, cookies or browser referrer. Fetch uses `credentials: omit`, `redirect: manual` and `referrerPolicy: no-referrer`. No HTML link, CSS reference, JavaScript, remote icon, source link or status-supplied URL is fetched. Redirect bodies and cross-origin responses are ignored. This inspection contacts only the host already supplied by the user; local/private providers remain usable.

The shared deadline is four seconds. Each response body is limited to 128 KiB, cancellation stops awaiting a hanging request or body, and failures are recorded as fixed diagnostic evidence without raw network errors or response data. Classification reads exact schema fields, exact header names/values and exact asset hashes. It does not use regex heuristics or score arbitrary substrings. A reverse proxy exposing only `/v1`, changed assets, an older contract, stripped headers, an unavailable public status endpoint or a fork can cause `unknown` or `suspected`. Manual provider protection remains necessary for arbitrary intermediaries.

`ponytail:` the detector deliberately uses public fingerprints rather than an active challenge or an external reputation service. Add new versioned schema/asset fixtures when another release changes a public contract; authenticated identity would require explicit server attestation and a separate trust mechanism.
