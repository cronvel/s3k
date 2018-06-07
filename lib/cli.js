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
var Promise = require( 'seventh' ) ;

var Logfella = require( 'logfella' ) ;
var log = Logfella.global.use( 's3k-proxy' ) ;

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
	var logLevel = 'info' ;

	if ( args['generate-key'] ) {
		configPath = args._[ 0 ] && path.join( process.cwd() , args._[ 0 ] ) ;
		cli.generateKey( configPath , args['generate-key'] , args['grant-all'] , args['bucket-rw'] , args['bucket-r'] ) ;
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

	if ( config.debug ) { logLevel = 'debug' ; }
	else if ( config.verbose ) { logLevel = 'verbose' ; }

	Logfella.global.configure( {
		minLevel: logLevel ,
		overrideConsole: false ,
		transports: [ {
			type: 'console' , timeFormatter: 'dateTime' , color: true , output: 'stderr'
		} ]
	} ) ;

	if ( config['mon'] ) {
		Logfella.global.configure( { monPeriod: 1000 } ) ;
		Logfella.global.addTransport( 'netServer' , {
			role: 'mon' ,
			port: typeof config['mon'] === 'number' ? config['mon'] : 10632
		} ) ;
	}

	var proxy = new Proxy( config ) ;
	proxy.startServer() ;

	process.on( 'SIGINT' , async() => {
		log.info( 'Gracefully exiting' ) ;
		await proxy.stopServer() ;
		log.info( 'Graceful exit done' ) ;
		process.exit() ;
	} ) ;
}

module.exports = cli ;



cli.usage = function usage() {
	term.blue( "Usage is: s3k-proxy [<config-files>] [<option1>] [<option2>] [...]\n" ) ;
	term.blue( "Available options:\n" ) ;
	term.blue( "  -h , --help                       Show this help\n" ) ;
	term.blue( "       --verbose                    Turn the verbose log-level on\n" ) ;
	term.blue( "       --debug                      Turn the debug log-level on\n" ) ;
	term.blue( "       --mon [<port> | <socket>]    Open a log server on a port/unix socket\n" ) ;
	term.blue( "       --generate-key [<key>]       Generate an accessKeyId/secretAccessKey pair (config-files is mandatory)\n" ) ;
	term.blue( "       --grant-all                  With --generate-key, grant the key all access to all buckets\n" ) ;
	term.blue( "       --bucket-r <bucket-name>     With --generate-key, grant the key a read access to that bucket\n" ) ;
	term.blue( "                                    It can be used multiple times.\n" ) ;
	term.blue( "       --bucket-rw <bucket-name>    With --generate-key, grant the key a read-write access to that bucket\n" ) ;
	term.blue( "                                    It can be used multiple times.\n" ) ;
	term( '\n' ) ;
} ;



cli.generateKey = function generateKey( configPath , accessKeyId , grantAll , bucketRw , bucketR ) {
	var fs = require( 'fs' ) ;
	var hashKit = require( 'hash-kit' ) ;

	if ( ! accessKeyId ) { accessKeyId = hashKit.randomBase64( 15 ) ; }

	var secretAccessKey = hashKit.randomBase64( 32 ) ;

	term( "Access Key ID: %s\n" , accessKeyId ) ;
	term( "Secret Access Key: %s\n" , secretAccessKey ) ;

	if ( ! configPath ) { return ; }

	var config = require( configPath ) ;

	if ( ! config.clients ) { config.clients = {} ; }

	var bucketsObject ;

	if ( grantAll ) {
		config.clients[ accessKeyId ] = {
			secretAccessKey: secretAccessKey ,
			grantAll: true
		} ;
	}
	else {
		bucketsObject = {} ;

		if ( Array.isArray( bucketRw ) ) {
			bucketRw.forEach( bucket => bucketsObject[ bucket ] = "rw" ) ;
		}
		else if ( bucketRw ) {
			bucketsObject[ bucketRw ] = "rw" ;
		}

		if ( Array.isArray( bucketR ) ) {
			bucketR.forEach( bucket => bucketsObject[ bucket ] = "r" ) ;
		}
		else if ( bucketR ) {
			bucketsObject[ bucketR ] = "r" ;
		}

		config.clients[ accessKeyId ] = {
			secretAccessKey: secretAccessKey ,
			buckets: bucketsObject
		} ;
	}

	term( "\nAdding the key: %s\n" , configPath ) ;
	fs.writeFileSync( configPath , JSON.stringify( config , null , '\t' ) ) ;
} ;


