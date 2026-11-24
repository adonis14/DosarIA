# portal.just.ro SOAP integration — findings and enablement gate

Status (2026-11-25): **implemented behind a disabled feature flag; NOT approved for use.**
The mock provider remains the default. Nothing in the application polls the portal.

## 1. Evidence base

Everything below was established on 2026-11-25 from one of three sources:

| Source | How it was obtained |
|---|---|
| WSDL `http://portalquery.just.ro/query.asmx?WSDL` | Fetched once and parsed. The court list was generated from it into `institutions.generated.ts`. |
| Official sample request/response pages `?op=CautareDosare`, `?op=CautareSedinte` | Fetched once each. |
| Live validation run (`npm run test:portal-live`) | Two runs, ≤ 3 requests each: one HTTPS probe through the real provider, one public hearing list, one public case. The report contains no personal data. |
| portal.just.ro terms (`/SitePages/termeni.aspx`), programmatic-access page (`/SitePages/acces.aspx`), service documentation (.doc) | **Not read.** All return HTTP 403 to automated clients (Cloudflare bot protection). Deliberately not circumvented. |
| Web search snippets about those pages | Secondary and unverified. Marked as such below. |

## 2. Endpoint and transport — BLOCKER

| Check | Result |
|---|---|
| `https://portalquery.just.ro/query.asmx` | **HTTP 525** (Cloudflare cannot complete TLS to the origin). Failed on every attempt made that day (5 of 5, spread across the session), including two through the real provider. |
| `http://portalquery.just.ro/query.asmx` | HTTP 200. Served by Cloudflare → ASP.NET 2.0 (`X-AspNet-Version: 2.0.50727`). |
| WSDL `soap:address` | `http://portalquery.just.ro/query.asmx` (HTTP only) |

Consequence: the provider **refuses plain HTTP by design**. The list of case
numbers a firm monitors reveals its client relationships, which is
confidential. Even with the flag enabled, every check is therefore currently
recorded as **"Sursă indisponibilă"** (`source HTTP 525`). It is never recorded
as "no changes".

Options to unblock, in order of preference:
1. The Ministry of Justice / court IT fixes TLS on the origin. Ask formally.
2. An officially provided secure channel or alternative API.
3. Last resort, only with a written legal and risk decision: HTTP for
   **public, non-client queries only**. That is not compatible with monitoring
   client files, so it doesn't unlock the product.

## 3. Service contract (from the WSDL)

Namespace `portalquery.just.ro`, SOAP 1.1/1.2, no authentication, no API key.

| Operation | Inputs | Notes |
|---|---|---|
| `CautareDosare` | `numarDosar`, `obiectDosar`, `numeParte` (all optional); `institutie`, `dataStart`, `dataStop` (required, nillable) | Used by the provider: number + court |
| `CautareDosare2` | as above, plus `dataUltimaModificareStart/Stop` | **Filter by last modification**: the right primitive for any future, approved, efficient polling |
| `CautareSedinte` | `dataSedinta`, `institutie` (both required) | Hearing list per court and day. **No party names.** |
| `HelloWorld` | none | Health check |

`Dosar` fields:
- `numar`, `numarVechi`, `data`, `institutie` (an enum of 246 courts)
- `departament`, `categorieCaz`/`categorieCazNume`, `stadiuProcesual`/`stadiuProcesualNume`
- `obiect`, `dataModificare`
- `parti[]` (`nume`, `calitateParte`)
- `sedinte[]` (`complet`, `data`, `ora`, `solutie`, `solutieSumar`, `dataPronuntare`, `documentSedinta` (an enum of 816 values), `numarDocument`, `dataDocument`)
- `caiAtac[]` (`dataDeclarare`, `parteDeclaratoare`, `tipCaleAtac`)

## 4. Live observations (one court, one day, one case — not statistically representative)

| Observation | Value |
|---|---|
| `CautareSedinte` Tribunalul București, 2026-11-23 | 145 sessions, **1,001** case entries, 330 KB, 2.0–3.0 s |
| `CautareDosare` by number + court | 1 exact match, 17 KB, 0.6 s |
| Mapping → normalizer | **complete**, with no missing fields |
| `dataModificare` | Hearing 2026-11-23 09:00; record modified 2026-11-23 13:38 (same day). Has milliseconds and **no time-zone offset**. |
| Hearings | 23. All have `ora`; 22 have `solutie` and `solutieSumar`; 15 have `dataPronuntare` |
| Longest `solutieSumar` | **5,202 characters** |
| `solutie` vocabulary seen | Amână cauza, Amână pronunţarea, Admite cererea, **Alte soluţii**, **Termen preschimbat** |
| `solutieSumar` contains party / practitioner names | **Yes** |
| Rate-limit headers / HTTP 429 | None observed at this volume. Limits are unknown. |

