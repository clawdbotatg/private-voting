// SPDX-License-Identifier: LGPL-3.0-only
// Runs the Sepolia round driver under vitest (the SDK's wasm loader
// resolves correctly here, unlike plain tsx). Gated on RUN_SEPOLIA=1 so
// `pnpm vitest run` in CI never fires real testnet rounds.
import { it } from 'vitest'
import { runSepoliaRound } from '../deploy/sepolia-round'

it.runIf(process.env.RUN_SEPOLIA === '1')('full E3 round against the live Sepolia committee', async () => {
  await runSepoliaRound()
}, 1_800_000)
