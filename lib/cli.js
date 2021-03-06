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



const path = require( 'path' ) ;
const S3k = require( './S3k.js' ) ;
const term = require( 'terminal-kit' ).terminal ;
//const Promise = require( 'seventh' ) ;

const Logfella = require( 'logfella' ) ;
const log = Logfella.global.use( 's3k-proxy' ) ;
Logfella.setStackTraceLimit( 30 ) ;

const cliManager = require( 'utterminal' ).cli ;

const s3kPackage = require( '../package.json' ) ;



function cli() {
	var config ;

	/* eslint-disable indent */
	var args = cliManager.package( s3kPackage )
		.app( 'S3K Proxy' )
		.introIfTTY
		.helpOption
		.camel
		.description( "S3K Proxy is used to proxy to a S3 storage, allowing more controle on backends that only support a subset of S3 features." )
		.arg( 'config-path' ).string
			.description( "The config to load, it must be a .json or a .kfg" )
		.opt( 'generate-key' )
			.typeLabel( 'key' )
			.description( "Generate an accessKeyId/secretAccessKey pair (config-path is mandatory)" )
		.opt( 'grant-all' ).flag
			.description( "In conjunction with --generate-key, grant the key all access to all buckets" )
		.opt( 'bucket-r' ).arrayOf.string
			.typeLabel( 'bucket-name' )
			.description( "In conjunction with --generate-key, grant the key a read access to that bucket. It can be used multiple times." )
		.opt( 'bucket-rw' ).arrayOf.string
			.typeLabel( 'bucket-name' )
			.description( "In conjunction with --generate-key, grant the key a read-write access to that bucket. It can be used multiple times." )
		.opt( 'sign' ).string
			.typeLabel( 'request.json' )
			.description( "For debugging purpose, sign the headers using a request's JSON" )
		.addLogOptions( { mon: true , stderrIfNotTTY: true , symbol: true } )
		.details( "Any extra option will override the config.\nE.g. to override the config's port: --port 1234\n" )
		.run() ;
	/* eslint-enable indent */

	if ( args.sign ) {
		args.sign = path.join( process.cwd() , args.sign ) ;
		cli.sign( args.sign ) ;
		return ;
	}

	if ( ! args.configPath ) {
		cliManager.displayHelp() ;
		return ;
	}

	args.configExt = path.extname( args.configPath ) ;
	args.configPath = path.join( process.cwd() , args.configPath ) ;

	if ( args.ext === '.json' ) {
		config = require( args.configPath ) ;
	}
	else {
		config = require( 'kung-fig' ).load( args.configPath ) ;
	}

	if ( args.generateKey ) {
		//cli.generateKey( args.configPath , args.generateKey , args.grantAll , args.bucketRw , args.bucketR ) ;
		cli.generateKey( config , args ) ;
		return ;
	}

	// Assign after generateKey()
	Object.assign( config , args ) ;

	if ( ! process.stdout.isTTY ) {
		log.info( 'Starting up S3K Proxy v%s by Cédric Ronvel' , s3kPackage.version ) ;
	}

	var proxy = new S3k.Proxy( config ) ;
	proxy.startServer() ;

	var gracefulExit = async () => {
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



cli.generateKey = function( config , options ) {
	var bucketsObject = {} ,
		clientObject = {} ,
		kfgSource ,
		found = false ,
		fs = require( 'fs' ) ,
		hashKit = require( 'hash-kit' ) ;

	if ( ! options.accessKeyId ) { options.accessKeyId = hashKit.randomBase64( 15 ) ; }

	var secretAccessKey = hashKit.randomBase64( 32 ) ;

	term( "Access Key ID: %s\n" , options.accessKeyId ) ;
	term( "Secret Access Key: %s\n" , secretAccessKey ) ;

	if ( ! config.clients ) { config.clients = {} ; }

	if ( options.grantAll ) {
		config.clients[ options.accessKeyId ] = {
			secretAccessKey: secretAccessKey ,
			grantAll: true
		} ;
	}
	else {
		bucketsObject = {} ;

		if ( options.bucketRw ) {
			options.bucketRw.forEach( bucket => bucketsObject[ bucket ] = "rw" ) ;
		}

		if ( options.bucketR ) {
			options.bucketR.forEach( bucket => bucketsObject[ bucket ] = "r" ) ;
		}

		clientObject[ options.accessKeyId ] = { secretAccessKey: secretAccessKey } ;

		if ( Object.keys( bucketsObject ).length ) {
			clientObject[ options.accessKeyId ].buckets = bucketsObject ;
		}
	}

	term( "\nAdding the key to the file: %s\n" , options.configPath ) ;

	if ( options.ext === '.json' ) {
		Object.assign( config.clients , clientObject ) ;
		fs.writeFileSync( options.configPath , JSON.stringify( config , null , '\t' ) ) ;
	}
	else {
		kfgSource = fs.readFileSync( options.configPath , 'utf8' ) ;

		kfgSource = kfgSource.replace( /(?:^|\n)clients *:(?:\n(?=[\n\t #]|$)|[^\n])*/ , match => {
			found = true ;

			var insert = require( 'kung-fig' ).stringify( clientObject , { hasOperators: false } )
				.replace( /^|\n/g , match_ => match_ + '\t' ) ;

			if ( match[ match.length - 1 ] === '\n' ) {
				return match + insert ;
			}

			return match + '\n' + insert ;

		} ) ;

		if ( ! found ) {
			log.error( "Can't edit config: %s\n" , options.configPath ) ;
			return ;
		}

		fs.writeFileSync( options.configPath , kfgSource ) ;
	}
} ;



cli.sign = function( jsonPath ) {
	var data = require( jsonPath ) ;
	var signature = S3k.signHeaders( data.request , data.accessKeyId , data.secretAccessKey ) ;
	log.info( "Signature:\n%Y" , signature ) ;
} ;

