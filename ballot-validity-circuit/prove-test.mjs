import { readFileSync } from "node:fs";
import { Noir } from "@noir-lang/noir_js";
import { UltraHonkBackend, Barretenberg } from "@aztec/bb.js";
import * as e3 from "/private/tmp/claude-501/-Users-clawd-clawd-harness-projects-slop-computer-live/5fe470df-775b-4152-a7c6-40a5241c03db/scratchpad/pkg-wasm/package/dist/node/e3_wasm.js";
const CIRCUIT = "/private/tmp/claude-501/-Users-clawd-clawd-harness-projects-slop-computer-live/5fe470df-775b-4152-a7c6-40a5241c03db/scratchpad/interfold-repo/circuits/bin/ballot_validity/target/ballot_validity.json";
const DEG=512, T=100n, MOD=new BigUint64Array([0xffffee001n,0xffffc4001n]);
const pk = e3.generate_public_key(DEG, T, MOD);
const circuit = JSON.parse(readFileSync(CIRCUIT, "utf8"));
const noir = new Noir(circuit);

function witnessInputs(voteVal, voteIdx) {
  const v = new BigUint64Array(DEG); v[voteIdx] = BigInt(voteVal);
  const [, j] = e3.bfv_verifiable_encrypt_vector(v, pk, DEG, T, MOD);
  const a = JSON.parse(j);
  return { pk0is:a.pk0is, ct0is:a.ct0is, u:a.u, e0:a.e0, e0is:a.e0is, e0_quotients:a.e0_quotients, k1:a.k1, r1is:a.r1is, r2is:a.r2is, pk1is:a.pk1is, ct1is:a.ct1is, e1:a.e1, p1is:a.p1is, p2is:a.p2is };
}

// GOOD ballot: one-hot [1] at option 0
console.log("=== GOOD ballot (one-hot vote for option 0) ===");
const good = witnessInputs(1, 0);
const { witness } = await noir.execute(good);
console.log("witness generated ✓");
const api = await Barretenberg.new(); await api.initSRSChonk(2**21);
const backend = new UltraHonkBackend(circuit.bytecode, api);
const proof = await backend.generateProof(witness);
console.log(`proof: ${proof.proof.length} bytes, ${proof.publicInputs.length} public inputs`);
const ok = await backend.verifyProof(proof);
console.log(ok ? "VERIFIED ✓" : "verify FAILED ✗");

// BAD ballot: [2] at option 0 — must be rejected at witness gen (one-hot assert fails)
console.log("\n=== BAD ballot ([2] at option 0 - inflation attempt) ===");
try {
  await noir.execute(witnessInputs(2, 0));
  console.log("✗✗ SECURITY FAIL: bad ballot was accepted!");
  process.exit(1);
} catch (e) {
  console.log("REJECTED ✓ —", String(e.message||e).split("\n")[0].slice(0, 90));
}
console.log(ok ? "\n✓✓✓ VALIDITY CIRCUIT WORKS: good proves+verifies, bad rejected" : "");
process.exit(ok ? 0 : 1);
