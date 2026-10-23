"""Explicit crate registration and whole-crate location transfers.
These events never change product stock or enter reconciliation movements.
"""
import re
import uuid

def init(db):
    db.executescript("""
    CREATE TABLE IF NOT EXISTS tracked_crates(
      id TEXT PRIMARY KEY, tag TEXT UNIQUE NOT NULL, product_id TEXT NOT NULL REFERENCES products(id),
      declared_quantity INTEGER NOT NULL CHECK(declared_quantity>=0), location TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1, registered_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS crate_events(
      id INTEGER PRIMARY KEY, crate_id TEXT NOT NULL REFERENCES tracked_crates(id),
      action TEXT NOT NULL, from_location TEXT, to_location TEXT NOT NULL,
      actor TEXT NOT NULL, at TEXT NOT NULL, note TEXT NOT NULL,
      request_id TEXT UNIQUE NOT NULL, request_body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS crate_scans(
      id INTEGER PRIMARY KEY, tag TEXT NOT NULL, crate_id TEXT REFERENCES tracked_crates(id),
      source TEXT NOT NULL CHECK(source IN ('simulated','entered_id')),
      station TEXT NOT NULL, recorded_location TEXT, crate_revision INTEGER,
      actor TEXT NOT NULL, at TEXT NOT NULL, request_id TEXT UNIQUE NOT NULL, request_body TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS crate_scans_crate ON crate_scans(crate_id,id);
    """)

def tag_id(value, s):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9:_-]{4,80}', value.strip()):
        raise s.APIError('Tag ID must contain 4–80 letters, numbers, colons, underscores or hyphens.')
    return value.strip().upper()

def location(value, s):
    value = s.text(value, 'Location')
    if len(value) > 80: raise s.APIError('Location cannot exceed 80 characters.')
    return value

def snapshot(db):
    result=[]
    for row in db.execute('SELECT c.*,p.name AS product_name FROM tracked_crates c JOIN products p ON p.id=c.product_id ORDER BY c.registered_at DESC,c.id'):
        item=dict(row)
        item['events']=[{k:r[k] for k in ('id','action','from_location','to_location','actor','at','note')} for r in db.execute('SELECT * FROM crate_events WHERE crate_id=? ORDER BY id DESC',(row['id'],))]
        scan=db.execute('SELECT id,source,station,recorded_location,crate_revision,actor,at FROM crate_scans WHERE crate_id=? ORDER BY id DESC LIMIT 1',(row['id'],)).fetchone()
        item['last_scan']=dict(scan) if scan else None
        item['location_review']=bool(scan and scan['crate_revision']==row['revision'] and scan['station'].casefold()!=scan['recorded_location'].casefold())
        result.append(item)
    scans=[dict(row) for row in db.execute('SELECT id,tag,crate_id,source,station,recorded_location,crate_revision,actor,at FROM crate_scans ORDER BY id DESC LIMIT 100')]
    return {'crates':result,'scans':scans}

def route(db,user,method,b,s):
    if method=='GET': return snapshot(db)
    s.require(user,('staff','manager'))
    action=b.get('action')
    if action not in ('register','transfer','scan'): raise s.APIError('Choose register, transfer or scan.')
    request_id=b.get('requestId')
    if not isinstance(request_id,str) or not re.fullmatch(r'[A-Za-z0-9-]{16,80}',request_id): raise s.APIError('A valid request ID is required.')
    canonical=s.dump(b)
    old=db.execute('SELECT request_body FROM crate_events WHERE request_id=? UNION ALL SELECT request_body FROM crate_scans WHERE request_id=?',(request_id,request_id)).fetchone()
    if old:
        if old['request_body']!=canonical: raise s.APIError('Request ID already used for different data.',409)
        return snapshot(db)
    tag=tag_id(b.get('tag'),s)
    if action=='scan':
        source=b.get('source')
        if source not in ('simulated','entered_id'): raise s.APIError('Choose simulated or entered_id input. Physical RFID verification is not available.')
        station=location(b.get('station'),s)
        crate=db.execute('SELECT * FROM tracked_crates WHERE tag=?',(tag,)).fetchone()
        db.execute('INSERT INTO crate_scans(tag,crate_id,source,station,recorded_location,crate_revision,actor,at,request_id,request_body) VALUES(?,?,?,?,?,?,?,?,?,?)',
          (tag,crate['id'] if crate else None,source,station,crate['location'] if crate else None,crate['revision'] if crate else None,user['name'],s.now(),request_id,canonical))
        s.audit(db,user,'crate_scan',None,{'tag':tag,'source':source,'station':station,'known':bool(crate)})
        return snapshot(db)
    destination=location(b.get('location'),s)
    note=b.get('note','')
    if not isinstance(note,str) or len(note)>1000: raise s.APIError('Note must be at most 1000 characters.')
    at=s.now()
    if action=='register':
        pid=b.get('productId')
        if not isinstance(pid,str) or not db.execute('SELECT 1 FROM products WHERE id=?',(pid,)).fetchone(): raise s.APIError('Select an existing product.')
        quantity=s.integer(b.get('quantity'),'Declared quantity')
        if db.execute('SELECT 1 FROM tracked_crates WHERE tag=?',(tag,)).fetchone(): raise s.APIError('This tag is already registered.',409)
        cid='CR-'+uuid.uuid4().hex[:12].upper()
        db.execute('INSERT INTO tracked_crates(id,tag,product_id,declared_quantity,location,registered_at) VALUES(?,?,?,?,?,?)',(cid,tag,pid,quantity,destination,at))
        source=None
    else:
        crate=db.execute('SELECT * FROM tracked_crates WHERE tag=?',(tag,)).fetchone()
        if not crate: raise s.APIError('Tag not registered.',404)
        revision=s.integer(b.get('revision'),'Revision',1)
        if revision!=crate['revision']: raise s.APIError('Crate changed. Refresh and review its latest location.',409)
        source=crate['location'];cid=crate['id']
        if source.casefold()==destination.casefold(): raise s.APIError('Choose a different destination.')
        db.execute('UPDATE tracked_crates SET location=?,revision=revision+1 WHERE id=?',(destination,cid))
    db.execute('INSERT INTO crate_events(crate_id,action,from_location,to_location,actor,at,note,request_id,request_body) VALUES(?,?,?,?,?,?,?,?,?)',(cid,action,source,destination,user['name'],at,note.strip(),request_id,canonical))
    s.audit(db,user,'crate_'+action,None,{'crateId':cid,'tag':tag,'from':source,'to':destination})
    return snapshot(db)
