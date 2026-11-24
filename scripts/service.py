"""Own the optional development server without affecting unrelated processes."""
import os
from pathlib import Path
import signal
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
os.chdir(root)
pidfile = root / 'tmp/server.pid'
server = str(root / 'scripts/serve.mjs')

def running():
    if not pidfile.exists():
        return None
    pid = int(pidfile.read_text())
    result = subprocess.run(['ps', '-p', str(pid), '-o', 'command='], capture_output=True, text=True)
    return pid if result.returncode == 0 and server in result.stdout else None

command = sys.argv[1]
pid = running()
if command == 'start':
    if pid:
        print(f'Server running: {pid}')
    else:
        (root / 'tmp').mkdir(exist_ok=True)
        (root / 'var/log').mkdir(parents=True, exist_ok=True)
        with open('var/log/server.stdout', 'ab') as out, open('var/log/server.stderr', 'ab') as err:
            process = subprocess.Popen(['node', server], stdout=out, stderr=err, start_new_session=True)
        pidfile.write_text(str(process.pid))
        print(f'Started {process.pid}: http://127.0.0.1:{os.environ.get("PORT", "8080")}')
elif command == 'stop':
    if pid:
        os.kill(pid, signal.SIGTERM)
    pidfile.unlink(missing_ok=True)
    print('Server stopped')
elif command == 'status':
    print(f'Server running: {pid}' if pid else 'Server stopped')
else:
    raise SystemExit('Expected start, stop, or status')
