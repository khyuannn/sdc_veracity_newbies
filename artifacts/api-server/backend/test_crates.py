import tempfile
import unittest
from pathlib import Path
import crates
import server as s

class CrateTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.old=s.DB; s.DB=str(Path(self.temp.name)/'crates.db'); s.init()
        with s.connect() as db: db.execute("INSERT INTO products(id,name,recorded) VALUES('P1','Bottles',12)")
    def tearDown(self): s.DB=self.old; self.temp.cleanup()
    def call(self,body=None,role='staff'):
        with s.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            return crates.route(db,s.USERS[role],'GET' if body is None else 'POST',body or {},s)
    def register(self,**changes):
        body={'action':'register','tag':'demo-001','productId':'P1','quantity':12,'location':'Stockroom','requestId':'register-request-0001'};body.update(changes);return body
    def transfer(self,**changes):
        body={'action':'transfer','tag':'DEMO-001','revision':1,'location':'Shelf','requestId':'transfer-request-0001'};body.update(changes);return body
    def test_register_transfer_history_does_not_change_stock(self):
        self.call(self.register()); result=self.call(self.transfer())['crates'][0]
        self.assertEqual(result['location'],'Shelf');self.assertEqual(result['revision'],2)
        self.assertEqual(result['events'][0]['from_location'],'Stockroom')
        self.assertEqual(result['events'][0]['actor'],'Staff A');self.assertEqual(len(result['events']),2)
        with s.connect() as db:
            self.assertEqual(db.execute('SELECT recorded FROM products').fetchone()[0],12)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM movements').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM counts').fetchone()[0],0)
    def test_retry_idempotent_and_conflicting_reuse_rejected(self):
        body=self.register();self.call(body);self.call(body)
        self.call(self.transfer());self.call(self.transfer())
        self.assertEqual(len(self.call()['crates'][0]['events']),2)
        with self.assertRaises(s.APIError) as error:self.call(self.transfer(location='Other'))
        self.assertEqual(error.exception.status,409)
    def test_stale_revision_and_same_location_rejected(self):
        self.call(self.register());self.call(self.transfer())
        for body in (self.transfer(requestId='transfer-request-0002'),self.transfer(revision=2,requestId='transfer-request-0003')):
            with self.assertRaises(s.APIError):self.call(body)
        self.assertEqual(len(self.call()['crates'][0]['events']),2)
    def test_owner_read_only_and_duplicate_tag_rejected(self):
        with self.assertRaises(s.APIError) as error:self.call(self.register(),role='owner')
        self.assertEqual(error.exception.status,403)
        self.call(self.register(),role='manager')
        self.assertEqual(len(self.call(role='owner')['crates']),1)
        with self.assertRaises(s.APIError):self.call(self.register(requestId='register-request-0002'))
    def test_invalid_fields_leave_no_partial_registration(self):
        for change in ({'quantity':True},{'quantity':-1},{'tag':'bad tag'},{'productId':'missing'},{'location':''},{'requestId':'bad'}):
            with self.assertRaises(s.APIError):self.call(self.register(**change))
        self.assertEqual(self.call()['crates'],[])
    def test_init_is_repeatable_and_data_persists(self):
        self.call(self.register());s.init();self.assertEqual(self.call()['crates'][0]['tag'],'DEMO-001')
    def scan(self,**changes):
        body={'action':'scan','tag':'DEMO-001','source':'simulated','station':'Stockroom','requestId':'scan-request-0000001'};body.update(changes);return body
    def test_scan_opens_known_crate_and_preserves_inventory(self):
        self.call(self.register()); state=self.call(self.scan())
        self.assertEqual(state['crates'][0]['last_scan']['source'],'simulated')
        self.assertFalse(state['crates'][0]['location_review'])
        self.assertEqual(state['scans'][0]['recorded_location'],'Stockroom')
        self.assertEqual(len(state['crates'][0]['events']),1)
        with s.connect() as db:
            self.assertEqual(db.execute('SELECT recorded FROM products').fetchone()[0],12)
            for table in ('movements','counts','ledger'): self.assertEqual(db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0],0)
    def test_mismatched_reader_location_only_flags_review(self):
        self.call(self.register());state=self.call(self.scan(station='Shelf'))
        self.assertTrue(state['crates'][0]['location_review'])
        self.assertEqual(state['crates'][0]['location'],'Stockroom')
        self.assertEqual(state['crates'][0]['revision'],1)
        state=self.call(self.transfer())
        self.assertFalse(state['crates'][0]['location_review'])
        self.assertEqual(state['scans'][0]['recorded_location'],'Stockroom')
    def test_unknown_scan_does_not_create_crate_or_product(self):
        state=self.call(self.scan());self.assertEqual(state['crates'],[])
        self.assertIsNone(state['scans'][0]['crate_id'])
        self.assertIsNone(state['scans'][0]['recorded_location'])
        with s.connect() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM products').fetchone()[0],1)
    def test_scan_retry_and_cross_action_request_reuse(self):
        self.call(self.register()); self.call(self.scan());self.call(self.scan())
        self.assertEqual(len(self.call()['scans']),1)
        with self.assertRaises(s.APIError):self.call(self.scan(station='Shelf'))
        with self.assertRaises(s.APIError):self.call(self.transfer(requestId='scan-request-0000001'))
        with self.assertRaises(s.APIError):self.call(self.scan(requestId='register-request-0001'))
    def test_scan_source_validation_and_permissions(self):
        for change in ({'source':'rfid_verified'},{'source':None},{'station':''},{'station':'x'*81}):
            with self.assertRaises(s.APIError):self.call(self.scan(**change))
        with self.assertRaises(s.APIError) as error:self.call(self.scan(),role='owner')
        self.assertEqual(error.exception.status,403)
        self.assertEqual(self.call()['scans'],[])
    def test_id_entry_and_scans_persist_across_init(self):
        self.call(self.register());self.call(self.scan(source='entered_id'));s.init()
        state=self.call(role='owner');self.assertEqual(state['scans'][0]['source'],'entered_id')
        self.assertEqual(state['scans'][0]['actor'],'Staff A')
    def test_get_does_not_mutate_and_latest_scan_controls_review(self):
        self.call(self.register());self.call(self.scan(station='Shelf'))
        self.assertTrue(self.call()['crates'][0]['location_review'])
        state=self.call(self.scan(requestId='scan-request-0000002',station='stockroom'))
        self.assertFalse(state['crates'][0]['location_review'])
        self.assertEqual(len(self.call()['scans']),2)
