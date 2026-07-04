# ballot_validity — slop.computer ballot-validity ZK circuit

Proves in zero-knowledge that a submitted BFV ciphertext encrypts a
valid ONE-HOT vote (every plaintext coefficient is 0 or 1, exactly one
is 1), closing the tally-inflation hole (a hostile client encrypting
[500,0] or [2,0]) without revealing the choice.

Single Noir circuit (no recursion): in-circuit Greco encryption proof
(ct0 + ct1, from interfold's user_data_encryption lib) + a one-hot
assert on k1. Params = interfold `configs::default::threshold` =
insecure-512 = slop's exact BFV preset.

Depends on the interfold circuits `lib` (path dep). To build: place under
`interfold-repo/circuits/bin/ballot_validity/` (so `../../lib` resolves),
then `nargo compile`.

Verified (prove-test.mjs, bb 3.0.0-nightly.20260102):
- GOOD one-hot ballot -> witness OK -> UltraHonk proof (16 KB, 2 public
  inputs = ct0/ct1 commitments) -> VERIFIED.
- BAD [2,0] ballot -> witness generation REJECTED ("cannot satisfy
  constraint") - the inflation attempt fails at proving.

The 2 public inputs are the ciphertext-component commitments; on-chain
`publishInput` binds the proof to the submitted ciphertext via these.

## On-chain verification (Sepolia)

`bb write_vk --oracle_hash keccak` + `bb write_solidity_verifier` →
BallotValidityVerifier.sol (ZK Honk, `verify(bytes,bytes32[])`). Compiles
to 23,721 bytes at `optimizer_runs=1` (fits EIP-170's 24,576 limit).

**Deployed on Sepolia: `0xEcc4D77e1761C6828FD4E65D0fe7f0b31FCE9336`.**
Verified live:
- real ballot EVM proof (9,408 bytes, `verifierTarget:'evm'`, 2 public
  inputs = ct0/ct1 commitments) → `verify()` returns **true**.
- tampered public input → **reverts** (0x9fc3a218).

gen-evm-proof.mjs produces the EVM proof + public_inputs. The 2 public
inputs are the ciphertext-component commitments; on-chain publishInput
binds the proof to the submitted ciphertext through them (remaining
integration).
