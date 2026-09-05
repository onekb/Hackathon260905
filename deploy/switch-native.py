#!/usr/bin/env python3
"""Historical one-time MON asset migration; retired after D19.

The original migration below depended on the removed demo admission pause.
Keep it as an implementation record; regular upgrades preserve the native ledger.
"""
raise SystemExit('This one-time asset migration is retired. Deploy code while retaining the current native ledger; do not rerun asset migration.')

import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import urllib.request

ROOT = Path('/srv/inferpool')
STATE = ROOT / 'state'
MARKET = '0x142a4904307244Bed0cECD72dE8329A253333182'
NATIVE_LEDGER = STATE / 'router-mon-state.json'
IDENTITY = {'market_address': MARKET, 'asset_symbol': 'MON', 'asset_decimals': 18}
SERVICES = ['inferpool-router.service', 'inferpool-provider.service']

def emit(**values):
    print(json.dumps(values), flush=True)

def run(*args):
    subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

def ledger():
    path = STATE / 'router-state.json'
    data = json.loads(path.read_text())
    orders = list(data['orders'].values())
    unresolved = [o['id'] for o in orders if o['status'] in ('locking', 'running', 'reservation_unknown') or o.get('reservationUncertain') or o['settlement'] == 'pending' or (o['settlement'] == 'failed' and o['status'] != 'lock_failed')]
    if unresolved:
        raise RuntimeError('Existing reservations must finish before switching; no ledger was discarded')
    # Only the information needed to preserve admission quotas enters the new ledger.
    history = list(data.get('admissionHistory', [])) + [
        {'buyer': o['buyer'].lower(), 'createdAt': o['createdAt']} for o in orders
    ]
    if any(set(h) != {'buyer', 'createdAt'} or not re.fullmatch(r'0x[0-9a-fA-F]{40}', h['buyer']) or type(h['createdAt']) is not int or not 0 < h['createdAt'] <= 9007199254740991 for h in history):
        raise RuntimeError('Invalid original admission history')
    return {'count': len(orders), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}, history

def update_env(path, changes):
    lines = path.read_text().splitlines()
    result = []
    written = set()
    for line in lines:
        name = line.split('=', 1)[0]
        if name in changes:
            if name not in written:
                result.append(name + '=' + changes[name])
                written.add(name)
        elif name not in ('TOKEN_ADDRESS', 'DEMO_USD_ADDRESS', 'LEGACY_MARKET_ADDRESS', 'LEGACY_TOKEN_ADDRESS'):
            result.append(line)
    result.extend(name + '=' + value for name, value in changes.items() if name not in written)
    temporary = path.with_suffix('.tmp')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, 'w') as output:
        os.fchmod(output.fileno(), 0o600)
        output.write('\n'.join(result) + '\n')
        output.flush()
        os.fsync(output.fileno())
    metadata = path.stat()
    os.chown(temporary, metadata.st_uid, metadata.st_gid)
    temporary.chmod(0o600)
    temporary.replace(path)

def point_to(release):
    temporary = ROOT / 'current-next'
    if temporary.is_symlink(): temporary.unlink()
    temporary.symlink_to(release)
    temporary.replace(ROOT / 'current')

def read_http(path):
    with urllib.request.urlopen('http://127.0.0.1:8788' + path, timeout=5) as response:
        return json.load(response)

def ready():
    for _ in range(45):
        try:
            config = read_http('/config')
            models = read_http('/v1/models')
            if config.get('market_address', '').lower() == MARKET.lower() and config.get('asset_symbol') == 'MON' and config.get('asset_decimals') == 18 and models.get('data'):
                return config, models
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError('Native Router/Provider did not become ready while new orders were paused')

parser = argparse.ArgumentParser()
parser.add_argument('revision')
parser.add_argument('--execute', action='store_true')
args = parser.parse_args()
if not re.fullmatch(r'[a-f0-9]{7,40}', args.revision): raise SystemExit('Expected a Git revision directory')
release = ROOT / 'releases' / args.revision
for relative in ['server/src/index.ts', 'node_modules/tsx/package.json', 'web/out/index.html', 'contracts/out/InferenceMarket.sol/InferenceMarket.json']:
    if not (release / relative).is_file(): raise SystemExit('Release is incomplete: ' + relative)
