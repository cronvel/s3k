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
var aws4 = require( 'aws4' ) ;



/*
	port: proxy server port

	target: the target of the proxy, e.g.: http://somedomain.tld:80
*/
exports.create = function create( options ) {
	if ( ! options || typeof options !== 'object' || ! options.port || ! options.target ) {
		throw new Error( "proxy.create() needs an option object, having at least those keys: port, target" ) ;
	}
	
	console.log( options ) ;
	
	var targetParsed = url.parse( options.target ) ;
	//console.log( targetParsed ) ;

	// Create a proxy server with custom application logic
	var proxy = httpProxy.createProxyServer( {} ) ;

	// Intercept request
	proxy.on( 'proxyReq' , ( proxyRequest , request , response , proxyOptions ) => {
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
			var parsed = url.parse( 'http://' + request.headers.host + request.url ) ;
			console.log( parsed ) ;
			process.exit() ;
			*/
			
			console.log( request.rawHeaders ) ;
			console.log( "\n" + request.headers.authorization + "\n\n" ) ;
			
			var opts = {
				host: request.headers.host ,
				path: request.url ,
				service: 's3' ,
				headers: {}
			} ;
			
			if ( request.headers['x-amz-content-sha256'] ) {
				opts.headers['X-Amz-Content-Sha256'] = request.headers['x-amz-content-sha256'] ;
			}
			
			var obj = { accessKeyId: options.accessKeyId , secretAccessKey: options.secretAccessKey } ;
			console.log( obj ) ;
			aws4.sign( opts , { accessKeyId: options.accessKeyId , secretAccessKey: options.secretAccessKey } ) ;
			console.log( opts ) ;
			process.exit() ;
			
			//console.log( request ) ;
			
			/*
			var canonicalRequest = request.method + '\n' +
				parsed.pathname + '\n' +
				parsed.query + '\n' +
				signedHeaders.map( header => request.headers[ header ] ).join() + '\n' +
				signedHeaders + '\n' +
				hashedPayload ;
			//*/
			
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


