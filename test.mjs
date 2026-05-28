// Smoke test: prove the kernel verifies a real creation off-site (Base only).
// Run: node test.mjs
import { verifyCreation } from './verify-core.mjs';

// A real Platform-Attested + Minted MythosForge creation on Base.
const TOKEN = '54851462332250288029513346248177259202425846707039409026292648779135787226601';

const r = await verifyCreation(TOKEN, {}, (i, lo, hi) => console.error(`  scan window ${i}: ${lo}-${hi}`));
console.log(JSON.stringify({
  ok: r.ok, badge: r.badge, independent: r.independent,
  tokenId: r.tokenId, manifestHash: r.manifestHash, minted: r.minted,
  name: r.creation?.name, agent: r.creation?.agent, proofStatus: r.creation?.proofStatus,
  imageOnChain: r.creation?.image?.slice(0, 30),
  anchor: r.anchor,
}, null, 2));

const pass = r.ok && r.badge === 'Minted' && r.independent === true
  && r.anchor?.source === 'platform' && r.manifestHash.startsWith('0x7944d3');
console.log(pass ? '\nPASS ✅ verified off-site (zero mythosforge.xyz calls)' : '\nFAIL ❌');
process.exit(pass ? 0 : 1);
