/*
	S3K

	Copyright (c) 2018 Cédric Ronvel

	The MIT License (MIT)

	Permission is hereby granted, free of charge, to any person obtaining a copy
	of this software and associated documentation files (the "Software"), to deal
	in the Software without restriction, including without limitation the rights
	to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
	copies of the Software, and to permit persons to whom the Software is
	furnished to do so, subject to the following conditions:

	The above copyright notice and this permission notice shall be included in all
	copies or substantial portions of the Software.

	THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
	IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
	FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
	AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
	LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
	OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
	SOFTWARE.
*/

"use strict" ;



const url = require( 'url' ) ;
//const http = require( 'http' ) ;
const requestModule = require( 'request' ) ;
const S3k = require( './S3k.js' ) ;
const string = require( 'string-kit' ) ;
const streamKit = require( 'stream-kit' ) ;
const serverKit = require( 'server-kit' ) ;
const Promise = require( 'seventh' ) ;

const Logfella = require( 'logfella' ) ;
const log = Logfella.global.use( 's3k-proxy' ) ;



/*
	port: proxy server port
	target: the target of the proxy, e.g.: http://somedomain.tld:80
	type: 's3' or 'web'
*/
function Proxy( options ) {
	if ( ! options || typeof options !== 'object' || ! options.port || ! options.hostname || ! options.target ) {
		throw new Error( "new Proxy() needs an option object, having at least those keys: port, target" ) ;
	}

	//log.debug( "Proxy server parameters: %Y" , options ) ;

	log.mon.status = 'unstarted' ;
	log.mon.request = 0 ;
	log.mon.requestInProgress = 0 ;
	log.mon.upload = 0 ;
	log.mon.download = 0 ;

	this.port = options.port ;
	this.proto = "http" ;
	this.hostname = options.hostname ;
	this.host = this.hostname + ':' + this.port ;
	this.endpoint = this.proto + '://' + this.host ;
	this.target = options.target ;
	this.targetParsed = url.parse( this.target ) ;
	this.hostId = options.hostId || 'host-' + ( '' + Math.random() ).slice( 2 , 8 ) ;
	this.accessKeyId = options.accessKeyId ;
	this.secretAccessKey = options.secretAccessKey ;
	this.isWebProxy = options.type === 'web' ;	// If true, the proxy does not act as a S3 proxy, but a regular web proxy (it abstracts S3 away)
	this.clients = options.clients || {} ;
	this.anonymous = options.anonymous || null ;
	this.server = null ;
	this.status = 'unstarted' ;

	this.bucketHostRegexp = new RegExp( "^(?:([a-z0-9_-]+).)?" + this.hostname + "(?::" + this.port + ")?" + "$" ) ;
}

module.exports = Proxy ;



Proxy.prototype.startServer = function() {

	this.server = new serverKit.Server( { port: this.port , http: true } , client => {
		log.mon.request ++ ;
		log.mon.requestInProgress ++ ;

		client.response.on( 'finish' , () => {
			log.mon.upload += client.socket.bytesRead ;
			log.mon.download += client.socket.bytesWritten ;
			log.mon.requestInProgress -- ;
			client.log.debug( "Request processed" ) ;
		} ) ;

		this.preliminaries( client ) || this.checkAuth( client ) || this.remoteRequest( client ) ;
	} ) ;

	this.server.on( 'close' , () => {
		log.mon.status = this.status = 'closed' ;
		log.info( "Server closed" ) ;
	} ) ;

	this.server.on( 'listening' , () => {
		log.mon.status = this.status = 'started' ;
		log.info( "Listening on port %s" , this.port ) ;
	} ) ;

	//this.server.listen( this.port ) ;
} ;



Proxy.prototype.stopServer = function() {
	if ( this.status !== 'started' ) { return ; }

	log.mon.status = this.status = 'closing' ;
	log.info( "The server is closing" ) ;
	this.server.close() ;

	return new Promise( resolve => this.server.once( 'close' , resolve ) ) ;
} ;



