// MythosForge v2.5 — off-site Proof-of-Creation verifier (kernel).
//
// Verifies a MythosForge creation ENTIRELY from the Base blockchain, with
// ZERO calls to mythosforge.xyz and ZERO third-party libraries — just JSON-RPC
// `fetch` against any public Base node. This is the "outlives the platform"
// proof: if mythosforge.xyz disappears, this still works.
//
// What it proves, purely on-chain:
//   • Minted          — the ERC-1155 `uri(tokenId)` resolves on the MythosForge
//                        Submissions contract (the token exists on Base).
//   • Manifest hash    — tokenId == uint256(manifestHash), so the sha256 manifest
//                        commitment is recoverable from the id alone.
//   • Anchored / by whom — the Anchor contract emits `Anchor(bytes32 indexed
//                        manifestHash, ...)`; we look the event up by the indexed
//                        manifestHash and read the anchoring tx's `from`.
//   • Platform-Attested — that anchor caller == the published platform wallet.
//
// Honesty (matches apps/web/lib/v1-proof.ts):
//   • Hashes only, never raw prompts — none are on-chain or fetched here.
//   • "Platform-Attested" is derived from the on-chain anchor caller vs. the
//     published platform address, NOT from "it's in our DB".
//   • Off-chain-only fields (mint recipient, exact timestamps) are intentionally
//     NOT shown — they live in MythosForge's DB and can't be verified off-site.

export const DEFAULTS = {
  rpcUrl: 'https://mainnet.base.org',
  chainId: 8453,
  mintContract: '0x21d6Ce25aa1AB3F59eE51b7693A596C6d39A03C9', // MythosForgeSubmissions (ERC-1155)
  anchorContract: '0x936cc31Ce3D0e0abcD76ED29851Ab8bC5f8bEFf9', // MythosForgeAnchor (emit-only)
  // Published platform anchor wallet — a PUBLIC address (not a secret). Verified
  // empirically: every anchor on the contract to date was sent by this wallet.
  platformAnchorAddress: '0x0d648b9e7046201912d23f9d68d17614a9fe66e8',
  // Anchor(bytes32,bytes32,string,string) topic0 (read off-chain from the contract).
  anchorEventSig: '0xe26330fb69e6d6cdfaf33baaba97994bb1a77473f4d347e251a6b122c173b0cf',
  uriSelector: '0x0e89341c', // ERC-1155 uri(uint256)
  logWindow: 9999,           // public Base RPC caps eth_getLogs at 10k blocks
  maxWindows: 40,            // backward-scan budget (~400k blocks ≈ the contract's life)
};

// ─── low-level helpers (no deps) ────────────────────────────────────────────

