# Private Voting on slop.computer — Status & Production Plan

Authoritative snapshot as of 2026-07-05. (Dated milestone history lives
in slop-computer-live `ops/PLAN-private-voting.md`; this is the clean
"where we are / what's next" you can hand your future self.)

## TL;DR

- **LIVE on prod**: you can host a private vote today. Every poll runs as
  a real Interfold E3 on Sepolia — a public ciphernode committee, real
  threshold encryption, only the aggregate ever decrypts.
- **Privacy is cryptographically real.** Nobody, including slop, can read
  an individual ballot. That is not a gap.
- **Two integrity gaps remain**, both disclosed in the UI, both either
  mainnet-gated or de-risked-but-not-productionized. Nothing is broken;
  these are known, honest limitations.
- **Plan: consolidate, run real votes, wait for Interfold mainnet
  (~weeks), then productionize.** Pushing further now builds on infra
  that doesn't exist yet.

## What's live on prod (today)

- **Voting Booth** app in every slop room.
- **Sepolia mode** (relay `VOTING_E3_CHAIN=sepolia`): poll creation
  requests a real E3; the public testnet committee runs sortition +
  distributed key generation; ballots are encrypted in each voter's
  browser (server only ever sees ciphertext); the committee
  threshold-decrypts only the tally, which reveals automatically.
- **Protocol panel** narrates every stage with live Etherscan links.
- **~7 min per round**: ~2 min committee formation + a 5-min voting
  window (`VOTING_E3_WINDOW_SECS=300`) + compute + decryption.
- **Self-healing**: stranded polls recover from chain on room-open;
  testnet fee tokens auto-refill from the faucet before each request.
- Anyone signed in can create and vote (public committee — no
  per-browser key dependency).

## Proven, but not yet productionized

**Ballot-validity ZK** — every gate passed, off the live chain:
- Circuit (`ballot-validity-circuit/`): proves a ballot is a valid
  one-hot vote, rejects `[500,0]`/`[2,0]`. ~2s proving.
- On-chain HonkVerifier deployed Sepolia `0xEcc4D77e...9336` — verifies
  real proofs, reverts on tampering.
- Verifiable-encrypt ballots are committee-decryptable (drop-in).
- Browser proving works single-threaded, **no COOP/COEP headers**.
- **Remaining**: bundle bb.js + noir_js + @interfold/wasm + circuit into
  the nextjs voting worker; wire the on-chain `publishInput` binding
  (redeploy our program against the verifier). The binding is
  security-critical — do it deliberately, rested.

## The two integrity gaps (both disclosed in-UI)

1. **Tally integrity (compute proof): DEV-MODE.** The relay computes the
   homomorphic sum and publishes it with a stubbed proof (mock verifier).
   Meaning: you trust slop to count honestly — the same trust as any web
   backend. Real fix = a RISC Zero proof of the sum, which needs a prover
   (Boundless: ZKC + ETH + Pinata; or a dedicated prover box). Bonsai is
   dead. Even Interfold's own CRISP mocks this on testnet. **Mainnet-era +
   funded step.** Recipe: `REAL-PROOFS.md`.
2. **Ballot validity: no proof yet.** A hostile voter *could* inflate a
   tally with a malformed ballot. Fully de-risked (see above); just needs
   productionization. The more realistic threat of the two.

Privacy is **not** in this list — it is real today.

## Key addresses (Sepolia)

| What | Address |
|---|---|
| Interfold | `0x64Cd2d88537A18D8E599d786447F9a07Dd9C7f26` |
| Our E3 program | `0x095C187a5bAC36e1857ad2e3c1F5414c3C738511` |
| Ballot-validity HonkVerifier | `0xEcc4D77e1761C6828FD4E65D0fe7f0b31FCE9336` |
| RISC Zero verifier router (real) | `0x925d8331ddc0a1F0d96E68CF073DFE1d92b69187` |
| Fee token (mock USDC) / faucet | `0x08260aE8...6E6D` / `0x94FCD9b6...87Df` |
| Facilitator (relay key) | `0xBa16e496574514A28b15e19c222c4d367c6C0FF0` |

