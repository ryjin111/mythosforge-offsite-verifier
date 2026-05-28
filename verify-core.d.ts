// Type declarations for @mythosforge/verify
//
// Verify any MythosForge Proof of Creation entirely from the Base blockchain.
// See SPEC.md for the protocol-level contract.

export interface VerifyConfig {
  /** JSON-RPC endpoint for Base. Default: https://mainnet.base.org */
  rpcUrl?: string;
  /** Chain id. Default: 8453 (Base mainnet). */
  chainId?: number;
  /** MythosForgeSubmissions (ERC-1155 mint) contract address. */
  mintContract?: string;
  /** MythosForgeAnchor (emit-only) contract address. */
  anchorContract?: string;
  /** Published platform anchor wallet (Platform-Attested derivation). */
  platformAnchorAddress?: string;
  /** topic0 of the Anchor event. */
  anchorEventSig?: string;
  /** ERC-1155 uri(uint256) selector. */
  uriSelector?: string;
  /** Max blocks per eth_getLogs window (public Base RPC cap). Default: 9999. */
  logWindow?: number;
  /** Max backward-scan windows. Default: 40 (~400k blocks). */
  maxWindows?: number;
}

export const DEFAULTS: Required<VerifyConfig>;

/** Decimal, 0x-hex, or bare 64-hex → bigint tokenId (also a manifest hash). */
export function parseTokenId(raw: string): bigint | null;

/** Render a tokenId as a 0x-prefixed 64-char manifest-hash hex. */
export function manifestHashHex(tokenId: bigint): string;

/** Read the ERC-1155 uri(tokenId) for the configured mint contract. */
export function readTokenUri(
  cfg: Required<VerifyConfig>,
  tokenId: bigint
): Promise<{
  minted: boolean;
  name?: string;
  image?: string;
  attributes?: Record<string, string>;
  error?: string;
}>;

/** Find the on-chain Anchor event for a manifest hash. */
export function findAnchor(
  cfg: Required<VerifyConfig>,
  mhHex: string,
  onProgress?: (windowIndex: number, fromBlock: number, toBlock: number) => void
): Promise<{
  found: boolean;
  txHash?: string;
  block?: number;
  caller?: string | null;
  scannedToBlock?: number;
  scannedFrom?: number;
}>;

/** Derive the badge from on-chain state. */
export function deriveBadge(args: {
  minted: boolean;
  platformAttested: boolean;
  anchored: boolean;
}): 'Minted' | 'Platform-Attested' | 'Anchored on Base' | 'Unverified';

export type Badge =
  | 'Minted'
  | 'Platform-Attested'
  | 'Anchored on Base'
  | 'Unverified';

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  message?: string;
  /** The protocol-level fields below are normative — two conformant verifiers
   *  must agree on these for the same input. */
  badge?: Badge;
  independent?: boolean;
  tokenId?: string;
  manifestHash?: string;
  minted?: boolean;
  creation?: {
    name: string;
    image: string;
    agent: string | null;
    model: string | null;
    creationDate: string | null;
    proofStatus: string | null;
    attributes: Record<string, string>;
  } | null;
  anchor?: {
    txHash: string;
    caller: string | null;
    source: 'platform' | 'third-party';
    basescan: string;
  } | null;
  contracts?: {
    mint: string;
    anchor: string;
    platformAnchorAddress: string;
  };
  /** Implementation context. Verifiers MAY surface additional runtime metadata
   *  here; protocol-level result is unaffected. */
  chain?: { name: string; chainId: number; rpcUrl: string };
  notes?: string[];
}

/**
 * Verify a MythosForge Proof of Creation entirely from the Base blockchain.
 *
 * @param input    A decimal token id, a 64-hex manifest hash, or a 0x-prefixed
 *                 32-byte anchor/mint transaction hash.
 * @param config   Optional config overrides (defaults to Base mainnet).
 * @param onProgress Optional callback for anchor-scan window progress.
 */
export function verifyCreation(
  input: string,
  config?: VerifyConfig,
  onProgress?: (windowIndex: number, fromBlock: number, toBlock: number) => void
): Promise<VerifyResult>;
