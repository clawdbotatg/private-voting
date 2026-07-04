# Real RISC Zero compute proofs — activation recipe

Where we are, and the exact steps to replace the dev-mode proof with a
real one. Researched 2026-07-03 against `gnosisguild/interfold`.

## The gap, precisely

Our E3 program proves the tally is the true homomorphic sum of the
on-chain ballots via `MyProgram.verify(e3Id, ciphertextHash, proof)`,
which builds a 396-byte journal `(ciphertextHash, paramsHash,
inputRoot)` and calls `risc0Verifier.verify(proof, imageId,
sha256(journal))`. That logic is production-shaped. **Two things make
it dev-mode today:**

1. **The program's verifier is a `MockRISC0Verifier`** — `verify()` has
   an empty body, so any bytes pass. (Deployed by `deploy/default.ts`.)
2. **The published "proof" is fake** — the template's `program.dev:
   true` path (`.interfold/support/dev`) returns the real homomorphic
   sum bolted to a hardcoded journal `[3,1,4,1,5,9,2,6,5,3,5]` (digits
   of pi) with an empty seal. No prover runs.

**Proven on-chain** (`deploy/prove-real-verifier-rejects-fake.sh`): the
*real* RISC Zero router on Sepolia reverts on our pi-proof. So real
verification is live on this testnet — nothing is blocked by "mainnet."

## What "real" requires (and why it's not a config flip)

A real proof means running our guest ELF (ImageID
`0xaf928ebf…76ef`) in the RISC Zero zkVM and producing a **Groth16**
seal. That needs a prover. The only prover the interfold CLI wires in
production mode is **Boundless** (the proving marketplace — Bonsai, the
old hosted API, is deprecated). A local prover exists in the code
(`crates/support/host/src/lib.rs` `Risc0Provider`, `ProverOpts::
groth16()`) but isn't wired into `run_compute`, and Groth16 on
Apple-Silicon needs an x86 Docker container anyway.

**Prerequisites to provision (the part a human must do):**
- A Sepolia key holding **ETH** (pays provers on the market) + **ZKC**
  collateral (~2.0, `lock_collateral_zkc`). The facilitator
  `0xBa16…0FF0` already holds Sepolia ETH; ZKC needs acquiring.
- A **Pinata JWT** (free tier) to upload the guest ELF to IPFS — or a
  pre-uploaded `program_url`.

## Activation steps

1. **Deploy a real verifier + point our program at it.** Either add a
   `RiscZeroGroth16Verifier` (mirror CRISP's `deployVerifier(false)` in
   `examples/CRISP/.../deploy/crisp.ts`) or, simpler, point the program
   constructor at RISC Zero's **canonical Sepolia router**
   `0x925d8331ddc0a1F0d96E68CF073DFE1d92b69187`. Edit `deploy/default.ts`
   (replace the `MockRISC0Verifier` deploy with that address), then
   redeploy `ImageID` + `MyProgram` and `interfold.registerE3Program`.
2. **Config** (`interfold.config.yaml`): `program.dev: false`; uncomment
   `risc0:` with `risc0_dev_mode: 0` and a `boundless:` block —
   `rpc_url` (Sepolia), `private_key` (env), `pinata_jwt`,
   `onchain: true`, and ideally a pre-uploaded `program_url`.
3. **Compile:** `interfold compile` (regenerates `ImageID.sol`; if the
   guest ELF changed, the imageId changed → step 1's redeploy must use
   the new id).
4. **Run:** `interfold program start` now runs the Risc0/Boundless
   container — a round submits a proving job to Boundless, waits for the
   Groth16 seal, and `MyProgram.verify` calls the real verifier, which
   reverts unless the seal is genuine.

## Wiring it into the slop relay (prod)

`packages/relay/src/vote-e3.ts` currently publishes `DEV_PROOF` directly
via `publishCiphertextOutput`. For real proofs the coordinator must,
after the homomorphic sum, obtain a Groth16 seal from a prover before
publishing. Two viable shapes:
- **Delegate to `interfold program start`** (the container flow above) —
  run it as a sidecar the coordinator calls, mirroring the local
  `deploy/sepolia-round.ts` server/runner split. Heaviest but matches
  the template.
- **Boundless SDK call** from the coordinator — submit the proving
  request directly, poll for fulfillment, publish the returned seal.
  Per-poll cost: ETH + ZKC on the market.

Gate it behind `VOTING_E3_REAL_PROOFS=1` so prod stays on the working
dev-mode flow until a funded prover is ready.

## The other integrity gap (separate from this)

Real compute proofs prove *the relay counted honestly*. They do **not**
prove *a ballot is a valid one-hot vote* — a hostile client could
encrypt `[500, 0]`. That's CRISP's Noir ballot-validity circuit
(`examples/CRISP/circuits`), reusable for K≤8 options with `balance=1`,
proved client-side (bb.js UltraHonk, 2^21 SRS) and verified by an
on-chain HonkVerifier. Independent work item.
