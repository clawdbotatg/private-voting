import { UltraHonkBackend, Barretenberg, BackendType } from "@aztec/bb.js";
const log = m => { document.getElementById("log").textContent += m+"\n"; console.log(m); };
try {
  log("crossOriginIsolated: " + globalThis.crossOriginIsolated);
  const circuit = await (await fetch("/circuit.json")).json();
  const wb64 = (await (await fetch("/witness.b64")).text()).trim();
  const witness = Uint8Array.from(atob(wb64), c=>c.charCodeAt(0));
  log("witness bytes: " + witness.length);
  log("initializing Barretenberg (single-thread Wasm backend, no COEP)…");
  const t0 = performance.now();
  // Force single-threaded Wasm backend — no SharedArrayBuffer / COEP needed.
  const api = await Barretenberg.new({ backend: BackendType.Wasm });
  await api.initSRSChonk(2**21);
  log(`SRS+api ready in ${((performance.now()-t0)/1000).toFixed(1)}s`);
  const backend = new UltraHonkBackend(circuit.bytecode, api);
  log("proving…");
  const t1 = performance.now();
  const proof = await backend.generateProof(witness, { verifierTarget:"evm" });
  log(`PROOF in ${((performance.now()-t1)/1000).toFixed(1)}s — ${proof.proof.length} bytes, ${proof.publicInputs.length} public inputs`);
  const ok = await backend.verifyProof(proof, { verifierTarget:"evm" });
  log(ok ? "RESULT: BROWSER-PROVE-PASS" : "RESULT: verify-failed");
} catch(e) { log("RESULT: ERROR " + (e && e.message ? e.message : e)); }
