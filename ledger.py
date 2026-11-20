"""Firm books. Money in journal lines is signed integer paise (debit positive)."""
import calendar
import csv
import hashlib
import io
import json
import re
import sqlite3
from collections import Counter
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from zipfile import ZipFile, BadZipFile
import xml.etree.ElementTree as ET

SCHEMA = """
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS firms(id INTEGER PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,owner TEXT,address TEXT,gstin TEXT,demo INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS accounts(id INTEGER PRIMARY KEY,firm INTEGER REFERENCES firms,kind TEXT NOT NULL,name TEXT NOT NULL COLLATE NOCASE,detail TEXT NOT NULL DEFAULT '{}',archived INTEGER DEFAULT 0,system TEXT,UNIQUE(firm,kind,name),UNIQUE(firm,system));
CREATE TABLE IF NOT EXISTS sites(id INTEGER PRIMARY KEY,firm INTEGER REFERENCES firms,name TEXT NOT NULL COLLATE NOCASE,UNIQUE(firm,name));
CREATE TABLE IF NOT EXISTS assigned(account INTEGER REFERENCES accounts,site INTEGER REFERENCES sites,PRIMARY KEY(account,site));
CREATE TABLE IF NOT EXISTS vouchers(id INTEGER PRIMARY KEY,firm INTEGER REFERENCES firms,day TEXT NOT NULL,kind TEXT NOT NULL,memo TEXT NOT NULL,amount INTEGER NOT NULL,document TEXT,invoice_key TEXT,request TEXT UNIQUE,reverses INTEGER UNIQUE REFERENCES vouchers,UNIQUE(firm,invoice_key));
CREATE TABLE IF NOT EXISTS lines(voucher INTEGER REFERENCES vouchers,account INTEGER REFERENCES accounts,site INTEGER REFERENCES sites,value INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_lines_account ON lines(account,voucher);
CREATE TABLE IF NOT EXISTS statement(id INTEGER PRIMARY KEY,bank INTEGER REFERENCES accounts,day TEXT,memo TEXT,ref TEXT,value INTEGER,fingerprint TEXT,voucher INTEGER REFERENCES vouchers,UNIQUE(bank,fingerprint),UNIQUE(bank,voucher));
"""
SYSTEM = {
    'capital':('equity','Opening capital'), 'sales':('income','Sales revenue'),
    'purchases':('expense','Purchases'), 'work':('expense','Contract work'),
    'salary':('expense','Salaries'), 'general':('expense','Office expenses'),
    **{side+tax:(kind,label+' '+tax) for side,kind,label in [('in','asset','Input'),('out','liability','Output')] for tax in ('CGST','SGST','IGST')}
}
KINDS = {'bank','cash','contractor','employee','party','asset','liability','expense','income','equity'}

def need(condition, message):
    if not condition:
        raise ValueError(message)

def word(v, label='Name', limit=180):
    s = str(v or '').strip()
    need(0 < len(s) <= limit, f'{label} must contain 1–{limit} characters.')
    return s

def numeric(v, label='Amount'):
    try:
        d = Decimal(str(v).replace(',','').strip())
        need(d.is_finite() and abs(d) <= Decimal('100000000000'), f'Invalid {label.lower()}.')
        return d
    except (InvalidOperation, TypeError):
        raise ValueError(f'Enter a number for {label.lower()}.') from None

def paise(v):
    return int((numeric(v)*100).quantize(Decimal(1), rounding=ROUND_HALF_UP))

def day(v):
    return date.fromisoformat(str(v)).isoformat()

def rows(db, sql, args=()):
    return [dict(r) for r in db.execute(sql,args)]

def firmrow(db, f):
    r=db.execute('SELECT * FROM firms WHERE id=?',(f,)).fetchone()
    need(r,'Select an existing firm.')
    return dict(r)

def account(db, f, n, kinds=(), active=True):
    r=db.execute('SELECT * FROM accounts WHERE id=? AND firm=?',(n,f)).fetchone()
    need(r and (not active or not r['archived']) and (not kinds or r['kind'] in kinds),'Select an available account in this firm.')
    return r

