/*
	S3K

	Copyright (c) 2018 - 2019 Cédric Ronvel

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



describe( "Operation on objects" , function() {
	
	it( "should list objects" , async function() {
		this.timeout( 5000 ) ;
		
		var s3 = new S3k( config ) ;
		var data = await s3.listObjects() ;
		
		console.log( data ) ;
	} ) ;
	
	it( "should put and get some data" , async function() {
		this.timeout( 7000 ) ;
		
		var s3 = new S3k( config ) ;
		var result = await s3.putObject( { Key: "bob.txt" , Body: "OMG, some bob content!\n" } ) ;
		//console.log( "result:" , result ) ;
		var data = await s3.getObject( { Key: "bob.txt" } ) ;
		//console.log( data ) ;
		var content = data.Body.toString() ;
		//console.log( content ) ;
		expect( content ).to.be( "OMG, some bob content!\n" ) ;
	} ) ;
	
	it( "should put and get some streamed data" , async function() {
		this.timeout( 7000 ) ;
		
		var content = '' ,
			count = 0 ,
			originalContent = "OMG, some bob content!\n".repeat( 3000 ) ;
		
		var s3 = new S3k( config ) ;
		var result = await s3.putObject( { Key: "bob.txt" , Body: originalContent } ) ;
		//console.log( "result:" , result ) ;
		var stream = s3.getObjectStream( { Key: "bob.txt" } ) ;
		
		return new Promise( ( resolve , reject ) => {
			stream.on( 'data' , chunk => {
				console.log( "received chunk #" + ( count ++ ) ) ;
				content += chunk.toString()
			} ) ;
			stream.on( 'end' , () => {
				//console.log( content ) ;
				expect( content ).to.be( originalContent ) ;
				resolve() ;
			} ) ;
		} ) ;
	} ) ;
	
	/*
	it( "should put and get some streamed data (tiny)" , async function() {
		this.timeout( 10000 ) ;
		var s3 = new S3k( config ) ;
		var filePath = path.join( __dirname , '../sample/bob.txt' ) ;
		console.log( fs.readFileSync( filePath , 'utf8' ) ) ;
		var result = await s3.putObject( { Key: "bob.txt" , Body: fs.createReadStream( filePath ) } ) ;
		//var result = await s3.putObject( { Key: "bob.txt" , Body: fs.readFileSync( filePath , 'utf8' ) } ) ;
		//console.log( "result:" , result ) ;
		var data = await s3.getObject( { Key: "bob.txt" } ) ;
		//console.log( data ) ;
		var content = data.Body.toString() ;
		//console.log( content ) ;
		expect( content ).to.be( fs.readFileSync( filePath , 'utf8' ) ) ;
	} ) ;
	
	it( "should put and get some streamed data (100KB)" , async function() {
		this.timeout( 10000000 ) ;
		var s3 = new S3k( config ) ;
		var filePath = path.join( __dirname , '../sample/sample.jpg' ) ;
		var result = await s3.putObject( { Key: "sample.jpg" , Body: fs.createReadStream( filePath ) } ) ;
		//console.log( "result:" , result ) ;
		var data = await s3.getObject( { Key: "sample.jpg" } ) ;
		//console.log( data ) ;
		var content = data.Body.toString() ;
		//console.log( content ) ;
		expect( content ).to.be( fs.readFileSync( filePath , 'utf8' ) ) ;
	} ) ;
	
	it( "should put and get some streamed data (1MB)" , async function() {
		this.timeout( 10000000 ) ;
		var s3 = new S3k( config ) ;
		var filePath = path.join( __dirname , '../sample/sample.mp4' ) ;
		var result = await s3.putObject( { Key: "sample.mp4" , Body: fs.createReadStream( filePath ) } ) ;
		//console.log( "result:" , result ) ;
		var data = await s3.getObject( { Key: "sample.mp4" } ) ;
		//console.log( data ) ;
		var content = data.Body.toString() ;
		//console.log( content ) ;
		expect( content ).to.be( fs.readFileSync( filePath , 'utf8' ) ) ;
	} ) ;
	//*/
	
	it( "should put-get-delete-get some data" , async function() {
		this.timeout( 10000 ) ;
		
		var s3 = new S3k( config ) ;
		var result = await s3.putObject( { Key: "bob2.txt" , Body: "OMG, more bob content!\n" } ) ;
		//console.log( "result:" , result ) ;
		var data = await s3.getObject( { Key: "bob2.txt" } ) ;
		//console.log( data ) ;
		var content = data.Body.toString() ;
		//console.log( content ) ;
		expect( content ).to.be( "OMG, more bob content!\n" ) ;
		
		var result = await s3.deleteObject( { Key: "bob2.txt" } ) ;
		//console.log( "result:" , result ) ;
		
		try {
			await s3.getObject( { Key: "bob2.txt" } ) ;
			expect().fail( 'Should throw' ) ;
		}
		catch ( error ) {
			console.log( 'error:' , error ) ;
			expect( error ).to.be.partially.like( { statusCode: 404 , code: 'NoSuchKey' } ) ;
		}
	} ) ;
} ) ;



/*
describe( "Access Control" , function() {
	
	it( "should set (put) and get bucket ACL" , async () => {
		var s3 = new S3k( config ) ;
		
		var result = await s3.setBucketAcl( {
			AccessControlPolicy: {
				Owner: {
					//DisplayName: "2802192",
					ID: "2802192"
				},
				Grants: [
					{
						Grantee: {
							//DisplayName: "2802192",
							ID: "2802192",
							Type: "CanonicalUser"
						},
						Permission: "FULL_CONTROL"
					}
				]
			}
		} ) ;
		console.log( result ) ;
		
		var data = await s3.getBucketAcl() ;
		console.log( JSON.stringify( data , true , '  ' ) ) ;
	} ) ;
} ) ;
*/


