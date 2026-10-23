"""Veracity local MVP API. Python 3.10+, no third-party dependencies."""
import argparse
import csv
import hashlib
import io
import json
import math
import os
import secrets
import sqlite3
import sys
import attachments
import crates
import reports
from reporting import service as summary_reports
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DB = os.environ.get('VERACITY_DB', str(Path(__file__).with_name('veracity.sqlite3')))
USERS = {'staff': {'id':'u-staff-a','name':'Staff A','role':'staff'}, 'manager': {'id':'u-manager-k','name':'Manager K','role':'manager'}, 'owner': {'id':'u-owner-r','name':'Owner R','role':'owner'}}
OPEN = ('pending_approval','manual_review','needs_review')
class APIError(Exception):
    def __init__(self, message, status=400): self.message, self.status = message, status

def now(): return datetime.now(timezone.utc).isoformat()
def dump(value): return json.dumps(value, separators=(',', ':'), sort_keys=True)
def connect():
    db = sqlite3.connect(DB, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    return db

def init():
    with connect() as db:
        db.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,recorded INTEGER NOT NULL CHECK(recorded>=0),unit_cost REAL NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS movements(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),kind TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity<>0),occurred_at TEXT NOT NULL,conflict_ref TEXT NOT NULL DEFAULT '',posted_case TEXT,revision INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS cases(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS counts(id INTEGER PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),counted INTEGER NOT NULL,actor TEXT NOT NULL,at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,role TEXT NOT NULL,expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,case_id TEXT,detail TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ledger(id INTEGER PRIMARY KEY,case_id TEXT UNIQUE NOT NULL,product_id TEXT NOT NULL,before_qty INTEGER NOT NULL,after_qty INTEGER NOT NULL,detail TEXT NOT NULL);
        ''')
        crates.init(db)
        attachments.init(db)
        reports.init(db)
        product_columns = {row['name'] for row in db.execute('PRAGMA table_info(products)')}
        if 'evidence_missing' not in product_columns:
            db.execute('ALTER TABLE products ADD COLUMN evidence_missing INTEGER NOT NULL DEFAULT 0')
        summary_reports.init(db)

def audit(db,user,action,cid,detail): db.execute('INSERT INTO audit(at,actor,action,case_id,detail) VALUES(?,?,?,?,?)',(now(),user['name'],action,cid,dump(detail)))
def integer(value, label, minimum=0):
    if isinstance(value,bool) or not isinstance(value,int) or value < minimum or value > 1000000000: raise APIError(f'{label} must be a whole number between {minimum} and 1000000000.')
    return value

def text(value,label):
    if not isinstance(value,str) or not value.strip() or len(value)>4000: raise APIError(f'{label} is required (maximum 4000 characters).')
    return value.strip()

def require(user,roles):
    if user['role'] not in roles: raise APIError('This role cannot perform this action.',403)

def load(db,cid,user):
    row=db.execute('SELECT body FROM cases WHERE id=?',(cid,)).fetchone()
    if not row: raise APIError('Case not found.',404)
    c=json.loads(row['body'])
    if user['role']=='staff' and c['createdBy']!=user['name']: raise APIError('Case not found.',404)
    return c

def save(db,c): db.execute('UPDATE cases SET body=? WHERE id=?',(dump(c),c['id']))
def pending(c):
    if c['status'] not in OPEN: raise APIError('This case is already closed. No second correction is allowed.',409)

def assess(db,c):
    rows=[dict(r) for r in db.execute('SELECT * FROM movements WHERE product_id=? AND posted_case IS NULL AND occurred_at<=? ORDER BY id',(c['productId'],c['createdAt']))]
    delta=c['counted']-c['recorded']; net=sum(r['quantity'] for r in rows)
    conflicts=any(r['conflict_ref'] for r in rows)
    # Reconcile the complete eligible set, never cherry-pick transactions to force a match.
    supported=bool(rows) and net==delta and not conflicts
    same_sign=delta*net>0
    explained=min(abs(delta),abs(net)) if same_sign and not conflicts else 0
    state='supported' if supported else 'conflicting' if conflicts or (rows and (not same_sign or abs(net)>abs(delta))) else 'incomplete'
    checks=[('R1','Records match the product',bool(rows),'Only this product is queried.'),('R2','Records happened before the count',bool(rows),'Only unposted records at or before the count are eligible.'),('R3','Net records equal the discrepancy',net==delta and bool(rows),f'Eligible net {net}; discrepancy {delta}.'),('R4','No conflicting records',not conflicts,'Linked or disputed records require human investigation.')]
    previous=c['versions'][-1]['evidence'] if c['versions'] else []
    old_ids={x['id'] for x in previous}
    at=now()
    return {'version':len(c['versions'])+1,'createdAt':at,'rulesVersion':'reconcile-v1','evidenceState':state,'explained':explained,'unexplained':abs(delta)-explained,
      'summary':f'{len(rows)} eligible records; net movement {net:+d} units. '+('Records support a possible reconciliation.' if supported else 'Manual investigation required.'),
      'conclusion':'A numerical match supports a potential explanation; it does not prove the root cause.' if supported else 'Do not post these records automatically. Resolve missing or conflicting evidence first.',
      'evidence':[{'id':r['id'],'type':r['kind'],'quantity':r['quantity'],'stockStatus':'Unposted at assessment time','match':'conflicting' if r['conflict_ref'] else 'matched' if supported else 'unmatched','isNew':bool(previous) and r['id'] not in old_ids} for r in rows],
      'rules':[{'id':a,'name':b,'passed':d,'detail':e} for a,b,d,e in checks],
      'impact':[f'Post {len(rows)} outstanding records once',f'Update stock from {c["recorded"]} to {c["counted"]}','No additional independent stock adjustment'] if supported else ['Keep stock unchanged pending investigation or explicit manager override'],
      'attachmentIds':[a['id'] for a in c.get('attachments',[])],
      'sourceSnapshot':rows,'sourceHash':hashlib.sha256(dump(rows).encode()).hexdigest()}

def add_assessment(db,c):
    v=assess(db,c); c['versions'].append(v)
    c['status']='pending_approval' if v['evidenceState']=='supported' else 'needs_review' if v['evidenceState']=='conflicting' else 'manual_review'
    at=now()
    if not c['timeline']: c['timeline']=[{'stage':'trigger','summary':f'Count {c["counted"]}; recorded {c["recorded"]}. Note: {c["note"]}','at':c['createdAt'],'actor':c['createdBy']}]
    for stage,summary in [('evidence',v['summary']),('reasoning',v['conclusion']),('approval','Waiting for manager review.'),('outcome','No stock change yet.')]:
        c['timeline'].append({'stage':stage,'summary':summary,'at':at if stage!='outcome' else '', 'actor':'Veracity'})
    v['timelineSnapshot']=[dict(e) for e in c['timeline']]
    return v

def create_count(db,user,b):
    require(user,('staff','manager'))
    p=db.execute('SELECT * FROM products WHERE id=? OR name=?',(b.get('productId',''),b.get('product',''))).fetchone()
    if not p: raise APIError('Choose an imported product.')
    counted=integer(b.get('counted'),'Counted quantity')
    if 'recorded' in b and b['recorded']!=p['recorded']: raise APIError('Stock changed. Refresh before submitting.',409)
    for r in db.execute('SELECT body FROM cases WHERE product_id=?',(p['id'],)):
        if json.loads(r['body'])['status'] in OPEN: raise APIError('This product already has an open investigation.',409)
    at=now(); db.execute('INSERT INTO counts(product_id,counted,actor,at) VALUES(?,?,?,?)',(p['id'],counted,user['name'],at))
    if counted==p['recorded']:
        audit(db,user,'count_matched',None,{'productId':p['id'],'counted':counted}); return {'matched':True}
    cid='INV-'+secrets.token_hex(4).upper()
    c={'id':cid,'productId':p['id'],'product':p['name'],'recorded':p['recorded'],'stockRevision':p['revision'],'counted':counted,'createdAt':at,'createdBy':user['name'],'note':str(b.get('note',''))[:4000],'status':'manual_review','versions':[],'timeline':[]}
    add_assessment(db,c)
    db.execute('INSERT INTO cases VALUES(?,?,?)',(cid,p['id'],dump(c))); audit(db,user,'count_submitted',cid,{'counted':counted})
    return c

def create_product(db,user,b):
    require(user,('staff','manager'))
    name=text(b.get('name'),'Product name')
    recorded=integer(b.get('recorded'),'Recorded stock')
    cost=b.get('unit_cost',0)
    if isinstance(cost,bool) or not isinstance(cost,(int,float)) or not math.isfinite(cost) or not 0<=cost<=1000000000:
        raise APIError('Unit cost must be a nonnegative finite number.')
    note=b.get('note','')
    if not isinstance(note,str) or len(note)>4000:
        raise APIError('Note must be 4000 characters or fewer.')
    if db.execute('SELECT 1 FROM products WHERE lower(name)=lower(?)',(name,)).fetchone():
        raise APIError('A product with this name already exists. Count it instead.',409)
    product_id=secrets.token_hex(8).upper()
    db.execute('INSERT INTO products(id,name,recorded,unit_cost,evidence_missing) VALUES(?,?,?,?,1)',(product_id,name,recorded,float(cost)))
    product=dict(db.execute('SELECT * FROM products WHERE id=?',(product_id,)).fetchone())
    product['evidence_missing']=bool(product['evidence_missing'])
    audit(db,user,'product_created',None,{'productId':product_id,'name':name,'recorded':recorded,'unit_cost':float(cost),'note':note})
    return product

def decision(db,user,c,b):
    require(user,('manager',)); pending(c)
    v=c['versions'][-1]
    if b.get('version')!=v['version']: raise APIError('Assessment changed. Review the latest version.',409)
    if b.get('attachmentRevision',0)!=c.get('attachmentRevision',0): raise APIError('Documents changed. Refresh the case and review all attachments before deciding.',409)
    reason=text(b.get('reason'),'Decision reason'); action=b.get('action')
    if action not in ('approved','rejected','overridden','review'): raise APIError('Unknown decision action.')
    if action=='review':
        c['status']='needs_review'; c['timeline'].append({'stage':'approval','summary':f'Review requested: {reason}','at':now(),'actor':user['name']}); save(db,c);audit(db,user,'review_requested',c['id'],{'reason':reason});return c
    p=db.execute('SELECT * FROM products WHERE id=?',(c['productId'],)).fetchone()
    if action!='rejected':
        if p['revision']!=c['stockRevision'] or p['recorded']!=c['recorded']: raise APIError('Inventory changed since this count. Reject and submit a fresh count.',409)
        fresh=assess(db,c)
        if fresh['sourceHash']!=v['sourceHash']: raise APIError('Evidence changed. Reassess and review the new version.',409)
        if action=='approved' and v['evidenceState']!='supported': raise APIError('Normal approval requires complete, nonconflicting evidence.',409)
        if action=='approved':
            for r in v['sourceSnapshot']:
                changed=db.execute('UPDATE movements SET posted_case=?,revision=revision+1 WHERE id=? AND posted_case IS NULL AND revision=?',(c['id'],r['id'],r['revision'])).rowcount
                if changed!=1: raise APIError('A source record has already changed.',409)
        if action=='overridden':
            for r in v['sourceSnapshot']:
                db.execute("UPDATE movements SET conflict_ref=?,revision=revision+1 WHERE id=? AND posted_case IS NULL", ('Unresolved after override '+c['id'],r['id']))
        # Overrides post one explicit adjustment, do not silently consume uncertain evidence.
        db.execute('UPDATE products SET recorded=?,revision=revision+1 WHERE id=?',(c['counted'],c['productId']))
        db.execute('INSERT INTO ledger(case_id,product_id,before_qty,after_qty,detail) VALUES(?,?,?,?,?)',(c['id'],c['productId'],c['recorded'],c['counted'],dump({'action':action,'sourceIds':[r['id'] for r in v['sourceSnapshot']] if action=='approved' else [],'reason':reason})))
    c['status']='rejected' if action=='rejected' else 'completed'; c['finalStock']=p['recorded'] if action=='rejected' else c['counted']
    c['decision']={'action':action,'by':user['name'],'role':user['role'],'reason':reason,'at':now(),'assessmentVersion':v['version'],'attachmentRevision':c.get('attachmentRevision',0),'attachmentIds':[a['id'] for a in c.get('attachments',[])]}
    c['timeline'] += [{'stage':'approval','summary':f'{action} by {user["name"]}: {reason}','at':now(),'actor':user['name']},{'stage':'outcome','summary':f'Stock {c["recorded"]} → {c["finalStock"]}. '+('No stock mutation.' if action=='rejected' else 'One atomic reconciliation recorded.'),'at':now(),'actor':'Veracity'}]
    save(db,c); audit(db,user,action,c['id'],c['decision']); return c

def import_rows(db,user,b):
    require(user,('manager',)); kind=b.get('kind'); rows=b.get('rows')
    if kind not in ('products','movements') or not isinstance(rows,list) or not 1<=len(rows)<=10000: raise APIError('Provide kind products/movements and 1–10000 rows.')
    for r in rows:
        if not isinstance(r,dict): raise APIError('Each row must be an object.')
        rid=text(r.get('id'),'Record ID')
        if kind=='products':
            qty=integer(r.get('recorded'),'Recorded stock'); name=text(r.get('name'),'Product name');cost=r.get('unit_cost',0)
            if isinstance(cost,bool) or not isinstance(cost,(int,float)) or not 0<=cost<=1000000000: raise APIError('unit_cost must be a nonnegative finite number.')
            # Never overwrite balances using an import. Corrections must use an approved case.
            db.execute('INSERT INTO products(id,name,recorded,unit_cost) VALUES(?,?,?,?)',(rid,name,qty,cost))
        else:
            q=r.get('quantity'); integer(abs(q) if isinstance(q,int) and not isinstance(q,bool) else None,'Absolute quantity')
            if q==0: raise APIError('Movement quantity cannot be zero.')
            occurred=text(r.get('occurred_at'),'occurred_at')
            try:
                dt=datetime.fromisoformat(occurred.replace('Z','+00:00'))
                if dt.tzinfo is None: raise ValueError()
                occurred=dt.astimezone(timezone.utc).isoformat()
            except ValueError: raise APIError('occurred_at requires an ISO timestamp with timezone.')
            movement_kind=text(r.get('kind'),'Movement kind')
            if movement_kind not in ('Sale','Delivery','Customer return','Supplier return','Damage','Transfer in','Transfer out'): raise APIError('Unsupported movement kind.')
            if (movement_kind in ('Sale','Supplier return','Damage','Transfer out') and q>0) or (movement_kind in ('Delivery','Customer return','Transfer in') and q<0): raise APIError('Movement sign does not match its kind.')
            db.execute('INSERT INTO movements(id,product_id,kind,quantity,occurred_at,conflict_ref) VALUES(?,?,?,?,?,?)',(rid,text(r.get('product_id'),'product_id'),movement_kind,q,occurred,str(r.get('conflict_ref',''))[:4000]))
    audit(db,user,'import_'+kind,None,{'rows':len(rows)}); return {'imported':len(rows)}

def state(db,user):
    products=[dict(p) for p in db.execute('SELECT * FROM products ORDER BY name')]
    for product in products:
        product['evidence_missing']=bool(product.get('evidence_missing',0))
    cases=[json.loads(r['body']) for r in db.execute('SELECT body FROM cases ORDER BY rowid DESC')]
    if user['role']=='staff': cases=[c for c in cases if c['createdBy']==user['name']]
    counts={'verified':0,'awaiting':0,'attention':0,'not_counted':0};items=[];last=None; matched=0; differ=0;summary_items=[]
    for p in products:
        own=db.execute('SELECT * FROM counts WHERE product_id=? '+('AND actor=? ' if user['role']=='staff' else '')+'ORDER BY id DESC LIMIT 1', (p['id'],user['name']) if user['role']=='staff' else (p['id'],)).fetchone()
        latest=next((c for c in cases if c['productId']==p['id']),None)
        if own: last=max(last or '',own['at'])
        if latest and latest['status'] in OPEN:
            key='awaiting' if latest['status']=='pending_approval' else 'attention';differ+=1
            units=max(0,latest['recorded']-latest['counted']);v=latest['versions'][-1]
            items.append({'name':p['name'],'units':units,'value':units*p['unit_cost'],'status':latest['status'],'caseId':latest['id'],'explainedValue':min(units,v['explained'])*p['unit_cost']})
            counted=latest['counted'];recorded=latest['recorded'];case_id=latest['id']
        elif latest and latest['status']=='completed': key='verified';matched+=1
        elif own and own['counted']==p['recorded']:key='verified';matched+=1
        elif own:key='attention';differ+=1
        else:key='not_counted'
        if latest and latest['status']=='completed':
            counted=recorded=p['recorded'];case_id=None
        elif not (latest and latest['status'] in OPEN) and own:
            counted=own['counted'];recorded=p['recorded'];case_id=None
        elif not (latest and latest['status'] in OPEN):
            counted=None;recorded=p['recorded'];case_id=None
        row_status='not_counted' if counted is None else 'matched' if counted==recorded else 'difference'
        summary_items.append({
            'productId':p['id'],'name':p['name'],'recorded':recorded,'counted':counted,
            'difference':None if counted is None else counted-recorded,'status':row_status,
            'caseId':case_id,'evidenceMissing':bool(p.get('evidence_missing',0)),
        })
        counts[key]+=1
    summary_items.sort(key=lambda item:({'difference':0,'not_counted':1,'matched':2}[item['status']],item['name'].casefold()))
    value=sum(i['value'] for i in items); exp=sum(i.pop('explainedValue') for i in items)
    return {'user':user,'products':products,'cases':cases,'summary':{'total':len(products),'counts':counts,'matches':sum(item['status']=='matched' for item in summary_items),'items':summary_items,'updatedAt':now(),'lastCount':last,'missing':{'units':sum(i['units'] for i in items),'value':value,'explained':exp,'unexplained':value-exp,'items':items}},'progress':{'counted':matched+differ,'total':len(products),'matched':matched,'differ':differ,'lastSubmitted':last}}

class Handler(BaseHTTPRequestHandler):
    def respond(self,status,payload,cookie=None):
        data=dump(payload).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)))
        if cookie:self.send_header('Set-Cookie',cookie)
        self.end_headers();self.wfile.write(data)
    def do_GET(self): self.dispatch()
    def do_POST(self): self.dispatch()
    def dispatch(self):
        import time
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<=length<=2000000: raise APIError('Request too large.',413)
            b=json.loads(self.rfile.read(length)) if length else {}
            if not isinstance(b,dict): raise APIError('Expected JSON object.')
            path=self.path.split('?')[0].strip('/').split('/')
            with connect() as db:
                reporting = self.command=='GET' and path in (['reports','weekly'], ['reports','summary'])
                db.execute('BEGIN IMMEDIATE' if self.command=='POST' or reporting else 'BEGIN')
                if path==['health'] and self.command=='GET': self.respond(200,{'ok':True});return
                cookie=self.headers.get('Cookie','');token=next((p.strip().split('=',1)[1] for p in cookie.split(';') if p.strip().startswith('veracity_session=')),'')
                if path==['session','end'] and self.command=='POST':
                    db.execute('DELETE FROM sessions WHERE token=?',(token,));db.commit()
                    self.respond(200,{'ok':True},'veracity_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return
                if path==['session'] and self.command=='POST':
                    role=b.get('role')
                    if not isinstance(role,str) or role not in USERS: raise APIError('Select a valid demo role.')
                    if os.environ.get('VERACITY_DEMO_MODE','true').lower()!='true': raise APIError('Role switching disabled. Configure real authentication before deployment.',403)
                    db.execute('DELETE FROM sessions WHERE token=? OR expires<?',(token,time.time()))
                    token=secrets.token_urlsafe(32);db.execute('INSERT INTO sessions VALUES(?,?,?)',(token,role,time.time()+28800));db.commit()
                    self.respond(200,{'user':USERS[role]},f'veracity_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800');return
                session=db.execute('SELECT role FROM sessions WHERE token=? AND expires>?',(token,time.time())).fetchone()
                if not session: raise APIError('Session expired. Select your demo role again.',401)
                user=USERS[session['role']]
                if path[0]=='evidence':
                    bridge=os.environ.get('VERACITY_EVIDENCE_BRIDGE','')
                    if not bridge or not secrets.compare_digest(self.headers.get('X-Evidence-Bridge',''),bridge): raise APIError('Private evidence endpoint.',403)
                    result=attachments.route(db,user,path,self.command,b,sys.modules[__name__])
                elif path==['crates']: result=crates.route(db,user,self.command,b,sys.modules[__name__])
                elif self.command=='GET' and path==['state']: result=state(db,user)
                elif reporting:
                    from urllib.parse import parse_qs, urlsplit
                    query=parse_qs(urlsplit(self.path).query,keep_blank_values=True)
                    if path[-1]=='weekly':
                        if set(query)-{'week'} or len(query.get('week',[]))>1:
                            raise APIError('Expected a single optional week parameter.')
                        result=reports.weekly(db,user,query.get('week',[None])[0],sys.modules[__name__])
                    else:
                        if set(query)-{'period','date'} or any(len(v)!=1 for v in query.values()):
                            raise APIError('Expected one optional period and one optional date.')
                        result=summary_reports.summary(db,user,query.get('period',[None])[0],query.get('date',[None])[0],sys.modules[__name__])
                elif self.command=='POST' and path==['products']:result=create_product(db,user,b)
                elif self.command=='POST' and path==['counts']:result=create_count(db,user,b)
                elif self.command=='POST' and path==['imports']:result=import_rows(db,user,b)
                elif len(path)>=2 and path[0]=='cases':
                    c=load(db,path[1],user)
                    if self.command=='GET' and len(path)==2:result=c
                    elif self.command=='POST' and len(path)==3 and path[2]=='decisions': result=decision(db,user,c,b)
                    elif self.command=='POST' and len(path)==3 and path[2]=='reassess':
                        require(user,('staff','manager'));pending(c);add_assessment(db,c);save(db,c);audit(db,user,'reassessed',c['id'],{'version':len(c['versions'])});result=c
                    elif self.command=='GET' and len(path)==3 and path[2]=='audit':result=[dict(r) for r in db.execute('SELECT * FROM audit WHERE case_id=? ORDER BY id',(c['id'],))]
                    else:raise APIError('Endpoint not found.',404)
                else:raise APIError('Endpoint not found.',404)
                db.commit();self.respond(200,result)
        except APIError as e:self.respond(e.status,{'error':e.message})
        except (ValueError,TypeError,KeyError):self.respond(400,{'error':'Invalid request fields or JSON.'})
        except sqlite3.IntegrityError:self.respond(409,{'error':'Duplicate ID, missing product, or invalid database constraint. Nothing was imported or changed.'})
        except Exception:
            import traceback;traceback.print_exc();self.respond(500,{'error':'Internal server error. No partial transaction was committed.'})

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8000);args=parser.parse_args();init()
    print(f'Veracity API listening on http://127.0.0.1:{args.port}; database: {DB}',flush=True)
    ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