def system(db,f,k):
    return db.execute('SELECT id FROM accounts WHERE firm=? AND system=?',(f,k)).fetchone()[0]

def make_firm(db,p):
    name=word(p.get('name'))
    fields=(name,str(p.get('owner','')).strip(),str(p.get('address','')).strip(),str(p.get('gstin','')).strip().upper())
    if p.get('id'):
        firmrow(db,p['id'])
        db.execute('UPDATE firms SET name=?,owner=?,address=?,gstin=? WHERE id=?',(*fields,p['id']))
        return p['id']
    f=db.execute('INSERT INTO firms(name,owner,address,gstin) VALUES (?,?,?,?)',fields).lastrowid
    db.executemany('INSERT INTO accounts(firm,system,kind,name) VALUES(?,?,?,?)',[(f,k,*v) for k,v in SYSTEM.items()])
    return f

def site_id(db,f,name):
    name=word(name,'Site')
    db.execute('INSERT INTO sites(firm,name) VALUES(?,?) ON CONFLICT DO NOTHING',(f,name))
    return db.execute('SELECT id FROM sites WHERE firm=? AND name=?',(f,name)).fetchone()[0]

def make_account(db,f,p):
    kind=p.get('kind')
    need(kind in KINDS,'Choose an account type.')
    name=word(p.get('name'))
    detail={k:str(p.get(k,'')).strip() for k in ('owner','number','ifsc','phone','role','address','gstin')}
    if kind=='cash':
        word(detail['owner'],'Cashbook custodian')
    a=p.get('id')
    if a:
        r=account(db,f,a,[kind])
        need(not r['system'],'Built-in ledgers have fixed names.')
        db.execute('UPDATE accounts SET name=?,detail=? WHERE id=?',(name,json.dumps(detail),a))
    else:
        a=db.execute('INSERT INTO accounts(firm,kind,name,detail) VALUES(?,?,?,?)',(f,kind,name,json.dumps(detail))).lastrowid
        opening=paise(p.get('opening') or 0)
        if opening:
            record(db,f,day(p['day']),'Opening balance',name,[(a,None,opening),(system(db,f,'capital'),None,-opening)])
    if kind=='contractor':
        db.execute('DELETE FROM assigned WHERE account=?',(a,))
        for name in str(p.get('sites','')).split(','):
            if name.strip():
                db.execute('INSERT OR IGNORE INTO assigned VALUES(?,?)',(a,site_id(db,f,name)))
    return a

def remove_account(db,f,a):
    r=account(db,f,a)
    need(not r['system'],'Built-in ledgers must be retained.')
    if db.execute('SELECT 1 FROM lines WHERE account=? UNION ALL SELECT 1 FROM statement WHERE bank=? LIMIT 1',(a,a)).fetchone():
        db.execute('UPDATE accounts SET archived=1 WHERE id=?',(a,))
        return 'Archived with its history'
    db.execute('DELETE FROM assigned WHERE account=?',(a,))
    db.execute('DELETE FROM accounts WHERE id=?',(a,))
    return 'Deleted'

def record(db,f,d,k,m,entries,doc=None,ikey=None,req=None,reverses=None):
    need(len(entries)>=2 and sum(v for _,_,v in entries)==0,'Debits and credits must balance.')
    need(all(isinstance(v,int) and 0<abs(v)<=10**15 for _,_,v in entries),'Each posting needs a valid non-zero amount.')
    amt=sum(v for _,_,v in entries if v>0)
    vid=db.execute('INSERT INTO vouchers(firm,day,kind,memo,amount,document,invoice_key,request,reverses) VALUES(?,?,?,?,?,?,?,?,?)',
        (f,day(d),k,m,amt,json.dumps(doc,ensure_ascii=False) if doc else None,ikey,req,reverses)).lastrowid
    db.executemany('INSERT INTO lines VALUES(?,?,?,?)',[(vid,a,s,v) for a,s,v in entries])
    return vid