Proxy.prototype.preliminaries = function( client ) {
	client.data = {
		reqId: 'req-' + ( '' + Math.random() ).slice( 2 , 8 ) ,
		bucket: null ,
		bucketInPath: null ,
		logData: null
	} ;

	// This creates a child logger for client, with interesting meta
	client.log = log.useHook( data => {
		if ( ! data.meta ) { data.meta = {} ; }
		data.meta.id = client.data.reqId ;
	} ) ;

	client.log.debug( "Received a new request: %s http(s)://%s%s\nHeaders: %Y" , client.request.method , client.request.headers.host , client.request.url , client.request.headers ) ;

	if ( ! client.request.headers.host ) {
		this.badRequest( client , "No host" ) ;
		return true ;
	}

	var match = client.request.headers.host.match( this.bucketHostRegexp ) ;

	if ( ! match ) {
		this.badRequest( client , "Bad host" ) ;
		return true ;
	}

	client.data.bucket = match[ 1 ] ;

	if ( ! client.data.bucket ) {
		client.request.url.replace( /^\/([a-z0-9_-]+)/ , ( match_ , bucket ) => {
			client.data.bucketInPath = true ;
			client.data.bucket = bucket ;
			return '' ;
		} ) ;
	}

	client.log.debug( "Bucket: %s" , client.data.bucket ) ;
} ;



Proxy.prototype.checkAuth = function( client ) {
	var auth , access , expectedHeaders , expectedAuth , rights ;

	if ( ! client.request.headers.authorization ) {
		if ( ! this.anonymous ) {
			this.unauthorized( client , "No authorization header" ) ;
			return true ;
		}

		// Anonymous access
		client.log.debug( "Anonymous access" ) ;
		rights = this.anonymous ;
	}
	else {
		// Check if there is an authorization header with a known access key ID
		try {
			auth = S3k.parseAuthorization( client.request.headers.authorization ) ;
		}
		catch ( error ) {
			this.unauthorized( client , error ) ;
			return true ;
		}

		client.log.debug( "Parsed auth: %Y" , auth ) ;

		if ( ! this.clients[ auth.accessKeyId ] ) {
			this.unauthorized( client , "Unknown access key ID" ) ;
			return true ;
		}


		try {
			// Check if the secret access key used was ok
			// /!\ For instance there is a rare bug with .signHeader(), so this line is temporarly moved inside the try block
			expectedHeaders = S3k.signHeadersFromRequest( client.request , auth.signedHeaders , auth.accessKeyId , this.clients[ auth.accessKeyId ].secretAccessKey ) ;

			expectedAuth = S3k.parseAuthorization( expectedHeaders.Authorization ) ;
		}
		catch ( error ) {
			// Should not happen
			log.error( client.data.logData , ".signHeaders()/.parseAuthorization(): %E" , error ) ;
			this.internalServerError( client , error ) ;
			return true ;
		}

		if ( auth.signature !== expectedAuth.signature ) {
			this.unauthorized( client , "Signatures mismatch (expecting '" + expectedAuth.signature + "' but got '" + auth.signature + ")" ) ;
			return true ;
		}

		rights = this.clients[ auth.accessKeyId ] ;
	}

	// Check if it has access to that bucket
	if ( ! rights.grantAll ) {
		access = rights.buckets[ client.data.bucket ] ;

		if ( ! access ) {
			this.forbidden( client , "Access to this bucket denied" ) ;
			return true ;
		}

		switch ( client.method ) {
			case 'GET' :
			case 'HEAD' :
			case 'OPTIONS' :
				if ( access !== 'r' && access !== 'rw' ) {
					this.forbidden( client , "Access to this bucket denied" ) ;
					return true ;
				}
				break ;

			case 'POST' :
			case 'PUT' :
			case 'PATCH' :
			case 'DELETE' :
				if ( access !== 'rw' ) {
					this.forbidden( client , "Write access to this bucket denied" ) ;
					return true ;
				}
				break ;

			default :
				this.forbidden( client , "HTTP method denied" ) ;
				return true ;
		}
	}

	client.log.debug( "Auth: ok!" ) ;
} ;



