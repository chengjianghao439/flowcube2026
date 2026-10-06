'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
require('./helpers/testEnvironment').configureTestEnvironment()
const {pool}=require('../backend/src/config/db')
const {splitSqlStatements}=require('../backend/src/database/sqlStatements')
test('security migrations replay safely and actual schema matches column types plus ordered indexes',async()=>{
 const conn=await pool.getConnection()
 try{
  const [[db]]=await conn.query('SELECT DATABASE() AS db')
  assert.equal(db.db,process.env.DB_NAME)
  for(let pass=0;pass<2;pass++)for(const file of ['276_auth_session_families.sql','277_print_client_credentials.sql'])for(const sql of splitSqlStatements(fs.readFileSync(path.join(__dirname,'../backend/src/database',file),'utf8')))await conn.query(sql)
  const [columns]=await conn.query("SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('auth_session_families','refresh_token_sessions','print_clients','print_jobs')")
  const expected=[['auth_session_families','family_id','char(36)','NO'],['auth_session_families','user_id','bigint unsigned','NO'],['auth_session_families','revoked_at','datetime','YES'],['refresh_token_sessions','family_id','char(36)','YES'],['print_clients','credential_hash','char(64)','YES'],['print_clients','revoked_at','datetime','YES'],['print_clients','warehouse_id','bigint unsigned','YES'],['print_jobs','claimed_client_id','varchar(200)','YES'],['print_jobs','claimed_credential_hash','char(64)','YES']]
  for(const [table,name,type,nullable]of expected){const col=columns.find(c=>c.TABLE_NAME===table&&c.COLUMN_NAME===name);assert.ok(col,table+'.'+name);assert.equal(col.COLUMN_TYPE,type);assert.equal(col.IS_NULLABLE,nullable)}
  const [indexes]=await conn.query("SELECT TABLE_NAME,INDEX_NAME,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('auth_session_families','refresh_token_sessions') GROUP BY TABLE_NAME,INDEX_NAME")
  for(const [table,name,cols]of [['auth_session_families','PRIMARY','family_id'],['auth_session_families','idx_auth_family_user','user_id'],['refresh_token_sessions','idx_refresh_family','family_id,user_id']])assert.equal(indexes.find(i=>i.TABLE_NAME===table&&i.INDEX_NAME===name)?.cols,cols)
 }finally{conn.release();await pool.end()}
})