def invoice(db,f,p):
    sale=p['kind']=='Sale'
    party_name=word(p.get('party'),'Trading party')
    party=db.execute("SELECT id,archived FROM accounts WHERE firm=? AND name=? AND kind='party'",(f,party_name)).fetchone()
    if party:
        need(not party['archived'],'This trading party is archived.')
        a=party['id']
    else:
        a=make_account(db,f,{'kind':'party','name':party_name,'address':p.get('party_address',''),'gstin':p.get('party_gstin','')})
    num=word(p.get('number'),'Invoice number',40)
    d=date.fromisoformat(p['day'])
    fy=d.year-(d.month<4)
    key=json.dumps([p['kind'],fy,None if sale else a,num.casefold()])
    need(not db.execute('SELECT 1 FROM vouchers WHERE firm=? AND invoice_key=?',(f,key)).fetchone(),'This invoice number is already in these books.')
    mode=p.get('tax_mode','split')
    need(mode in ('split','integrated'),'Select a GST mode.')
    amounts=Counter()
    items=[]
    for i in p.get('items',[]):
        qty,rate,gst=[numeric(i.get(k) or 0,k) for k in ('qty','rate','gst')]
        need(qty>0 and rate>0 and 0<=gst<=100,'Check item quantities, rates and GST percentages.')
        base=paise(qty*rate)
        need(base>0,'The line value rounds to zero.')
        # Round each printed tax component once, using paise throughout.
        tax={k:int((Decimal(base)*gst/div).quantize(Decimal(1),rounding=ROUND_HALF_UP)) for k,div in
             ([('CGST',200),('SGST',200)] if mode=='split' else [('IGST',100)])}
        amounts.update(tax)
        amounts['base']+=base
        items.append(dict(description=word(i.get('description'),'Item'),qty=str(qty),rate=str(rate),gst=str(gst),hsn=str(i.get('hsn','')),unit=str(i.get('unit','')),base=base,tax=tax))
    need(items,'Add an invoice item.')
    sign=1 if sale else -1
    total=sum(amounts.values())
    lines=[(a,None,sign*total),(system(db,f,'sales' if sale else 'purchases'),None,-sign*amounts['base'])]
    for k,v in amounts.items():
        if k!='base' and v:
            lines.append((system(db,f,('out' if sale else 'in')+k),None,-sign*v))
    doc={k:str(p.get(k,'')) for k in ('party_address','party_gstin','supply','consumer')}
    doc.update(number=num,party=party_name,firm=firmrow(db,f),items=items,totals=dict(amounts),tax_mode=mode)
    return record(db,f,p['day'],p['kind'],p.get('memo') or party_name,lines,doc,key,p.get('request'))

