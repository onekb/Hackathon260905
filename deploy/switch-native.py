#!/usr/bin/env python3
"""Controlled one-time MON release switch on the existing InferPool host.

Run as root with a prepared /srv/inferpool/releases/<git-sha> directory.
Private state remains private; no credentials or order bodies are printed.
"""
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
OLD_MARKET = '0x6F1b725DD3588cb5c8C3f72F614E80ebB2d82568'
OLD_TOKEN = '0x62701D69bD213e8F63c28465528931de208cE06E'
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
    return {'count': len(orders), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}

def update_env(path, changes):
    lines = path.read_text().splitlines()
    result = []
    for line in lines:
        name = line.split('=', 1)[0]
        if name in changes:
            result.append(name + '=' + changes.pop(name))
        elif name not in ('TOKEN_ADDRESS', 'DEMO_USD_ADDRESS'):
            result.append(line)
    result.extend(name + '=' + value for name, value in changes.items())
    temporary = path.with_suffix('.tmp')
    temporary.write_text('\n'.join(result) + '\n')
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
before = ledger()
emit(stage='preflight', release=str(release), previous=str(previous), ledger=before, execute=args.execute)
if not args.execute: raise SystemExit(0)
backup = STATE / 'backups' / ('native-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True, mode=0o700)
backup.chmod(0o700)
opened = False
backed_up = False
try:
    run('systemctl', 'stop', *SERVICES)
    before = ledger()
    for name in ['router-state.json', 'router.env', 'provider.env']:
        shutil.copy2(STATE / name, backup / name)
        (backup / name).chmod(0o600)
    backed_up = True
    update_env(STATE / 'router.env', {'MARKET_ADDRESS': MARKET, 'LEGACY_MARKET_ADDRESS': OLD_MARKET, 'LEGACY_TOKEN_ADDRESS': OLD_TOKEN, 'DEMO_NEW_ORDERS_ENABLED': 'false'})
    update_env(STATE / 'provider.env', {'PROVIDER_INPUT_PRICE': '0.3', 'PROVIDER_CACHE_READ_PRICE': '0.03', 'PROVIDER_CACHE_WRITE_PRICE': '0.375', 'PROVIDER_OUTPUT_PRICE': '0.8', 'PROVIDER_MIN_RESERVE': '0.000001'})
    point_to(release)
    run('systemctl', 'start', *SERVICES)
    config, models = ready()
    data = json.loads((STATE / 'router-state.json').read_text())
    if len(data['orders']) != before['count'] or any(o.get('asset_symbol') != 'dUSD' or o.get('asset_decimals') != 6 or o.get('market_address', '').lower() != OLD_MARKET.lower() for o in data['orders'].values()):
        raise RuntimeError('Legacy order migration metadata does not match the original dUSD ledger')
    emit(stage='native-ready-paused', legacyOrders=before['count'], providers=len(models['data']), backup=str(backup), ledgerBefore=before['sha256'])
    # After opening, never restore an old ledger: a real MON request may already have arrived.
    opened = True
    update_env(STATE / 'router.env', {'DEMO_NEW_ORDERS_ENABLED': 'true'})
    run('systemctl', 'restart', SERVICES[0])
    config, models = ready()
    emit(stage='live', market=config['market_address'], asset=config['asset_symbol'], providers=len(models['data']), legacyOrders=before['count'], revision=args.revision)
except Exception as error:
    if not opened:
        run('systemctl', 'stop', *SERVICES)
        if backed_up:
            for name in ['router-state.json', 'router.env', 'provider.env']:
                shutil.copy2(backup / name, STATE / name)
                shutil.chown(STATE / name, user='inferpool', group='inferpool')
        point_to(previous)
        run('systemctl', 'start', *SERVICES)
    emit(stage='error', message=str(error), rolledBack=not opened, backup=str(backup))
    raise SystemExit(1)
