# MythosForge — Off-site Proof-of-Creation Verifier (v2.5)

Verify **any MythosForge creation entirely from the Base blockchain**, with
**zero calls to `mythosforge.xyz`** and **zero third-party libraries**.

v2 lets you verify a creation *on the MythosForge site*. **v2.5 lets anyone
verify it even if that site is gone** — the proof outlives the platform.

> **Standalone by design.** This repo is independent of the MythosForge
> application infra: no Supabase, no MythosForge API, no shared code with the
> production app. It reads Base directly via JSON-RPC and renders the answer.
> If `mythosforge.xyz` disappeared tomorrow, this still works.

## Live

- **Demo:** https://ryjin111.github.io/mythosforge-offsite-verifier/
- **Spec:** [`SPEC.md`](./SPEC.md) — Proof of Creation v1
- **RPC field is editable** — point it at *any* public Base node to prove the
  verifier is never talking to MythosForge infra.

## Use as a library (`@mythosforge/verify`)

```bash
npm install @mythosforge/verify
```

```js
import { verifyCreation } from '@mythosforge/verify';

const result = await verifyCreation(
  '54851462332250288029513346248177259202425846707039409026292648779135787226601'
);

console.log(result.badge);          // 'Minted'
console.log(result.manifestHash);   // '0x7944d3d6…9855e9'
console.log(result.anchor.source);  // 'platform'  (Platform-Attested)
```

Zero dependencies. Node 18+. Browser-compatible (it's just `fetch` + the
Web Crypto-friendly primitives). Reads Base directly — no MythosForge API calls.

See [`SPEC.md`](./SPEC.md) for the protocol-level contract this implements.

## Run the demo locally

```bash
# Headless proof (Node 18+), verifies a real creation off-site:
node test.mjs

# UI (serve statically, then open the printed URL):
python -m http.server 8000      # or: npx serve .
#  → http://localhost:8000
```

Paste a **token id**, a **64-hex manifest hash**, or a **0x anchor/mint tx hash**.

## What it proves — purely on-chain

| Claim | Source (Base only) |
|---|---|
| **Minted** | ERC-1155 `uri(tokenId)` resolves on the Submissions contract |
| **Manifest hash** | `tokenId == uint256(manifestHash)` — recoverable from the id alone |
| **Anchored / by whom** | `Anchor(bytes32 indexed manifestHash, …)` event → anchoring tx `from` |
| **Platform-Attested** | that anchor caller `==` the published platform wallet |
| **Artwork** | the image is an on-chain `data:` URI — it lives on Base too |

## Scope

v2.5 verifies **minted creations** (badge: *Minted*) and creations with a
platform-signed on-chain anchor (badge: *Platform-Attested*). Extending the
off-site verifier to anchored-but-unminted entries is **v2.1** — tracked
separately, not built here. Until then, unminted manifest hashes return
*not minted* even if a real Base anchor exists.

## Honest by construction

- **Hashes only, never raw prompts** — none are on-chain or fetched here.
- **"Platform-Attested"** is derived from the on-chain anchor caller vs. the
  published platform wallet — *not* from a database lookup.
- **Off-chain-only fields are NOT shown** (mint recipient, exact timestamps live
  in MythosForge's DB and can't be verified off-site — so this verifier doesn't
  claim them).

## Constants (all public)

```
chain                  base (8453)
default RPC            https://mainnet.base.org   (swappable — not MythosForge's)
Submissions (mint)     0x21d6Ce25aa1AB3F59eE51b7693A596C6d39A03C9
Anchor (emit-only)     0x936cc31Ce3D0e0abcD76ED29851Ab8bC5f8bEFf9
platform anchor wallet 0x0d648b9e7046201912d23f9d68d17614a9fe66e8
```

The Anchor contract is emit-only and permissionless by design — *"tx history of
the contract address IS the registry."* This verifier is just an honest reader
of that public registry.

## Files

- `verify-core.mjs` — the verification kernel (no deps; the reusable SDK seed)
- `index.html` — self-contained UI on top of the kernel
- `test.mjs` — headless smoke test against a real creation
