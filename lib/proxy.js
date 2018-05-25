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
var crypto = require( 'crypto' ) ;
var http = require( 'http' ) ;
var httpProxy = require( 'http-proxy' ) ;



/*
	port: proxy server port

	target: the target of the proxy, e.g.: http://somedomain.tld:80
*/
exports.create = function create( options ) {
	if ( ! options || typeof options !== 'object' || ! options.port || ! options.target ) {
		throw new Error( "proxy.create() needs an option object, having at least those keys: port, target" ) ;
	}

	var targetParsed = url.parse( options.target ) ;
	//console.log( targetParsed ) ;

	// Create a proxy server with custom application logic
	var proxy = httpProxy.createProxyServer( {} ) ;

	// To modify the proxy connection before data is sent, you can listen
	// for the 'proxyReq' event. When the event is fired, you will receive
	// the following arguments:
	// (http.ClientRequest proxyReq, http.IncomingMessage req,
	//  http.ServerResponse res, Object options). This mechanism is useful when
	// you need to modify the proxy request before the proxy connection
	// is made to the target.
	//
	proxy.on( 'proxyReq' , ( proxyRequest , request , response , options ) => {
		try {
			var bucket = request.headers.host.split( '.' )[ 0 ] ;
			console.log( "bucket:" , bucket ) ;
			
			var type = request.headers.authorization.match( /^([^ ]+)/ )[ 1 ] ;
			var credential = request.headers.authorization.match( /Credential=([^,]+)/ )[ 1 ] ;
			var signedHeaders = request.headers.authorization.match( /SignedHeaders=([^,]+)/ )[ 1 ] ;
			var signature = request.headers.authorization.match( /Signature=([^,]+)/ )[ 1 ] ;
		
			console.log( "matches:" , type , credential , signedHeaders , signature ) ;
			
			// Find a way to trash this request
			if ( ! type || ! credential || ! signedHeaders || ! signature ) { return ; }
			
			signedHeaders = signedHeaders.split( ';' ) ;
			
			/*
			var canonicalRequest = request.method + '\n' +
				canonicalURI + '\n' +
				canonicalQueryString + '\n' +
				canonicalHeaders + '\n' +
				signedHeaders + '\n' +
				hashedPayload ;
			*/
			
			var newSignatureStr = '' ;
			
			//signedHeaders.map( header => request.headers[ header ] ).join( 
			
			var newSignature = crypto.createHmac( 'sha256' , newSignatureStr ).digest( 'hex' ) ;
			
			console.log( request.headers ) ;
			proxyRequest.setHeader( 'Host' , bucket + '.' + targetParsed.hostname ) ;
			console.log( proxyRequest.getHeader( 'Host' ) ) ;
			//console.log( proxyRequest ) ;
		}
		catch ( error ) {
			console.log( error ) ;
			return ;
		}
	} ) ;

	var proxyServer = http.createServer( ( request , response ) => {
		// You can define here your custom logic to handle the request
		// and then proxy the request.
		proxy.web( request , response , {
			target: options.target
		} ) ;
	} ) ;

	console.log( "listening on port" , options.port ) ;
	proxyServer.listen( options.port ) ;

	proxy.server = proxyServer ;
	proxy.target = options.target ;
	proxy.endpoint = "http://localhost:" + options.port ;

	return proxy ;
} ;