## Mainnet trigger checklist (when Interfold ships mainnet, ~weeks)

1. Swap the relay chain config to the mainnet Interfold contracts.
2. Deploy our E3 program to mainnet; register it.
3. Fund the facilitator with mainnet ETH + real fee tokens.
4. **Real compute proofs**: fund Boundless (ZKC + ETH + Pinata),
   deploy our program against the real RISC Zero verifier, flip on the
   Boundless proving path (see `REAL-PROOFS.md`).
5. **Ballot validity**: finish the nextjs bundling + on-chain binding,
   deploy the HonkVerifier to mainnet, redeploy the program to verify in
   `publishInput`.

## Independent flip (anytime, not mainnet-gated)

- **PollAnchor on Ethereum mainnet** (notarize results on L1): fund the
  facilitator with ~0.02 mainnet ETH, deploy PollAnchor, set
  `VOTING_ANCHOR_CHAIN=mainnet` + `VOTING_ANCHOR_ADDRESS`.

## Repos

- **slop-computer-live**: the app — Voting Booth UI, relay coordinator
  (`packages/relay/src/vote-e3.ts`), Sepolia-mode wiring.
- **clawdbotatg/private-voting** (this repo): the E3 program, the
  ballot-validity circuit + verifier, all the gate scripts (wasm compat,
  verifiable-encrypt, browser-prove PoC), and `REAL-PROOFS.md`.

## Toolchain (installed on the dev box)

nargo `~/.nargo/bin` (1.0.0-beta.16), bb `~/.bb` (3.0.0-nightly.20260102),
rust via brew rustup (`/opt/homebrew/opt/rustup/bin`) + wasm-pack,
foundry `~/.foundry/bin`, interfold CLI `~/.local/bin`.

## Client-side voting proofs — status + notes for Auryn / Interfold

**Q (Auryn, 2026-07-05): "You have client-side voting proofs?" → Yes,
proven end to end; not yet wired into the live vote flow.**

What we built:
- A single Noir circuit (`ballot-validity-circuit/`, no recursion) that
  calls Interfold's `user_data_encryption_ct0` + `_ct1` (the Greco
  encryption relation) in-circuit, plus a one-hot check on `k1` (each
  coeff in {0, Q_MOD_T_CENTERED}, exactly one nonzero). Built against
  `configs::default` = `insecure-512` = our exact BFV preset, so the
  Interfold circuits dropped in unmodified.
- Witness from `@interfold/wasm bfv_verifiable_encrypt_vector`; proof via
  noir_js + bb.js UltraHonk. Good one-hot ballot verifies; `[500,0]` /
  `[2,0]` rejected at witness gen.
- HonkVerifier codegen'd + **deployed Sepolia
  `0xEcc4D77e...9336`** — verifies real proofs, reverts on tampering.
- **Caveat:** proven end-to-end, NOT yet bundled into the live app or
  checked in `publishInput`. That is the remaining productionization.

Two findings likely useful to the Interfold ecosystem:
1. **No-COEP single-threaded browser proving.** bb.js proves in a plain
   browser with `Barretenberg.new({ backend: BackendType.Wasm })` and
   `crossOriginIsolated: false` — **no COOP/COEP headers**. ~5s/proof,
   11s one-time SRS. CRISP's web client sets global COEP (breaks
   cross-origin embedding); this sidesteps it. PoC:
   `ballot-validity-circuit/browser-prove-poc/`.
2. **Interfold's Greco circuits are reusable standalone.** We used
   `user_data_encryption_ct0/ct1` for a custom one-hot ballot without the
   full CRISP crisp+fold recursive stack — a leaner single-proof path for
   apps that only need "valid one-hot encryption," no eligibility/mask/
   ciphertext-addition. Minimal reusable artifact = our
   `ballot-validity-circuit/`.

If Auryn wants either packaged (a write-up of the no-COEP trick, or a
clean minimal repo of the one-hot-over-Greco circuit), that's the
highest-leverage thing to hand back to the ecosystem.
