import Rx from 'rx';
import fs from 'fs-extra';
import path from 'path';
import observableFromNodeCallback from './observableFromNodeCallback';

// TODO: move to fs-rx
const realpath = observableFromNodeCallback( fs.realpath );
const lstat = observableFromNodeCallback( fs.lstat );
const readdir = observableFromNodeCallback( fs.readdir );

/**
 * Adds a symbolic link's target path the the elements of the given observable.
 *
 * @param  {Observable.<Scope|Module>}   observable   List of `Scope` or `Module` objects
 * @return {Observable.<Scope|Module>}
 */
function addSymlinkTargetPath( observable ) {
  return observable.flatMap( scopeOrModule => {
    if( scopeOrModule.isSymlink ) {
      return realpath( scopeOrModule.path )
        .map( path => { scopeOrModule.targetPath = path; return scopeOrModule; } )
    } else {
      scopeOrModule.targetPath = '';
      return Rx.Observable.just( scopeOrModule );
    }
  } );
}

/**
 * Retrieves a `Directory` ( an object with a path and a content list )
 * from the given directory path.
 *
 * @param  {string}                  dirPath
 * @return {Observable.<Directory>}            Observable with a single `Directory` element
 */
function getDirectory( dirPath ) {
  return readdir( dirPath )
    .map( contents => ({
        path: dirPath,
        contents
      }) );
}

/**
 * Retrieves all `Scope`s from the given `Directory`.
 * A scope is nothing, but a directory that starts with '@'. A `Scope`
 * already contains information on its sub-modules and whether it is a
 * symbolic link.
 *
 * @param  {Directory}          directory
 * @return {Observable.<Scope>}              Observable with `Scope`s
 */
function getScopesFromDir( directory ) {
  const scopes = directory.contents.filter( el => el.startsWith( '@' ) );

  return Rx.Observable.fromArray( scopes )
    .flatMap( scopeName => {
      const scopePath = path.join( directory.path, scopeName );

      // TODO: make sure it is actually a directory
      const $stats = lstat( scopePath );
      const $scopeModules = getDirectory( scopePath )
        .flatMap( getModulesFromDir )
        .toArray();

      return Rx.Observable.combineLatest( $stats, $scopeModules,
        ( stats, scopeModules ) => ({
          name: scopeName,
          path: scopePath,
          isSymlink: stats.isSymbolicLink(),
          modules: scopeModules
        }) )
        .let( addSymlinkTargetPath );
    } );
}

/**
 * Retrieves all `Module`s from the given `Directory`.
 * A `Module` already contains information on whether it is a symbolic link.
 *
 * @param  {Directory}            directory
 * @return {Observable.<Module>}               Observable with `Module`s
 */
function getModulesFromDir( directory ) {
  const modules = directory.contents.filter( el => !el.startsWith( '@' ) );

  return Rx.Observable.fromArray( modules )
    .flatMap( moduleName => {
      const modulePath = path.join( directory.path, moduleName );

      const $stats = lstat( modulePath );

      // TODO: make sure it is actually a directory
      return $stats.map( stats => ({
          name: moduleName,
          path: modulePath,
          isSymlink: stats.isSymbolicLink()
        }) )
        .let( addSymlinkTargetPath );
    } );
}

const isSymlink = ( scopeOrModule ) => scopeOrModule.isSymlink;
const isNotSymlink = ( scopeOrModule ) => !scopeOrModule.isSymlink;

/**
 * Retrieves a list with all modules of the given directory
 * that are symlinked in one way or another:
 *
 *  - node_modules/symlinkedModule
 *  - node_modules/@symlinkedScope/module
 *  - node_modules/@scope/symlinkedModule
 *
 * This is only done for 1 level, **not** recursively.
 *
 * @param  {string}                        dirPath
 * @return {Observable.<SymlinkedModule>}
 */
export default function getSymlinkedModules( dirPath ) {

  const $directory = getDirectory( dirPath );

  const $scopes = $directory.flatMap( getScopesFromDir ).share(); // TODO: share not really working
  const $modules = $directory.flatMap( getModulesFromDir );

  const $symlinkedScopedModules = $scopes
    .filter( isNotSymlink )
    .flatMap( scope => {
      return Rx.Observable.fromArray( scope.modules )
        .filter( isSymlink )
        .map( mod => ({
          name: path.join( scope.name, mod.name ),
          path: mod.path,
          target: mod.targetPath
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
          target: path.join( scope.targetPath, mod.name ),
          hasSymlinkedScope: true,
          scopePath: scope.path,
          scopeTarget: scope.targetPath
        }) );
    } );

  const $unscopedSymlinkedModules = $modules
    .filter( isSymlink )
    .map( mod => ({
      name: mod.name,
      path: mod.path,
      target: mod.targetPath
    }) );

  return Rx.Observable.merge(
    $symlinkedScopedModules,
    $modulesFromSymlinkedScopes,
    $unscopedSymlinkedModules );
}