Unverified secondary sources (search snippets about the official pages):
- The service is "intended for applications developed by third parties".
- At least one of number, subject or party is required.
- Results are capped at 1,000 per query (one source says 10,000). The 1,001
  entries above may hint at a cap on hearing lists.
- Delays versus ECRIS are "generally not more than 24 hours".
- Confidential cases are not published.

**All of these must be confirmed by a person reading the official pages in a browser.**

## 5. Implementation (feature-flagged)

| File | Purpose |
|---|---|
| `src/server/monitoring/providers/portal-just-soap-provider.ts` | Provider: HTTPS-only, approval flag, exact court and number match, one request at a time with a 2 s minimum gap, `redirect: "error"`, 5 MB cap, 52x/5xx/429 → unavailable |
| `…/portal-just/soap.ts` | Envelope builder (escaped values, `xsi:nil`) and a strict XML parser: DTD/entities rejected, unknown entities rejected, malformed markup rejected; SOAP faults are sanitized |
| `…/portal-just/mapping.ts` | `Dosar` → normalizer input. **Party list dropped.** Status **derived and labelled "(dedus din ședințe)"**. Hours normalized. Europe/Bucharest offset (EET/EEST). Texts bounded (summary ≤ 10,000) |
| `…/portal-just/institutions(.generated).ts` | The 246 court values from the WSDL, plus an exact, diacritics-insensitive resolver. Unknown names → `court_not_recognized` (no guessing) |
| `src/server/monitoring/check-case.ts` | **Additive:** honours a provider's `minIntervalMs` (default 60 min for the portal). A too-early check is refused and nothing is recorded, so freshness is never overstated |
| `tests/unit/portal-just.test.ts` | 37 tests with a synthetic fixture and fake transport (no network) |
| `tests/portal-live/portal.live.test.ts` | Opt-in live validation (separate config, request budget, no-PII report) |

Activation requires **all** of the following:
- `COURT_DATA_PROVIDER=portaljust_soap`
- `PORTAL_JUST_INTEGRATION_APPROVED=true`
- an `https://` endpoint that actually works

Optional settings: `PORTAL_JUST_MIN_INTERVAL_MINUTES` (15–1440, default 60)
and `PORTAL_JUST_TIMEOUT_MS`.

## 6. Data-protection findings

- **Party lists** (`parti`) often name natural persons. They are not stored,
  because the product doesn't need them.
- **Solution summaries** written by the court also name parties and
  practitioners, so a stored snapshot of a real case **contains personal
  data**. For a firm's own cases this is part of its legitimate case file, but
  it must be covered by the DPA, retention and erasure procedures.
- **The (disabled) LLM path** allow-lists `solution_text`. Before any LLM is
  enabled, summaries must be **pseudonymized** (names → placeholders), in
  addition to the existing EU/DPA gates.
- **No bulk harvesting.** The hearing-list operation could enumerate thousands
  of unrelated cases, so the product must only ever query a firm's own case
  numbers.

## 7. Enablement checklist (all required)

- [ ] A person has read and archived the current **Termeni și condiții** and the
      **acces programatic** page and documentation. Automated use for a
      commercial service is confirmed to be permitted, and any request-volume
      limits are recorded.
- [ ] Written confirmation (or no objection) from the portal operator for the
      intended volume. Contact details recorded.
- [ ] **HTTPS works end to end** (no 525), verified with `npm run test:portal-live`.
- [ ] Legal basis, DPA clauses and retention cover snapshots that contain
      personal data from court summaries.
- [ ] `solutie` classifier calibrated against real vocabulary and reviewed by a lawyer.
      For example, "Termen preschimbat" is a rescheduling, and "Alte soluţii" is ambiguous.
- [ ] Appeals (`caiAtac`) modelled, or explicitly out of scope.
- [ ] Staging validation on synthetic and approved test files only (see `STAGING-DEPLOYMENT.md`).
- [ ] Monitoring and alerting on provider error rates; kill switch = unset the flag.

**Until every box is ticked, keep `PORTAL_JUST_INTEGRATION_APPROVED=false`.**
