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
var proxy = require( './proxy.js' ) ;
var term = require( 'terminal-kit' ).terminal ;

var s3kPackage = require( '../package.json' ) ;



function cli() {
	term.bold.magenta( 'S3k Proxy' ).dim( ' v%s by Cédric Ronvel\n\n' , s3kPackage.version ) ;

	var config ,
		args = require( 'minimist' )( process.argv.slice( 2 ) ) ;


	if ( args.h || args.help ) {
		cli.usage() ;
		return ;
	}

	if ( args._[ 0 ] ) {
		config = require( path.join( process.cwd() , args._[ 0 ] ) ) ;
	}
	else {
		config = {} ;
	}

	delete args._ ;
	Object.assign( config , args ) ;

	console.log( config ) ;

	proxy.create( config ) ;
}

module.exports = cli ;



cli.usage = function usage() {
	term.blue( "Usage is: s3k-proxy [<config files>] [<option1>] [<option2>] [...]\n" ) ;
	term.blue( "Available options:\n" ) ;
	term.blue( "  -h , --help             Show this help\n" ) ;
	term( '\n' ) ;
} ;


