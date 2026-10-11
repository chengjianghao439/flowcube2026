'use strict'
const fs=require('node:fs'),Module=require('node:module'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
if(process.env.NODE_ENV!=='test'||process.env.DB_HOST!=='127.0.0.1'||[3306,3307].includes(Number(process.env.DB_PORT))) throw Error('Unsafe test environment')
// Allow repository source/dependencies while all application log files stay in task directory.
process.env.LOG_DIR=path.join(process.env.APP_UPDATE_DOWNLOADS_DIR,'logs')
// Prevent accidental loading of real credential files by any dependency.
const read=fs.readFileSync
fs.readFileSync=function(p,...a){if(typeof p==='string'&&(p===root+'/backend/.env'||/deploy\/production.*\.json$/.test(p)))throw Error('Prohibited credential file read');return read.call(this,p,...a)}
const oldLoad=Module._load
Module._load=function(name,parent,...rest){if(name==='dotenv')return {config(){throw Error('dotenv disabled for synthetic-only test')}};return oldLoad.call(this,name,parent,...rest)}
// The test listener may bind only a random loopback port. No real network printer or notifications.
const net=require('node:net');const connect=net.Socket.prototype.connect
net.Socket.prototype.connect=function(...args){const o=args[0];const host=typeof o==='object'?o.host:typeof args[1]==='string'?args[1]:null;if(host&&!['127.0.0.1','localhost','::1'].includes(host))throw Error('External network blocked: '+host);return connect.apply(this,args)}
