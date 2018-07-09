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



var url = require( 'url' ) ;
var http = require( 'http' ) ;
var requestModule = require( 'request' ) ;
var S3k = require( './S3k.js' ) ;
var string = require( 'string-kit' ) ;
var streamKit = require( 'stream-kit' ) ;
var Promise = require( 'seventh' ) ;

var Logfella = require( 'logfella' ) ;
var log = Logfella.global.use( 's3k-proxy' ) ;



/*
	port: proxy server port
	target: the target of the proxy, e.g.: http://somedomain.tld:80
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
	this.accessKeyId = options.accessKeyId ;
	this.secretAccessKey = options.secretAccessKey ;
	this.clients = options.clients ;
	this.server = null ;
	this.status = 'unstarted' ;

	this.bucketHostRegexp = new RegExp( "^(?:([a-z0-9_-]+).)?" + this.hostname + "(?::" + this.port + ")?" + "$" ) ;
}

module.exports = Proxy ;



Proxy.prototype.startServer = function startServer() {
	this.server = http.createServer( ( request , response ) => {
		var responseSocket = response.socket ;	// Because this property is nulled after any response.end()

		log.mon.request ++ ;
		log.mon.requestInProgress ++ ;

		log.debug( "Received a new request: %s http(s)://%s%s\nHeaders: %Y" , request.method , request.headers.host , request.url , request.headers ) ;

		response.on( 'finish' , () => {
			log.mon.upload += request.socket.bytesRead ;
			log.mon.download += responseSocket.bytesWritten ;
			log.mon.requestInProgress -- ;
			log.debug( "Request processed" ) ;
		} ) ;

		this.preliminaries( request , response ) || this.checkAuth( request , response ) || this.remoteRequest( request , response ) ;
	} ) ;

	this.server.on( 'close' , () => {
		log.mon.status = this.status = 'closed' ;
		log.info( "Server closed" ) ;
	} ) ;

	this.server.on( 'listening' , () => {
		log.mon.status = this.status = 'started' ;
		log.info( "Listening on port %s" , this.port ) ;
	} ) ;

	this.server.listen( this.port ) ;
} ;



Proxy.prototype.stopServer = function stopServer() {
	if ( this.status !== 'started' ) { return ; }

	log.mon.status = this.status = 'closing' ;
	log.info( "The server is closing" ) ;
	this.server.close() ;

	return new Promise( resolve => this.server.once( 'close' , resolve ) ) ;
} ;



Proxy.prototype.preliminaries = function preliminaries( request , response ) {
	if ( ! request.headers.host ) {
		this.badRequest( request , response , "No host" ) ;
		return true ;
	}

	var match = request.headers.host.match( this.bucketHostRegexp ) ;

	if ( ! match ) {
		this.badRequest( request , response , "Bad host" ) ;
		return true ;
	}

	request.bucket = match[ 1 ] ;

	if ( ! request.bucket ) {
		request.url.replace( /^\/([a-z0-9_-]+)/ , ( match , bucket ) => {
			request.bucketInPath = true ;
			request.bucket = bucket ;
			return '' ;
		} ) ;
	}

	log.debug( "Bucket: %s" , request.bucket ) ;
} ;



Proxy.prototype.checkAuth = function checkAuth( request , response ) {
	var auth , access , expectedHeaders , expectedAuth ;

	if ( ! request.headers.authorization ) {
		this.unauthorized( request , response , "No authorization header" ) ;
		return true ;
	}

	// Check if there is an authorization header with a known access key ID
	try {
		auth = S3k.parseAuthorization( request.headers.authorization ) ;
	}
	catch ( error ) {
		this.unauthorized( request , response , error ) ;
		return true ;
	}

	log.debug( "Parsed auth: %Y" , auth ) ;

	if ( ! this.clients[ auth.accessKeyId ] ) {
		this.unauthorized( request , response , "Unknown access key ID" ) ;
		return true ;
	}

	// Check if the secret access key used was ok
	expectedHeaders = S3k.signHeadersFromRequest( request , auth.signedHeaders , auth.accessKeyId , this.clients[ auth.accessKeyId ].secretAccessKey ) ;

	try {
		expectedAuth = S3k.parseAuthorization( expectedHeaders.Authorization ) ;
	}
	catch ( error ) {
		// Should not happen
		this.internalServerError( request , response , error ) ;
		return true ;
	}

	if ( auth.signature !== expectedAuth.signature ) {
		this.unauthorized( request , response , "Signatures mismatch (expecting '" + expectedAuth.signature + "' but got '" + auth.signature + ")" ) ;
		return true ;
	}

	// Check if it has access to that bucket
	if ( ! this.clients[ auth.accessKeyId ].grantAll ) {
		access = this.clients[ auth.accessKeyId ].buckets[ request.bucket ] ;

		if ( ! access ) {
			this.forbidden( request , response , "Access to this bucket denied" ) ;
			return true ;
		}

		switch ( request.method ) {
			case 'GET' :
			case 'HEAD' :
			case 'OPTIONS' :
				if ( access !== 'r' && access !== 'rw' ) {
					this.forbidden( request , response , "Access to this bucket denied" ) ;
					return true ;
				}
				break ;

			case 'POST' :
			case 'PUT' :
			case 'PATCH' :
			case 'DELETE' :
				if ( access !== 'rw' ) {
					this.forbidden( request , response , "Write access to this bucket denied" ) ;
					return true ;
				}
				break ;

			default :
				this.forbidden( request , response , "HTTP method denied" ) ;
				return true ;
		}
	}

	log.debug( "Auth: ok!" ) ;
} ;



Proxy.prototype.remoteRequest = function remoteRequest_( request , response ) {
	var remoteHost , remotePath , remoteRequestHeaders , signedHeaders , remoteRequestOptions , remoteRequest ;

	remoteHost = request.bucket + '.' + this.targetParsed.host ;
	remoteRequestHeaders = Object.assign( {} , request.headers ) ;
	delete remoteRequestHeaders.authorization ;
	delete remoteRequestHeaders.Authorization ;

	signedHeaders = { host: remoteHost } ;

	if ( request.headers['x-amz-date'] ) { signedHeaders['x-amz-date'] = request.headers['x-amz-date'] ; }
	if ( request.headers['x-amz-content-sha256'] ) { signedHeaders['x-amz-content-sha256'] = request.headers['x-amz-content-sha256'] ; }

	if ( request.bucketInPath ) {
		remotePath = request.url.replace( /^\/[a-z0-9_-]+\/?/ , '/' ) ;
	}
	else {
		remotePath = request.url ;
	}

	S3k.signHeaders(
		{
			host: remoteHost ,
			method: request.method ,
			path: remotePath ,
			headers: signedHeaders
		} ,
		this.accessKeyId ,
		this.secretAccessKey
	) ;

	Object.assign( remoteRequestHeaders , signedHeaders ) ;

	remoteRequestOptions = {
		method: request.method ,
		url: this.targetParsed.protocol + '//' + remoteHost + remotePath ,
		headers: remoteRequestHeaders
	} ;

	log.debug( "Remote request: %s %s -- headers: %Y" , remoteRequestOptions.method , remoteRequestOptions.url , remoteRequestHeaders ) ;

	remoteRequest = requestModule( remoteRequestOptions ) ;
	remoteRequest.on( 'response' , async ( remoteResponse ) => {
		var remoteResponseHeaders = remoteResponse.headers ;
		//var remoteResponseHeaders = Object.assign( {} , remoteResponse.headers ) ;

		log.debug( "Remote response: %s %s -- headers: %Y" , remoteResponse.statusCode , remoteResponse.statusMessage , remoteResponseHeaders ) ;
		
		// If we need to modify headers, we have to .writeHead() before .pipe(),
		// or any original headers will overwrite our modification.
		response.writeHead( remoteResponse.statusCode , remoteResponse.statusMessage , remoteResponseHeaders ) ;
		
		// We want to debug local client error
		if ( log.checkLevel( 'debug' ) &&
			remoteResponse.statusCode >= 400 && remoteResponse.statusCode < 500 &&
			remoteResponseHeaders['content-length'] < 2000
		) {
			remoteResponseBody = await streamKit.getFullString( remoteResponse ) ;
			reponse.end( remoteResponseBody ) ;
			return ;
		}

		remoteResponse.pipe( response ) ;
	} ) ;

	//request.pipe( remoteRequest ).pipe( response ) ;
	request.pipe( remoteRequest ) ;
} ;



// code, bucket, requestId, HostId
var errorBodyFormat = "<Error><Code>%s</Code><BucketName>%s</BucketName><RequestId>%s</RequestId><HostId>%s</HostId></Error>" ;



Proxy.prototype.badRequest = function badRequest( request , response , reason = '' ) {
	var text = "400 - Bad request. " + reason ;
	log.debug( "%s" , text ) ;

	try {
		response.writeHead( 400 , {
			'X-S3k-Proxy-Error': text
		} ) ;
	}
	catch ( error ) {}

	response.end( text ) ;
} ;



Proxy.prototype.unauthorized = function unauthorized( request , response , reason = '' ) {
	var text = "401 - Unauthorized. " + reason ;
	log.debug( "%s" , text ) ;

	try {
		response.writeHead( 401 , {
			'X-S3k-Proxy-Error': text
		} ) ;
	}
	catch ( error ) {}

	response.end( string.format( errorBodyFormat , 'AccessDenied' , request.bucket , "random-request-id-" + ( '' + Math.random() ).slice( 2 ) , "random-request-id" ) ) ;
} ;



Proxy.prototype.forbidden = function forbidden( request , response , reason = '' ) {
	var text = "403 - Forbidden. " + reason ;
	log.debug( "%s" , text ) ;

	try {
		response.writeHead( 403 , {
			'X-S3k-Proxy-Error': text
		} ) ;
	}
	catch ( error ) {}

	response.end( string.format( errorBodyFormat , 'AccessDenied' , request.bucket , "random-request-id-" + ( '' + Math.random() ).slice( 2 ) , "random-request-id" ) ) ;
} ;



Proxy.prototype.internalServerError = function internalServerError( request , response , reason = '' ) {
	var text = "500 - Internal server error. " + reason ;
	log.debug( "%s" , text ) ;

	try {
		response.writeHead( 500 , {
			'X-S3k-Proxy-Error': text
		} ) ;
	}
	catch ( error ) {}

	response.end( text ) ;
} ;

