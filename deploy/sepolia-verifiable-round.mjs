// SPDX-License-Identifier: LGPL-3.0-only
//
// THE COMPATIBILITY GATE for slop's Sepolia mode: run a full E3 round
// where OUR wasm (weft fhe-wasm, INSECURE_THRESHOLD_512) does both the
// ballot encryption and the homomorphic sum — no @interfold/sdk crypto,
// no program runner, no coordinator server. If the live public
// committee threshold-decrypts our sum to the right tally, the relay
// can use this exact pipeline.
//
// Plain node (no vitest needed — our wasm loads fine outside bundlers):
//   PRIVATE_KEY=... node deploy/sepolia-wasm-round.mjs
import { readFileSync } from 'node:fs'
import {
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  http,
  parseAbi,
  toHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

// --- config (live Sepolia deployment) --------------------------------------
const INTERFOLD = '0x64Cd2d88537A18D8E599d786447F9a07Dd9C7f26'
const REGISTRY = '0xDDd7e1eA2AD8195217D9B25B13fac667b6Fc4dD9'
const FEE_TOKEN = '0x08260aE8970E3555E48caA547988bAD397786E6D'
const E3_PROGRAM = '0x095C187a5bAC36e1857ad2e3c1F5414c3C738511'
const TX_RPC = process.env.TX_RPC || 'https://ethereum-sepolia-rpc.publicnode.com'
const LOG_RPC = process.env.LOG_RPC || 'https://sepolia.drpc.org'
const E3_REQUESTED_TOPIC = '0x5090c9764b5cd13df7afc0013f733dfbe6eaf1b6ddc22a5e291fa387efd4c15e'
const COMMITTEE_PUBLISHED_TOPIC = '0xbf0636a312095f6c09c909823813b50e392323588d2d83432e7512c64041e67f'
const DEV_PROOF = '0x0301040105090206050305' // dev-mode "proof": digits of pi
const OPTIONS = 3
const VOTES = [0, 2, 2, 1] // expected tally [1, 1, 2]
const WINDOW_SECS = 240
const WINDOW_LEAD_SECS = 120

const interfoldAbi = parseAbi([
  'struct E3RequestParams { uint8 committeeSize; uint256[2] inputWindow; address e3Program; uint8 paramSet; bytes computeProviderParams; bytes customParams; bool proofAggregationEnabled; }',
  'function request(E3RequestParams params) returns (uint256)',
  'function getE3Stage(uint256 e3Id) view returns (uint8)',
  'function publishCiphertextOutput(uint256 e3Id, bytes ciphertextOutput, bytes proof) returns (bool)',
  'event PlaintextOutputPublished(uint256 indexed e3Id, bytes plaintextOutput, bytes proof)',
])
const erc20Abi = parseAbi([
  'function allowance(address, address) view returns (uint256)',
  'function approve(address, uint256) returns (bool)',
])
const programAbi = parseAbi(['function publishInput(uint256 e3Id, bytes data)'])

const account = privateKeyToAccount(process.env.PRIVATE_KEY)
const pub = createPublicClient({ chain: sepolia, transport: http(TX_RPC) })
const logs = createPublicClient({ chain: sepolia, transport: http(LOG_RPC) })
const wallet = createWalletClient({ account, chain: sepolia, transport: http(TX_RPC) })

const write = async (req, label) => {
  const hash = await wallet.writeContract(req)
  await pub.waitForTransactionReceipt({ hash, timeout: 300_000 })
  console.log(`  ${label}: ${hash}`)
  return hash
}

// --- wasm -------------------------------------------------------------------
const PKG = new URL('../../weft/examples/weft-web/packages/fhe-wasm/pkg/', import.meta.url).pathname
const { default: init, ...fhe } = await import(`${PKG}fhe_wasm.js`)
await init(readFileSync(`${PKG}fhe_wasm_bg.wasm`))
// @interfold/wasm for VERIFIABLE encryption (produces the ballot ciphertext
// AND the Greco witness). The ballot ct must be committee-decryptable and
// sum-compatible with weft's homomorphic_add — that is what this round tests.
const e3 = await import('/private/tmp/claude-501/-Users-clawd-clawd-harness-projects-slop-computer-live/5fe470df-775b-4152-a7c6-40a5241c03db/scratchpad/pkg-wasm/package/dist/node/e3_wasm.js')
const VDEG = 512, VT = 100n, VMOD = new BigUint64Array([0xffffee001n, 0xffffc4001n])
const params = fhe.load_params_named('INSECURE_THRESHOLD_512')
console.log('✓ wasm loaded, INSECURE_THRESHOLD_512 params ready')

// --- fee allowance ----------------------------------------------------------
const allowance = await pub.readContract({
  address: FEE_TOKEN, abi: erc20Abi, functionName: 'allowance', args: [account.address, INTERFOLD],
})
if (allowance < 20_000_000n) {
  await write({ address: FEE_TOKEN, abi: erc20Abi, functionName: 'approve', args: [INTERFOLD, 100_000_000n], account, chain: sepolia }, 'fee approve')
} else {
  console.log(`✓ fee allowance sufficient (${allowance})`)
}

// --- request E3 -------------------------------------------------------------
const nowChain = (await pub.getBlock()).timestamp
const inputWindow = [nowChain + BigInt(WINDOW_LEAD_SECS), nowChain + BigInt(WINDOW_LEAD_SECS + WINDOW_SECS)]
console.log(`requesting E3 (window +${WINDOW_LEAD_SECS}s → +${WINDOW_LEAD_SECS + WINDOW_SECS}s)…`)
const reqHash = await wallet.writeContract({
  address: INTERFOLD, abi: interfoldAbi, functionName: 'request',
  args: [{
    committeeSize: 0, inputWindow, e3Program: E3_PROGRAM, paramSet: 0,
    computeProviderParams: toHex(new Uint8Array(32)), customParams: '0x', proofAggregationEnabled: false,
  }],
  account, chain: sepolia,
})
const receipt = await pub.waitForTransactionReceipt({ hash: reqHash, timeout: 300_000 })
const reqLog = receipt.logs.find(l => l.address.toLowerCase() === INTERFOLD.toLowerCase() && l.topics[0] === E3_REQUESTED_TOPIC)
const e3Id = BigInt(reqLog.data.slice(0, 66))
console.log(`✓ E3 ${e3Id} requested: ${reqHash}`)

// --- wait for the public committee ------------------------------------------
for (;;) {
  const stage = await pub.readContract({ address: INTERFOLD, abi: interfoldAbi, functionName: 'getE3Stage', args: [e3Id] })
  console.log(`  stage ${stage}`)
  if (stage === 6) throw new Error('E3 failed')
  if (stage >= 3) break
  await new Promise(r => setTimeout(r, 15_000))
}
const keyLogs = await logs.getLogs({ address: REGISTRY, fromBlock: receipt.blockNumber, toBlock: 'latest' })
const keyLog = keyLogs.find(l => l.topics[0] === COMMITTEE_PUBLISHED_TOPIC && BigInt(l.topics[1]) === e3Id)
const [nodes, publicKeyHex] = decodeAbiParameters(
  [{ type: 'address[]' }, { type: 'bytes' }, { type: 'bytes32' }, { type: 'bytes' }],
  keyLog.data,
)
const publicKey = Buffer.from(publicKeyHex.slice(2), 'hex')
console.log(`✓ committee ${nodes.join(', ')}`)
console.log(`✓ committee key ${publicKey.length} bytes`)

// --- encrypt ballots with OUR wasm and publish -------------------------------
const cts = VOTES.map(choice => {
  const v = new BigUint64Array(VDEG)
  v[choice] = 1n
  const [ct] = e3.bfv_verifiable_encrypt_vector(v, publicKey, VDEG, VT, VMOD)
  return ct
})
console.log(`✓ ${cts.length} ballots VERIFIABLY encrypted with @interfold/wasm (${cts[0].length} bytes each)`)
for (const [i, ct] of cts.entries()) {
  await write({ address: E3_PROGRAM, abi: programAbi, functionName: 'publishInput', args: [e3Id, toHex(ct)], account, chain: sepolia }, `ballot ${i} (vote=${VOTES[i]})`)
}

// --- homomorphic sum with OUR wasm, publish after deadline -------------------
let sum = cts[0]
for (const ct of cts.slice(1)) sum = fhe.homomorphic_add(params, sum, ct)
console.log(`✓ encrypted tally computed in-process (${sum.length} bytes)`)
const waitUntil = Number(inputWindow[1]) * 1000 - Date.now() + 10_000
if (waitUntil > 0) {
  console.log(`waiting ${Math.round(waitUntil / 1000)}s for the input window to close…`)
  await new Promise(r => setTimeout(r, waitUntil))
}
for (let attempt = 1; ; attempt++) {
  try {
    await write({ address: INTERFOLD, abi: interfoldAbi, functionName: 'publishCiphertextOutput', args: [e3Id, toHex(sum), DEV_PROOF], account, chain: sepolia }, 'ciphertext output')
    break
  } catch (err) {
    const msg = String(err)
    if (attempt < 24 && (msg.includes('InputDeadlineNotReached') || msg.includes('0xbf1af280'))) {
      console.log(`  deadline not reached on-chain yet (attempt ${attempt}) — retrying in 10s`)
      await new Promise(r => setTimeout(r, 10_000))
      continue
    }
    throw err
  }
}

// --- wait for the committee to threshold-decrypt ----------------------------
console.log('waiting for the PUBLIC COMMITTEE to threshold-decrypt…')
const deadline = Date.now() + 900_000
for (;;) {
  const plainLogs = await logs.getLogs({
    address: INTERFOLD,
    event: interfoldAbi.find(x => x.type === 'event' && x.name === 'PlaintextOutputPublished'),
    args: { e3Id },
    fromBlock: receipt.blockNumber,
    toBlock: 'latest',
  })
  if (plainLogs.length) {
    const raw = plainLogs[0].args.plaintextOutput
    console.log(`✓ raw plaintext from committee: ${raw.slice(0, 130)}… (${(raw.length - 2) / 2} bytes)`)
    const bytes = Buffer.from(raw.slice(2), 'hex')
    const coeffs = []
    for (let o = 0; o + 8 <= bytes.length && coeffs.length < 8; o += 8) coeffs.push(bytes.readBigUInt64LE(o))
    console.log('first u64-LE coefficients:', coeffs.map(String).join(', '))
    const tally = coeffs.slice(0, OPTIONS).map(Number)
    console.log(`TALLY: ${JSON.stringify(tally)} — expected [1,1,2]`)
    if (JSON.stringify(tally) === JSON.stringify([1, 1, 2])) {
      console.log('✓✓✓ WEFT-WASM ↔ LIVE COMMITTEE COMPATIBILITY CONFIRMED')
      process.exit(0)
    }
    console.log('tally mismatch — inspect the raw bytes above for framing')
    process.exit(2)
  }
  if (Date.now() > deadline) throw new Error('timeout waiting for plaintext')
  await new Promise(r => setTimeout(r, 20_000))
}
