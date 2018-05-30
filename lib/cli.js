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



var path = require( 'path' ) ;
var Proxy = require( './Proxy.js' ) ;
var term = require( 'terminal-kit' ).terminal ;

var Logfella = require( 'logfella' ) ;

var s3kPackage = require( '../package.json' ) ;



function cli() {
	term.bold.magenta( 'S3k Proxy' ).dim( ' v%s by Cédric Ronvel\n\n' , s3kPackage.version ) ;

	var configPath , config ,
		args = require( 'minimist' )( process.argv.slice( 2 ) ) ;

	if ( args.h || args.help ) {
		cli.usage() ;
		return ;
	}

	// Init logfella
	if ( args.debug ) {
		Logfella.global.setGlobalConfig( {
			minLevel: 'debug' ,
			overrideConsole: false ,
			transports: [
				{
					type: 'console' , timeFormatter: 'time' , color: true , output: 'stderr'
				}
			]
		} ) ;
	}
	else {
		Logfella.global.setGlobalConfig( {
			minLevel: 'info' ,
			overrideConsole: false ,
			transports: [
				{
					type: 'console' , timeFormatter: 'time' , color: true , output: 'stderr'
				}
			]
		} ) ;
	}

	if ( args['generate-key'] ) {
		configPath = path.join( process.cwd() , typeof args['generate-key'] === 'string' ? args['generate-key'] : args._[ 0 ] ) ;
		cli.generateKey( configPath ) ;
		return ;
	}

	if ( args._[ 0 ] ) {
		configPath = path.join( process.cwd() , args._[ 0 ] ) ;
		config = require( configPath ) ;
	}
	else {
		config = {} ;
	}

	delete args._ ;
	Object.assign( config , args ) ;

	console.log( config ) ;

	var proxy = new Proxy( config ) ;
	proxy.startServer() ;
}

module.exports = cli ;



cli.usage = function usage() {
	term.blue( "Usage is: s3k-proxy [<config files>] [<option1>] [<option2>] [...]\n" ) ;
	term.blue( "Available options:\n" ) ;
	term.blue( "  -h , --help                  Show this help\n" ) ;
	term.blue( "       --debug                 Turn the debug log-level on\n" ) ;
	term.blue( "       --generate-key <file>   Generate an accessKeyId/secretAccessKey pair\n" ) ;
	term( '\n' ) ;
} ;



cli.generateKey = function generateKey( configPath ) {
	var fs = require( 'fs' ) ;
	var hashKit = require( 'hash-kit' ) ;

	var accessKeyId = hashKit.randomBase64( 15 ) ;
	var secretAccessKey = hashKit.randomBase64( 32 ) ;

	term( "Access Key ID: %s\n" , accessKeyId ) ;
	term( "Secret Access Key: %s\n" , secretAccessKey ) ;

	if ( ! configPath ) { return ; }

	var config = require( configPath ) ;

	if ( ! config.clients ) { config.clients = {} ; }

	config.clients[ accessKeyId ] = {
		secretAccessKey: secretAccessKey ,
		buckets: []
	} ;

	term( "\nAdding the key: %s\n" , configPath ) ;
	fs.writeFileSync( configPath , JSON.stringify( config , null , '\t' ) ) ;
} ;