previous = (ROOT / 'current').resolve()
if previous == release: raise SystemExit('Already using this release; refusing to repeat migration')
if NATIVE_LEDGER.exists(): raise SystemExit('Native ledger already exists; inspect it before attempting a new switch')
before, history = ledger()
emit(stage='preflight', release=str(release), previous=str(previous), ledger=before, execute=args.execute)
if not args.execute: raise SystemExit(0)
backup = STATE / 'backups' / ('native-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True, mode=0o700)
backup.chmod(0o700)
opened = False
backed_up = False
try:
    run('systemctl', 'stop', *SERVICES)
    before, history = ledger()
    for name in ['router-state.json', 'router.env', 'provider.env']:
        shutil.copy2(STATE / name, backup / name)
        (backup / name).chmod(0o600)
    backed_up = True
    native = {'version': 1, 'market': IDENTITY, 'orders': {}, 'idempotency': {}, 'credentials': {}, 'cache': {}, 'admissionHistory': history}
    # Exclusive creation prevents a repeated switch from discarding any native requests.
    descriptor = os.open(NATIVE_LEDGER, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as output:
        json.dump(native, output)
        output.flush()
        os.fsync(output.fileno())
    shutil.chown(NATIVE_LEDGER, user='inferpool', group='inferpool')
    update_env(STATE / 'router.env', {'MARKET_ADDRESS': MARKET, 'ROUTER_STATE_PATH': str(NATIVE_LEDGER), 'DEMO_NEW_ORDERS_ENABLED': 'false'})
    update_env(STATE / 'provider.env', {'PROVIDER_INPUT_PRICE': '0.3', 'PROVIDER_CACHE_READ_PRICE': '0.03', 'PROVIDER_CACHE_WRITE_PRICE': '0.375', 'PROVIDER_OUTPUT_PRICE': '0.8', 'PROVIDER_MIN_RESERVE': '0.000001'})
    point_to(release)
    run('systemctl', 'start', *SERVICES)
    config, models = ready()
    data = json.loads(NATIVE_LEDGER.read_text())
    # Visitors may legitimately create fresh sessions while inference is paused.
    if data['market'] != IDENTITY or data['orders'] or data['admissionHistory'] != history:
        raise RuntimeError('Native ledger must contain no orders and preserve original admission history')
    archived, _ = ledger()
    if archived['sha256'] != before['sha256']:
        raise RuntimeError('Archived ledger changed during switch')
    emit(stage='native-ready-paused', archivedOrders=before['count'], admissionHistory=len(history), providers=len(models['data']), backup=str(backup), ledgerBefore=before['sha256'])
    # After opening, never restore an old ledger: a real MON request may already have arrived.
    opened = True
    update_env(STATE / 'router.env', {'DEMO_NEW_ORDERS_ENABLED': 'true'})
    # Close the seller's WebSocket too so the Router can finish graceful shutdown.
    run('systemctl', 'restart', *SERVICES)
    config, models = ready()
    emit(stage='live', market=config['market_address'], asset=config['asset_symbol'], providers=len(models['data']), archivedOrders=before['count'], admissionHistory=len(history), revision=args.revision)
except Exception as error:
    if not opened:
        run('systemctl', 'stop', *SERVICES)
        if backed_up:
            for name in ['router.env', 'provider.env']:
                shutil.copy2(backup / name, STATE / name)
                shutil.chown(STATE / name, user='inferpool', group='inferpool')
        # Keep a failed native ledger for inspection; never overwrite or delete it automatically.
        point_to(previous)
        run('systemctl', 'start', *SERVICES)
    emit(stage='error', message=str(error), rolledBack=not opened, backup=str(backup))
    raise SystemExit(1)
