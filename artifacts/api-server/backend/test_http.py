"""Exercise cookie authentication and HTTP routing against an ephemeral API."""
import json
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
import http.cookiejar
from pathlib import Path
from http.server import ThreadingHTTPServer
import server as s

class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();s.DB=str(Path(self.temp.name)/'http.sqlite3');s.init()
        self.http=ThreadingHTTPServer(('127.0.0.1',0),s.Handler)
        self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start()
        self.base=f'http://127.0.0.1:{self.http.server_port}/'
        self.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def tearDown(self):
        self.http.shutdown();self.http.server_close();self.thread.join();self.temp.cleanup()
    def call(self,path,body=None):
        request=urllib.request.Request(self.base+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
        with self.opener.open(request,timeout=5) as response:return json.load(response)
    def test_demo_entry_requires_an_explicit_valid_role(self):
        for body in ({}, {'role':'admin'}, {'role':None}, {'role':[]}):
            with self.assertRaises(urllib.error.HTTPError) as err:self.call('session',body)
            self.assertEqual(err.exception.code,400)
        with self.assertRaises(urllib.error.HTTPError) as err:self.call('state')
        self.assertEqual(err.exception.code,401)
    def test_change_role_ends_and_revokes_session(self):
        self.call('session',{'role':'owner'})
        with s.connect() as db:old_token=db.execute('SELECT token FROM sessions').fetchone()['token']
        self.assertEqual(self.call('session/end',{}),{'ok':True})
        with self.assertRaises(urllib.error.HTTPError) as err:self.call('state')
        self.assertEqual(err.exception.code,401)
        request=urllib.request.Request(self.base+'state',headers={'Cookie':f'veracity_session={old_token}'})
        with self.assertRaises(urllib.error.HTTPError) as err:urllib.request.urlopen(request,timeout=5)
        self.assertEqual(err.exception.code,401)
        self.assertEqual(self.call('session/end',{}),{'ok':True})
        self.call('session',{'role':'staff'})
        self.assertEqual(self.call('state')['user']['role'],'staff')
    def test_reentering_replaces_the_previous_session(self):
        self.call('session',{'role':'manager'})
        self.call('session',{'role':'staff'})
        with s.connect() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM sessions').fetchone()[0],1)
        self.assertEqual(self.call('state')['user']['role'],'staff')
    def test_session_permissions_and_full_journey(self):
        with self.assertRaises(urllib.error.HTTPError) as err:self.call('state')
        self.assertEqual(err.exception.code,401)
        self.call('session',{'role':'manager'})
        self.call('imports',{'kind':'products','rows':[{'id':'A','name':'Drink','recorded':50}]})
        self.call('imports',{'kind':'movements','rows':[{'id':'T1','product_id':'A','kind':'Sale','quantity':-7,'occurred_at':'2026-01-01T00:00:00Z'}]})
        self.call('session',{'role':'staff'})
        c=self.call('counts',{'productId':'A','counted':43})
        with self.assertRaises(urllib.error.HTTPError) as err:self.call('cases/'+c['id']+'/decisions',{'action':'approved','reason':'Verified','version':1})
        self.assertEqual(err.exception.code,403)
        self.call('session',{'role':'manager'})
        result=self.call('cases/'+c['id']+'/decisions',{'action':'approved','reason':'Verified','version':1})
        self.assertEqual(result['finalStock'],43)
        self.assertEqual(self.call('state')['products'][0]['recorded'],43)
        self.assertTrue(self.call('cases/'+c['id']+'/audit'))
    def test_bad_json_and_unsigned_role_header_do_not_authorize(self):
        req=urllib.request.Request(self.base+'state',headers={'X-Role':'manager'})
        with self.assertRaises(urllib.error.HTTPError) as err:self.opener.open(req,timeout=5)
        self.assertEqual(err.exception.code,401)
        req=urllib.request.Request(self.base+'counts',data=b'not json',headers={'Content-Type':'application/json'})
        with self.assertRaises(urllib.error.HTTPError) as err:self.opener.open(req,timeout=5)
        self.assertEqual(err.exception.code,400)
    def test_weekly_report_session_role_and_query_validation(self):
        with self.assertRaises(urllib.error.HTTPError) as err:self.call('reports/weekly')
        self.assertEqual(err.exception.code,401)
        self.call('session',{'role':'staff'})
        with self.assertRaises(urllib.error.HTTPError) as err:self.call('reports/weekly')
        self.assertEqual(err.exception.code,403)
        for role in ('manager','owner'):
            self.call('session',{'role':role})
            report=self.call('reports/weekly?week=2026-01-05')
            self.assertEqual(report['weekStart'],'2026-01-05')
            self.assertEqual(report['timezone'],'Asia/Kuala_Lumpur')
        for query in ('week=', 'week=2026-01-06', 'week=2026-01-05&week=2026-01-12','other=1'):
            with self.subTest(query=query), self.assertRaises(urllib.error.HTTPError) as err:
                self.call('reports/weekly?'+query)
            self.assertEqual(err.exception.code,400)
    def test_evidence_requires_session_and_private_bridge(self):
        import os
        from unittest.mock import patch
        self.call('session', {'role':'manager'})
        self.call('imports', {'kind':'products','rows':[{'id':'A','name':'Drink','recorded':50}]})
        c=self.call('counts', {'productId':'A','counted':43})
        body={'requestKey':'http-retry-key-12345','filename':'receipt.pdf','contentType':'application/pdf','size':200,'version':1}
        path='evidence/'+c['id']+'/uploads'
        with patch.dict(os.environ, {'VERACITY_EVIDENCE_BRIDGE':'private-test-bridge'}):
            with self.assertRaises(urllib.error.HTTPError) as err:self.call(path,body)
            self.assertEqual(err.exception.code,403)
            req=urllib.request.Request(self.base+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','X-Evidence-Bridge':'private-test-bridge'})
            with self.opener.open(req,timeout=5) as response:ticket=json.load(response)
            self.assertTrue(ticket['id'])
            no_cookie=urllib.request.build_opener(urllib.request.ProxyHandler({}))
            unsigned=urllib.request.Request(self.base+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','X-Evidence-Bridge':'private-test-bridge'})
            with self.assertRaises(urllib.error.HTTPError) as err:no_cookie.open(unsigned,timeout=5)
            self.assertEqual(err.exception.code,401)
    def test_product_create_permissions_duplicates_and_live_summary(self):
        self.call('session',{'role':'manager'})
        created=self.call('products',{'name':'Oat milk','recorded':8,'unit_cost':4.25,'note':'New delivery'})
        self.assertTrue(created['evidence_missing'])
        self.call('session',{'role':'staff'})
        with self.assertRaises(urllib.error.HTTPError) as duplicate:
            self.call('products',{'name':'OAT MILK','recorded':8})
        self.assertEqual(duplicate.exception.code,409)
        second=self.call('products',{'name':'Tea','recorded':3})
        self.assertEqual(second['name'],'Tea')
        state=self.call('state')
        self.assertEqual(len(state['products']),2)
        self.assertTrue(any(item['productId']==second['id'] and item['status']=='not_counted' for item in state['summary']['items']))
        self.call('session',{'role':'owner'})
        with self.assertRaises(urllib.error.HTTPError) as forbidden:
            self.call('products',{'name':'Owner product','recorded':1})
        self.assertEqual(forbidden.exception.code,403)

    def test_crate_scan_http_session_permissions_and_persistence(self):
        with self.assertRaises(urllib.error.HTTPError) as error:self.call('crates')
        self.assertEqual(error.exception.code,401)
        self.call('session',{'role':'manager'})
        self.call('imports',{'kind':'products','rows':[{'id':'CR-P','name':'Crate Product','recorded':12}]})
        self.call('crates',{'action':'register','tag':'HTTP-TAG-001','productId':'CR-P','quantity':12,'location':'Stockroom','requestId':'http-register-000001'})
        self.call('session',{'role':'staff'})
        body={'action':'scan','tag':'HTTP-TAG-001','source':'simulated','station':'Rack A','requestId':'http-scan-000000001'}
        self.call('crates',body);state=self.call('crates',body)
        self.assertEqual(len(state['scans']),1)
        self.assertTrue(state['crates'][0]['location_review'])
        self.assertEqual(state['crates'][0]['location'],'Stockroom')
        self.assertEqual(self.call('state')['products'][0]['recorded'],12)
        self.call('session',{'role':'owner'})
        self.assertEqual(len(self.call('crates')['scans']),1)
        with self.assertRaises(urllib.error.HTTPError) as error:self.call('crates',body)
        self.assertEqual(error.exception.code,403)

if __name__=='__main__':unittest.main()
