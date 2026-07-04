// SPDX-License-Identifier: LGPL-3.0-only
//
// Drive one full E3 round against the LIVE Sepolia testnet committee:
// quote + pay the fee, request the E3, wait for the public ciphernodes
// to run sortition + DKG and publish the committee key, encrypt two
// numbers under it, publish them as on-chain inputs, then wait for the
// ciphertext + plaintext outputs (the local server/program-runner pair
// handles compute; the testnet committee threshold-decrypts).
//
// Env: PRIVATE_KEY, RPC_URL (https), plus the contract addresses below
// via `interfold print-env --chain sepolia` or explicit exports.
import {
  InterfoldSDK,
  calculateInputWindow,
  DEFAULT_COMPUTE_PROVIDER_PARAMS,
  encodeComputeProviderParams,
  decodePlaintextOutput,
  CommitteeSize,
} from '@interfold/sdk'
import { InterfoldEventType, RegistryEventType } from '@interfold/sdk/events'
import { createWalletClient, decodeAbiParameters, hexToBytes, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

const env = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`missing env ${k}`)
  return v
}

const PRIVATE_KEY = env('PRIVATE_KEY') as `0x${string}`
const RPC_URL = env('RPC_URL')
const INTERFOLD = env('INTERFOLD_ADDRESS') as `0x${string}`
const REGISTRY = env('REGISTRY_ADDRESS') as `0x${string}`
const FEE_TOKEN = env('FEE_TOKEN_ADDRESS') as `0x${string}`
const E3_PROGRAM = env('E3_PROGRAM_ADDRESS') as `0x${string}`

const INPUT_WINDOW_SECS = 240

