#!/usr/bin/env node

var Rx = require( 'rx' );
var symlinkDedupe = require( '../build/index' ).default;

var logObserver = Rx.Observer.create(
  function( el ) {
    console.log( el );
  },
  function( el ) {
    console.error( el );
  },
  function( ) {
     console.log( 'completed' );
  }
);

symlinkDedupe( process.cwd()  ).subscribe( logObserver );
