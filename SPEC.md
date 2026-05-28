# Proof of Creation — Specification (v1)

Proof of Creation is an **open receipt format and verification protocol** for AI-generated work. It lets anyone — creator, marketplace, collector, or third-party tool — verify the **origin and history** of an AI creation, anchored on the Base blockchain.

This specification is intentionally **implementation-agnostic**. Anyone may write a verifier in any language; if it produces the same answer as the reference implementation in [`verify-core.mjs`](./verify-core.mjs) against the same inputs, it is conformant.

> **What this proves:** a specific manifest (prompt + params + output hash + wallet + timestamp) was committed to a public ledger at time T, and was optionally minted as an artifact. Tamper-evident: any field change yields a different hash.
>
> **What this does NOT prove:** absolute originality, "first to create globally," or that the human or agent behind the wallet authored anything in a legal sense. Proof of Creation proves **provenance and priority**, not authorship in an absolute sense.

---

## Terms

| Term | Meaning |
|---|---|
| **Proof of Creation** | The receipt itself — a manifest + its sha256 hash + an on-chain anchor + (optionally) a mint. This is the *standard* defined by this document. |
| **AI Creation Layer** | The umbrella product/category that issues, anchors, exposes, and verifies Proofs of Creation. *Not* a new blockchain or L2 — a **provenance layer on Base**. |
| **Manifest** | The canonical JSON object whose sha256 is the on-chain commitment. |
| **Manifest hash** | `sha256(canonical_manifest_bytes_utf8)`, expressed as 64 lowercase hex chars (no `0x` prefix in the source manifest field; `0x`-prefixed when used as a 32-byte hash on-chain). |
| **Anchor** | A `MythosForgeAnchor.anchor()` call on Base whose `manifestHash` argument matches the manifest hash. Permissionless — anyone may anchor. |
| **Mint** | A `MythosForgeSubmissions.mint()` call on Base producing an ERC-1155 token whose `tokenId == uint256(manifestHash)`. Permissionless — anyone may mint. |
| **Badge** | The verifier's summary of an on-chain lookup: *Minted*, *Platform-Attested*, *Anchored on Base*, or *Unverified*. |

Scope of this spec: **MythosForge-issued creations today.** External tools may implement and emit compatible proofs against the same contracts; the spec is open so that adoption can grow organically after publication of the spec and SDKs.

---

## Manifest schema

A manifest is a JSON object with the following fields. The required fields MUST be present on every v1 manifest; optional cognitive-trace fields MAY be included.

### Required fields

| Field | Type | Notes |
|---|---|---|
| `prompt` | string | The full text prompt. Verbatim — leading/trailing whitespace is part of the prompt. |
| `negative_prompt` | string | Empty string `""` allowed; the field MUST be present. |
| `model_id` | string | e.g. `"flux-1.1"`, `"sdxl-1.0"`. |
| `model_version` | string | Provider-reported version string. Empty string allowed. |
| `seed` | integer \| null | Integer (including `0` as a valid distinct value). Use `null` when the generator did not specify a seed — do not conflate `null` with `0`. |
| `params` | object | Generation params (e.g. `steps`, `guidance`). `{}` if none. Values must be JSON-canonicalizable. |
| `output_hash` | string | Lowercase hex sha256 of the original rendered image bytes (pre-resize, pre-thumbnail). 64 hex chars, no `0x` prefix. |
| `submitter_wallet` | string | `0x…` hex address (or other wallet identifier). For MythosForge issuance this is the agent's wallet. |
| `timestamp` | string | ISO-8601 UTC, e.g. `"2026-05-12T20:30:54Z"`. |

### Optional cognitive-trace fields

These extend the proof to include the *process*, not just the final inputs/output. Including them commits them to the hash and exposes them to anyone who has the full manifest — omit if you intend the process to remain private.

| Field | Type | Notes |
|---|---|---|
| `iteration_history` | `IterationStep[]` | Sequence of generation steps; order is meaningful. |
| `human_edits` | `HumanEdit[]` | Sequence of explicit human edits to manifest fields after generation. |
| `reliance_intent` | string | Free-form: what this proof is being relied on for. |

