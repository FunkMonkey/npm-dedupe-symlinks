import Rx from 'rx';
import path from 'path';
import fs from 'fs-extra';
import child_process from 'child_process';

import observableFromNodeCallback from './observableFromNodeCallback';

// TODO: move to fs-rx
const symlink = observableFromNodeCallback( fs.symlink );
const unlink = observableFromNodeCallback( fs.unlink );
const move = observableFromNodeCallback( fs.move );
const ensureDir = observableFromNodeCallback( fs.ensureDir );
const remove = observableFromNodeCallback( fs.remove );
const exists = ( path ) => Rx.Observable.fromCallback( fs.stat, fs, (err, result) => result == null ? false : true )( path ); // TODO check for EOENT

/**
 * Moves the `node_modules` sub-folder from one directory to another
 * @param  {string}      from
 * @param  {string}      to
 * @return {Observable}        Empty or trash.
 */
function moveNodeModules( from, to ) {
  const fromPath = path.join( from, "node_modules" );
  const toPath = path.join( to, "node_modules" );

  return exists( fromPath ).flatMap( doesExist => {
    return doesExist ?
      ensureDir( path.dirname( toPath )).flatMap( () => move(fromPath, toPath) ) :
      Rx.Observable.empty();
  } );
}

// TODO: don't log to the console
/**
 * Spawns the `npm dedupe` process in the given directory. Logs to the console.
 *
 * @param  {string}                     dirPath
 * @return {Observable.<ChildProcess>}           Observable with single element
 */
function spawnNPMDedupe( dirPath ) {
  return Rx.Observable.create( observer => {
    console.log( "deduping", dirPath );

    // we need 'shell' for windows
    const ls = child_process.spawn( 'npm', ['dedupe'], { cwd: dirPath, env: process.env, shell: true } );
    observer.onNext( ls );

    ls.stdout.on( 'data', data => {
      console.log( data.toString() );
    } );

    ls.stderr.on( 'data', data => {
      console.error( data.toString() );
    });

    ls.on( 'close', code => {
      console.log( `'npm dedupe' exited with code ${code}` );
      if( code === 0 )
        observer.onCompleted();
      else
        observer.onError( new Error( code ) );
    });

  });
}


// TODO: don't log to the console
// TODO: don't allow multiple uses of same symlink source
/**
 * Performs the actuall deduplication (including moving `node_modules`) in the
 * given directory for the given symlinked modules.
 *
 * @param  {string}             dirPath
 * @param  {SymlinkedModule[]}  linkedModules   List of modules (most likely retrieved by using `getSymlinkedModules`)
 * @return {Observable}                         Only contains rubbish
 */
export default function dedupe( dirPath, linkedModules ) {

  const $allModules = Rx.Observable.fromArray( linkedModules );

  const $modulesFromSymlinkedScopesGrouped = $allModules
    .filter( val => val.hasSymlinkedScope )
    .groupBy( mod => mod.scopePath, mod => mod );

  const $scopeSymlinks = $modulesFromSymlinkedScopesGrouped
    .flatMap( scope => scope.first().map( mod => ({
      path: mod.scopePath,
      target: mod.scopeTarget
    }) ) );

  const $symlinkedModules = $allModules.filter( val => !val.hasSymlinkedScope );

  const $allSymlinks = Rx.Observable.merge( $scopeSymlinks, $symlinkedModules);

  // TODO: figure out if there is a better way in rx to have a step-by-step process
  // where subscriptions only happen after each step (maybe concat or concatMap)
  const $done =
     // unlink symbolic links
     $allSymlinks
    .flatMap( link => unlink( link.path ) )
    .toArray()

    // move node_modules into directory structure that will be deduped
    .flatMap( () =>
      $allModules
        .tap( mod => console.log( `moving node_modules from ${mod.target} to ${mod.path}` ) )
        .flatMap( mod => moveNodeModules( mod.target, mod.path ) ) )
    .toArray()

    // dedupe
    .flatMap( () => spawnNPMDedupe( dirPath ) )
    .toArray()

    // move deduped node_modules back into its original module
    .flatMap( () =>
      $allModules
        .tap( mod => console.log( `moving node_modules from ${mod.path} to ${mod.target}` ) )
        .flatMap( mod => moveNodeModules( mod.path, mod.target ) ) )
    .toArray()

    // remove created folder structure
    .flatMap( () => $allSymlinks.flatMap( link => remove( link.path ) ) )
    .toArray()

    // re-create symlinks
    .flatMap( () => $allSymlinks.flatMap( link => symlink( link.target, link.path, 'dir' ) ) )
    .toArray()
    .map( () => "DONE" );

  return $done;
}
