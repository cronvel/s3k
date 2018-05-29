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



var Promise = require( 'seventh' ) ;
var AWS = require( 'aws-sdk' ) ;
var aws4 = require( 'aws4' ) ;



var defaultRetryOptions = {
	retries: 10 ,
	coolDown: 10 ,
	raiseFactor: 1.5 ,
	maxCoolDown: 30000
} ;



/*
	Full doc:
	https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html
*/



function S3k( options ) {
	if ( ! options || typeof options !== 'object' || ! options.endpoint || ! options.accessKeyId || ! options.secretAccessKey ) {
		throw new Error( 'S3k should be creted with at least those mandatory options: endpoint, accessKeyId and secretAccessKey' ) ;
	}

	this.endpoint = new AWS.Endpoint( options.endpoint ) ;
	this.accessKeyId = options.accessKeyId ;
	this.secretAccessKey = options.secretAccessKey ;
	this.bucket = options.bucket || null ;
	this.prefix = options.prefix || null ;
	this.delimiter = options.delimiter || null ;

	this._s3 = new AWS.S3( {
		endpoint: new AWS.Endpoint( this.endpoint ) ,
		accessKeyId: this.accessKeyId ,
		secretAccessKey: this.secretAccessKey
	} ) ;

	Promise.promisifyAnyNodeApi( this._s3 ) ;
}

module.exports = S3k ;

S3k.Proxy = require( './Proxy.js' ) ;



/*
	Bucket
*/
S3k.prototype.getBucketAcl = function( params ) {
	params = params ? Object.assign( {} , params ) : {} ;
	if ( this.bucket && ! params.Bucket ) { params.Bucket = this.bucket ; }

	return this._s3.getBucketAclAsync( params ) ;
} ;



/*
	Bucket
	ACL: private | public-read | public-read-write | authenticated-read
	AccessControlPolicy: `object`, where:
		Grants: `array` of `object` :
			Grantee: `object` where:
				Type: CanonicalUser | AmazonCustomerByEmail | Group
				DisplayName: `string`
				EmailAddress: `string`
				ID: `string`
				URI: `string`
			Permission: FULL_CONTROL | WRITE | WRITE_ACP | READ | READ_ACP
		Owner: `object` where:
			DisplayName: `string`
			ID: `string`
*/
S3k.prototype.setBucketAcl =
S3k.prototype.putBucketAcl = function( params ) {
	params = params ? Object.assign( {} , params ) : {} ;
	if ( this.bucket && ! params.Bucket ) { params.Bucket = this.bucket ; }

	return this._s3.putBucketAclAsync( params ) ;
} ;



/*
	Bucket, Prefix, Delimiter
*/
S3k.prototype.listObjects = function( params ) {
	params = params ? Object.assign( {} , params ) : {} ;

	if ( this.bucket && ! params.Bucket ) { params.Bucket = this.bucket ; }
	if ( this.prefix ) { params.Prefix = this.prefix + ( params.Prefix || '' ) ; }
	if ( this.delimiter && ! params.Delimiter ) { params.Delimiter = this.delimiter ; }

	return this._s3.listObjectsAsync( params ) ;
} ;



/*
	Bucket, Key
*/
S3k.prototype.getObject = function( params = {} ) {
	params = params ? Object.assign( {} , params ) : {} ;

	if ( this.bucket && ! params.Bucket ) { params.Bucket = this.bucket ; }
	if ( this.prefix ) { params.Key = this.prefix + params.Key ; }

	console.log( "Params:" , params ) ;

	return this._s3.getObjectAsync( params ) ;
} ;



/*
	Bucket, Key, Body
*/
S3k.prototype.putObject = function( params = {} ) {
	params = params ? Object.assign( {} , params ) : {} ;

	if ( this.bucket && ! params.Bucket ) { params.Bucket = this.bucket ; }
	if ( this.prefix ) { params.Key = this.prefix + params.Key ; }

	return this._s3.putObjectAsync( params ) ;
} ;



/*
	Bucket, Key
*/
S3k.prototype.deleteObject = function( params = {} ) {
	params = params ? Object.assign( {} , params ) : {} ;

	if ( this.bucket && ! params.Bucket ) { params.Bucket = this.bucket ; }
	if ( this.prefix ) { params.Key = this.prefix + params.Key ; }

	return this._s3.deleteObjectAsync( params ) ;
} ;



/*
	Bucket, Key
*/
S3k.prototype.deleteObjects = function( params = {} ) {
	params = params ? Object.assign( {} , params ) : {} ;

	var keys ;

	if ( this.bucket && ! params.Bucket ) { params.Bucket = this.bucket ; }

	if ( Array.isArray( keys = params.Keys || params.Key ) ) {
		if ( this.prefix ) {
			params.Delete = {
				Objects: keys.map( key => ( { Key: this.prefix + key } ) ) ,
				Quiet: false
			} ;
		}
		else {
			params.Delete = {
				Objects: keys.map( key => ( { Key: key } ) ) ,
				Quiet: false
			} ;
		}
	}
	else if ( this.prefix ) {
		params.Key = this.prefix + params.Key ;
	}

	return this._s3.deleteObjectAsync( params ) ;
} ;



S3k.parseAuthorization = function parseAuthorization( authorization ) {
	if ( ! authorization ) { return null ; }
	
	var type = authorization.match( /^[^ ]+/ ) ;
	if ( ! type ) { return null ; }
	
	type = type[ 0 ] ;
	
	var credential = authorization.match( /Credential=([^,]+)/ ) ;
	var signedHeaders = authorization.match( /SignedHeaders=([^,]+)/ ) ;
	var signature = authorization.match( /Signature=([^,]+)/ ) ;

	if ( ! credential || ! signedHeaders || ! signature ) { return null ; }
	
	return {
		type: type ,
		credential: credential[ 1 ] ,
		accessKeyId: credential[ 1 ].split( '/' )[ 0 ] ,
		signedHeaders: signedHeaders[ 1 ].split( ';' ) ,
		signature: signature[ 1 ]
	} ;
} ;



S3k.signHeaders = function signHeaders( request , accessKeyId , secretAccessKey ) {
	var opts = {
		host: request.headers.host ,
		method: request.method ,
		path: request.url ,
		service: 's3' ,
		headers: {}
	} ;
	
	if ( request.headers['x-amz-content-sha256'] ) {
		opts.headers['X-Amz-Content-Sha256'] = request.headers['x-amz-content-sha256'] ;
	}
	
	aws4.sign( opts , { accessKeyId: accessKeyId , secretAccessKey: secretAccessKey } ) ;
	//console.log( "Final opts:" , opts ) ;
	
	return opts.headers ;
} ;

