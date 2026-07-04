#!/usr/bin/env bash
# Demonstrates that the REAL RISC Zero verifier on Sepolia rejects our
# current dev-mode "proof" — i.e. the trust gap is real and the fix is a
# genuine proof, not a config flip. The mock verifier our program is
# deployed with (MockRISC0Verifier) is the only reason the fake passes.
#
# RISC Zero canonical Sepolia deployment (dev.risczero.com verifier docs):
#   Router:  0x925d8331ddc0a1F0d96E68CF073DFE1d92b69187
#   Groth16: 0x2a098988600d87650Fb061FfAff08B97149Fa84D
set -euo pipefail
RPC="${RPC:-https://ethereum-sepolia-rpc.publicnode.com}"
ROUTER=0x925d8331ddc0a1F0d96E68CF073DFE1d92b69187
IMAGEID=0xaf928ebf39fec4696c3f41f473a1a9473b67d723c6373149c6ab99ba4c1a76ef  # our guest ImageID (ImageID.sol PROGRAM_ID)
PI_PROOF=0x0301040105090206050305                                          # the dev-mode "proof" (digits of pi)

echo "Calling the REAL RISC Zero router.verify(piProof, ourImageId, journalHash) on Sepolia…"
if cast call "$ROUTER" "verify(bytes,bytes32,bytes32)" "$PI_PROOF" "$IMAGEID" \
   0x1111111111111111111111111111111111111111111111111111111111111111 --rpc-url "$RPC" 2>/dev/null; then
  echo "UNEXPECTED: the real verifier accepted the fake proof."
  exit 1
else
  echo "✓ EXPECTED: the real verifier REVERTED (fake proof rejected)."
  echo "  → real on-chain compute verification is live on Sepolia;"
  echo "    our dev-mode proof only passes because our program points at MockRISC0Verifier."
fi