```ts
interface IterationStep { step: number; prompt: string; note?: string }
interface HumanEdit    { at: string; field: string; before: string; after: string; by: string }
```

> **Privacy note:** every field listed above commits to the manifest hash when present. A manifest's hash does **not** reveal its contents — a verifier with only the hash and an on-chain anchor learns nothing about the prompt. But anyone holding the full manifest JSON (e.g. via the proof bundle download) can read everything in it. Use cognitive-trace fields intentionally.

---

## Canonicalization

The manifest hash is computed over a **canonical** JSON serialization, not raw `JSON.stringify` output. These rules are normative — any implementation that re-hashes a manifest MUST follow them exactly, or it will produce a different hash:

1. **Object keys serialized in lexicographic (UTF-16 codepoint) order.** Equivalent to JavaScript `Object.keys(obj).sort()`.
2. **No whitespace between JSON tokens.** No spaces, tabs, or newlines outside of string values.
3. **Optional fields omitted when undefined.** Do NOT serialize an absent field as `null`. A manifest without cognitive-trace fields hashes identically whether the caller passed `undefined` or omitted the key entirely.
4. **String values preserved verbatim.** Whitespace, casing, and Unicode are byte-identical to the input. JSON-escape per [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259).
5. **Numbers serialized via spec JSON.** Integers and finite floats only — `NaN`, `±Infinity`, and `-0` are not allowed.
6. **Arrays preserve insertion order.** Order is meaningful (e.g. `iteration_history` is a sequence).

### Hashing

```
canonical_bytes = utf8_encode(canonicalize(manifest))
manifest_hash   = lowercase_hex(sha256(canonical_bytes))      # 64 chars, no 0x
```

Reference implementation: `canonicalize()` and `hashManifest()` in `apps/web/lib/v1-manifest.ts` (MythosForge application repo). Independent re-implementations should produce the identical 64-char hex digest for the same logical manifest.

> This specification is **self-sufficient** — the six rules above are the normative source. Reference-implementation paths in this document are a courtesy for cross-checking; reimplementers do not need access to MythosForge's application code to be conformant.

---

## On-chain layout (Base mainnet, chain id 8453)

Proof of Creation uses two contracts on Base. Both are **permissionless by design** — anyone may write to them; the verifier filters by caller address to derive the *Platform-Attested* badge.

### Anchor contract — `MythosForgeAnchor`

| | |
|---|---|
| Address | `0x936cc31Ce3D0e0abcD76ED29851Ab8bC5f8bEFf9` |
| Role | Emit-only event registry. Tx history of the contract address IS the registry — no state, no funds, no admin. |
| Function | `anchor(bytes32 manifestHash, bytes32 agentIdHash, string agentId, string agentWallet)` |
| Event | `Anchor(bytes32 indexed manifestHash, bytes32 indexed agentIdHash, string agentId, string agentWallet)` |
| Event topic0 | `0xe26330fb69e6d6cdfaf33baaba97994bb1a77473f4d347e251a6b122c173b0cf` |
| `agentIdHash` | `keccak256(abi.encodePacked(agentId))` — indexed for cheap per-agent log filtering. Not verified on-chain; integrity is the caller's responsibility. |

**Platform-Attested anchor:** the published MythosForge platform anchor wallet (`0x0d648b9e7046201912d23f9d68d17614a9fe66e8`) is the canonical issuer. Anchors sent by this wallet are *Platform-Attested*; anchors sent by other wallets are still valid `Anchor` events on-chain but are not Platform-Attested.

### Mint contract — `MythosForgeSubmissions`

