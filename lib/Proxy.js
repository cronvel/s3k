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

	log.debug( "Proxy server parameters: %Y" , options ) ;

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

	this.bucketRegexp = new RegExp( "^(?:([a-z0-9_-]+).)?" + this.hostname + "(?::" + this.port + ")?" + "$" ) ;
}

module.exports = Proxy ;



Proxy.prototype.startServer = function startServer() {
	this.server = http.createServer( ( request , response ) => {
		log.debug( "Received a new request %s http(s)://%s%s\nHeaders: %Y" , request.method , request.headers.host , request.url , request.headers ) ;

		if ( this.preliminaries( request , response ) || this.checkAuth( request , response ) ) {
			return ;
		}

		this.remoteRequest( request , response ) ;
	} ) ;

	log.info( "listening on port %s" , this.port ) ;
	this.server.listen( this.port ) ;
} ;



Proxy.prototype.preliminaries = function preliminaries( request , response ) {
	if ( ! request.headers.host ) {
		this.badRequest( response , "No host" ) ;
		return true ;
	}

	var match = request.headers.host.match( this.bucketRegexp ) ;

	if ( ! match ) {
		this.badRequest( response , "Bad host" ) ;
		return true ;
	}

	request.bucket = match[ 1 ] ;
	log.debug( "Bucket: %s" , request.bucket ) ;
} ;



Proxy.prototype.checkAuth = function checkAuth( request , response ) {
	var auth , access , expectedHeaders , expectedAuth ;

	if ( ! request.headers.authorization ) {
		this.unauthorized( response , "No authorization header" ) ;
		return true ;
	}

	// Check if there is an authorization header with a known access key ID
	try {
		auth = S3k.parseAuthorization( request.headers.authorization ) ;
	}
	catch ( error ) {
		this.unauthorized( response , error ) ;
		return true ;
	}

	log.debug( "Parsed auth: %Y" , auth ) ;

	if ( ! this.clients[ auth.accessKeyId ] ) {
		this.unauthorized( response , "Unknown access key ID" ) ;
		return true ;
	}

	// Check if the secret access key used was ok
	expectedHeaders = S3k.signHeadersFromRequest( request , auth.accessKeyId , this.clients[ auth.accessKeyId ].secretAccessKey ) ;

	try {
		expectedAuth = S3k.parseAuthorization( expectedHeaders.Authorization ) ;
	}
	catch ( error ) {
		// Should not happen
		this.internalServerError( response , error ) ;
		return true ;
	}

	if ( auth.signature !== expectedAuth.signature ) {
		this.unauthorized( response , "Signatures mismatch" ) ;
		return true ;
	}

	// Check if it has access to that bucket
	if ( ! this.clients[ auth.accessKeyId ].grantAll ) {
		access = this.clients[ auth.accessKeyId ].buckets[ request.bucket ] ;

		if ( ! access ) {
			this.unauthorized( response , "Access to this bucket denied" ) ;
			return true ;
		}

		switch ( request.method ) {
			case 'GET' :
			case 'HEAD' :
			case 'OPTIONS' :
				if ( access !== 'r' && access !== 'rw' ) {
					this.unauthorized( response , "Access to this bucket denied" ) ;
					return true ;
				}
				break ;

			case 'POST' :
			case 'PUT' :
			case 'PATCH' :
			case 'DELETE' :
				if ( access !== 'rw' ) {
					this.unauthorized( response , "Write access to this bucket denied" ) ;
					return true ;
				}
				break ;

			default :
				this.unauthorized( response , "HTTP method denied" ) ;
				return true ;
		}
	}

	log.debug( "Auth: ok!" ) ;
} ;



Proxy.prototype.remoteRequest = function remoteRequest_( request , response ) {
	log.debug( "Original headers: %Y" , request.headers ) ;

	var remoteHost = request.bucket + '.' + this.targetParsed.host ;

	var remoteRequestHeaders = Object.assign( {} , request.headers ) ;
	delete remoteRequestHeaders.authorization ;
	delete remoteRequestHeaders.Authorization ;

	var signedHeaders = { host: remoteHost } ;
	if ( request.headers['x-amz-date'] ) { signedHeaders['x-amz-date'] = request.headers['x-amz-date'] ; }
	if ( request.headers['x-amz-content-sha256'] ) { signedHeaders['x-amz-content-sha256'] = request.headers['x-amz-content-sha256'] ; }

	S3k.signHeaders(
		{
			host: remoteHost ,
			method: request.method ,
			path: request.url ,
			headers: signedHeaders
		} ,
		this.accessKeyId ,
		this.secretAccessKey
	) ;

	Object.assign( remoteRequestHeaders , signedHeaders ) ;

	log.debug( "Remote request headers: %Y" , remoteRequestHeaders ) ;

	var remoteRequestOptions = {
		url: this.targetParsed.protocol + '//' + remoteHost + request.url ,
		headers: remoteRequestHeaders
	} ;

	//log.debug( "Remote request options: %Y" , remoteRequestOptions ) ;

	var remoteRequest = requestModule( remoteRequestOptions ) ;
	remoteRequest.on( 'response' , remoteResponse => {
		var remoteResponseHeaders = remoteResponse.headers ;
		//var remoteResponseHeaders = Object.assign( {} , remoteResponse.headers ) ;

		log.debug( "Remote response headers: %Y" , remoteResponseHeaders ) ;

		// If we need to modify headers, we have to .writeHead() before .pipe(),
		// or any original headers will overwrite our modification.
		response.writeHead( remoteResponse.statusCode , remoteResponse.statusMessage , remoteResponseHeaders ) ;
		remoteResponse.pipe( response ) ;
	} ) ;

	//request.pipe( remoteRequest ).pipe( response ) ;
	request.pipe( remoteRequest ) ;
} ;



Proxy.prototype.badRequest = function badRequest( response , reason = '' ) {
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



Proxy.prototype.unauthorized = function unauthorized( response , reason = '' ) {
	var text = "403 - Unauthorized. " + reason ;
	log.debug( "%s" , text ) ;

	try {
		response.writeHead( 403 , {
			'X-S3k-Proxy-Error': text
		} ) ;
	}
	catch ( error ) {}

	response.end( text ) ;
} ;



Proxy.prototype.internalServerError = function internalServerError( response , reason = '' ) {
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
