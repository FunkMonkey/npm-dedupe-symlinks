import Rx from 'rx';
import path from 'path';
import fs from 'fs-extra';

import observableFromNodeCallback from './observableFromNodeCallback';

const PATH = 'E:/Projekte/copal/src/node_modules';

const realpath = observableFromNodeCallback( fs.realpath );
const lstat = observableFromNodeCallback( fs.lstat );
const readdir = observableFromNodeCallback( fs.readdir );
const symlink = observableFromNodeCallback( fs.symlink );
const unlink = observableFromNodeCallback( fs.unlink );
const rename = observableFromNodeCallback( fs.rename );
const mkdirs = observableFromNodeCallback( fs.mkdirs );
const remove = observableFromNodeCallback( fs.remove );
const exists = ( path ) => Rx.Observable.fromCallback( fs.stat, fs, (err, result) => result == null ? false : true )( path ); // TODO check for EOENT

// function readdir( ...args ) {
//   const source = observableFromNodeCallback( fs.readdir )( ...args );
//   return source.flatMap( Rx.Observable.fromArray );
// }

function log( ...args ) {
  console.log( ...args );
}

const logObserver = Rx.Observer.create(
  el => console.log( el ),
  err => console.error( err ),
  () => console.log( 'completed' )
);

function addLinkedPath( observable ) {
  return observable.flatMap( scopeOrModule => {
    if( scopeOrModule.isSymlink ) {
      return realpath( scopeOrModule.path )
        .map( path => { scopeOrModule.linkedPath = path; return scopeOrModule; } )
    } else {
      scopeOrModule.linkedPath = '';
      return Rx.Observable.just( scopeOrModule );
    }
  } );
}

function getDirectory( path ) {
  return readdir( path )
    .map( contents => ({
        path: path,
        contents
      }) );
}

function getScopes( directory ) {
  const scopes = directory.contents.filter( el => el.startsWith( '@' ) );

  return Rx.Observable.fromArray( scopes )
    .flatMap( scopeName => {
      const scopePath = path.join( directory.path, scopeName );

      const $stats = lstat( scopePath );
      const $scopeModules = getDirectory( scopePath )
        .flatMap( getModules )
        .toArray();

      return Rx.Observable.combineLatest( $stats, $scopeModules,
        ( stats, scopeModules ) => ({
          name: scopeName,
          path: scopePath,
          isSymlink: stats.isSymbolicLink(),
          modules: scopeModules
        }) )
        .let( addLinkedPath );
    } );
}

function getModules( directory ) {
  const modules = directory.contents.filter( el => !el.startsWith( '@' ) );

  return Rx.Observable.fromArray( modules )
    .flatMap( moduleName => {
      const modulePath = path.join( directory.path, moduleName );

      const $stats = lstat( modulePath );

      return $stats.map( stats => ({
          name: moduleName,
          path: modulePath,
          isSymlink: stats.isSymbolicLink()
        }) )
        .let( addLinkedPath );
    } );
}

const isSymlink = ( scopeOrModule ) => scopeOrModule.isSymlink;
const isNotSymlink = ( scopeOrModule ) => !scopeOrModule.isSymlink;

/**
 * Retrieves a list (observable) with all modules of the given directory
 * that are symlinked in one way or another:
 *
 *  - node_modules/symlinkedModule
 *  - node_modules/@symlinkedScope/module
 *  - node_modules/@scope/symlinkedModule
 *
 * This is only done for 1 level, *not* recursively.
 *
 * @param  {string}      dirPath
 * @return {Observable}
 */
function getLinkedModules( dirPath ) {
  const $directory = getDirectory( dirPath );

  const $scopes = $directory.flatMap( getScopes ).share(); // TODO: share not really working
  const $modules = $directory.flatMap( getModules );

  const $symlinkedScopedModules = $scopes
    .filter( isNotSymlink )
    .flatMap( scope => {
      return Rx.Observable.fromArray( scope.modules )
        .filter( isSymlink )
        .map( mod => ({
          name: path.join( scope.name, mod.name ),
          path: mod.path,
          target: mod.linkedPath
        }) );
    } );

  const $modulesFromSymlinkedScopes = $scopes
    .filter( isSymlink )
    .flatMap( scope => {
      return Rx.Observable.fromArray( scope.modules )
        .do( mod => {
          if( mod.isSymlink )
            throw new Error( `Symlinked modules not allowed inside symlinked scopes (${scope.name}/${mod.name})` );
        } )
        .map( mod => ({
          name: path.join( scope.name, mod.name ),
          path: mod.path,
          target: path.join( scope.linkedPath, mod.name ),
          hasSymlinkedScope: true,
          scopePath: scope.path,
          scopeTarget: scope.linkedPath
        }) );
    } );

  const $unscopedSymlinkedModules = $modules
    .filter( isSymlink )
    .map( mod => ({
      name: mod.name,
      path: mod.path,
      target: mod.linkedPath
    }) );

  return Rx.Observable.merge(
    $symlinkedScopedModules,
    $modulesFromSymlinkedScopes,
    $unscopedSymlinkedModules );
}

Rx.Observable.just( PATH )
  .flatMap( getLinkedModules )
  .toArray()
  .flatMap( dedupe )
  .subscribe( logObserver );

function moveNodeModules( from, to ) {
  const fromPath = path.join( from, "node_modules" );
  const toPath = path.join( to, "node_modules" );
  console.log( `moving node_modules from ${fromPath} to ${toPath}` );
  return exists( fromPath ).flatMap( doesExist => {
    console.log( "Exists", doesExist );
    return doesExist ? mkdirs( path.dirname( toPath )).flatMap( () => rename(fromPath, toPath) ) : Rx.Observable.just("");
  } );
}

// TODO: don't allow multiple uses of same symlink source
function dedupe( linkedModules ) {
  const $allModules = Rx.Observable.fromArray( linkedModules );

  const $modulesFromSymlinkedScopes = $allModules
    .filter( val => val.hasSymlinkedScope );

  const $modulesFromSymlinkedScopesGrouped = $modulesFromSymlinkedScopes
    .groupBy( mod => mod.scopePath, mod => mod );

  const $scopeSymlinks = $modulesFromSymlinkedScopesGrouped
    .flatMap( scope => scope.first().map( mod => ({
      path: mod.scopePath,
      target: mod.scopeTarget
    }) ) );

  const $symlinkedModules = $allModules.filter( val => !val.hasSymlinkedScope );

  const $allSymlinks = Rx.Observable.merge( $scopeSymlinks, $symlinkedModules);

  const $unlinked = $allSymlinks.flatMap( link => unlink( link.path ) );
  const $moved = $unlinked.toArray().flatMap( () => $allModules.flatMap( mod => moveNodeModules( mod.target, mod.path ) ) );
  const $dedupe = $moved.toArray().do( log.bind(null, "dedupe") );
  const $movedBack = $dedupe.toArray().flatMap( () => $allModules.flatMap( mod => moveNodeModules( mod.path, mod.target ) ) );
  const $removed = $movedBack.toArray().flatMap( () => $allSymlinks.flatMap( link => remove( link.path ) ) );
  const $relinked = $removed.toArray().flatMap( () => $allSymlinks.flatMap( link => symlink( link.target, link.path, 'dir' ) ) );

  return $relinked;
}
