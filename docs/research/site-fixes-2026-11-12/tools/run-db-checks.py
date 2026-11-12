"""One disposable capped DB, serially instead of the preview stack; never production."""
import json, os, pathlib, secrets, socket, subprocess, tempfile, time
ROOT = pathlib.Path('/home/bigboss/PycharmProjects/watchdemo-web')
PYTHON = '/home/bigboss/.cache/watchdemo-prelaunch-python/watchdemo-web-JtkTGdsV-py3.14/bin/python'
URL = 'postgresql+asyncpg://watchdemo_qa:watchdemo_qa_local_only@127.0.0.1:55438/watchdemo_prelaunch_qa'
def run(*args, **kw): return subprocess.run(args, check=True, cwd=ROOT, **kw)
with socket.socket() as sock:
 sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
 sock.bind(('127.0.0.1',55438))
compose = ['docker','compose','--env-file','/dev/null','-f','docker-compose.local.yml']
run(*compose, 'stop')
name = 'watchdemo-site-fixes-qa-' + secrets.token_hex(4)
with tempfile.TemporaryDirectory(prefix='watchdemo-pg-qa-') as temp:
 root = pathlib.Path(temp); root.chmod(0o755); data=root/'data'; data.mkdir(); data.chmod(0o777)
 try:
  run('docker','run','-d','--name',name,'--network','host','--memory','256m','--memory-swap','256m','--cpus','.5','--pids-limit','96','-e','POSTGRES_USER=watchdemo_qa','-e','POSTGRES_PASSWORD=watchdemo_qa_local_only','-e','POSTGRES_DB=watchdemo_prelaunch_qa','-e',f'PGDATA={data}','-v',f'{data}:{data}','postgres:16','postgres','-h','127.0.0.1','-p','55438','-c','shared_buffers=32MB','-c','max_connections=20','-c','work_mem=2MB')
  for _ in range(60):
   initialized = b'PostgreSQL init process complete' in subprocess.check_output(['docker','logs',name],stderr=subprocess.DEVNULL)
   if initialized and subprocess.run(['docker','exec',name,'pg_isready','-h','127.0.0.1','-p','55438','-U','watchdemo_qa'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0: break
   time.sleep(1)
  else: raise RuntimeError('Disposable PG did not start')
  # Docker user owns the real data; only copy its real PID proof for the existing guard.
  proof = subprocess.check_output(['docker','exec',name,'cat',str(data/'postmaster.pid')],text=True)
  accessible=root/'proof';accessible.mkdir();(accessible/'postmaster.pid').write_text(proof)
  # Real data-directory identity must remain exact; expose read permission only to proof file.
  run('docker','exec',name,'chmod','a+rx',str(data))
  run('docker','exec',name,'chmod','a+r',str(data/'postmaster.pid'))
  token=secrets.token_hex(32)
  (root/'qa-disposable.json').write_text(json.dumps({'token':token,'database_url':URL,'data_directory':str(data)}))
  env=dict(os.environ,TEST_DATABASE_URL=URL,QA_DISPOSABLE_ROOT=str(root),QA_DISPOSABLE_TOKEN=token)
  result=subprocess.run([PYTHON,'-m','pytest','-q','--tb=short','web/tests/test_migration_history.py','web/tests/test_social_auth.py','web/tests/test_social_auth_network_failures.py','web/tests/test_social_auth_nonce.py','web/tests/test_auth_logout.py','web/tests/test_auth_token_concurrency.py','web/tests/test_maintenance_notice.py'],cwd=ROOT,env=env)
  code=result.returncode
 finally:
  subprocess.run(['docker','rm','-f',name],check=False,stdout=subprocess.DEVNULL)
  # Container-owned files cannot be removed by the caller until ownership is restored.
  run('docker','run','--rm','--network','none','--memory','32m','--memory-swap','32m','--cpus','.1','--pids-limit','16','-v',f'{data}:/data','--entrypoint','chown','postgres:16','-R',f'{os.getuid()}:{os.getgid()}','/data')
raise SystemExit(code)