def post(db,f,p):
    req=p.get('request')
    if req:
        prior=db.execute('SELECT id FROM vouchers WHERE firm=? AND request=?',(f,req)).fetchone()
        if prior:
            return prior[0]
    k=p['kind']
    if k in ('Sale','Purchase'):
        return invoice(db,f,p)
    if k=='Reversal':
        old=db.execute('SELECT * FROM vouchers WHERE id=? AND firm=?',(p['original'],f)).fetchone()
        need(old and old['kind']!='Reversal','Choose an original voucher.')
        need(not db.execute('SELECT 1 FROM vouchers WHERE reverses=?',(old['id'],)).fetchone(),'This voucher already has a reversal.')
        need(day(p['day'])>=old['day'],'Reversal date must be on or after the voucher date.')
        entries=[(a,s,-v) for a,s,v in db.execute('SELECT account,site,value FROM lines WHERE voucher=?',(old['id'],))]
        v=record(db,f,p['day'],k,word(p.get('memo'),'Reversal reason',500),entries,req=req,reverses=old['id'])
        db.execute('UPDATE statement SET voucher=NULL WHERE voucher=?',(old['id'],))
        return v
    kset={'Payment','Receipt','Contra','Journal','Work approved','Salary earned','Credit note','Debit note'}
    need(k in kset,'Unknown voucher type.')
    entries=[]
    for l in p['lines']:
        a=account(db,f,l['account'])
        s=site_id(db,f,l['site']) if str(l.get('site') or '').strip() else None
        if a['kind']=='contractor':
            need(s,'Enter a site for each contractor posting.')
            db.execute('INSERT OR IGNORE INTO assigned VALUES(?,?)',(a['id'],s))
        entries.append((a['id'],s,paise(l['amount'])))
    need(len({a for a,_,_ in entries})>=2,'Choose different accounts.')
    liquid={r[0] for r in db.execute("SELECT id FROM accounts WHERE firm=? AND kind IN ('cash','bank')",(f,))}
    movement=sum(v for a,_,v in entries if a in liquid)
    if k in ('Payment','Receipt'):
        need(movement<0 if k=='Payment' else movement>0,'Check the source and destination accounts.')
    if k=='Contra':
        need(all(a in liquid for a,_,_ in entries),'Transfers require bank or cash accounts.')
    for kind,sys,group in [('Work approved','work','contractor'),('Salary earned','salary','employee')]:
        if k==kind:
            need(len(entries)==2 and any(a==system(db,f,sys) and v>0 for a,_,v in entries) and any(account(db,f,a)['kind']==group and v<0 for a,_,v in entries),'Check the expense and payee for this accrual.')
    vid=record(db,f,p['day'],k,str(p.get('memo','')).strip()[:500],entries,req=req)
    if p.get('statement'):
        reconcile(db,f,p['statement'],vid)
    return vid

def reconcile(db,f,s,v):
    st=db.execute('SELECT s.* FROM statement s JOIN accounts a ON a.id=s.bank WHERE s.id=? AND a.firm=?',(s,f)).fetchone()
    need(st and not st['voucher'],'The statement row is already linked or unavailable.')
    r=db.execute("""SELECT SUM(l.value) FROM lines l JOIN vouchers v ON v.id=l.voucher WHERE v.firm=? AND v.id=? AND l.account=? AND v.reverses IS NULL AND NOT EXISTS(SELECT 1 FROM vouchers r WHERE r.reverses=v.id)""",(f,v,st['bank'])).fetchone()
    need(r[0]==st['value'],'The voucher bank amount must match the statement.')
    db.execute('UPDATE statement SET voucher=? WHERE id=?',(v,s))

def statement_table(raw,filename):
    if filename.lower().endswith('.xlsx'):
        try:
            with ZipFile(io.BytesIO(raw)) as z:
                need(sum(i.file_size for i in z.infolist())<30_000_000,'Workbook is too large.')
                ns='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
                shared=[]
                if 'xl/sharedStrings.xml' in z.namelist():
                    shared=[''.join(t.text or '' for t in si.iter(ns+'t')) for si in ET.fromstring(z.read('xl/sharedStrings.xml'))]
                sheets=sorted(n for n in z.namelist() if re.fullmatch(r'xl/worksheets/sheet\d+\.xml',n))
                need(sheets,'No worksheet found.')
                table=[]
                for row in ET.fromstring(z.read(sheets[0])).iter(ns+'row'):
                    cells=[]
                    for c in row.findall(ns+'c'):
                        col=0
                        for ch in re.match('[A-Z]+',c.get('r','A1')).group():
                            col=26*col+ord(ch)-64
                        need(col<=256,'Too many columns.')
                        cells.extend(['']*max(0,col-len(cells)))
                        val=c.findtext(ns+'v','')
                        if c.get('t')=='s':
                            val=shared[int(val)]
                        if c.get('t')=='inlineStr':
                            val=''.join(t.text or '' for t in c.iter(ns+'t'))
                        cells[col-1]=val
                    table.append(cells)
                return table
        except (BadZipFile,ET.ParseError,KeyError,IndexError,AttributeError):
            raise ValueError('This Excel workbook could not be read.') from None
    need(filename.lower().endswith(('.csv','.tsv')),'Choose a CSV, TSV or XLSX statement.')
    s=raw.decode('utf-8-sig')
    try:
        dialect=csv.Sniffer().sniff(s[:6000],delimiters=',\t;')
    except csv.Error:
        dialect=csv.excel
    return list(csv.reader(io.StringIO(s),dialect))