| | |
|---|---|
| Address | `0x21d6Ce25aa1AB3F59eE51b7693A596C6d39A03C9` |
| Standard | ERC-1155, one supply-1 token per submission. |
| `tokenId` rule | `tokenId = uint256(manifestHash)`. Front-run-resistant — a griefer needs the manifest hash to mint a slot, which requires the image bytes the original creator alone holds at mint time. |
| `mint(uint256 tokenId, address to, bytes32 manifestHash, bytes32 originalOutputHash, bytes fullTokenURI)` | Permissionless. Stores `fullTokenURI` via SSTORE2; `uri(tokenId)` returns it verbatim. |
| `uri(tokenId)` | Returns the full `data:application/json;base64,...` blob. O(1) (single SSTORE2 read). |
| `tokenData(tokenId)` | Returns `(manifestHash, originalOutputHash, tokenURIPointer)` without parsing the URI blob. |
| Event | `Submission(uint256 indexed tokenId, bytes32 indexed manifestHash, bytes32 originalOutputHash, address indexed to, address minter, address tokenURIPointer)` |

The on-chain `tokenURI` is a self-contained `data:application/json;base64` URI that includes an embedded thumbnail and a `manifest_hash` field. The verifier MUST treat the tokenURI's `manifest_hash` and the `manifestHash` argument that produced the `tokenId` as the source of truth, not the embedded prompt text (which is informational; the cryptographic commitment is the hash, not the text).

---

## Badge derivation

A verifier computes the badge from on-chain reads alone:

```
mint_exists       = MythosForgeSubmissions.uri(tokenId) resolves
anchor_exists     = at least one Anchor(manifestHash=H, …) event exists
platform_attested = anchor_exists AND anchor caller == platform_anchor_address

badge =
  Minted              if mint_exists
  Platform-Attested   else if platform_attested
  Anchored on Base    else if anchor_exists
  Unverified          else
```

| Badge | Meaning |
|---|---|
| **Minted** | The ERC-1155 token with `tokenId == uint256(manifestHash)` resolves on the Submissions contract. The strongest on-chain claim. (Anchor status is honored separately as a sub-claim when present.) |
| **Platform-Attested** | An on-chain `Anchor` event matches and was sent by the published platform anchor wallet. MythosForge stands behind the anchor; the proof has not (yet) been minted as an artifact. |
| **Anchored on Base** | An on-chain `Anchor` event matches but was sent by some other wallet. The proof exists on Base; MythosForge has not attested it. |
| **Unverified** | No matching anchor and no matching mint. Either the manifest was never anchored, or the input hash does not match any committed manifest. |

Badge precedence is **Minted > Platform-Attested > Anchored on Base > Unverified.** This is intentional: a mint without anchor is still a fully-on-chain commitment; an anchor without mint is a timestamped commitment that has not crossed the artifact-on-chain boundary.

---

## Verify algorithm

Given an input — a `tokenId` (decimal or hex), a 64-char manifest hash, or a 32-byte anchor/mint tx hash — the verifier produces a Proof of Creation result entirely from Base reads.

```
verifyCreation(input, config):
    # 1. Resolve input → tokenId (== manifestHash as uint256)
    tokenId = parse_as_decimal_or_hex(input)
    if tokenId is null and input is 0x-prefixed 32-byte tx hash:
        tx = eth_getTransactionByHash(input)
        if tx.to in [mint_contract, anchor_contract]:
            tokenId = uint256(tx.input[4:36])    # first arg after the 4-byte selector
    if tokenId is null:
        return { ok: false, reason: "invalid_input" }

    manifest_hash_hex = "0x" + hex(tokenId).pad(64)

    # 2. Read mint side
    token_uri = eth_call(mint_contract, "uri(uint256)", tokenId)
    minted = token_uri is non-empty and decodes to a data: URI
    if minted:
        creation = parse_token_uri_json(token_uri)

    # 3. Read anchor side
    #    Prefer an "Anchor Tx" hint in the tokenURI attributes (no scan needed);
    #    otherwise scan Anchor logs by the indexed manifestHash.
    anchor = find_anchor(manifest_hash_hex)
        # eth_getLogs(address=anchor_contract,
        #             topics=[anchor_event_sig, manifest_hash_hex])
        # → first match: tx.from is the anchor caller
    anchored          = anchor.found
    platform_attested = anchored and anchor.caller == platform_anchor_address

    # 4. Derive badge (see Badge derivation above)
    badge = derive_badge(minted, platform_attested, anchored)

    # 5. Return
    return {
        ok: true,
        badge,
        tokenId, manifest_hash: manifest_hash_hex,
        minted, creation,
        anchor: { tx_hash, caller, source: platform | third-party } if anchored else null,
        chain: { name: "base", chainId: 8453 },        # implementation context
    }
```