async function rpc(rpcUrl, method, params) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message || JSON.stringify(json.error)}`);
  return json.result;
}

const hexToBytes = (h) => {
  const s = h.startsWith('0x') ? h.slice(2) : h;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
};

// Decode a single ABI-encoded dynamic `string` return (head offset + len + data).
function decodeAbiString(hex) {
  const b = hexToBytes(hex);
  if (b.length < 64) return '';
  const len = Number(BigInt('0x' + hex.slice(2).slice(64, 128)));
  const data = b.slice(64, 64 + len);
  return new TextDecoder().decode(data);
}

const b64ToUtf8 = (b64) =>
  typeof atob === 'function'
    ? decodeURIComponent(escape(atob(b64)))
    : Buffer.from(b64, 'base64').toString('utf8');

function attrsOf(json) {
  const out = {};
  for (const a of Array.isArray(json.attributes) ? json.attributes : []) {
    if (typeof a?.trait_type === 'string' && typeof a?.value === 'string') out[a.trait_type] = a.value;
  }
  return out;
}

// ─── input parsing ──────────────────────────────────────────────────────────

const TXHASH = /^0x[0-9a-fA-F]{64}$/;

// decimal | 0x-hex | bare 64-hex  →  bigint tokenId (also a manifest hash)
export function parseTokenId(raw) {
  const q = (raw || '').trim();
  try {
    if (/^0x[0-9a-fA-F]+$/.test(q)) return BigInt(q);
    if (/^[0-9a-fA-F]{64}$/.test(q)) return BigInt('0x' + q);
    if (/^[0-9]+$/.test(q)) return BigInt(q);
  } catch { /* fall through */ }
  return null;
}

export const manifestHashHex = (tokenId) => '0x' + tokenId.toString(16).padStart(64, '0');

// ─── on-chain reads ───────────────────────────────────────────────────────────

export async function readTokenUri(cfg, tokenId) {
  const data = cfg.uriSelector + tokenId.toString(16).padStart(64, '0');
  let raw;
  try {
    raw = await rpc(cfg.rpcUrl, 'eth_call', [{ to: cfg.mintContract, data }, 'latest']);
  } catch (e) {
    return { minted: false, error: e.message };
  }
  if (!raw || raw === '0x') return { minted: false };
  let uri;
  try {
    uri = decodeAbiString(raw);
    const prefix = 'data:application/json;base64,';
    if (!uri.startsWith(prefix)) return { minted: false, error: 'tokenURI not a base64 json data uri' };
    const json = JSON.parse(b64ToUtf8(uri.slice(prefix.length)));
    return {
      minted: true,
      name: typeof json.name === 'string' ? json.name : '',
      image: typeof json.image === 'string' ? json.image : '',
      attributes: attrsOf(json),
    };
  } catch (e) {
    return { minted: false, error: 'decode failed: ' + e.message };
  }
}

async function txCaller(cfg, txHash) {
  const tx = await rpc(cfg.rpcUrl, 'eth_getTransactionByHash', [txHash]);
  return tx ? { from: tx.from, to: tx.to } : null;
}

// Find the on-chain anchor for a manifest hash via the indexed Anchor event.
// Backward-scans 10k windows (public RPC range cap) up to maxWindows; reports
// how far it scanned so a "no anchor found" answer is honest, not silent.
export async function findAnchor(cfg, mhHex, onProgress) {
  const latest = Number(BigInt(await rpc(cfg.rpcUrl, 'eth_blockNumber', [])));
  let hi = latest;
  for (let i = 0; i < cfg.maxWindows; i++) {
    const lo = Math.max(0, hi - cfg.logWindow);
    if (onProgress) onProgress(i, lo, hi);
    const logs = await rpc(cfg.rpcUrl, 'eth_getLogs', [{
      address: cfg.anchorContract,
      topics: [cfg.anchorEventSig, mhHex],
      fromBlock: '0x' + lo.toString(16),
      toBlock: '0x' + hi.toString(16),
    }]);
    if (logs && logs.length) {
      const lg = logs[logs.length - 1];
      const caller = await txCaller(cfg, lg.transactionHash);
      return {
        found: true,
        txHash: lg.transactionHash,
        block: Number(BigInt(lg.blockNumber)),
        caller: caller?.from || null,
        scannedToBlock: lo,
      };
    }
    if (lo === 0) break;
    hi = lo - 1;
  }
  return { found: false, scannedToBlock: hi, scannedFrom: latest };
}

// If the input is an anchor/mint tx, decode the tokenId from its calldata.
async function tokenIdFromTx(cfg, txHash) {
  const tx = await rpc(cfg.rpcUrl, 'eth_getTransactionByHash', [txHash]);
  if (!tx?.input || !tx.to) return null;
  const to = tx.to.toLowerCase();
  const word0 = tx.input.slice(10, 10 + 64); // first 32-byte arg after the 4-byte selector
  if (!word0) return null;
  // anchor(bytes32 manifestHash,...) and mint(uint256 tokenId,...) both put the
  // id-equivalent in arg0; tokenId == uint256(manifestHash) either way.
  if (to === cfg.anchorContract.toLowerCase() || to === cfg.mintContract.toLowerCase()) {
    try { return BigInt('0x' + word0); } catch { return null; }
  }
  return null;
}

// ─── badge ───────────────────────────────────────────────────────────────────

export function deriveBadge({ minted, platformAttested, anchored }) {
  if (minted) return 'Minted';
  if (platformAttested) return 'Platform-Attested';
  if (anchored) return 'Anchored on Base';
  return 'Unverified';
}

// ─── orchestration ─────────────────────────────────────────────────────────────

// verifyCreation(input, config?, onProgress?) → result object. Pure on-chain.
export async function verifyCreation(input, config = {}, onProgress) {
  const cfg = { ...DEFAULTS, ...config };
  let tokenId = parseTokenId(input);
  if (tokenId === null && TXHASH.test((input || '').trim())) {
    tokenId = await tokenIdFromTx(cfg, input.trim());
  }
  if (tokenId === null) {
    return { ok: false, reason: 'invalid_input', message: 'Enter a token id, 64-hex manifest hash, or 0x anchor/mint tx hash.' };
  }

  const mhHex = manifestHashHex(tokenId);
  const token = await readTokenUri(cfg, tokenId);

  // Prefer an "Anchor Tx" attribute if the tokenURI carries one (no scan needed);
  // otherwise look the anchor up by the indexed manifestHash.
  let anchor;
  const attrAnchorTx = token.attributes?.['Anchor Tx'];
  if (attrAnchorTx && TXHASH.test(attrAnchorTx)) {
    const c = await txCaller(cfg, attrAnchorTx);
    anchor = { found: true, txHash: attrAnchorTx, caller: c?.from || null, fromAttribute: true };
  } else {
    anchor = await findAnchor(cfg, mhHex, onProgress);
  }

  const anchored = Boolean(anchor.found);
  const platformAttested = Boolean(
    anchored && anchor.caller && anchor.caller.toLowerCase() === cfg.platformAnchorAddress.toLowerCase(),
  );
  const badge = deriveBadge({ minted: token.minted, platformAttested, anchored });

  return {
    ok: true,
    badge,
    independent: true, // proven from Base only — zero mythosforge.xyz calls
    chain: { name: 'base', chainId: cfg.chainId, rpcUrl: cfg.rpcUrl },
    tokenId: tokenId.toString(),
    manifestHash: mhHex,
    minted: token.minted,
    creation: token.minted ? {
      name: token.name,
      image: token.image,          // on-chain data: URI (the artwork lives on Base too)
      agent: token.attributes['Agent'] || null,
      model: token.attributes['Model'] || null,
      creationDate: token.attributes['Creation Date'] || null,
      proofStatus: token.attributes['Proof Status'] || null,
      attributes: token.attributes,
    } : null,
    anchor: anchored ? {
      txHash: anchor.txHash,
      caller: anchor.caller,
      source: platformAttested ? 'platform' : 'third-party',
      basescan: `https://basescan.org/tx/${anchor.txHash}`,
    } : null,
    contracts: {
      mint: cfg.mintContract,
      anchor: cfg.anchorContract,
      platformAnchorAddress: cfg.platformAnchorAddress,
    },
    notes: [
      'Verified entirely from the Base blockchain — zero calls to mythosforge.xyz.',
      'Manifest hash is recoverable from the token id alone (tokenId == uint256(manifestHash)).',
      'Off-chain fields (mint recipient, exact timestamps) are not shown — they cannot be verified off-site.',
    ],
  };
}