def statement_date(s):
    for fmt in ('%Y-%m-%d','%d/%m/%Y','%d-%m-%Y','%d/%m/%y','%d-%m-%y','%d %b %Y','%d-%b-%Y','%d-%b-%y','%d.%m.%Y'):
        try:
            return datetime.strptime(s,fmt).date().isoformat()
        except ValueError:
            pass
    if re.fullmatch(r'\d{5}(?:\.0+)?',s):
        return (date(1899,12,30)+timedelta(days=int(float(s)))).isoformat()
    raise ValueError('Unrecognised date.')

def import_rows(db,f,p):
    b=account(db,f,p['bank'],['bank'])['id']
    table=p['table']; cols=p['columns']
    need(0<len(table)<=30000,'Select a statement with up to 30,000 rows.')
    need(cols.get('date',-1)>=0 and any(cols.get(k,-1)>=0 for k in ('amount','debit','credit')),'Map a date and an amount or debit/credit column.')
    count=0
    occurrences=Counter()
    for ix,row in enumerate(table):
        if not any(str(c).strip() for c in row):
            continue
        def cell(k):
            col=cols.get(k,-1)
            return str(row[col]).strip() if 0<=col<len(row) else ''
        try:
            d=statement_date(cell('date'))
            def money(k):
                s=cell(k).replace('₹','').strip()
                return paise(s) if s and s not in ('-','—') else 0
            if cols.get('amount',-1)>=0:
                v=money('amount')
            else:
                cr,dr=money('credit'),money('debit')
                need(cr>=0 and dr>=0 and not (cr and dr),'Check debit and credit values.')
                v=cr-dr
            need(v,'Missing amount.')
        except ValueError as e:
            raise ValueError(f'Data row {ix+1}: {e}') from None
        memo,ref=cell('memo'),cell('ref')
        key=json.dumps([d,v,memo.casefold(),ref.casefold()],ensure_ascii=False)
        occurrences[key]+=1
        fingerprint=hashlib.sha256((key+str(occurrences[key])).encode()).hexdigest()
        count+=db.execute('INSERT INTO statement(bank,day,memo,ref,value,fingerprint) VALUES(?,?,?,?,?,?) ON CONFLICT(bank,fingerprint) DO NOTHING',(b,d,memo,ref,v,fingerprint)).rowcount
    return count

def state(db,f):
    firmrow(db,f)
    accounts=rows(db,'SELECT * FROM accounts WHERE firm=? ORDER BY name',(f,))
    for a in accounts:
        a['detail']=json.loads(a['detail'])
    vouchers=rows(db,'SELECT id,day,kind,memo,amount,document,reverses FROM vouchers WHERE firm=? ORDER BY day DESC,id DESC',(f,))
    byid={v['id']:v for v in vouchers}
    for v in vouchers:
        v['lines']=[]
        v['document']=json.loads(v['document']) if v['document'] else None
    for l in rows(db,'SELECT l.* FROM lines l JOIN vouchers v ON v.id=l.voucher WHERE v.firm=? ORDER BY l.rowid',(f,)):
        byid[l.pop('voucher')]['lines'].append(l)
    return dict(firms=rows(db,'SELECT * FROM firms ORDER BY id'),accounts=accounts,vouchers=vouchers,
        sites=rows(db,'SELECT * FROM sites WHERE firm=? ORDER BY name',(f,)),
        assigned=rows(db,'SELECT x.* FROM assigned x JOIN accounts a ON a.id=x.account WHERE a.firm=?',(f,)),
        statement=rows(db,'SELECT s.* FROM statement s JOIN accounts a ON a.id=s.bank WHERE a.firm=? ORDER BY s.day DESC,s.id DESC',(f,)))
