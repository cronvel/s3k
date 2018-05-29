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
var httpProxy = require( 'http-proxy' ) ;
var S3k = require( './S3k.js' ) ;
var string = require( 'string-kit' ) ;

var Logfella = require( 'logfella' ) ;
var log = Logfella.global.use( 's3k-proxy' ) ;



/*
	port: proxy server port
	target: the target of the proxy, e.g.: http://somedomain.tld:80
*/
function Proxy( options ) {
	if ( ! options || typeof options !== 'object' || ! options.port || ! options.target ) {
		throw new Error( "new Proxy() needs an option object, having at least those keys: port, target" ) ;
	}

	console.log( options ) ;

	this.port = options.port ;
	this.proto = "http" ;
	this.host = "localhost:" + this.port ;
	this.endpoint = this.proto + '://' + this.host ;
	this.target = options.target ;
	this.targetParsed = url.parse( this.target ) ;
	this.accessKeyId = options.accessKeyId ;
	this.secretAccessKey = options.secretAccessKey ;
	this.clients = options.clients ;
	this.proxy = null ;
	this.server = null ;
}

module.exports = Proxy ;



Proxy.prototype.startServer = function startServer() {
	// Create a proxy server with custom application logic
	this.proxy = httpProxy.createProxyServer( {} ) ;

	// Intercept request
	this.proxy.on( 'proxyReq' , ( proxyRequest , request , response , proxyOptions ) => {
		var signedHeaders = S3k.signHeaders( request , this.accessKeyId , this.secretAccessKey ) ;
		log.debug( "Signed headers: %Y" , signedHeaders ) ;

		Object.keys( signedHeaders ).forEach( headerName => proxyRequest.setHeader( headerName , signedHeaders[ headerName ] ) ) ;
		proxyRequest.setHeader( 'Host' , request.bucket + '.' + this.targetParsed.hostname ) ;
	} ) ;
	
	this.proxy.on( 'proxyRes' , ( proxyResponse , request , response ) => {
		log.debug( 'RAW response headers from the target %Y' , proxyResponse.headers ) ;
		this.rewriteLocation( proxyResponse , request , response ) ;
	} ) ;

	this.server = http.createServer( ( request , response ) => {
		log.debug( "Received a new request %s http(s)://%s%s" , request.method , request.headers.host , request.url ) ;
		
		if ( this.preliminaries( request , response ) || this.checkAuth( request , response ) ) {
			return ;
		}
		
		this.proxy.web( request , response , {
			target: this.target
		} ) ;
	} ) ;

	log.info( "listening on port %s" , this.port ) ;
	this.server.listen( this.port ) ;
} ;



Proxy.prototype.preliminaries = function preliminaries( request , response ) {
	if ( ! request.headers.host ) {
		this.badRequest( response , "No host" ) ;
		return true ;
	}
	
	var splitted = request.headers.host.split( '.' ) ;
	
	if ( splitted.length < 2 || ( ! splitted[ splitted.length - 1 ].match( /^local(host)?(:.*)?$/ ) && splitted.length < 3 ) ) {
		this.badRequest( response , string.format( "Bad host, missing bucket: %s" , request.headers.host ) ) ;
		return true ;
	}
	
	request.bucket = request.headers.host.split( '.' )[ 0 ] ;
	log.debug( "Bucket: %s" , request.bucket ) ;
} ;



Proxy.prototype.checkAuth = function checkAuth( request , response ) {
	if ( ! request.headers.authorization ) {
		this.unauthorized( response , "No authorization header" ) ;
		return true ;
	}
	
	var auth = S3k.parseAuthorization( request.headers.authorization ) ;
	console.log( "auth:" , auth ) ;
	
	if ( ! auth || ! this.clients[ auth.accessKeyId ] ) {
		this.unauthorized( response , "Unknown access key ID" ) ;
		return true ;
	}
	
	// Check if the secret access key was ok
	var expectedHeaders = S3k.signHeaders( request , this.accessKeyId , this.secretAccessKey ) ;
	var expectedAuth = S3k.parseAuthorization( expectedHeaders.Authorization ) ;
	
	if ( auth.signature !== expectedAuth.signature ) {
		this.unauthorized( response , "Signatures mismatch" ) ;
		return true ;
	}
} ;



Proxy.prototype.rewriteLocation = function rewriteLocation( proxyResponse , request , response ) {
	log.debug( "Location: %s" , proxyResponse.headers.location ) ;
	return ;
	proxyResponse.headers.location = proxyResponse.headers.location.replace(
		/^(https?:\/\/)([^/]+)/ ,
		( match , proto , host ) => this.proto + '://' + request.bucket + '.bob.jack.' + this.host
	) ;

	log.fatal( "bazooka" ) ;
} ;



Proxy.prototype.unauthorized = function unauthorized( response , reason = '' ) {
	var text = "403 - Unauthorized. " + reason ;
	log.debug( "%s" , text ) ;
	
	try {
		response.writeHeader( 403 , {
			'X-S3k-Proxy-Error': text
		} ) ;
	}
	catch ( error ) {}
	
	response.end( text ) ;
} ;



Proxy.prototype.badRequest = function badRequest( response , reason = '' ) {
	var text = "400 - Bad request. " + reason ;
	log.debug( "%s" , text ) ;
	
	try {
		response.writeHeader( 400 , {
			'X-S3k-Proxy-Error': text
		} ) ;
	}
	catch ( error ) {}
	
	response.end( text ) ;
} ;