Proxy.prototype.remoteRequest = function( client ) {
	var remoteHost , remotePath , remoteRequestHeaders , signedHeaders , remoteRequestOptions , remoteRequest ;

	remoteHost = client.data.bucket + '.' + this.targetParsed.host ;
	remoteRequestHeaders = Object.assign( {} , client.request.headers ) ;
	delete remoteRequestHeaders.authorization ;
	delete remoteRequestHeaders.Authorization ;

	signedHeaders = { host: remoteHost } ;

	if ( client.request.headers['x-amz-date'] ) { signedHeaders['x-amz-date'] = client.request.headers['x-amz-date'] ; }
	if ( client.request.headers['x-amz-content-sha256'] ) { signedHeaders['x-amz-content-sha256'] = client.request.headers['x-amz-content-sha256'] ; }

	if ( client.data.bucketInPath ) {
		remotePath = client.request.url.replace( /^\/[a-z0-9_-]+\/?/ , '/' ) ;
	}
	else {
		remotePath = client.request.url ;
	}

	try {
		// /!\ For instance there is a rare bug with .signHeader(), so this line is temporarly moved inside a try block
		S3k.signHeaders(
			{
				host: remoteHost ,
				method: client.method ,
				path: remotePath ,
				headers: signedHeaders
			} ,
			this.accessKeyId ,
			this.secretAccessKey
		) ;
	}
	catch ( error ) {
		// Should not happen
		log.error( client.data.logData , ".signHeaders(): %E" , error ) ;
		this.internalServerError( client , error ) ;
		return ;
	}

	Object.assign( remoteRequestHeaders , signedHeaders ) ;

	remoteRequestOptions = {
		method: client.method ,
		url: this.targetParsed.protocol + '//' + remoteHost + remotePath ,
		headers: remoteRequestHeaders
	} ;

	client.log.debug( "Remote request: %s %s -- headers: %Y" , remoteRequestOptions.method , remoteRequestOptions.url , remoteRequestHeaders ) ;

	remoteRequest = requestModule( remoteRequestOptions ) ;
	remoteRequest.on( 'response' , async( remoteResponse ) => {
		var remoteResponseBody ,
			remoteResponseHeaders = remoteResponse.headers ;
		//var remoteResponseHeaders = Object.assign( {} , remoteResponse.headers ) ;

		client.log.debug( "Remote response: %s %s -- headers: %Y" , remoteResponse.statusCode , remoteResponse.statusMessage , remoteResponseHeaders ) ;

		// If we need to modify headers, we have to .writeHead() before .pipe(),
		// or any original headers will overwrite our modification.
		client.response.writeHead( remoteResponse.statusCode , remoteResponse.statusMessage , remoteResponseHeaders ) ;

		// We want to debug local client error
		if ( log.checkLevel( 'debug' ) &&
			remoteResponse.statusCode >= 400 && remoteResponse.statusCode < 500 &&
			remoteResponseHeaders['content-length'] < 2000
		) {
			remoteResponseBody = await streamKit.getFullString( remoteResponse ) ;
			client.response.end( remoteResponseBody ) ;
			return ;
		}

		remoteResponse.pipe( client.response ) ;
	} ) ;

	//client.request.pipe( remoteRequest ).pipe( client.response ) ;
	client.request.pipe( remoteRequest ) ;
} ;



// code, bucket, requestId, HostId
var errorBodyFormat = "<Error><Code>%s</Code><BucketName>%s</BucketName><RequestId>%s</RequestId><HostId>%s</HostId></Error>" ;



Proxy.prototype.badRequest = function( client , reason = '' ) {
	var text = "400 - Bad request. " + reason ;
	client.log.debug( "%s" , text ) ;

	try {
		client.response.writeHead( 400 , {
			'X-S3k-Proxy-Error': text
		} ) ;
	}
	catch ( error ) {}

	client.response.end( text ) ;
} ;



Proxy.prototype.unauthorized = function( client , reason = '' ) {
	var text = "401 - Unauthorized. " + reason ;
	client.log.debug( "%s" , text ) ;

	try {
		client.response.writeHead( 401 , {
			'X-S3k-Proxy-Error': text ,
			'Content-Type': 'application/xml'
		} ) ;
	}
	catch ( error ) {}

	client.response.end( string.format( errorBodyFormat , 'AccessDenied' , client.data.bucket , client.data.reqId , this.hostId ) ) ;
} ;



Proxy.prototype.forbidden = function( client , reason = '' ) {
	var text = "403 - Forbidden. " + reason ;
	client.log.debug( "%s" , text ) ;

	try {
		client.response.writeHead( 403 , {
			'X-S3k-Proxy-Error': text ,
			'Content-Type': 'application/xml'
		} ) ;
	}
	catch ( error ) {}

	client.response.end( string.format( errorBodyFormat , 'AccessDenied' , client.data.bucket , client.data.reqId , this.hostId ) ) ;
} ;



Proxy.prototype.internalServerError = function( client , reason = '' ) {
	var text = "500 - Internal server error. " + reason ;
	client.log.debug( "%s" , text ) ;

	try {
		client.response.writeHead( 500 , {
			'X-S3k-Proxy-Error': text
		} ) ;
	}
	catch ( error ) {}

	client.response.end( text ) ;
} ;

