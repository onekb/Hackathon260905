#!/usr/bin/env node
/**
 * Reproducible Monad TESTNET deployment using the already-connected Alchemy session.
 * No local private key or session token is read by this script.
 *
 * node scripts/deploy-mon-native.mjs                 # read-only preflight and predictions
 * node scripts/deploy-mon-native.mjs --deploy        # deploy/recover and verify the native MON market
 * node scripts/deploy-mon-native.mjs --verify-only   # recheck deployed code and retry verification
 *
 * CreateX guards the chosen sender+chain salt. Its computeCreate2Address view expects
 * the GUARDED salt, while deployCreate2 receives the ORIGINAL salt.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  concatHex, createPublicClient, encodeAbiParameters, encodeDeployData, encodeFunctionData,
  formatEther, getContractAddress, http, keccak256, parseAbi, sliceHex, toHex,
} from 'viem';
import { monadTestnet } from 'viem/chains';

const execute = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACTS = resolve(ROOT, 'contracts');
const DEPLOYMENTS = resolve(CONTRACTS, 'deployments');
const RECORD = resolve(DEPLOYMENTS, 'inferpool-mon-native-testnet.json');
const NETWORK = 'monad-testnet';
const CHAIN_ID = 10143;
const RPC_URL = 'https://testnet-rpc.monad.xyz';
const FACTORY = '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed';
const DEPLOYER = '0xac801eec099c65a605b809b98a09a62674614a08';
const ROUTER = DEPLOYER;
const DEPLOY = process.argv.includes('--deploy');
const VERIFY_ONLY = process.argv.includes('--verify-only');
const client = createPublicClient({ chain: monadTestnet, transport: http(RPC_URL, { timeout: 30_000, retryCount: 2 }) });
const factoryAbi = parseAbi([
  'function deployCreate2(bytes32 salt, bytes initCode) payable returns (address)',
  'function computeCreate2Address(bytes32 salt, bytes32 initCodeHash) view returns (address)',
]);
const serializable = (_key, value) => typeof value === 'bigint' ? value.toString() : value;
const emit = (value) => console.log(JSON.stringify(value, serializable));
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

async function command(program, args, cwd = ROOT) {
  try {
    return (await execute(program, args, { cwd, maxBuffer: 8 * 1024 * 1024, timeout: 120_000 })).stdout.trim();
  } catch (error) {
    // Never relay raw Alchemy output, credentials, or complete command arguments to logs.
    let code = error.code;
    try { code = JSON.parse(error.stderr || error.stdout).error?.code ?? code; } catch {}
    throw new Error(`${program} failed (${String(code)}); inspect the CLI locally if needed.`);
  }
}

async function alchemy(args) {
  return JSON.parse(await command('alchemy', [...args, '--json', '--no-interactive']));
}

async function loadArtifact(name) {
  return JSON.parse(await readFile(resolve(CONTRACTS, `out/${name}.sol/${name}.json`), 'utf8'));
}

function deploymentPlan(name, artifact, constructorArguments = []) {
  const initCode = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: constructorArguments });
  const suffix = sliceHex(keccak256(toHex(`inferpool:${name}:2026-09-05:mon-native-v2`)), 0, 11);
  const salt = concatHex([DEPLOYER, '0x01', suffix]);
  const guardedSalt = keccak256(encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }], [DEPLOYER, BigInt(CHAIN_ID), salt],
  ));
  const initCodeHash = keccak256(initCode);
  const address = getContractAddress({ opcode: 'CREATE2', from: FACTORY, salt: guardedSalt, bytecodeHash: initCodeHash });
  return { name, artifact, constructorArguments, initCode, initCodeHash, salt, guardedSalt, address };
}

function matchesRuntime(artifact, deployed) {
  let local = artifact.deployedBytecode.object.slice(2).toLowerCase();
  let remote = deployed.slice(2).toLowerCase();
  for (const references of Object.values(artifact.deployedBytecode.immutableReferences ?? {})) {
    for (const { start, length } of references) {
      const zero = '0'.repeat(length * 2);
      local = local.slice(0, start * 2) + zero + local.slice((start + length) * 2);
      remote = remote.slice(0, start * 2) + zero + remote.slice((start + length) * 2);
    }
  }
  return local === remote;
}

let record;
try { record = JSON.parse(await readFile(RECORD, 'utf8')); } catch {
  record = { network: NETWORK, chainId: CHAIN_ID, rpcUrl: RPC_URL, factory: FACTORY, deployer: DEPLOYER, router: ROUTER, contracts: {} };
}

async function save() {
  await mkdir(DEPLOYMENTS, { recursive: true });
  await writeFile(RECORD, JSON.stringify(record, serializable, 2) + '\n');
}

async function verify(plan) {
  const contractName = `src/${plan.name}.sol:${plan.name}`;
  const standardJsonInput = JSON.parse(await command('forge', [
    'verify-contract', plan.address, contractName, '--chain', String(CHAIN_ID), '--show-standard-json-input',
  ], CONTRACTS));
  const metadata = typeof plan.artifact.metadata === 'string' ? JSON.parse(plan.artifact.metadata) : plan.artifact.metadata;
  const constructorArgs = plan.name === 'InferenceMarket'
    ? encodeAbiParameters([{ type: 'address' }], plan.constructorArguments).slice(2)
    : '';
  const body = {
    chainId: CHAIN_ID, contractAddress: plan.address, contractName,
    compilerVersion: `v${metadata.compiler.version}`, standardJsonInput, foundryMetadata: metadata,
    ...(constructorArgs ? { constructorArgs } : {}),
  };
  const prefix = resolve(DEPLOYMENTS, `inferpool-mon-native-${plan.name}`);
  await writeFile(`${prefix}-verification-request.json`, JSON.stringify(body, null, 2) + '\n');
  const response = await fetch('https://agents.devnads.com/v1/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(110_000),
  });
  const responseText = await response.text();
  let result;
  try { result = JSON.parse(responseText); } catch { result = { success: false, httpStatus: response.status, message: 'Non-JSON verification response' }; }
  await writeFile(`${prefix}-verification-result.json`, JSON.stringify(result, null, 2) + '\n');
  record.contracts[plan.name].verification = result;
  record.contracts[plan.name].sourceVerification = result.success ? 'verified' : 'pending-or-failed';
  await save();
  emit({ stage: 'verification', contract: plan.name, address: plan.address, success: result.success, verified: result.verified, total: result.total, httpStatus: response.status });
}

async function readBack(plan) {
  const code = await client.getCode({ address: plan.address });
  if (!code || code === '0x') throw new Error(`${plan.name}: no deployed runtime code`);
  if (!matchesRuntime(plan.artifact, code)) throw new Error(`${plan.name}: runtime does not match the compiled artifact`);
  const read = (functionName) => client.readContract({ address: plan.address, abi: plan.artifact.abi, functionName });
  const [router, native, symbol, decimals, maxOrderDuration] = await Promise.all([read('router'), read('IS_NATIVE_ASSET'), read('ASSET_SYMBOL'), read('ASSET_DECIMALS'), read('MAX_ORDER_DURATION')]);
  if (router.toLowerCase() !== ROUTER.toLowerCase() || native !== true || symbol !== 'MON' || Number(decimals) !== 18 || maxOrderDuration !== 3600n) throw new Error('InferenceMarket: unexpected native asset configuration');
  const values = {router, native, symbol, decimals, maxOrderDuration};
  record.contracts[plan.name] = {
    ...record.contracts[plan.name], contract: `src/${plan.name}.sol:${plan.name}`, address: plan.address,
    salt: plan.salt, guardedSalt: plan.guardedSalt, initCodeHash: plan.initCodeHash,
    runtimeBytecodeMatchesOutsideImmutableReferences: true, runtimeBytecodeHash: keccak256(code),
    readBack: values, explorerUrl: `https://testnet.monadscan.com/address/${plan.address}`,
  };
  record.market = plan.address;
  record.asset = {symbol:'MON',decimals:18,native:true};
  record.legacyMarket = '0x6F1b725DD3588cb5c8C3f72F614E80ebB2d82568';
  record.legacyToken = '0x62701D69bD213e8F63c28465528931de208cE06E';
  await save();
  emit({ stage: 'deployed-and-read-back', contract: plan.name, address: plan.address, transactionHash: record.contracts[plan.name].transactionHash, values });
}

async function deploy(plan) {
  const previousAddress = record.contracts[plan.name]?.address;
  if (previousAddress && previousAddress.toLowerCase() !== plan.address.toLowerCase()) {
    throw new Error(`${plan.name}: current artifact differs from the recorded deployment; use a new explicitly versioned deployment instead of overwriting its record`);
  }
  const onChainPrediction = await client.readContract({ address: FACTORY, abi: factoryAbi, functionName: 'computeCreate2Address', args: [plan.guardedSalt, plan.initCodeHash] });
  if (onChainPrediction.toLowerCase() !== plan.address.toLowerCase()) throw new Error('CreateX address prediction disagrees');
  let code = await client.getCode({ address: plan.address });
  emit({ stage: 'prediction', contract: plan.name, address: plan.address, existingCode: !!code && code !== '0x' });
  if (!DEPLOY && !VERIFY_ONLY) return;

  let transactionHash = record.contracts[plan.name]?.transactionHash;
  let operationId = record.contracts[plan.name]?.operationId;
  if (!code || code === '0x') {
    if (!DEPLOY) throw new Error(`${plan.name} is not deployed; use --deploy first`);
    if (!transactionHash && !operationId) {
      if (record.contracts[plan.name]?.submissionStartedAt) {
        throw new Error(`${plan.name}: a previous submission has an uncertain result; inspect wallet activity before any retry`);
      }
      const data = encodeFunctionData({ abi: factoryAbi, functionName: 'deployCreate2', args: [plan.salt, plan.initCode] });
      const [estimate, gasPrice, balance] = await Promise.all([
        client.estimateGas({ account: DEPLOYER, to: FACTORY, data }), client.getGasPrice(), client.getBalance({ address: DEPLOYER }),
      ]);
      const estimateWithBuffer = estimate + estimate / 10n;
      const estimatedCost = estimateWithBuffer * gasPrice;
      if (balance < estimatedCost) throw new Error(`${plan.name}: insufficient test MON for estimated deployment cost`);
      record.contracts[plan.name] = { address: plan.address, gasEstimate: estimate, estimateWithTenPercentBuffer: estimateWithBuffer, gasPriceWei: gasPrice, estimatedCostWei: estimatedCost, balanceBeforeWei: balance, gasLimitControl: 'Alchemy session CLI manages final gas parameters; this is a preflight estimate, not an enforced gas limit.' };
      await save();
      emit({ stage: 'estimate', contract: plan.name, gasEstimate: estimate, estimatedCostMON: formatEther(estimatedCost), balanceMON: formatEther(balance) });
      record.contracts[plan.name].submissionStartedAt = new Date().toISOString();
      await save();
      const result = await alchemy(['evm', 'contract', 'call', FACTORY, 'deployCreate2(bytes32,bytes)', '--args', JSON.stringify([plan.salt, plan.initCode]), '--signer', 'session', '-n', NETWORK]);
      transactionHash = result.txHash ?? result.transactionHash;
      operationId = result.callId ?? result.id;
      record.contracts[plan.name] = { ...record.contracts[plan.name], transactionHash, operationId, executionMode: result.executionMode, submittedAt: new Date().toISOString() };
      await save();
      emit({ stage: 'submitted', contract: plan.name, address: plan.address, transactionHash, operationId, status: result.status });
      if (!transactionHash && !operationId) throw new Error('Alchemy returned no transaction or operation ID; inspect wallet activity before retrying');
    }
    for (let attempt = 0; !transactionHash && attempt < 30; attempt++) {
      const result = await alchemy(['evm', 'status', operationId, '-n', NETWORK]);
      transactionHash = result.txHash ?? result.transactionHash ?? result.receipt?.transactionHash;
      if (transactionHash) break;
      if (result.status === 'failed') throw new Error(`${plan.name}: Alchemy operation failed`);
      await delay(2_000);
    }
    if (!transactionHash) throw new Error(`${plan.name}: operation still pending; run this script again to recover`);
    record.contracts[plan.name].transactionHash = transactionHash;
    await save();
    const receipt = await client.waitForTransactionReceipt({ hash: transactionHash, timeout: 60_000, pollingInterval: 1_000 });
    if (receipt.status !== 'success') throw new Error(`${plan.name}: deployment receipt reverted`);
    const transaction = await client.getTransaction({ hash: transactionHash });
    record.contracts[plan.name] = {
      ...record.contracts[plan.name], blockNumber: receipt.blockNumber, receiptStatus: receipt.status,
      gasUsed: receipt.gasUsed, gasLimit: transaction.gas, effectiveGasPrice: receipt.effectiveGasPrice,
      monadGasLimitCostWei: transaction.gas * receipt.effectiveGasPrice,
    };
    await save();
  }
  await readBack(plan);
}

try {
  await command('forge', ['build'], CONTRACTS);
  const [chainId, factoryCode, status] = await Promise.all([
    client.getChainId(), client.getCode({ address: FACTORY }), alchemy(['wallet', 'status', '--verify']),
  ]);
  if (chainId !== CHAIN_ID) throw new Error('Refusing to deploy outside Monad testnet');
  if (!factoryCode || factoryCode === '0x') throw new Error('CreateX factory has no code');
  if (status.activeSigner !== 'session' || !status.valid || status.walletAddress?.toLowerCase() !== DEPLOYER) throw new Error('A valid matching Alchemy session signer is required');
  emit({ stage: 'preflight', chainId, activeSigner: status.activeSigner, valid: status.valid, deployer: DEPLOYER, factoryCodeHash: keccak256(factoryCode) });
  const market = deploymentPlan('InferenceMarket', await loadArtifact('InferenceMarket'), [ROUTER]);
  await deploy(market);
  if (DEPLOY || VERIFY_ONLY) {
    for (const plan of [market]) {
      if (record.contracts[plan.name]?.sourceVerification === 'verified' && !VERIFY_ONLY) continue;
      try { await verify(plan); } catch (error) {
        record.contracts[plan.name].sourceVerification = 'pending-or-failed';
        await save();
        emit({ stage: 'verification-error', contract: plan.name, error: error.message });
      }
    }
  }
} catch (error) {
  emit({ stage: 'error', message: error.shortMessage ?? error.message });
  process.exitCode = 1;
}
