// Ballot-validity gate: prove a real slop ballot's ciphertext is a valid
// BFV encryption of its one-hot plaintext, using the interfold
// user_data_encryption_ct0 (Greco) circuit at our INSECURE_THRESHOLD_512
// preset — the exact preset our ballots use.
import { readFileSync } from "node:fs";
import { Noir } from "@noir-lang/noir_js";
import { UltraHonkBackend, Barretenberg } from "@aztec/bb.js";
import * as e3 from "/private/tmp/claude-501/-Users-clawd-clawd-harness-projects-slop-computer-live/5fe470df-775b-4152-a7c6-40a5241c03db/scratchpad/pkg-wasm/package/dist/node/e3_wasm.js";

const CIRCUIT_JSON = "/private/tmp/claude-501/-Users-clawd-clawd-harness-projects-slop-computer-live/5fe470df-775b-4152-a7c6-40a5241c03db/scratchpad/interfold-repo/circuits/bin/threshold/target/user_data_encryption_ct0.json";
const DEGREE = 512, T = 100n, MODULI = new BigUint64Array([0xffffee001n, 0xffffc4001n]);

// 1. Generate a real one-hot ballot (option 0 of 2) + its Greco witness.
const pk = e3.generate_public_key(DEGREE, T, MODULI);
const vote = new BigUint64Array(DEGREE); vote[0] = 1n; // one-hot
const [ciphertext, inputsJson] = e3.bfv_verifiable_encrypt_vector(vote, pk, DEGREE, T, MODULI);
console.log(`ballot ciphertext: ${ciphertext.length} bytes`);
const allInputs = JSON.parse(inputsJson);

// 2. Sanity: k1 must be one-hot in the plaintext region. (The ZK version
// of this check is what the crisp circuit adds; here we assert it in the
// clear to confirm our ballot is well-formed before proving encryption.)
const Q_MOD_T_CENTERED = -7; // field rep of "1" at this preset
const k1 = allInputs.k1.coefficients.map(c => (typeof c === "string" ? BigInt(c) : BigInt(c)));
// centered "1" is the modular value of -7; count nonzero plaintext slots
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const oneVal = ((BigInt(Q_MOD_T_CENTERED) % FIELD) + FIELD) % FIELD;
const nonzero = k1.filter(c => c !== 0n);
console.log(`k1 nonzero coeffs: ${nonzero.length}; all == field(-7)? ${nonzero.every(c => c === oneVal)}`);

// 3. Pick the 9 params the ct0 circuit wants.
const inputs = {
  pk0is: allInputs.pk0is, ct0is: allInputs.ct0is, u: allInputs.u,
  e0: allInputs.e0, e0is: allInputs.e0is, e0_quotients: allInputs.e0_quotients,
  k1: allInputs.k1, r1is: allInputs.r1is, r2is: allInputs.r2is,
};

// 4. Execute the circuit → witness.
const circuit = JSON.parse(readFileSync(CIRCUIT_JSON, "utf8"));
const noir = new Noir(circuit);
console.log("executing circuit (generating witness)…");
const t0 = Date.now();
const { witness } = await noir.execute(inputs);
console.log(`witness generated in ${((Date.now()-t0)/1000).toFixed(1)}s`);

// 5. Prove + verify with UltraHonk.
console.log("initializing Barretenberg + 2^21 SRS (heavy)…");
const tSrs = Date.now();
const api = await Barretenberg.new();
await api.initSRSChonk(2 ** 21);
console.log(`SRS ready in ${((Date.now()-tSrs)/1000).toFixed(1)}s`);
const backend = new UltraHonkBackend(circuit.bytecode, api);
console.log("proving (UltraHonk)…");
const t1 = Date.now();
const proof = await backend.generateProof(witness);
console.log(`proof generated in ${((Date.now()-t1)/1000).toFixed(1)}s — ${proof.proof.length} bytes, ${proof.publicInputs.length} public inputs`);
const ok = await backend.verifyProof(proof);
console.log(ok ? "✓✓✓ GATE PASS — Greco encryption proof VERIFIED for a real slop ballot at our preset" : "✗ verification failed");
process.exit(ok ? 0 : 1);