The **protocol-level result** is `badge`, `manifest_hash`, `tokenId`, `minted`, and `anchor`. The `chain` block is implementation context — a verifier MAY surface additional runtime metadata (e.g. `rpcUrl` actually used, scan window bounds, latency) as long as the protocol-level fields are present and computed correctly. Two conformant verifiers must agree on the protocol-level fields for the same input; they may differ in implementation context.

Notes for implementers:

- The public Base RPC caps `eth_getLogs` at ~10,000 blocks per call. Conformant verifiers paginate backward in 10k-block windows; the reference implementation uses 40 windows (~400k blocks), enough to cover the contract's lifetime to date.
- `eth_call` returning `0x` (empty) for `uri(tokenId)` means *not minted*, not *error*. Treat as a clean negative. If a node *reverts* on an unknown id (some ERC-1155 implementations do), also treat as not-minted — unless the revert reason indicates a different protocol-level failure (RPC error, contract paused, etc.), which should propagate.
- The verifier reads on-chain `Anchor` events directly — it does not require MythosForge's database or API. A verifier that calls `mythosforge.xyz` for any verification step is NOT conformant with this spec.

---

## Honest semantics

This spec is deliberately explicit about what a Proof of Creation does and does not prove:

- **Provenance, not absolute originality.** A Proof commits to "this manifest existed at time T," not "this is the first time anyone created this content anywhere." A perfect copy of an image can be anchored later under a different wallet; the original wins on priority because its anchor is timestamped earlier, but the copy still produces a valid (later) anchor event.
- **Priority, by Base block time.** Two anchors of the same manifest hash are ordered by block number / position. Earlier anchor = stronger priority claim.
- **Attestation, not endorsement.** *Platform-Attested* means "MythosForge's wallet signed the anchor transaction." It does not certify any external claim about the creator, the prompt, or the artifact's market value.
- **Hashes commit, they don't reveal.** Holding only a manifest hash and an on-chain anchor tells you *that* a specific manifest was committed at time T. To learn *what* the manifest contains, you need the manifest JSON itself.
- **No royalties enforced by the protocol.** Proof of Creation is *royalty-ready* — proofs carry the data marketplaces need to honor royalty splits — but the spec defines no enforcement mechanism. Royalty honoring is opt-in by integrating marketplaces.

---

## Versioning

This document specifies **Proof of Creation v1**. Breaking changes (new required manifest fields, changes to canonicalization, new contracts) get a new spec version. Additive, non-breaking extensions (new optional fields, new badge sub-statuses) are noted as v1.x and remain backward-compatible.

**Spec changelog:**
- **v1** (this document) — initial publication. Covers manifest schema, canonicalization, on-chain layout, badge derivation, verify algorithm, and honest semantics.

**Planned (forward-compatible) additions:**
- **v1.1 (sign-at-generation)** — adds an optional `signature` field to the manifest: an agent-wallet signature over a digest of `{manifestHash, outputHash, timestamp}`, included in the Anchor call so verifiers can recover the signer and confirm it matches `submitter_wallet`. Backward-compatible: verifiers MAY check signatures when present; v1 manifests without signatures remain conformant. A new badge sub-status (*Creator-Signed*) may be added alongside the existing four, layered onto *Minted* / *Platform-Attested* / *Anchored on Base* rather than replacing them.

---

## Reference materials

- Reference verifier (open, no deps): [`verify-core.mjs`](./verify-core.mjs).
- Reference manifest + canonicalization: `apps/web/lib/v1-manifest.ts` in the MythosForge application repo.
- Anchor contract: `MythosForgeAnchor.sol`. Mint contract: `MythosForgeSubmissions.sol`.
- Live verifier UI: <https://ryjin111.github.io/mythosforge-offsite-verifier/> — reads Base directly, makes zero calls to `mythosforge.xyz`.
