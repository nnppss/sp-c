"""Start the local accounts workspace with python3 app.py."""
import argparse
import base64
import binascii
import json
import mimetypes
import os
import sqlite3
import tempfile
import webbrowser
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
import ledger as L

ROOT=Path(__file__).resolve().parent
DEFAULT_DB=ROOT/'books'/'workspace.sqlite3'

def connect(path):
    db=sqlite3.connect(path,timeout=10)
    db.row_factory=sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    return db

def seed(db,today):
    f=L.make_firm(db,dict(name='SP & Company',owner='Nikhil Singh',address='Agra, Uttar Pradesh'))
    db.execute('UPDATE firms SET demo=1 WHERE id=?',(f,))
    def acc(kind,name,**params):
        return L.make_account(db,f,dict(kind=kind,name=name,**params))
    bank=acc('bank','HDFC Bank',number='4821',role='Current account')
    other=acc('bank','State Bank of India',number='7630',role='Current account')
    cash=acc('cash','Office cashbook',owner='Nikhil Singh')
    petty=acc('cash','Site cashbook',owner='Vikram Sharma')
    anuj=acc('contractor','Anuj Kumar',sites='Yamuna, Bodla, Kargil',role='Civil works')
    ravi=acc('contractor','Ravi Constructions',sites='Yamuna, Kargil',role='Structural works')
    acc('contractor','Sharma Electricals',sites='Bodla',role='Electrical works')
    emp=acc('employee','Meera Sharma',role='Accounts assistant')
    acc('employee','Vikram Sharma',role='Site supervisor')
    client=acc('party','Aarav Developers')
    supp=acc('party','Agra Steel Traders')
    def rec(d,k,m,a,b,amount,site=None):
        s=L.site_id(db,f,site) if site else None
        return L.record(db,f,d.isoformat(),k,m,[(a,s,amount*100),(b,s,-amount*100)])
    months=[]
    for back in range(5,-1,-1):
        n=today.year*12+today.month-1-back
        months.append(date(n//12,n%12+1,1))
    start=months[0]-timedelta(days=1)
    for a,bal in [(bank,345000),(other,165000),(cash,38000),(petty,14000)]:
        rec(start,'Opening balance','Opening funds',a,L.system(db,f,'capital'),bal)
    for ix,month in enumerate(months):
        def at(n):
            return month.replace(day=min(n,today.day) if ix==5 else n)
        income=[165000,225000,184000,295000,256000,326000][ix]
        cost=[85000,114000,102000,154000,127000,168000][ix]
        rec(at(2),'Receipt','Site mobilisation receipt',bank,L.system(db,f,'sales'),income)
        rec(at(4),'Payment','Construction materials',L.system(db,f,'purchases'),bank,cost)
        rec(at(6),'Salary earned','Monthly salary · Meera Sharma',L.system(db,f,'salary'),emp,24000)
        rec(at(8),'Payment','Salary payment · Meera Sharma',emp,bank,24000)
        if ix<5:
            rec(at(10),'Payment','Site expenses',L.system(db,f,'general'),bank,6000)
    for kind,party,num,item,qty,rate in [('Purchase','Agra Steel Traders','AST-218','Steel reinforcement bars',12,4500),('Sale','Aarav Developers','SP-026','Site development works',3,32000)]:
        L.post(db,f,dict(kind=kind,number=num,party=party,day=(today-timedelta(days=4)).isoformat(),supply='Uttar Pradesh',tax_mode='split',items=[dict(description=item,qty=qty,rate=rate,gst=18,unit='unit')]))
    rec(today-timedelta(days=3),'Work approved','Foundation work · Yamuna',L.system(db,f,'work'),anuj,48000,'Yamuna')
    rec(today-timedelta(days=2),'Payment','Site advance · Bodla',anuj,cash,10000,'Bodla')
    rec(today-timedelta(days=2),'Payment','Site advance · Kargil',ravi,bank,12500,'Kargil')
    rec(today-timedelta(days=1),'Receipt','Part payment · Aarav Developers',bank,client,65000)
    rec(today,'Payment','Site advance · Yamuna',anuj,bank,30000,'Yamuna')

def initialise(path):
    path.parent.mkdir(parents=True,exist_ok=True)
    db=connect(path)
    try:
        db.executescript(L.SCHEMA)
        with db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT id FROM firms LIMIT 1').fetchone():
                seed(db,date.today())
    finally:
        db.close()

class Handler(BaseHTTPRequestHandler):
    def reply(self,code,data,mime='application/json',download=None):
        raw=json.dumps(data,ensure_ascii=False).encode() if mime=='application/json' else data
        self.send_response(code)
        self.send_header('Content-Type',mime)
        self.send_header('Content-Length',str(len(raw)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('X-Frame-Options','DENY')
        if download:
            self.send_header('Content-Disposition','attachment; filename="'+download+'"')
        self.end_headers()
        self.wfile.write(raw)

    def host_ok(self):
        return self.headers.get('Host') in (f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}')

    def do_GET(self):
        if not self.host_ok():
            return self.reply(403,{'error':'Use the local workspace address.'})
        url=urlsplit(self.path)
        if url.path in ('/','/index.html','/style.css','/app.js','/icons.js','/favicon.png'):
            path=ROOT/'static'/('index.html' if url.path=='/' else url.path[1:])
            if path.is_file():
                return self.reply(200,path.read_bytes(),mimetypes.guess_type(str(path))[0] or 'application/octet-stream')
        if url.path not in ('/api/state','/api/backup'):
            return self.reply(404,{'error':'Page not found.'})
        db=connect(self.server.database)
        try:
            if url.path=='/api/backup':
                with tempfile.TemporaryDirectory() as tmp:
                    path=Path(tmp)/'backup.sqlite3'
                    dest=sqlite3.connect(path)
                    try:
                        db.backup(dest)
                    finally:
                        dest.close()
                    return self.reply(200,path.read_bytes(),'application/octet-stream',f'ledgerdesk-{date.today()}.sqlite3')
            f=int(parse_qs(url.query).get('firm',['1'])[0])
            self.reply(200,L.state(db,f))
        except (ValueError,KeyError) as e:
            self.reply(400,{'error':str(e)})
        finally:
            db.close()

    def do_POST(self):
        if not self.host_ok() or self.headers.get('X-Workspace')!='local' or self.headers.get('Origin','http://'+self.headers['Host'])!='http://'+self.headers['Host']:
            return self.reply(403,{'error':'Open the local workspace to save changes.'})
        db=connect(self.server.database)
        try:
            size=int(self.headers.get('Content-Length',0))
            L.need(0<size<=12_000_000,'File exceeds the 8 MB limit.')
            p=json.loads(self.rfile.read(size))
            with db:
                db.execute('BEGIN IMMEDIATE')
                f=p.get('firm',1)
                op=self.path
                if op=='/api/firm':
                    result=L.make_firm(db,p)
                else:
                    L.firmrow(db,f)
                    if op=='/api/account':
                        result=L.make_account(db,f,p)
                    elif op=='/api/remove':
                        result=L.remove_account(db,f,p['id'])
                    elif op=='/api/post':
                        result=L.post(db,f,p)
                    elif op=='/api/read-statement':
                        result=L.statement_table(base64.b64decode(p['data'],validate=True),p['filename'])
                    elif op=='/api/import':
                        result=L.import_rows(db,f,p)
                    elif op=='/api/match':
                        L.reconcile(db,f,p['statement'],p['voucher'])
                        result=p['voucher']
                    else:
                        return self.reply(404,{'error':'Unknown action.'})
            self.reply(200,{'result':result})
        except sqlite3.IntegrityError:
            self.reply(409,{'error':'This record, number, or statement match already exists in these books.'})
        except (ValueError,KeyError,TypeError,IndexError,OverflowError,binascii.Error) as e:
            self.reply(400,{'error':str(e) or 'Check the entered details.'})
        except sqlite3.OperationalError:
            self.reply(503,{'error':'The database is unavailable. Check disk space and retry.'})
        finally:
            db.close()

    def log_message(self,fmt,*args):
        if args and len(args)>1 and str(args[1]).startswith('5'):
            super().log_message(fmt,*args)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description='Ledgerdesk local accounting workspace')
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--database',type=Path,default=DEFAULT_DB)
    parser.add_argument('--open',action='store_true')
    args=parser.parse_args()
    initialise(args.database)
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    server.database=args.database
    url=f'http://127.0.0.1:{server.server_port}'
    print(f'Ledgerdesk is running at {url}',flush=True)
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
