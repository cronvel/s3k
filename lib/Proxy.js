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
	this.target = options.target ;
	this.targetParsed = url.parse( this.target ) ;
	this.endpoint = "http://localhost:" + this.port ;
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
		try {
			var bucket = request.headers.host.split( '.' )[ 0 ] ;
			console.log( "bucket:" , bucket ) ;

			if ( ! request.headers.authorization ) { return ; }

			var auth = S3k.parseAuthorization( request.headers.authorization ) ;
			console.log( "auth:" , auth ) ;

			// Find a way to trash this request
			if ( ! auth ) { return ; }

			console.log( request.rawHeaders ) ;
			console.log( "\n" + request.headers.authorization + "\n\n" ) ;

			var headers = S3k.signHeaders( request , this.accessKeyId , this.secretAccessKey ) ;
			console.log( "headers:" , headers ) ;

			Object.keys( headers ).forEach( headerName => proxyRequest.setHeader( headerName , headers[ headerName ] ) ) ;
			proxyRequest.setHeader( 'Host' , bucket + '.' + this.targetParsed.hostname ) ;

			//console.log( proxyRequest ) ;
		}
		catch ( error ) {
			console.log( error ) ;
			return ;
		}
	} ) ;

	this.server = http.createServer( ( request , response ) => {
		if ( ! request.headers.host ) { return this.unauthorized( response ) ; }
		request.bucket = request.headers.host.split( '.' )[ 0 ] ;
		
		if ( ! this.checkAuth( request ) ) { return this.unauthorized( response ) ; }
		
		this.proxy.web( request , response , {
			target: this.target
		} ) ;
	} ) ;

	console.log( "listening on port" , this.port ) ;
	this.server.listen( this.port ) ;
} ;



Proxy.prototype.checkAuth = function checkAuth( request ) {
	console.log( "bucket:" , request.bucket ) ;

	if ( ! request.headers.authorization ) { return false ; }
	var auth = S3k.parseAuthorization( request.headers.authorization ) ;
	console.log( "auth:" , auth ) ;
	
	if ( ! auth || ! this.clients[ auth.accessKeyId ] ) { return false ; }
	
	// Check if the secret access key was ok
	var expectedHeaders = S3k.signHeaders( request , this.accessKeyId , this.secretAccessKey ) ;
	var expectedAuth = S3k.parseAuthorization( expectedHeaders.Authorization ) ;
	
	if ( auth.signature !== expectedAuth.signature ) { return false ; }
	
	
	return true ;
} ;



Proxy.prototype.unauthorized = function unauthorized( response ) {
	console.log( "\n\n\t>>> UNAUTHORIZED\n\n" ) ;
	response.writeHeader( 403 , {} ) ;
	response.end() ;
} ;


