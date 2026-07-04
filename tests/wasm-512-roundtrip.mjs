import { readFileSync } from "node:fs";
const PKG = "/private/tmp/claude-501/-Users-clawd-clawd-harness-projects-slop-computer-live/5fe470df-775b-4152-a7c6-40a5241c03db/scratchpad/weft/examples/weft-web/packages/fhe-wasm/pkg";
const { default: init, ...fhe } = await import(`${PKG}/fhe_wasm.js`);
await init(readFileSync(`${PKG}/fhe_wasm_bg.wasm`));
const params = fhe.load_params_named("INSECURE_THRESHOLD_512");
const sk = fhe.generate_secret_key(params);
const pk = fhe.derive_public_key(params, sk);
console.log("512-preset pk bytes:", pk.length);
// 4 ballots over 3 options: votes for option 0, 2, 2, 1 → tally [1,1,2]
const ballots = [0, 2, 2, 1].map(choice => {
  const v = new Int32Array(3); v[choice] = 1;
  return fhe.encrypt_vector(params, pk, v);
});
console.log("ballot ct bytes:", ballots[0].length);
let sum = ballots[0];
for (const b of ballots.slice(1)) sum = fhe.homomorphic_add(params, sum, b);
const plain = fhe.decrypt(params, sk, sum);
const tally = Array.from(plain.slice(0, 3));
console.log("tally:", tally);
if (JSON.stringify(tally) !== JSON.stringify([1, 1, 2])) { console.error("FAIL"); process.exit(1); }
console.log("PASS — 512-preset one-hot ballot pipeline works in Node");
