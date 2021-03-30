/*
	S3K

	Copyright (c) 2018 - 2021 Cédric Ronvel

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



var Promise = require( 'seventh' ) ;
var S3k = require( '..' ) ;
var fs = require( 'fs' ) ;
var path = require( 'path' ) ;
var kungFig = require( 'kung-fig' ) ;

var Logfella = require( 'logfella' ) ;

var config , proxyConfig , proxy ;



before( () => {
	if ( teaTime.cliManager.parsedArgs.proxy ) {
		config = require( '../conf/s3-proxy.local.json' ) ;
		proxyConfig = kungFig.load( __dirname + '/../conf/proxy.local.kfg' ) ;
		proxy = new S3k.Proxy( proxyConfig ) ;
		proxy.startServer() ;
		//console.log( proxy ) ;
	}
	else {
		config = kungFig.load( __dirname + '/../conf/s3-unit-test.local.kfg' ) ;
	}
} ) ;



describe( "Test are done in S3k-core" , function() {
	
	it( "..." ) ;
} ) ;

