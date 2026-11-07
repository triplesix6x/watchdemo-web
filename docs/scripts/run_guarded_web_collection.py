"""Collect guarded crash/support tests without dotenv, DB capability or network."""
from contextvars import ContextVar
from pathlib import Path
import os
import socket
import sys
from unittest.mock import patch

for name in ('TEST_DATABASE_URL', 'QA_DISPOSABLE_ROOT', 'QA_DISPOSABLE_TOKEN'):
    os.environ.pop(name, None)
os.environ['PYTEST_DISABLE_PLUGIN_AUTOLOAD'] = '1'
sys.dont_write_bytecode = True
root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / 'web' / 'tests'))
from pydantic_settings import DotEnvSettingsSource
import pytest

original_connect = socket.socket.connect
original_pair = socket.socketpair
original_getaddrinfo = socket.getaddrinfo
in_pair = ContextVar('audit_collection_socketpair', default=False)
attempts = []


def denied(*args, **kwargs):
    attempts.append('network attempt')
    raise RuntimeError('Network forbidden during audit collection')


def connect(sock, address):
    return original_connect(sock, address) if in_pair.get() else denied()


def getaddrinfo(*args, **kwargs):
    return original_getaddrinfo(*args, **kwargs) if in_pair.get() else denied()


def socketpair(*args, **kwargs):
    token = in_pair.set(True)
    try:
        return original_pair(*args, **kwargs)
    finally:
        in_pair.reset(token)


with patch.object(DotEnvSettingsSource, '_read_env_files', return_value={}), \
     patch.object(socket.socket, 'connect', connect), \
     patch.object(socket.socket, 'connect_ex', denied), \
     patch.object(socket, 'socketpair', socketpair), \
     patch.object(socket, 'getaddrinfo', getaddrinfo), \
     patch.object(socket, 'gethostbyname', denied), \
     patch.object(socket, 'gethostbyname_ex', denied), \
     patch.object(socket, 'gethostbyaddr', denied):
    result = pytest.main(['--collect-only', '-q', '-p', 'no:cacheprovider',
                          str(root / 'web/tests/test_crash_reports.py'),
                          str(root / 'web/tests/test_support.py')])
    if attempts:
        raise RuntimeError(f'Collection made {len(attempts)} forbidden network attempts')
    if result:
        raise SystemExit(result)
    print('PASS collection without connection or DNS attempts; no DB capability provided')
    raise SystemExit(result)