export async function runSepoliaRound() {
  const sdk = InterfoldSDK.create({
    rpcUrl: RPC_URL,
    privateKey: PRIVATE_KEY,
    contracts: { interfold: INTERFOLD, ciphernodeRegistry: REGISTRY, feeToken: FEE_TOKEN },
    chain: sepolia,
    thresholdBfvParamsPresetName: 'INSECURE_THRESHOLD_512',
  })

  const account = privateKeyToAccount(PRIVATE_KEY)
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) })
  const publicClient = sdk.getPublicClient()

  // Window start needs headroom: the fee approval mines first (~12-30s on
  // Sepolia) and the SDK's default +15s buffer goes stale by request time
  // (InvalidInputDeadlineStart). Build params with a placeholder for the
  // quote, then recompute the window with a 120s buffer just before the
  // actual request.
  const buildParams = async (startBuffer: bigint) => ({
    committeeSize: CommitteeSize.Minimum,
    inputWindow: await calculateInputWindow(publicClient, INPUT_WINDOW_SECS, startBuffer),
    e3Program: E3_PROGRAM,
    paramSet: 0, // InsecureThreshold512
    computeProviderParams: encodeComputeProviderParams(DEFAULT_COMPUTE_PROVIDER_PARAMS, true),
    proofAggregationEnabled: false,
  })
  let requestParams = await buildParams(120n)

  const quote = await sdk.getE3Quote(requestParams)
  console.log(`E3 quote: ${quote} fee-token units`)
  const allowance = (await publicClient.readContract({
    address: FEE_TOKEN,
    abi: [{ name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }],
    functionName: 'allowance',
    args: [account.address, INTERFOLD],
  })) as bigint
  if (allowance >= quote) {
    console.log(`fee allowance already sufficient (${allowance}) — skipping approve`)
  } else {
    console.log('approving fee token…')
    await sdk.waitForTransaction(await sdk.approveFeeToken(quote))
  }

  const waitFor = <T = any>(type: any, timeoutMs: number, filter?: (e: any) => boolean): Promise<T> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${String(type)}`)), timeoutMs)
      const cb = (event: any) => {
        if (filter && !filter(event)) return
        clearTimeout(timer)
        sdk.off(type, cb)
        resolve(event)
      }
      void sdk.onInterfoldEvent(type, cb)
    })

  console.log('requesting E3 from the live Sepolia committee…')
  requestParams = await buildParams(120n)
  const reqHash = await sdk.requestE3(requestParams)
  console.log(`request tx: ${reqHash}`)
  const receipt: any = await publicClient.waitForTransactionReceipt({ hash: reqHash, timeout: 300_000 })
  // Derive e3Id from the E3Requested log on the receipt. NOTE: topics[1]
  // is the indexed PROGRAM address — the e3Id is the first word of data.
  const E3_REQUESTED_TOPIC = '0x5090c9764b5cd13df7afc0013f733dfbe6eaf1b6ddc22a5e291fa387efd4c15e'
  const reqLog = receipt.logs.find(
    (l: any) => l.address.toLowerCase() === INTERFOLD.toLowerCase() && l.topics[0] === E3_REQUESTED_TOPIC,
  )
  if (!reqLog) throw new Error('no E3Requested log on request receipt')
  const e3Id = BigInt(reqLog.data.slice(0, 66))
  console.log(`✓ E3 requested — id ${e3Id} (block ${receipt.blockNumber})`)

  console.log('waiting for the public ciphernodes: sortition + distributed DKG…')
  // Poll the on-chain stage (robust against event-stream hiccups), then
  // read the committee key from the contract.
  const deadline = Date.now() + 900_000
  for (;;) {
    const stage = Number(await sdk.getE3Stage(e3Id))
    console.log(`  stage: ${stage} (${new Date().toISOString()})`)
    if (stage === 6) throw new Error(`E3 FAILED — reason: ${await sdk.getFailureReason(e3Id)}`)
    if (stage >= 3) break // KeyPublished
    if (Date.now() > deadline) throw new Error(`timeout waiting for committee key; last stage ${stage}`)
    await new Promise(r => setTimeout(r, 15_000))
  }
  // getE3PublicKey returns the 32-byte on-chain COMMITMENT; the full BFV
  // key rides the registry's CommitteePublished event. Fetch that log
  // directly (the SDK's event poller misses it on public RPCs) and
  // decode: (address[] nodes, bytes publicKey, bytes32 hash, bytes extra).
  const COMMITTEE_PUBLISHED_TOPIC = '0xbf0636a312095f6c09c909823813b50e392323588d2d83432e7512c64041e67f'
  const keyLogs = await publicClient.getLogs({
    address: REGISTRY,
    fromBlock: receipt.blockNumber,
    toBlock: 'latest',
  })
  const keyLog = keyLogs.find(
    (l: any) => l.topics[0] === COMMITTEE_PUBLISHED_TOPIC && BigInt(l.topics[1]) === e3Id,
  )
  if (!keyLog) throw new Error('CommitteePublished log not found')
  const decoded = decodeAbiParameters(
    [{ type: 'address[]' }, { type: 'bytes' }, { type: 'bytes32' }, { type: 'bytes' }],
    keyLog.data,
  ) as [readonly `0x${string}`[], `0x${string}`, `0x${string}`, `0x${string}`]
  const committeeNodes = decoded[0]
  const publicKey = hexToBytes(decoded[1])
  console.log(`✓ committee: ${committeeNodes.join(', ')}`)
  console.log(`✓ full committee key from the TESTNET committee (${publicKey.length} bytes)`)

  console.log('encrypting 1 and 2 under the committee key…')
  const enc1 = await sdk.encryptNumber(1n, publicKey)
  const enc2 = await sdk.encryptNumber(2n, publicKey)
  const toHex = (b: Uint8Array) => `0x${Array.from(b, x => x.toString(16).padStart(2, '0')).join('')}` as `0x${string}`

  console.log('publishing encrypted inputs on Sepolia…')
  // Sign locally (template's publishInput passes a bare address, which
  // makes viem fall back to eth_sendTransaction — public RPCs can't sign).
  const programAbi = [
    {
      inputs: [
        { internalType: 'uint256', name: 'e3Id', type: 'uint256' },
        { internalType: 'bytes', name: 'data', type: 'bytes' },
      ],
      name: 'publishInput',
      outputs: [],
      stateMutability: 'nonpayable',
      type: 'function',
    },
  ] as const
  for (const enc of [enc1, enc2]) {
    const hash = await walletClient.writeContract({
      address: E3_PROGRAM,
      abi: programAbi,
      functionName: 'publishInput',
      args: [e3Id, toHex(enc)],
      account,
      chain: sepolia,
    })
    await publicClient.waitForTransactionReceipt({ hash, timeout: 300_000 })
    console.log(`  input tx ${hash}`)
  }
  console.log('✓ two encrypted inputs on-chain')

  console.log(`input window closes in ~${INPUT_WINDOW_SECS}s; server computes + publishes, committee decrypts…`)
  const plainDeadline = Date.now() + 1_200_000
  let plaintextOutput = ''
  for (;;) {
    const e3 = await sdk.getE3(e3Id)
    const stage = Number(await sdk.getE3Stage(e3Id))
    console.log(`  stage: ${stage}, plaintext: ${e3.plaintextOutput?.length > 2 ? 'YES' : 'no'} (${new Date().toISOString()})`)
    if (stage === 6) throw new Error(`E3 FAILED — reason: ${await sdk.getFailureReason(e3Id)}`)
    if (e3.plaintextOutput && e3.plaintextOutput.length > 2) {
      plaintextOutput = e3.plaintextOutput
      break
    }
    if (Date.now() > plainDeadline) throw new Error('timeout waiting for plaintext output')
    await new Promise(r => setTimeout(r, 20_000))
  }
  const result = decodePlaintextOutput(plaintextOutput)
  console.log(`✓✓✓ PLAINTEXT OUTPUT from the Sepolia committee: ${result}`)
  if (BigInt(result as any) !== 3n) throw new Error(`expected 3, got ${result}`)
  console.log('ANSWER CORRECT — full E3 round on Sepolia complete')
}

if (process.env.VITEST === undefined && process.argv[1]?.includes('sepolia-round')) {
  runSepoliaRound().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
