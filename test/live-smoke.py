"""Isolated real Magpie gateway + loopback mock upstream, no real accounts."""
import hashlib, json, os, pathlib, socket, subprocess, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

root = pathlib.Path(__file__).resolve().parents[1]
binary = os.environ['MAGPIE_TEST_BIN']
home = pathlib.Path(os.environ['MAGPIE_TEST_HOME'])
config = home / '.config' / 'magpie'
config.mkdir(parents=True, exist_ok=True)
seen = []
class Upstream(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_POST(self):
        self.rfile.read(int(self.headers.get('Content-Length', 0)))
        key = self.headers.get('Authorization', '').removeprefix('Bearer ')
        seen.append(key)
        body = {'error': {'message': 'fixture refuses this credential', 'type': 'invalid_api_key'}} if key == 'fixture-dead' else {'id': 'fixture', 'object': 'chat.completion', 'model': 'fixture-model', 'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': 'fixture success'}, 'finish_reason': 'stop'}], 'usage': {'prompt_tokens': 1, 'completion_tokens': 1, 'total_tokens': 2}}
        self.send_response(401 if key == 'fixture-dead' else 200)
        self.send_header('Content-Type', 'application/json'); self.end_headers()
        self.wfile.write(json.dumps(body).encode())
up = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
threading.Thread(target=up.serve_forever, daemon=True).start()
with socket.socket() as s:
    s.bind(('127.0.0.1',0)); port=s.getsockname()[1]
p = {'id':'fixture','name':'Fixture','key':'fixture-dead','keys':[{'key':'fixture-good','name':'good'}], 'chat':f'http://127.0.0.1:{up.server_port}/v1', 'models':['fixture-model'], 'routing':'smart','affinity':'off','restCapSecs':0}
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
    assert seen==['fixture-dead','fixture-good'],seen
    request()
    assert seen==['fixture-dead','fixture-good','fixture-good'],seen
    stored=json.loads((config/'providers.json').read_text())['providers'][0]
    assert stored['key']=='fixture-good' and stored['keys'][-1]['key']=='fixture-dead',stored
    assert stored['routing']=='order',stored
    inventory=json.loads(subprocess.check_output([binary,'plugin','list','--json'],env=env,text=True))
    assert not any(x.get('error') for x in inventory.get('loaded',[])),inventory
    print(json.dumps({'magpie':subprocess.check_output([binary,'--version'],env=env,text=True).strip(),'upstreamAttempts':seen,'responses':2,'savedOrder':['fixture-good','fixture-dead'],'routing':stored['routing'],'pluginInventory':inventory},indent=2))
finally:
    proc.terminate()
    try: proc.wait(timeout=10)
    except subprocess.TimeoutExpired: proc.kill();proc.wait()
    log.close();up.shutdown()
