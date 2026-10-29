"""Isolated real Magpie gateway + loopback mock upstream, no real accounts."""
import hashlib, json, os, pathlib, socket, subprocess, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

root = pathlib.Path(__file__).resolve().parents[1]
binary = os.environ['MAGPIE_TEST_BIN']
home = pathlib.Path(os.environ['MAGPIE_TEST_HOME'])
config = home / '.config' / 'magpie'
config.mkdir(parents=True, exist_ok=True)
seen = []
soft_limited = False
class Upstream(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_POST(self):
        self.rfile.read(int(self.headers.get('Content-Length', 0)))
        key = self.headers.get('Authorization', '').removeprefix('Bearer ')
        seen.append(key)
        status = 401 if key == 'fixture-dead' else 429 if key == 'fixture-soft' and soft_limited else 200
        body = {'error': {'message': 'fixture credential failure', 'type': 'invalid_api_key' if status == 401 else 'rate_limit_exceeded'}} if status != 200 else {'id': 'fixture', 'object': 'chat.completion', 'model': 'fixture-model', 'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': 'fixture success'}, 'finish_reason': 'stop'}], 'usage': {'prompt_tokens': 1, 'completion_tokens': 1, 'total_tokens': 2}}
        self.send_response(status)
        self.send_header('Content-Type', 'application/json'); self.end_headers()
        self.wfile.write(json.dumps(body).encode())
up = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
threading.Thread(target=up.serve_forever, daemon=True).start()
with socket.socket() as s:
    s.bind(('127.0.0.1',0)); port=s.getsockname()[1]
p = {'id':'fixture','name':'Fixture','key':'fixture-dead','keys':[{'key':'fixture-soft','name':'soft'},{'key':'fixture-good','name':'good'}], 'chat':f'http://127.0.0.1:{up.server_port}/v1', 'models':['fixture-model'], 'routing':'smart','affinity':'off','restCapSecs':0}
(config/'providers.json').write_text(json.dumps({'providers':[p]}))
os.chmod(config/'providers.json',0o600)
with socket.socket() as s:
    s.bind(('127.0.0.1',0)); webport=s.getsockname()[1]
(config/'plugins.json').write_text(json.dumps({'plugins':[{'spec':str(root),'options':{'webPort':webport}}]}))
env = dict(os.environ,HOME=str(home),XDG_CONFIG_HOME=str(home/'.config'),XDG_CACHE_HOME=str(home/'.cache'),MAGPIE_ADDR=f'127.0.0.1:{port}',DO_NOT_TRACK='1',MAGPIE_NO_ACCOUNTS='1',MAGPIE_WEB_KEY='fixture-management-key-123456',MAGPIE_BUN=os.environ.get('MAGPIE_TEST_BUN','bun'))
log = (home/'gateway.log').open('w')
proc = subprocess.Popen([binary,'serve',f'--web=127.0.0.1:{webport}'],env=env,stdout=log,stderr=subprocess.STDOUT)
try:
    url=f'http://127.0.0.1:{port}'
    for _ in range(150):
        if proc.poll() is not None: raise RuntimeError('gateway exited')
        try:
            urllib.request.urlopen(url+'/v1/models',timeout=1).close(); break
        except Exception: time.sleep(.1)
    else: raise RuntimeError('gateway did not start')
    def request():
        data=json.dumps({'model':'fixture/fixture-model','messages':[{'role':'user','content':'fixture test'}],'stream':False}).encode()
        r=urllib.request.urlopen(urllib.request.Request(url+'/v1/chat/completions',data=data,headers={'Content-Type':'application/json','Authorization':'Bearer fixture-local'}),timeout=30)
        result=json.load(r); assert result['choices'][0]['message']['content']=='fixture success',result
    request()
    assert seen==['fixture-dead','fixture-soft'],seen
    def saved_order():
        stored=json.loads((config/'providers.json').read_text())['providers'][0]
        return [stored['key']]+[x['key'] for x in stored.get('keys',[])],stored
    # Completion is best effort; a subsequent request also reconciles pending trace attempts.
    request()
    order,stored=saved_order()
    assert order==['fixture-soft','fixture-good','fixture-dead'],order
    assert stored['routing']=='order',stored
    state=json.loads((config/'demote-state.json').read_text())
    assert state['entries'][0]['tier']==2,state
    # Restart the actual gateway/host to prove hard tier retention, then trigger 429.
    proc.terminate();proc.wait(timeout=10)
    proc=subprocess.Popen([binary,'serve',f'--web=127.0.0.1:{webport}'],env=env,stdout=log,stderr=subprocess.STDOUT)
    for _ in range(150):
        try: urllib.request.urlopen(url+'/v1/models',timeout=1).close();break
        except Exception: time.sleep(.1)
    else: raise RuntimeError('restart did not start')
    soft_limited=True
    request()
    request()
    order,stored=saved_order()
    assert order==['fixture-good','fixture-soft','fixture-dead'],order
    state=json.loads((config/'demote-state.json').read_text())
    assert sorted(x['tier'] for x in state['entries'])==[1,2],state
    assert (config/'demote-state.json').stat().st_mode & 0o777 == 0o600
    inventory=json.loads(subprocess.check_output([binary,'plugin','list','--json'],env=env,text=True))
    assert not any(x.get('error') for x in inventory.get('loaded',[])),inventory
    print(json.dumps({'magpie':subprocess.check_output([binary,'--version'],env=env,text=True).strip(),'upstreamAttempts':seen,'savedOrder':order,'persistedTiers':sorted(x['tier'] for x in state['entries']),'restartVerified':True,'routing':stored['routing'],'pluginInventory':inventory},indent=2))
finally:
    proc.terminate()
    try: proc.wait(timeout=10)
    except subprocess.TimeoutExpired: proc.kill();proc.wait()
    log.close();up.shutdown()
