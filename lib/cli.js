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
var S3k = require( './S3k.js' ) ;
var term = require( 'terminal-kit' ).terminal ;
var Promise = require( 'seventh' ) ;

var Logfella = require( 'logfella' ) ;
var log = Logfella.global.use( 's3k-proxy' ) ;
Logfella.setStackTraceLimit( 30 ) ;

var cliManager = require( 'utterminal' ).cli ;

var s3kPackage = require( '../package.json' ) ;



function cli() {
	/* eslint-disable indent */
	cliManager.package( require( '../package.json' ) )
		.app( 'S3K Proxy' )
		.usage( "[<config-files>] [<option1>] [<option2>] [...]" )
		//.noIntro
		.helpOption.logOptions
		.description( "S3K Proxy is used to proxy to a S3 storage, allowing more controle on S3 backend that have limited features." )
		.restArgs( 'urls' ).arrayOf.string
		
		.opt( 'mon' )
			.description( "Open a log server on a port/unix socket" )
		.opt( 'generate-key' ).string
			.description( "Generate an accessKeyId/secretAccessKey pair (config-files is mandatory)" )
		.opt( 'grant-all' ).string
			.description( "In conjunction with --generate-key, grant the key all access to all buckets" )
		.opt( 'bucket-r' ).arrayOf.string
			.description( "In conjunction with --generate-key, grant the key a read access to that bucket. It can be used multiple times." )
		.opt( 'bucket-rw' ).arrayOf.string
			.description( "In conjunction with --generate-key, grant the key a read-write access to that bucket. It can be used multiple times." )
		.opt( 'sign' ).string
			.description( "For debugging purpose, sign the headers using a request's JSON" )
	/* eslint-enable indent */

	var colorLog = false ;

	if ( process.stdout.isTTY ) {
		term.bold.magenta( 'S3k Proxy' ).dim( ' v%s by Cédric Ronvel\n\n' , s3kPackage.version ) ;
		colorLog = true ;
	}

	var configPath , config ,
		args = require( 'minimist' )( process.argv.slice( 2 ) ) ;

	if ( args.h || args.help || process.argv.length <= 2 ) {
		cli.usage() ;
		return ;
	}

	if ( args['generate-key'] ) {
		configPath = args._[ 0 ] && path.join( process.cwd() , args._[ 0 ] ) ;
		cli.generateKey( configPath , args['generate-key'] , args['grant-all'] , args['bucket-rw'] , args['bucket-r'] ) ;
		return ;
	}

	if ( args['sign'] ) {
		configPath = path.join( process.cwd() , args['sign'] ) ;
		cli.sign( configPath ) ;
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

	// Init logfella
	var logLevel = 'info' ;

	if ( args.color !== undefined ) { colorLog = !! args.color ; }

	if ( config.debug ) { logLevel = 'debug' ; }
	else if ( config.verbose ) { logLevel = 'verbose' ; }

	Logfella.global.configure( {
		minLevel: logLevel ,
		overrideConsole: false ,
		transports: [ {
			type: 'console' , timeFormatter: 'dateTime' , color: colorLog , output: 'stdout'
		} ]
	} ) ;

	if ( ! process.stdout.isTTY ) {
		Logfella.global.addTransport( 'console' , {
			minLevel: 'error' , timeFormatter: 'dateTime' , color: colorLog , output: 'stderr'
		} ) ;
	}

	if ( config['mon'] ) {
		Logfella.global.configure( { monPeriod: 1000 } ) ;
		Logfella.global.addTransport( 'netServer' , {
			role: 'mon' ,
			port: typeof config['mon'] === 'number' ? config['mon'] : 10632
		} ) ;
	}

	if ( ! process.stdout.isTTY ) {
		log.info( 'Starting up S3k Proxy v%s by Cédric Ronvel' , s3kPackage.version ) ;
	}

	var proxy = new Proxy( config ) ;
	proxy.startServer() ;

	var gracefulExit = async() => {
		log.info( 'Gracefully exiting' ) ;
		await proxy.stopServer() ;
		log.info( 'Graceful exit done' ) ;
		process.exit() ;
	} ;

	process.on( 'SIGINT' , gracefulExit ) ;	// Ctrl-C
	process.on( 'SIGTERM' , gracefulExit ) ;	// Daemon graceful exit
	process.on( 'SIGHUP' , gracefulExit ) ;		// Daemon graceful reload
}

module.exports = cli ;



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



cli.sign = function sign( configPath ) {
	var config = require( configPath ) ;
	var signature = S3k.signHeaders( config.request , config.accessKeyId , config.secretAccessKey ) ;
	log.info( "Signature:\n%Y" , signature ) ;
} ;


